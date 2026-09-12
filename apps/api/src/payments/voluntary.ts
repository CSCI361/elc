import {
  approveOrderRefundSchema,
  cancelRegistrationSchema,
  orderCancellationResponseSchema,
  providerRefundRequestSchema,
  refundApprovalResponseSchema,
  refundPolicySnapshotSchema,
} from "@elc/shared"
import { requireEventPermission } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import type { SqlPredicate } from "../orders/guards"
import type { OrderRow } from "../orders/read"
import { restockOrderInventory } from "../orders/restock"
import { unresolvedOrderOfflineAdmissionSql } from "../offline/guards"
import { requireVoluntaryRefundSupport } from "../support/guards"
import { paymentBinding, type PaymentRow } from "./store"

type Dependencies = { now?: () => number; beforeCommit?: () => Promise<void> }

export function refundAuthoritySql(
  actorId: string,
  eventId: string
): SqlPredicate {
  return {
    predicate: `EXISTS (SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id = u.id
      JOIN events e ON e.id = ? WHERE u.id = ? AND u.email_verified = 1 AND p.suspended_at IS NULL
      AND (e.organizer_id = u.id OR EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.event_id = e.id
        AND ep.user_id = u.id AND ep.permission = 'refund:initiate' AND ep.revoked_at IS NULL)))`,
    bindings: [eventId, actorId],
  }
}

async function managedOrder(db: D1Database, actorId: string, orderId: string) {
  const order = await db
    .prepare("SELECT * FROM orders WHERE id = ?")
    .bind(orderId)
    .first<OrderRow>()
  if (!order) throw new ApiFailure("NOT_FOUND", 404, "Order not found.")
  await requireEventPermission(db, actorId, order.event_id, "refund:initiate")
  return order
}

/** Shared commit-time cutoff and admission checks for paid and zero-total orders. */
export function voluntaryOrderGuards(
  db: D1Database,
  order: OrderRow,
  revision: number,
  now: number,
  injectedClock = false
) {
  const reported = unresolvedOrderOfflineAdmissionSql(order.id)
  return [
    ...assertSql(
      db,
      `EXISTS (SELECT 1 FROM orders o JOIN events e ON e.id = o.event_id
      WHERE o.id = ? AND o.revision = ? AND o.state = 'completed' AND o.completed_at IS NOT NULL
      AND o.admission_blocked_at IS NULL AND e.cancelled_at IS NULL AND e.starts_at > ?
      ${injectedClock ? "" : "AND e.starts_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"}
      AND o.refund_policy_version = 'academic-v1' AND json_extract(o.refund_policy_json, '$.version') = 'academic-v1'
      AND json_extract(o.refund_policy_json, '$.fullRefundOnly') = 1
      AND json_extract(o.refund_policy_json, '$.voluntaryBeforeEventStart') = 1
      AND json_extract(o.refund_policy_json, '$.requiresNoAdmission') = 1)`,
      [order.id, revision, now]
    ),
    ...assertSql(
      db,
      `NOT EXISTS (SELECT 1 FROM checkins c JOIN tickets t ON t.id = c.ticket_id
      WHERE t.order_id = ? AND c.reversed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM tickets WHERE order_id = ? AND state <> 'valid')`,
      [order.id, order.id]
    ),
    ...assertSql(db, `NOT (${reported.predicate})`, reported.bindings),
    ...assertSql(
      db,
      `NOT EXISTS (SELECT 1 FROM refunds r JOIN payment_attempts p ON p.id = r.payment_attempt_id
      WHERE p.purpose = 'ticket_order' AND p.subject_id = ?)`,
      [order.id]
    ),
  ]
}

function businessAudit(
  db: D1Database,
  actorId: string,
  order: OrderRow,
  entityId: string,
  action: string,
  reason: string,
  requestId: string,
  now: number
) {
  return db
    .prepare(`INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
    VALUES (?, ?, ?, 'event', ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      order.event_id,
      actorId,
      action,
      entityId,
      reason,
      requestId,
      now
    )
}

export async function approveOrderRefund(
  db: D1Database,
  actorId: string,
  orderId: string,
  raw: unknown,
  dependencies: Dependencies = {}
) {
  const parsed = approveOrderRefundSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide the current order revision, refund case, and approval reason."
    )
  const input = parsed.data
  const order = await managedOrder(db, actorId, orderId)
  const hash = await requestHash("refund.approve", { orderId, ...input })
  const cached = await readReceipt(db, actorId, input.requestId, hash)
  if (cached?.responseJson)
    return refundApprovalResponseSchema.parse(JSON.parse(cached.responseJson))
  refundPolicySnapshotSchema.parse(JSON.parse(order.refund_policy_json))
  const support = await requireVoluntaryRefundSupport(
    db,
    actorId,
    input.caseId,
    orderId
  )
  const payment = await db
    .prepare(`SELECT p.* FROM payment_attempts p JOIN reservations r ON r.payment_attempt_id = p.id
    WHERE r.order_id = ? AND p.purpose = 'ticket_order' AND p.subject_id = r.order_id AND p.state = 'succeeded'`)
    .bind(orderId)
    .first<PaymentRow>()
  if (
    !payment ||
    !payment.provider_order_id ||
    !payment.provider_payment_id ||
    order.total_minor <= 0 ||
    payment.amount_minor !== order.total_minor
  )
    throw new ApiFailure(
      "REFUND_INELIGIBLE",
      409,
      "A confirmed positive attendee payment is required for a full refund."
    )
  const id = crypto.randomUUID()
  const request = providerRefundRequestSchema.parse({
    refundId: id,
    idempotencyKey: id,
    providerPaymentId: payment.provider_payment_id,
    providerOrderId: payment.provider_order_id,
    expected: paymentBinding(payment),
    amountMinor: order.total_minor,
    currency: "KZT",
    reason: "voluntary",
  })
  const response = refundApprovalResponseSchema.parse({
    orderId,
    refundId: id,
    revision: input.expectedRevision + 1,
    state: "pending",
  })
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const authority = refundAuthoritySql(actorId, order.event_id)
  try {
    await db.batch([
      ...assertSql(db, authority.predicate, authority.bindings),
      ...assertSql(db, support.predicate, support.bindings),
      ...voluntaryOrderGuards(
        db,
        order,
        input.expectedRevision,
        now,
        !!dependencies.now
      ),
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM payment_attempts p JOIN orders o ON o.id = p.subject_id
        JOIN reservations r ON r.order_id = o.id AND r.payment_attempt_id = p.id
        WHERE p.id = ? AND o.id = ? AND p.state = 'succeeded' AND p.purpose = 'ticket_order'
        AND p.actor_id = o.account_id AND p.amount_minor = o.total_minor AND p.amount_minor = ?
        AND p.currency = o.currency AND p.currency = 'KZT' AND p.provider_payment_id = ? AND p.provider_order_id = ?)`,
        [
          payment.id,
          orderId,
          request.amountMinor,
          request.providerPaymentId,
          request.providerOrderId,
        ]
      ),
      db
        .prepare(`INSERT INTO refunds (id, payment_attempt_id, reason, amount_minor, request_json, requested_by, support_case_id, authorization_reason, created_at, updated_at)
        VALUES (?, ?, 'voluntary', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          payment.id,
          order.total_minor,
          JSON.stringify(request),
          actorId,
          input.caseId,
          input.reason,
          now,
          now
        ),
      db
        .prepare(
          "UPDATE orders SET admission_blocked_at = ?, revision = revision + 1 WHERE id = ?"
        )
        .bind(now, orderId),
      businessAudit(
        db,
        actorId,
        order,
        id,
        "refund.approved",
        input.reason,
        input.requestId,
        now
      ),
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
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'refund.requested', ?, ?, ?, ?)`)
        .bind(
          `refund-requested:${id}`,
          id,
          JSON.stringify({ refundId: id, orderId, caseId: input.caseId }),
          now,
          now
        ),
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          id,
          JSON.stringify(response),
          now
        ),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    await requireEventPermission(db, actorId, order.event_id, "refund:initiate")
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson)
      return refundApprovalResponseSchema.parse(JSON.parse(replay.responseJson))
    throw new ApiFailure(
      "REFUND_INELIGIBLE",
      409,
      "This order or refund request changed, the event started, or an admission is recorded. Refresh before approving."
    )
  }
  return response
}

export async function cancelFreeRegistration(
  db: D1Database,
  actorId: string,
  orderId: string,
  raw: unknown,
  dependencies: Dependencies = {}
) {
  const parsed = cancelRegistrationSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide the current order revision and cancellation reason."
    )
  const input = parsed.data
  const order = await managedOrder(db, actorId, orderId)
  const hash = await requestHash("registration.cancel", { orderId, ...input })
  const cached = await readReceipt(db, actorId, input.requestId, hash)
  if (cached?.responseJson)
    return orderCancellationResponseSchema.parse(
      JSON.parse(cached.responseJson)
    )
  if (order.total_minor !== 0)
    throw new ApiFailure(
      "REFUND_INELIGIBLE",
      409,
      "Paid orders require a full refund through their support request."
    )
  refundPolicySnapshotSchema.parse(JSON.parse(order.refund_policy_json))
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const authority = refundAuthoritySql(actorId, order.event_id)
  const response = orderCancellationResponseSchema.parse({
    orderId,
    revision: input.expectedRevision + 1,
    state: "cancelled",
  })
  try {
    await db.batch([
      ...assertSql(db, authority.predicate, authority.bindings),
      ...voluntaryOrderGuards(
        db,
        order,
        input.expectedRevision,
        now,
        !!dependencies.now
      ),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM orders WHERE id = ? AND total_minor = 0)",
        [orderId]
      ),
      db
        .prepare(
          "UPDATE orders SET state = 'cancelled', admission_blocked_at = ?, revision = revision + 1 WHERE id = ?"
        )
        .bind(now, orderId),
      db
        .prepare("UPDATE tickets SET state = 'cancelled' WHERE order_id = ?")
        .bind(orderId),
      ...restockOrderInventory(
        db,
        orderId,
        order.event_id,
        now,
        !!dependencies.now
      ),
      businessAudit(
        db,
        actorId,
        order,
        orderId,
        "registration.cancelled",
        input.reason,
        input.requestId,
        now
      ),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'registration.cancelled', ?, ?, ?, ?)`)
        .bind(
          `registration-cancelled:${orderId}`,
          orderId,
          JSON.stringify({ orderId }),
          now,
          now
        ),
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          orderId,
          JSON.stringify(response),
          now
        ),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    await requireEventPermission(db, actorId, order.event_id, "refund:initiate")
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson)
      return orderCancellationResponseSchema.parse(
        JSON.parse(replay.responseJson)
      )
    throw new ApiFailure(
      "REFUND_INELIGIBLE",
      409,
      "This registration changed, the event started, or an admission is recorded. Refresh before cancelling."
    )
  }
  return response
}
