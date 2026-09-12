import {
  startPaymentSchema,
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
import type { Bindings } from "../env"
import { activeCheckoutSql, purchaseEligibilitySql } from "../orders/guards"
import { loadOrderRows } from "../orders/read"
import { processPayment } from "./reconcile"
import { readPayment } from "./store"

export type PaymentEnvironment = Pick<
  Bindings,
  "DB" | "APP_ORIGIN" | "TICKET_ENCRYPTION_KEY"
>
export type PaymentDependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
}

export async function startOrderPayment(
  env: PaymentEnvironment,
  adapter: PaymentAdapter,
  actorId: string,
  orderId: string,
  raw: unknown,
  dependencies: PaymentDependencies = {}
) {
  const parsed = startPaymentSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide the current order revision and request identifier."
    )
  const input = parsed.data
  const clock = dependencies.now ?? Date.now
  const db = env.DB
  const account = await requireActiveAccount(db, actorId)
  const receiptHash = await requestHash("payment.start", { orderId, ...input })
  const previous = await readReceipt(db, actorId, input.requestId, receiptHash)
  if (previous) {
    await processPayment(env, adapter, previous.resourceId, dependencies)
    return readPayment(db, actorId, previous.resourceId)
  }
  const { order, reservation, items } = await loadOrderRows(
    db,
    actorId,
    orderId
  )
  if (order.total_minor <= 0)
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "Complete this free order without a payment."
    )
  const id = crypto.randomUUID()
  const frozenHash = await requestHash("payment.basket", {
    order,
    items,
    reservationId: reservation.id,
  })
  const request: PaymentCheckoutRequest = {
    paymentAttemptId: id,
    idempotencyKey: id,
    amountMinor: order.total_minor,
    currency: "KZT",
    purpose: "ticket_order",
    subjectId: orderId,
    accountId: actorId,
    requestHash: frozenHash,
    customerEmail: account.email,
    successUrl: `${env.APP_ORIGIN}/payments/return?attempt=${id}`,
    returnUrl: `${env.APP_ORIGIN}/orders/${orderId}`,
  }
  await dependencies.beforeCommit?.()
  const now = clock()
  const active = activeCheckoutSql(
    actorId,
    orderId,
    input.expectedRevision,
    now
  )
  const eligible = purchaseEligibilitySql(actorId, order.event_id, now)
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(actorId, input.requestId, receiptHash, id, now),
      ...assertSql(db, active.predicate, active.bindings),
      ...assertSql(db, eligible.predicate, eligible.bindings),
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM orders WHERE id = ? AND total_minor = ? AND admission_blocked_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN ticket_types t ON t.id = oi.ticket_type_id JOIN events e ON e.id = t.event_id
          WHERE oi.order_id = ? AND (t.hidden = 1 OR t.sales_start_at > ? OR t.sales_end_at <= ? OR ((t.kind = 'paid' OR oi.unit_price_minor > 0) AND e.paid_sales_state <> 'active')))`,
        [orderId, order.total_minor, orderId, now, now]
      ),
      ...(dependencies.now
        ? []
        : assertSql(
            db,
            `EXISTS (SELECT 1 FROM reservations r JOIN events e ON e.id = r.event_id
        WHERE r.id = ? AND r.expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        AND e.registration_opens_at <= CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        AND e.registration_closes_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        AND e.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER))`,
            [reservation.id]
          )),
      db
        .prepare(`INSERT INTO payment_attempts (id, purpose, subject_id, provider, idempotency_key,
        amount_minor, currency, actor_id, request_hash, request_json, created_at, updated_at)
        VALUES (?, 'ticket_order', ?, 'polar_sandbox', ?, ?, 'KZT', ?, ?, ?, ?, ?)`)
        .bind(
          id,
          orderId,
          id,
          order.total_minor,
          actorId,
          frozenHash,
          JSON.stringify(request),
          now,
          now
        ),
      db
        .prepare("UPDATE reservations SET payment_attempt_id = ? WHERE id = ?")
        .bind(id, reservation.id),
      db
        .prepare(`INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
        VALUES (?, ?, ?, 'event', 'payment.prepared', ?, 'Sandbox payment prepared for the frozen order', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          order.event_id,
          actorId,
          id,
          input.requestId,
          now
        ),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'payment.reconcile', ?, ?, ?, ?)`)
        .bind(
          `payment-reconcile:${id}`,
          id,
          JSON.stringify({ paymentAttemptId: id }),
          now,
          now
        ),
    ])
  } catch (error) {
    const receipt = await readReceipt(db, actorId, input.requestId, receiptHash)
    if (receipt) return readPayment(db, actorId, receipt.resourceId)
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "This order changed or already has a payment attempt. Refresh its status."
      )
    throw error
  }
  await processPayment(env, adapter, id, dependencies)
  return readPayment(db, actorId, id)
}
