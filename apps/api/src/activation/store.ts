import {
  activationResponseSchema,
  activationSettingsSchema,
  DEMO_PAID_TERMS_TEXT,
  DEMO_PAID_TERMS_VERSION,
  policy,
} from "@elc/shared"
import { ApiFailure } from "../db/transitions"
import { findEvent } from "../events/store"
import type { PaymentRow } from "../payments/store"

export type ActivationDependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
}
export type ActivationRow = {
  event_id: string
  revision: number
  display_name: string
  legal_name: string
  contact: string
  dummy_payout_reference: string
  profile_updated_at: number
  email_checked_at: number
  identity_check: "pending" | "passed" | "failed"
  identity_checked_at: number | null
  payout_check: "pending" | "passed" | "failed"
  payout_checked_at: number | null
  terms_version: string | null
  terms_accepted_at: number | null
  successful_payment_attempt_id: string | null
  activated_at: number | null
  suspended_at: number | null
  suspension_reason: string | null
  updated_at: number
}
export const timestamp = (value: number | null | undefined) =>
  value == null ? null : new Date(value).toISOString()
export const loadActivation = (db: D1Database, eventId: string) =>
  db
    .prepare("SELECT * FROM event_activations WHERE event_id = ?")
    .bind(eventId)
    .first<ActivationRow>()

export async function requireActivationOwner(
  db: D1Database,
  eventId: string,
  actorId: string
) {
  const event = await findEvent(db, eventId)
  if (event.organizer_id !== actorId)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Only the event owner can manage paid-sales activation."
    )
  return event
}

export async function readActivationSettings(db: D1Database) {
  const settings = await db
    .prepare(
      "SELECT fee_minor, revision FROM activation_settings WHERE id = 'default'"
    )
    .first<{ fee_minor: number; revision: number }>()
  return activationSettingsSchema.parse({
    feeMinor: settings?.fee_minor ?? policy.activationFeeMinor,
    revision: settings?.revision ?? 0,
    currency: "KZT",
  })
}

export async function readActivation(
  db: D1Database,
  eventId: string,
  actorId: string,
  now = Date.now(),
  platformRead = false
) {
  const event = platformRead
    ? await findEvent(db, eventId)
    : await requireActivationOwner(db, eventId, actorId)
  const activation = await loadActivation(db, eventId)
  const settings = await readActivationSettings(db)
  const account = await db
    .prepare(
      "SELECT u.email_verified, p.suspended_at FROM user u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?"
    )
    .bind(event.organizer_id)
    .first<{ email_verified: number; suspended_at: number | null }>()
  const hasPaidType = await db
    .prepare(
      "SELECT 1 FROM ticket_types WHERE event_id = ? AND kind = 'paid' AND price_minor > 0 LIMIT 1"
    )
    .bind(eventId)
    .first()
  const latest = await db
    .prepare(
      "SELECT pa.*, r.state AS refund_state FROM activation_attempts aa JOIN payment_attempts pa ON pa.id = aa.payment_attempt_id LEFT JOIN refunds r ON r.payment_attempt_id = pa.id WHERE aa.event_id = ? ORDER BY aa.created_at DESC, pa.rowid DESC LIMIT 1"
    )
    .bind(eventId)
    .first<
      PaymentRow & { refund_state: "pending" | "succeeded" | "failed" | null }
    >()
  const successful = activation?.successful_payment_attempt_id
    ? await db
        .prepare("SELECT amount_minor FROM payment_attempts WHERE id = ?")
        .bind(activation.successful_payment_attempt_id)
        .first<{ amount_minor: number }>()
    : null
  const blockers: Array<
    | "email_unverified"
    | "account_suspended"
    | "event_suspended"
    | "event_cancelled"
    | "event_ended"
    | "paid_sales_suspended"
    | "paid_ticket_required"
    | "profile_incomplete"
    | "identity_check"
    | "payout_check"
    | "terms_required"
    | "fee_required"
  > = []
  if (!account?.email_verified) blockers.push("email_unverified")
  if (account?.suspended_at != null) blockers.push("account_suspended")
  if (event.suspended_at !== null) blockers.push("event_suspended")
  if (event.cancelled_at !== null) blockers.push("event_cancelled")
  if (event.ends_at <= now) blockers.push("event_ended")
  if (
    activation?.suspended_at != null ||
    event.paid_sales_state === "suspended"
  )
    blockers.push("paid_sales_suspended")
  if (!hasPaidType) blockers.push("paid_ticket_required")
  if (!activation) blockers.push("profile_incomplete")
  if (activation?.identity_check !== "passed") blockers.push("identity_check")
  if (activation?.payout_check !== "passed") blockers.push("payout_check")
  if (
    activation?.terms_version !== DEMO_PAID_TERMS_VERSION ||
    activation.terms_accepted_at === null
  )
    blockers.push("terms_required")
  if (!successful) blockers.push("fee_required")
  const suspended =
    blockers.some((reason) =>
      [
        "account_suspended",
        "event_suspended",
        "event_cancelled",
        "event_ended",
        "paid_sales_suspended",
      ].includes(reason)
    ) ||
    (!!successful && blockers.length > 0)
  return activationResponseSchema.parse({
    activation: {
      eventId,
      revision: activation?.revision ?? 0,
      eventRevision: event.revision,
      eligibility:
        blockers.length === 0 ? "active" : suspended ? "suspended" : "pending",
      blockers,
      profile: activation
        ? {
            displayName: activation.display_name,
            legalName: activation.legal_name,
            contact: activation.contact,
            dummyPayoutReference: activation.dummy_payout_reference,
          }
        : null,
      profileUpdatedAt: timestamp(activation?.profile_updated_at),
      emailVerified: !!account?.email_verified,
      emailCheckedAt: timestamp(activation?.email_checked_at),
      identityCheck: {
        state: activation?.identity_check ?? "pending",
        checkedAt: timestamp(activation?.identity_checked_at),
      },
      payoutCheck: {
        state: activation?.payout_check ?? "pending",
        checkedAt: timestamp(activation?.payout_checked_at),
      },
      terms: {
        version: DEMO_PAID_TERMS_VERSION,
        text: DEMO_PAID_TERMS_TEXT,
        acceptedVersion: activation?.terms_version ?? null,
        acceptedAt: timestamp(activation?.terms_accepted_at),
      },
      fee: {
        configuredMinor: settings.feeMinor,
        configuredRevision: settings.revision,
        currency: "KZT",
        successfulPaymentAttemptId:
          activation?.successful_payment_attempt_id ?? null,
        paidMinor: successful?.amount_minor ?? null,
        activatedAt: timestamp(activation?.activated_at),
        refundable: !successful,
      },
      latestPayment: latest
        ? {
            id: latest.id,
            purpose: latest.purpose,
            subjectId: latest.subject_id,
            state: latest.state,
            dispatchState: latest.dispatch_state,
            amountMinor: latest.amount_minor,
            currency: latest.currency,
            checkoutUrl:
              latest.state === "pending" ? latest.checkout_url : null,
            refundState: latest.refund_state,
          }
        : null,
      suspendedAt: timestamp(activation?.suspended_at),
      suspensionReason: activation?.suspension_reason ?? null,
    },
  })
}

export function activationAudit(
  db: D1Database,
  eventId: string | null,
  actorId: string,
  action: string,
  correlationId: string,
  now: number,
  description = action.replaceAll(".", " ")
) {
  return db
    .prepare(
      `INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      eventId,
      actorId,
      eventId ? "event" : "platform",
      action,
      eventId ?? "activation-settings",
      description,
      correlationId,
      now
    )
}
export function activationOutbox(
  db: D1Database,
  eventId: string,
  kind: string,
  now: number,
  paymentAttemptId?: string
) {
  return db
    .prepare(
      "INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      kind,
      eventId,
      JSON.stringify({
        eventId,
        ...(paymentAttemptId ? { paymentAttemptId } : {}),
      }),
      now,
      now
    )
}
