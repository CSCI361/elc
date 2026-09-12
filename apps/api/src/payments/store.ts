import {
  paymentBindingSchema,
  paymentCheckoutRequestSchema,
  paymentResponseSchema,
  type PaymentBinding,
  type PaymentCheckoutRequest,
} from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure, assertSql, isTransitionConflict } from "../db/transitions"

export type PaymentRow = {
  id: string
  purpose: "ticket_order" | "event_activation"
  subject_id: string
  actor_id: string | null
  state: "pending" | "succeeded" | "failed" | "cancelled"
  provider: "polar_sandbox" | "simulation"
  provider_payment_id: string | null
  provider_order_id: string | null
  idempotency_key: string
  amount_minor: number
  currency: string
  request_hash: string | null
  request_json: string | null
  checkout_url: string | null
  dispatch_state: "prepared" | "dispatched" | "uncertain" | "reconciled"
  last_error_code: string | null
  created_at: number
  succeeded_at: number | null
  updated_at: number
}

export async function loadPayment(
  db: D1Database,
  id: string
): Promise<PaymentRow> {
  const payment = await db
    .prepare("SELECT * FROM payment_attempts WHERE id = ?")
    .bind(id)
    .first<PaymentRow>()
  if (!payment) throw new ApiFailure("NOT_FOUND", 404, "Payment not found.")
  return payment
}

export function paymentBinding(row: PaymentRow): PaymentBinding {
  return paymentBindingSchema.parse({
    paymentAttemptId: row.id,
    purpose: row.purpose,
    subjectId: row.subject_id,
    accountId: row.actor_id,
    requestHash: row.request_hash,
    amountMinor: row.amount_minor,
    currency: row.currency,
  })
}

export function checkoutRequest(row: PaymentRow): PaymentCheckoutRequest {
  const request = paymentCheckoutRequestSchema.parse(
    JSON.parse(row.request_json ?? "null")
  )
  const expected = paymentBinding(row)
  if (
    Object.entries(expected).some(
      ([key, value]) => request[key as keyof PaymentCheckoutRequest] !== value
    )
  )
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "The stored payment request does not match its order."
    )
  return request
}

export async function readPayment(db: D1Database, actorId: string, id: string) {
  await requireActiveAccount(db, actorId)
  const row = await loadPayment(db, id)
  if (row.actor_id !== actorId)
    throw new ApiFailure("NOT_FOUND", 404, "Payment not found.")
  const refund = await db
    .prepare("SELECT state FROM refunds WHERE payment_attempt_id = ?")
    .bind(id)
    .first<{ state: string }>()
  return paymentResponseSchema.parse({
    payment: {
      id,
      purpose: row.purpose,
      subjectId: row.subject_id,
      state: row.state,
      dispatchState: row.dispatch_state,
      amountMinor: row.amount_minor,
      currency: row.currency,
      checkoutUrl: row.state === "pending" ? row.checkout_url : null,
      refundState: refund?.state ?? null,
    },
  })
}

export function paymentAudit(
  db: D1Database,
  row: PaymentRow,
  action: string,
  now: number,
  actorId: string | null = null
) {
  return db
    .prepare(`INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
    VALUES (?, CASE WHEN ? = 'ticket_order' THEN (SELECT event_id FROM orders WHERE id = ?) ELSE ? END,
      ?, 'event', ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      row.purpose,
      row.subject_id,
      row.subject_id,
      actorId,
      action,
      row.id,
      action.replaceAll(".", " "),
      row.id,
      now
    )
}

/** A durable claim precedes the only financial POST; a lost response never releases it. */
export async function claimPaymentDispatch(
  db: D1Database,
  row: PaymentRow,
  now: number,
  injectedClock = false
) {
  // Resolve event identity from the frozen order; SQL reads current cancellation and holds.
  const eligible =
    row.purpose === "ticket_order"
      ? `EXISTS (
    SELECT 1 FROM orders o JOIN reservations r ON r.order_id = o.id JOIN events e ON e.id = o.event_id
    WHERE o.id = ? AND o.account_id = ? AND o.state = 'pending' AND o.admission_blocked_at IS NULL
    AND r.state = 'active' AND r.payment_attempt_id = ? AND r.expires_at > ?
    AND e.paid_sales_state = 'active' AND e.publication_state = 'published' AND e.suspended_at IS NULL AND e.cancelled_at IS NULL
    AND e.ends_at > ? AND e.registration_opens_at <= ? AND e.registration_closes_at > ?
    AND EXISTS (SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = o.account_id AND u.email_verified = 1 AND p.suspended_at IS NULL)
    AND (e.visibility <> 'private' OR EXISTS (SELECT 1 FROM invitations i JOIN user u ON u.id = o.account_id
      WHERE i.event_id = e.id AND i.accepted_by = u.id AND lower(i.email) = lower(u.email) AND i.revoked_at IS NULL
      AND i.accepted_at IS NOT NULL AND i.accepted_at <= ? AND i.accepted_at < i.expires_at AND i.accepted_at < e.ends_at))
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN ticket_types t ON t.id = oi.ticket_type_id WHERE oi.order_id = o.id
      AND (t.hidden = 1 OR t.sales_start_at > ? OR t.sales_end_at <= ?))
    AND (SELECT COALESCE(sum(quantity), 0) FROM order_items WHERE order_id = o.id) <= e.max_tickets_per_order
    AND (SELECT count(*) FROM inventory WHERE event_id = e.id AND (order_id IS NOT NULL OR reservation_id IS NOT NULL)) <= e.capacity
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN ticket_types t ON t.id = oi.ticket_type_id WHERE oi.order_id = o.id
      AND ((SELECT count(*) FROM inventory WHERE ticket_type_id = t.id AND (order_id IS NOT NULL OR reservation_id IS NOT NULL)) > t.quantity
        OR (SELECT count(*) FROM inventory WHERE ticket_type_id = t.id AND reservation_id = r.id AND enabled = 1 AND order_id IS NULL) <> oi.quantity))
    AND (o.campaign_id IS NULL OR EXISTS (SELECT 1 FROM promo_allocations pa JOIN campaigns c ON c.id = pa.campaign_id
      WHERE pa.order_id = o.id AND pa.reservation_id = r.id AND pa.released_at IS NULL AND pa.committed_at IS NULL
      AND c.enabled = 1 AND c.starts_at <= ? AND c.ends_at > ?))
    ${
      injectedClock
        ? ""
        : `AND r.expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
      AND e.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
      AND e.registration_closes_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
      AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN ticket_types t ON t.id = oi.ticket_type_id WHERE oi.order_id = o.id
        AND (t.sales_start_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER) OR t.sales_end_at <= CAST(unixepoch('subsecond') * 1000 AS INTEGER)))
      AND (o.campaign_id IS NULL OR EXISTS (SELECT 1 FROM campaigns c WHERE c.id = o.campaign_id
        AND c.starts_at <= CAST(unixepoch('subsecond') * 1000 AS INTEGER) AND c.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)))`
    }
    )`
      : "0"
  const values =
    row.purpose === "ticket_order"
      ? [
          row.subject_id,
          row.actor_id,
          row.id,
          now,
          now,
          now,
          now,
          now,
          now,
          now,
          now,
          now,
        ]
      : []
  try {
    const result = await db.batch([
      db
        .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at)
        VALUES ('system:payment-dispatch', ?, ?, ?, ?)`)
        .bind(row.id, row.request_hash, row.id, now),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND dispatch_state = 'prepared' AND state = 'pending')",
        [row.id]
      ),
      db
        .prepare(`UPDATE payment_attempts SET state = CASE WHEN (${eligible}) THEN 'pending' ELSE 'cancelled' END,
        dispatch_state = CASE WHEN (${eligible}) THEN 'dispatched' ELSE 'reconciled' END, updated_at = ? WHERE id = ?`)
        .bind(...values, ...values, now, row.id),
      paymentAudit(db, row, "payment.dispatch_checked", now),
      db
        .prepare("SELECT dispatch_state FROM payment_attempts WHERE id = ?")
        .bind(row.id),
    ])
    return (
      (result.at(-1)?.results[0] as { dispatch_state?: string } | undefined)
        ?.dispatch_state === "dispatched"
    )
  } catch (error) {
    if (isTransitionConflict(error)) return false
    throw error
  }
}
