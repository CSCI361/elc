import {
  activationResponseSchema,
  activationSettingsSchema,
  DEMO_PAID_TERMS_TEXT,
  DEMO_PAID_TERMS_VERSION,
  policy,
} from "@elc/shared"
import { ApiFailure } from "../db/transitions"
import { findEvent, type EventRow } from "../events/store"
import type { PaymentRow } from "../payments/store"
import { requirePlatformPermission } from "../auth/permissions"

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
  platformRead = false,
  dependencies: { beforeReturn?: () => Promise<void> } = {}
) {
  if (platformRead) {
    await requirePlatformPermission(db, actorId, "platform:moderate")
    await findEvent(db, eventId)
  } else await requireActivationOwner(db, eventId, actorId)
  await dependencies.beforeReturn?.()
  // Owners retain diagnostic access to their checklist while suspended/unverified.
  // Moderators require an active account and current platform grant. All returned facts
  // share the same final snapshot, including the owner's blockers and payment URL state.
  const authority = platformRead
    ? "actor.email_verified=1 AND actor_profile.suspended_at IS NULL AND EXISTS(SELECT 1 FROM platform_grants g WHERE g.user_id=actor.id AND g.permission='platform:moderate')"
    : "e.organizer_id=actor.id"
  const context = `WITH authorized_event AS(SELECT e.* FROM events e JOIN user actor ON actor.id=? LEFT JOIN profiles actor_profile ON actor_profile.user_id=actor.id WHERE e.id=? AND ${authority})`
  const statement = (sql: string) =>
    db.prepare(`${context} ${sql}`).bind(actorId, eventId)
  const results = await db.batch([
    statement("SELECT * FROM authorized_event"),
    statement(
      "SELECT a.* FROM authorized_event e JOIN event_activations a ON a.event_id=e.id"
    ),
    db.prepare(
      "SELECT fee_minor,revision FROM activation_settings WHERE id='default'"
    ),
    statement(
      "SELECT u.email_verified,p.suspended_at FROM authorized_event e JOIN user u ON u.id=e.organizer_id LEFT JOIN profiles p ON p.user_id=u.id"
    ),
    statement(
      "SELECT 1 FROM authorized_event e JOIN ticket_types t ON t.event_id=e.id WHERE t.kind='paid' AND t.price_minor>0 LIMIT 1"
    ),
    statement(
      "SELECT pa.*,r.state AS refund_state FROM authorized_event e JOIN activation_attempts aa ON aa.event_id=e.id JOIN payment_attempts pa ON pa.id=aa.payment_attempt_id LEFT JOIN refunds r ON r.payment_attempt_id=pa.id ORDER BY aa.created_at DESC,pa.rowid DESC LIMIT 1"
    ),
    statement(
      "SELECT pa.amount_minor FROM authorized_event e JOIN event_activations a ON a.event_id=e.id JOIN payment_attempts pa ON pa.id=a.successful_payment_attempt_id"
    ),
  ])
  const event = results[0]!.results[0] as EventRow | undefined
  if (!event)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      platformRead
        ? "Platform moderation permission is required."
        : "Only the current event owner can view paid-sales activation."
    )
  const activation = results[1]!.results[0] as ActivationRow | undefined
  const configured = results[2]!.results[0] as
    | { fee_minor: number; revision: number }
    | undefined
  const settings = activationSettingsSchema.parse({
    feeMinor: configured?.fee_minor ?? policy.activationFeeMinor,
    revision: configured?.revision ?? 0,
    currency: "KZT",
  })
  const account = results[3]!.results[0] as
    | { email_verified: number; suspended_at: number | null }
    | undefined
  const hasPaidType = results[4]!.results.length > 0
  const latest = results[5]!.results[0] as
    | (PaymentRow & { refund_state: "pending" | "succeeded" | "failed" | null })
    | undefined
  const successful = results[6]!.results[0] as
    | { amount_minor: number }
    | undefined
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
              !platformRead &&
              account?.email_verified &&
              account.suspended_at === null &&
              latest.state === "pending"
                ? latest.checkout_url
                : null,
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
