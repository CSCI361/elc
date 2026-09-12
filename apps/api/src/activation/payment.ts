import {
  startActivationPaymentSchema,
  type PaymentAdapter,
  type PaymentCheckoutRequest,
} from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeAccountSql } from "../events/store"
import type { PaymentEnvironment } from "../payments/checkout"
import { processPayment } from "../payments/reconcile"
import { readPayment } from "../payments/store"
import { checklistEligibilitySql } from "./guards"
import { parseActivationInput } from "./mutations"
import {
  activationAudit,
  loadActivation,
  readActivationSettings,
  requireActivationOwner,
  type ActivationDependencies,
} from "./store"

const unresolvedSql = `SELECT aa.payment_attempt_id FROM activation_attempts aa JOIN payment_attempts pa ON pa.id = aa.payment_attempt_id
  WHERE aa.event_id = ? AND NOT ((pa.state IN ('failed', 'cancelled') AND pa.provider_payment_id IS NULL AND pa.dispatch_state = 'reconciled')
    OR EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id = pa.id AND r.state = 'succeeded' AND r.amount_minor = pa.amount_minor)) ORDER BY aa.created_at DESC LIMIT 1`

/** Prepare a frozen request and outbox job atomically, before the dispatcher may send a POST. */
export async function prepareActivationPayment(
  env: PaymentEnvironment,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: ActivationDependencies = {}
) {
  const input = parseActivationInput(startActivationPaymentSchema, raw)
  const db = env.DB
  const account = await requireActiveAccount(db, actorId)
  await requireActivationOwner(db, eventId, actorId)
  const hash = await requestHash("activation.payment", { eventId, ...input })
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  if (receipt) return readPayment(db, actorId, receipt.resourceId)
  const activation = await loadActivation(db, eventId)
  const unresolved = await db
    .prepare(unresolvedSql)
    .bind(eventId)
    .first<{ payment_attempt_id: string }>()
  const previousId =
    activation?.successful_payment_attempt_id ?? unresolved?.payment_attempt_id
  if (previousId) {
    const now = (dependencies.now ?? Date.now)()
    try {
      await db.batch([
        ...assertSql(db, activeAccountSql, [actorId]),
        ...assertSql(
          db,
          "EXISTS (SELECT 1 FROM events WHERE id = ? AND organizer_id = ?)",
          [eventId, actorId]
        ),
        db
          .prepare(
            "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(actorId, input.requestId, hash, previousId, now),
      ])
    } catch (error) {
      const replay = await readReceipt(db, actorId, input.requestId, hash)
      if (!replay) {
        if (isTransitionConflict(error))
          throw new ApiFailure(
            "CONFLICT",
            409,
            "The account or event changed before the payment could be read."
          )
        throw error
      }
      return readPayment(db, actorId, replay.resourceId)
    }
    return readPayment(db, actorId, previousId)
  }
  if (!activation || activation.revision !== input.expectedRevision)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Complete and refresh the activation checklist before paying."
    )
  const settings = await readActivationSettings(db)
  const id = crypto.randomUUID()
  const snapshot = JSON.stringify(activation)
  const frozenHash = await requestHash("activation.snapshot", {
    eventId,
    actorId,
    checklist: activation,
    feeSettingsRevision: settings.revision,
    feeMinor: settings.feeMinor,
    currency: "KZT",
  })
  const request: PaymentCheckoutRequest = {
    paymentAttemptId: id,
    idempotencyKey: id,
    purpose: "event_activation",
    subjectId: eventId,
    accountId: actorId,
    amountMinor: settings.feeMinor,
    currency: "KZT",
    requestHash: frozenHash,
    customerEmail: account.email,
    successUrl: `${env.APP_ORIGIN}/payments/return?attempt=${id}`,
    returnUrl: `${env.APP_ORIGIN}/organizer/events/${eventId}`,
  }
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const eligible = checklistEligibilitySql(
    eventId,
    actorId,
    now,
    !!dependencies.now
  )
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(actorId, input.requestId, hash, id, now),
      ...assertSql(db, eligible.predicate, eligible.bindings),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM event_activations WHERE event_id = ? AND revision = ? AND successful_payment_attempt_id IS NULL)",
        [eventId, input.expectedRevision]
      ),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM activation_settings WHERE id = 'default' AND revision = ? AND fee_minor = ?)",
        [settings.revision, settings.feeMinor]
      ),
      ...assertSql(db, `NOT EXISTS (${unresolvedSql})`, [eventId]),
      db
        .prepare(`INSERT INTO payment_attempts (id, purpose, subject_id, provider, idempotency_key, amount_minor, currency,
        actor_id, request_hash, request_json, created_at, updated_at) VALUES (?, 'event_activation', ?, 'polar_sandbox', ?, ?, 'KZT', ?, ?, ?, ?, ?)`)
        .bind(
          id,
          eventId,
          id,
          settings.feeMinor,
          actorId,
          frozenHash,
          JSON.stringify(request),
          now,
          now
        ),
      db
        .prepare(`INSERT INTO activation_attempts (payment_attempt_id, event_id, checklist_revision, fee_settings_revision,
        fee_minor, currency, checklist_snapshot_json, terms_version, created_at) VALUES (?, ?, ?, ?, ?, 'KZT', ?, ?, ?)`)
        .bind(
          id,
          eventId,
          activation.revision,
          settings.revision,
          settings.feeMinor,
          snapshot,
          activation.terms_version,
          now
        ),
      activationAudit(
        db,
        eventId,
        actorId,
        "activation.payment_prepared",
        input.requestId,
        now
      ),
      db
        .prepare(
          "INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at) VALUES (?, 'payment.reconcile', ?, ?, ?, ?)"
        )
        .bind(
          `payment-reconcile:${id}`,
          id,
          JSON.stringify({ paymentAttemptId: id }),
          now,
          now
        ),
    ])
  } catch (error) {
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay) return readPayment(db, actorId, replay.resourceId)
    if (
      isTransitionConflict(error) ||
      (error instanceof Error &&
        error.message.includes("activation_attempt_binding"))
    )
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The activation checklist, fee, or existing payment changed. Refresh before retrying."
      )
    throw error
  }
  return readPayment(db, actorId, id)
}

export async function startActivationPayment(
  env: PaymentEnvironment,
  adapter: PaymentAdapter,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: ActivationDependencies = {}
) {
  const prepared = await prepareActivationPayment(
    env,
    actorId,
    eventId,
    raw,
    dependencies
  )
  await processPayment(env, adapter, prepared.payment.id, dependencies)
  return readPayment(env.DB, actorId, prepared.payment.id)
}
