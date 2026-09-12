import {
  ProviderOperationError,
  providerRefundRequestSchema,
  providerRefundStatusSchema,
  type PaymentAdapter,
  type ProviderRefundRequest,
  type ProviderRefundStatus,
} from "@elc/shared"
import { ApiFailure, assertSql, isTransitionConflict } from "../db/transitions"
import {
  loadPayment,
  paymentAudit,
  paymentBinding,
  type PaymentRow,
} from "./store"

type RefundRow = {
  id: string
  payment_attempt_id: string
  reason: string
  state: "pending" | "succeeded" | "failed"
  amount_minor: number
  provider_refund_id: string | null
  dispatch_state: "prepared" | "dispatched" | "uncertain" | "reconciled"
  request_json: string | null
}

export async function ensureCompensation(
  db: D1Database,
  payment: PaymentRow,
  now: number
) {
  const existing = await db
    .prepare("SELECT id FROM refunds WHERE payment_attempt_id = ?")
    .bind(payment.id)
    .first<{ id: string }>()
  if (existing) return existing.id
  if (
    payment.state !== "succeeded" ||
    !payment.provider_payment_id ||
    !payment.provider_order_id
  )
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "A confirmed provider order is required for compensation."
    )
  const id = crypto.randomUUID()
  const request: ProviderRefundRequest = {
    refundId: id,
    providerPaymentId: payment.provider_payment_id,
    providerOrderId: payment.provider_order_id,
    idempotencyKey: id,
    expected: paymentBinding(payment),
    amountMinor: payment.amount_minor,
    currency: "KZT",
    reason:
      payment.purpose === "event_activation"
        ? "activation_failed"
        : "technical_compensation",
  }
  try {
    await db.batch([
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND state = 'succeeded' AND amount_minor = ?)",
        [payment.id, payment.amount_minor]
      ),
      ...assertSql(
        db,
        "? <> 'ticket_order' OR NOT EXISTS (SELECT 1 FROM orders WHERE id = ? AND state = 'completed')",
        [payment.purpose, payment.subject_id]
      ),
      ...assertSql(
        db,
        "? <> 'event_activation' OR NOT EXISTS (SELECT 1 FROM event_activations WHERE successful_payment_attempt_id = ?)",
        [payment.purpose, payment.id]
      ),
      db
        .prepare(`INSERT INTO refunds (id, payment_attempt_id, reason, amount_minor, request_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          payment.id,
          request.reason,
          payment.amount_minor,
          JSON.stringify(request),
          now,
          now
        ),
      db
        .prepare(`UPDATE orders SET admission_blocked_at = COALESCE(admission_blocked_at, ?), revision = revision + 1
        WHERE id = ? AND ? = 'ticket_order'`)
        .bind(now, payment.subject_id, payment.purpose),
      // Never reclaim released inventory for a late payment. Active unsold holds are released.
      db
        .prepare(`UPDATE inventory SET reservation_id = NULL WHERE order_id IS NULL AND reservation_id IN
        (SELECT id FROM reservations WHERE order_id = ? AND state = 'active')`)
        .bind(payment.subject_id),
      db
        .prepare(
          `UPDATE promo_allocations SET released_at = ? WHERE order_id = ? AND committed_at IS NULL AND released_at IS NULL`
        )
        .bind(now, payment.subject_id),
      db
        .prepare(
          "UPDATE reservations SET state = 'abandoned' WHERE order_id = ? AND state = 'active'"
        )
        .bind(payment.subject_id),
      db
        .prepare(
          "UPDATE orders SET state = 'cancelled' WHERE id = ? AND state = 'pending' AND ? = 'ticket_order'"
        )
        .bind(payment.subject_id, payment.purpose),
      paymentAudit(db, payment, "refund.compensation_requested", now),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'refund.reconcile', ?, ?, ?, ?)`)
        .bind(
          `refund-reconcile:${id}`,
          id,
          JSON.stringify({ refundId: id, paymentAttemptId: payment.id }),
          now,
          now
        ),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const replay = await db
      .prepare("SELECT id FROM refunds WHERE payment_attempt_id = ?")
      .bind(payment.id)
      .first<{ id: string }>()
    if (replay) return replay.id
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The order changed before compensation could begin."
    )
  }
  return id
}

async function loadRefund(db: D1Database, id: string) {
  const refund = await db
    .prepare("SELECT * FROM refunds WHERE id = ?")
    .bind(id)
    .first<RefundRow>()
  if (!refund) throw new ApiFailure("NOT_FOUND", 404, "Refund not found.")
  return refund
}

export async function applyRefundStatus(
  db: D1Database,
  raw: ProviderRefundStatus,
  now = Date.now()
) {
  const status = providerRefundStatusSchema.parse(raw)
  const refund = await loadRefund(db, status.refundId)
  const payment = await loadPayment(db, refund.payment_attempt_id)
  const expected = paymentBinding(payment)
  if (
    Object.entries(expected).some(
      ([key, value]) => status[key as keyof ProviderRefundStatus] !== value
    ) ||
    status.providerPaymentId !== payment.provider_payment_id ||
    status.providerOrderId !== payment.provider_order_id ||
    (refund.provider_refund_id !== null &&
      refund.provider_refund_id !== status.providerRefundId)
  )
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "The refund does not match its payment."
    )
  if (refund.state === "succeeded") return
  if (refund.state === "failed" && status.state === "pending") return
  const mutationId = `${refund.id}:${status.providerRefundId}:${status.state}`
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at)
        VALUES ('system:refund-result', ?, 'refund-result-v1', ?, ?)`)
        .bind(mutationId, refund.id, now),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM refunds WHERE id = ? AND state <> 'succeeded' AND (provider_refund_id IS NULL OR provider_refund_id = ?))",
        [refund.id, status.providerRefundId]
      ),
      db
        .prepare(`UPDATE refunds SET state = ?, provider_refund_id = ?, dispatch_state = 'reconciled',
        confirmed_at = CASE WHEN ? = 'succeeded' THEN ? ELSE confirmed_at END, updated_at = ?, last_error_code = NULL WHERE id = ?`)
        .bind(
          status.state,
          status.providerRefundId,
          status.state,
          now,
          now,
          refund.id
        ),
      ...(status.state !== "succeeded" || payment.purpose !== "ticket_order"
        ? []
        : [
            db
              .prepare(
                "UPDATE tickets SET state = 'refunded' WHERE order_id = ?"
              )
              .bind(payment.subject_id),
            db
              .prepare(
                "UPDATE orders SET state = CASE WHEN completed_at IS NOT NULL THEN 'refunded' ELSE state END, admission_blocked_at = COALESCE(admission_blocked_at, ?), revision = revision + 1 WHERE id = ?"
              )
              .bind(now, payment.subject_id),
            db
              .prepare(`UPDATE inventory SET order_id = NULL, reservation_id = NULL WHERE order_id = ? AND enabled = 1
          AND EXISTS (SELECT 1 FROM events e JOIN ticket_types t ON t.event_id = e.id WHERE e.id = inventory.event_id AND t.id = inventory.ticket_type_id
            AND e.publication_state = 'published' AND e.cancelled_at IS NULL AND e.suspended_at IS NULL
            AND e.ends_at > ? AND e.registration_opens_at <= ? AND e.registration_closes_at > ?
            AND t.hidden = 0 AND t.sales_start_at <= ? AND t.sales_end_at > ? AND (t.kind = 'free' OR e.paid_sales_state = 'active'))`)
              .bind(payment.subject_id, now, now, now, now, now),
          ]),
      paymentAudit(db, payment, `refund.${status.state}`, now),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'refund.changed', ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          refund.id,
          JSON.stringify({
            refundId: refund.id,
            paymentAttemptId: payment.id,
            state: status.state,
          }),
          now,
          now
        ),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const replay = await db
      .prepare(
        "SELECT 1 FROM request_receipts WHERE actor_id = 'system:refund-result' AND request_id = ?"
      )
      .bind(mutationId)
      .first()
    if (replay) return
    if ((await loadRefund(db, refund.id)).state === "succeeded") return
    throw error
  }
}

export async function processRefund(
  db: D1Database,
  adapter: PaymentAdapter,
  refundId: string,
  now = Date.now(),
  options: { lookupOnly?: boolean } = {}
) {
  let refund = await loadRefund(db, refundId)
  if (
    refund.state === "succeeded" ||
    (refund.state === "failed" && refund.dispatch_state === "reconciled")
  )
    return
  const request = providerRefundRequestSchema.parse(
    JSON.parse(refund.request_json ?? "null")
  )
  if (
    request.refundId !== refund.id ||
    request.expected.paymentAttemptId !== refund.payment_attempt_id ||
    request.amountMinor !== refund.amount_minor
  )
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "The refund request does not match its frozen record."
    )
  let claimed = false
  if (refund.dispatch_state === "prepared" && !options.lookupOnly) {
    const payment = await loadPayment(db, refund.payment_attempt_id)
    try {
      await db.batch([
        db
          .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at)
          VALUES ('system:refund-dispatch', ?, 'refund-dispatch-v1', ?, ?)`)
          .bind(refund.id, refund.id, now),
        ...assertSql(
          db,
          "EXISTS (SELECT 1 FROM refunds WHERE id = ? AND dispatch_state = 'prepared' AND state = 'pending')",
          [refund.id]
        ),
        db
          .prepare(
            "UPDATE refunds SET dispatch_state = 'dispatched', updated_at = ? WHERE id = ?"
          )
          .bind(now, refund.id),
        paymentAudit(db, payment, "refund.dispatched", now),
      ])
      claimed = true
    } catch (error) {
      if (!isTransitionConflict(error)) throw error
    }
  }
  try {
    const status = claimed
      ? await adapter.refund(request)
      : await adapter.lookupRefund(request)
    if (status) await applyRefundStatus(db, status, now)
  } catch (error) {
    refund = await loadRefund(db, refundId)
    if (refund.state === "succeeded") return
    const definite =
      claimed &&
      error instanceof ProviderOperationError &&
      error.outcome === "definite_failure"
    const payment = await loadPayment(db, refund.payment_attempt_id)
    await db.batch([
      db
        .prepare(
          `UPDATE refunds SET dispatch_state = ?, state = ?, last_error_code = ?, updated_at = ? WHERE id = ? AND state <> 'succeeded'`
        )
        .bind(
          definite ? "reconciled" : "uncertain",
          definite ? "failed" : refund.state,
          error instanceof ProviderOperationError
            ? error.code
            : "RECONCILIATION_REQUIRED",
          now,
          refundId
        ),
      paymentAudit(
        db,
        payment,
        definite ? "refund.dispatch_failed" : "refund.dispatch_uncertain",
        now
      ),
    ])
  }
}
