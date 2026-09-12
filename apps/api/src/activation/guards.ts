import { DEMO_PAID_TERMS_VERSION } from "@elc/shared"
import type { PaymentRow } from "../payments/store"

// The aliases a/e/u/p belong to the server-authored queries below.
export const checklistConditions = `u.email_verified = 1 AND p.suspended_at IS NULL
  AND e.cancelled_at IS NULL AND e.suspended_at IS NULL AND e.paid_sales_state <> 'suspended'
  AND a.suspended_at IS NULL AND length(trim(a.display_name)) > 0 AND length(trim(a.legal_name)) > 0
  AND length(trim(a.contact)) >= 3 AND a.dummy_payout_reference GLOB 'DEMO-?*'
  AND a.identity_check = 'passed' AND a.identity_checked_at IS NOT NULL
  AND a.payout_check = 'passed' AND a.payout_checked_at IS NOT NULL
  AND a.terms_version = '${DEMO_PAID_TERMS_VERSION}' AND a.terms_accepted_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id = e.id AND t.kind = 'paid' AND t.price_minor > 0)`

export function activationEligibilitySql(
  payment: PaymentRow,
  now: number,
  injectedClock = false
) {
  return {
    predicate: `EXISTS (
      SELECT 1 FROM activation_attempts aa JOIN event_activations a ON a.event_id = aa.event_id
      JOIN events e ON e.id = a.event_id JOIN user u ON u.id = e.organizer_id
      LEFT JOIN profiles p ON p.user_id = u.id JOIN payment_attempts pa ON pa.id = aa.payment_attempt_id
      WHERE aa.payment_attempt_id = ? AND aa.event_id = ? AND e.organizer_id = ?
      AND pa.purpose = 'event_activation' AND pa.actor_id = e.organizer_id AND pa.subject_id = e.id
      AND pa.request_hash = ? AND pa.request_json IS NOT NULL AND pa.amount_minor = aa.fee_minor
      AND pa.currency = aa.currency AND pa.amount_minor = ? AND pa.currency = 'KZT'
      AND a.revision = aa.checklist_revision AND a.successful_payment_attempt_id IS NULL
      AND aa.terms_version = a.terms_version AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id = pa.id)
      AND ${checklistConditions} AND e.ends_at > ?
      ${injectedClock ? "" : "AND e.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"}
    )`,
    bindings: [
      payment.id,
      payment.subject_id,
      payment.actor_id,
      payment.request_hash,
      payment.amount_minor,
      now,
    ],
  }
}

export function checklistEligibilitySql(
  eventId: string,
  actorId: string,
  now: number,
  injectedClock = false
) {
  return {
    predicate: `EXISTS (SELECT 1 FROM event_activations a JOIN events e ON e.id = a.event_id
      JOIN user u ON u.id = e.organizer_id LEFT JOIN profiles p ON p.user_id = u.id
      WHERE e.id = ? AND e.organizer_id = ? AND ${checklistConditions} AND e.ends_at > ?
      ${injectedClock ? "" : "AND e.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"})`,
    bindings: [eventId, actorId, now],
  }
}

/** Current owner eligibility is required even when a promo makes paid admission free. */
export function paidSalesEligibilitySql(
  eventId: string,
  now: number,
  injectedClock = false
) {
  return {
    predicate: `EXISTS (SELECT 1 FROM event_activations a JOIN events e ON e.id = a.event_id
      JOIN user u ON u.id = e.organizer_id LEFT JOIN profiles p ON p.user_id = u.id
      JOIN payment_attempts paid ON paid.id = a.successful_payment_attempt_id
      WHERE e.id = ? AND e.paid_sales_state = 'active' AND ${checklistConditions}
      AND a.activated_at IS NOT NULL AND paid.state = 'succeeded'
      AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id = paid.id) AND e.ends_at > ?
      ${injectedClock ? "" : "AND e.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"})`,
    bindings: [eventId, now],
  }
}
