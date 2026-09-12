import { orderRefundResponseSchema } from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import type { OrderRow } from "../orders/read"
import { unresolvedOrderSupportSql } from "../support/guards"
import { unresolvedOrderOfflineAdmissionSql } from "../offline/guards"

type RefundViewRow = OrderRow & {
  refund_id: string | null
  payment_attempt_id: string | null
  refund_state: string | null
  refund_reason: string | null
  refund_amount_minor: number | null
  refund_created_at: number | null
  refund_confirmed_at: number | null
  refund_updated_at: number | null
  requested_by: string | null
  support_case_id: string | null
  authorization_reason: string | null
  dispatch_state: string | null
  last_error_code: string | null
  has_support_hold: number
  can_approve: number
  voluntary_eligible: number
}

/** One authorized snapshot; provider credentials and support conversation text are excluded. */
export async function readOrderRefund(
  db: D1Database,
  actorId: string,
  orderId: string
) {
  await requireActiveAccount(db, actorId)
  const support = unresolvedOrderSupportSql(orderId)
  const reported = unresolvedOrderOfflineAdmissionSql(orderId)
  const financialAuthority = `e.organizer_id = u.id OR EXISTS (SELECT 1 FROM event_permissions ep
    WHERE ep.event_id = o.event_id AND ep.user_id = u.id AND ep.permission = 'refund:initiate' AND ep.revoked_at IS NULL)`
  const row = await db
    .prepare(`SELECT o.*, r.id refund_id, r.payment_attempt_id, r.state refund_state,
    r.reason refund_reason, r.amount_minor refund_amount_minor, r.created_at refund_created_at,
    r.confirmed_at refund_confirmed_at, r.updated_at refund_updated_at, r.requested_by, r.support_case_id,
    r.authorization_reason, r.dispatch_state, r.last_error_code, (${support.predicate}) has_support_hold,
    (${financialAuthority}) can_approve,
    (o.state = 'completed' AND o.admission_blocked_at IS NULL AND e.cancelled_at IS NULL AND r.id IS NULL
      AND e.starts_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
      AND NOT EXISTS (SELECT 1 FROM checkins ci JOIN tickets t ON t.id = ci.ticket_id WHERE t.order_id = o.id AND ci.reversed_at IS NULL)
      AND NOT (${reported.predicate})) voluntary_eligible
    FROM orders o JOIN events e ON e.id = o.event_id JOIN user u ON u.id = ? LEFT JOIN profiles profile ON profile.user_id = u.id
    LEFT JOIN reservations held ON held.order_id = o.id LEFT JOIN refunds r ON r.payment_attempt_id = held.payment_attempt_id
    WHERE o.id = ? AND u.email_verified = 1 AND profile.suspended_at IS NULL
    AND (o.account_id = u.id OR ${financialAuthority})`)
    .bind(...support.bindings, ...reported.bindings, actorId, orderId)
    .first<RefundViewRow>()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Order not found.")
  const refunded = row.refund_state === "succeeded"
  const completed = row.completed_at !== null
  return orderRefundResponseSchema.parse({
    orderId: row.id,
    eventId: row.event_id,
    revision: row.revision,
    orderState: row.state,
    admissionBlocked: row.admission_blocked_at !== null,
    canApprove: row.can_approve === 1,
    voluntaryEligible: row.voluntary_eligible === 1,
    totalMinor: row.total_minor,
    originalProcessingFeeMinor: row.processing_fee_minor,
    remainingProcessingFeeMinor:
      refunded || !completed ? 0 : row.processing_fee_minor,
    estimatedPayoutContributionMinor:
      refunded || !completed ? 0 : row.total_minor - row.processing_fee_minor,
    payoutHeld:
      row.has_support_hold === 1 || (row.refund_id !== null && !refunded),
    refundPolicy: JSON.parse(row.refund_policy_json),
    refund:
      row.refund_id === null
        ? null
        : {
            id: row.refund_id,
            paymentAttemptId: row.payment_attempt_id,
            state: row.refund_state,
            reason: row.refund_reason,
            amountMinor: row.refund_amount_minor,
            currency: row.currency,
            createdAt: new Date(row.refund_created_at!).toISOString(),
            confirmedAt:
              row.refund_confirmed_at === null
                ? null
                : new Date(row.refund_confirmed_at).toISOString(),
            updatedAt: new Date(row.refund_updated_at!).toISOString(),
            requestedBy: row.requested_by,
            supportCaseId: row.support_case_id,
            authorizationReason: row.authorization_reason,
            reconciliationRequired:
              row.last_error_code !== null ||
              row.dispatch_state === "uncertain",
          },
  })
}
