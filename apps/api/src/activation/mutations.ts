import {
  activationModerationSchema,
  updateActivationSchema,
  updateActivationSettingsSchema,
} from "@elc/shared"
import type { z } from "zod"
import {
  requireActiveAccount,
  requirePlatformPermission,
} from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeAccountSql } from "../events/store"
import { checklistEligibilitySql } from "./guards"
import {
  activationAudit,
  activationOutbox,
  loadActivation,
  readActivation,
  readActivationSettings,
  requireActivationOwner,
  type ActivationDependencies,
} from "./store"

export function parseActivationInput<Schema extends z.ZodType>(
  schema: Schema,
  raw: unknown
): z.output<Schema> {
  const result = schema.safeParse(raw)
  if (!result.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide valid demo checklist fields and the current revision."
    )
  return result.data
}

const ownerSql =
  "EXISTS (SELECT 1 FROM events WHERE id = ? AND organizer_id = ?)"
export const platformGrantSql = `EXISTS (SELECT 1 FROM platform_grants WHERE user_id = ? AND permission = ?)`

export function refreshPaidSalesState(
  db: D1Database,
  eventId: string,
  actorId: string,
  now: number,
  injectedClock: boolean
) {
  const eligible = checklistEligibilitySql(eventId, actorId, now, injectedClock)
  return db
    .prepare(`UPDATE events SET paid_sales_state = CASE
    WHEN paid_sales_state = 'suspended' OR EXISTS (SELECT 1 FROM event_activations a WHERE a.event_id = events.id AND a.suspended_at IS NOT NULL) THEN 'suspended'
    WHEN (${eligible.predicate}) AND EXISTS (SELECT 1 FROM event_activations a WHERE a.event_id = events.id AND a.successful_payment_attempt_id IS NOT NULL) THEN 'active'
    ELSE 'pending' END, revision = revision + 1, updated_at = ? WHERE id = ?`)
    .bind(...eligible.bindings, now, eventId)
}

export async function updateActivation(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: ActivationDependencies = {}
) {
  const input = parseActivationInput(updateActivationSchema, raw)
  await requireActiveAccount(db, actorId)
  await requireActivationOwner(db, eventId, actorId)
  const hash = await requestHash("activation.checklist", { eventId, ...input })
  if (await readReceipt(db, actorId, input.requestId, hash))
    return readActivation(
      db,
      eventId,
      actorId,
      (dependencies.now ?? Date.now)()
    )
  const existing = await loadActivation(db, eventId)
  if ((existing?.revision ?? 0) !== input.expectedRevision)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The activation checklist changed. Refresh it before saving."
    )
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const acceptedAt =
    input.acceptedTermsVersion === null
      ? null
      : existing?.terms_version === input.acceptedTermsVersion
        ? (existing.terms_accepted_at ?? now)
        : now
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(actorId, input.requestId, hash, eventId, now),
      ...assertSql(db, activeAccountSql, [actorId]),
      ...assertSql(db, ownerSql, [eventId, actorId]),
      ...assertSql(
        db,
        "COALESCE((SELECT revision FROM event_activations WHERE event_id = ?), 0) = ?",
        [eventId, input.expectedRevision]
      ),
      db
        .prepare(`INSERT INTO event_activations (event_id, revision, display_name, legal_name, contact, dummy_payout_reference,
        profile_updated_at, email_checked_at, identity_check, identity_checked_at, payout_check, payout_checked_at, terms_version, terms_accepted_at, updated_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET revision = event_activations.revision + 1,
        display_name = excluded.display_name, legal_name = excluded.legal_name, contact = excluded.contact,
        dummy_payout_reference = excluded.dummy_payout_reference, profile_updated_at = excluded.profile_updated_at,
        email_checked_at = excluded.email_checked_at, identity_check = excluded.identity_check,
        identity_checked_at = excluded.identity_checked_at, payout_check = excluded.payout_check,
        payout_checked_at = excluded.payout_checked_at, terms_version = excluded.terms_version,
        terms_accepted_at = excluded.terms_accepted_at, updated_at = excluded.updated_at`)
        .bind(
          eventId,
          input.profile.displayName,
          input.profile.legalName,
          input.profile.contact,
          input.profile.dummyPayoutReference,
          now,
          now,
          input.identityCheck,
          now,
          input.payoutCheck,
          now,
          input.acceptedTermsVersion,
          acceptedAt,
          now
        ),
      db
        .prepare(
          "INSERT INTO activation_checklist_history (event_id, revision, actor_id, checklist_json, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(
          eventId,
          input.expectedRevision + 1,
          actorId,
          JSON.stringify({
            profile: input.profile,
            profileUpdatedAt: now,
            emailVerified: true,
            emailCheckedAt: now,
            identityCheck: input.identityCheck,
            identityCheckedAt: now,
            payoutCheck: input.payoutCheck,
            payoutCheckedAt: now,
            termsVersion: input.acceptedTermsVersion,
            termsAcceptedAt: acceptedAt,
          }),
          now
        ),
      refreshPaidSalesState(db, eventId, actorId, now, !!dependencies.now),
      activationAudit(
        db,
        eventId,
        actorId,
        "activation.checklist_updated",
        input.requestId,
        now
      ),
      activationOutbox(db, eventId, "activation.checklist_updated", now),
    ])
  } catch (error) {
    if (await readReceipt(db, actorId, input.requestId, hash))
      return readActivation(db, eventId, actorId, now)
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The account or activation checklist changed before it could be saved."
      )
    throw error
  }
  return readActivation(db, eventId, actorId, now)
}

export async function updateActivationSettings(
  db: D1Database,
  actorId: string,
  raw: unknown,
  dependencies: ActivationDependencies = {}
) {
  const input = parseActivationInput(updateActivationSettingsSchema, raw)
  await requirePlatformPermission(db, actorId, "platform:configure")
  const hash = await requestHash("activation.settings", input)
  if (await readReceipt(db, actorId, input.requestId, hash))
    return readActivationSettings(db)
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at) VALUES (?, ?, ?, 'activation-settings', ?)"
        )
        .bind(actorId, input.requestId, hash, now),
      ...assertSql(db, activeAccountSql, [actorId]),
      ...assertSql(db, platformGrantSql, [actorId, "platform:configure"]),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM activation_settings WHERE id = 'default' AND revision = ?)",
        [input.expectedRevision]
      ),
      db
        .prepare(
          "UPDATE activation_settings SET fee_minor = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = 'default'"
        )
        .bind(input.feeMinor, now, actorId),
      activationAudit(
        db,
        null,
        actorId,
        "activation.fee_configured",
        input.requestId,
        now,
        `Configured the simulated activation fee to ${input.feeMinor} KZT minor units at settings revision ${input.expectedRevision + 1}`
      ),
    ])
  } catch (error) {
    if (await readReceipt(db, actorId, input.requestId, hash))
      return readActivationSettings(db)
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The settings or administrator permission changed before the update."
      )
    throw error
  }
  return readActivationSettings(db)
}

export async function moderateActivation(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: ActivationDependencies = {}
) {
  const input = parseActivationInput(activationModerationSchema, raw)
  await requirePlatformPermission(db, actorId, "platform:moderate")
  const hash = await requestHash("activation.moderation", { eventId, ...input })
  if (await readReceipt(db, actorId, input.requestId, hash))
    return readActivation(
      db,
      eventId,
      actorId,
      (dependencies.now ?? Date.now)(),
      true
    )
  const activation = await loadActivation(db, eventId)
  if (!activation)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The event has no activation checklist to moderate."
    )
  const event = await db
    .prepare("SELECT organizer_id FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ organizer_id: string }>()
  if (!event) throw new ApiFailure("NOT_FOUND", 404, "Event not found.")
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(actorId, input.requestId, hash, eventId, now),
      ...assertSql(db, activeAccountSql, [actorId]),
      ...assertSql(db, platformGrantSql, [actorId, "platform:moderate"]),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM event_activations WHERE event_id = ? AND revision = ?)",
        [eventId, input.expectedRevision]
      ),
      db
        .prepare(
          "UPDATE event_activations SET suspended_at = ?, suspension_reason = ?, revision = revision + 1, updated_at = ? WHERE event_id = ?"
        )
        .bind(
          input.suspended ? now : null,
          input.suspended ? input.reason : null,
          now,
          eventId
        ),
      db
        .prepare("UPDATE events SET paid_sales_state = ? WHERE id = ?")
        .bind(input.suspended ? "suspended" : "pending", eventId),
      refreshPaidSalesState(
        db,
        eventId,
        event.organizer_id,
        now,
        !!dependencies.now
      ),
      db
        .prepare(
          "INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at) VALUES (?, ?, ?, 'event', ?, ?, ?, ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          eventId,
          actorId,
          input.suspended ? "activation.suspended" : "activation.resumed",
          eventId,
          input.reason,
          input.requestId,
          now
        ),
      activationOutbox(
        db,
        eventId,
        input.suspended ? "activation.suspended" : "activation.resumed",
        now
      ),
    ])
  } catch (error) {
    if (await readReceipt(db, actorId, input.requestId, hash))
      return readActivation(db, eventId, actorId, now, true)
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The checklist or moderator permission changed before the update."
      )
    throw error
  }
  return readActivation(db, eventId, actorId, now, true)
}
