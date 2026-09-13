import {
  abandonCheckoutSchema,
  type CheckoutResponse,
} from "../../../../packages/shared/src/checkout-api"
import { requireActiveAccount } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeCheckoutSql } from "./guards"
import { expireReservationBatch, RESERVATION_EXPIRY_BATCH_SIZE } from "./expiry"
import { checkoutResponse, loadOrder, loadOrderRows } from "./read"

/** Drain this event at a fixed cutoff using bounded transactions, independently of Cron. */
export async function expireReservations(
  db: D1Database,
  eventId: string,
  now = Date.now()
) {
  let expired = 0
  for (;;) {
    const batch = await expireReservationBatch(db, eventId, now)
    expired += batch.expired
    if (batch.selected < RESERVATION_EXPIRY_BATCH_SIZE) return expired
  }
}

export async function readCheckout(
  db: D1Database,
  actorId: string,
  orderId: string,
  now = Date.now()
) {
  const rows = await loadOrderRows(db, actorId, orderId)
  if (
    rows.reservation.state === "active" &&
    rows.reservation.expires_at <= now
  ) {
    await expireReservations(db, rows.order.event_id, now)
    return loadOrder(db, actorId, orderId)
  }
  return checkoutResponse(rows)
}

export async function abandonCheckout(
  db: D1Database,
  actorId: string,
  orderId: string,
  rawInput: unknown,
  now = Date.now()
): Promise<CheckoutResponse> {
  const parsed = abandonCheckoutSchema.safeParse(rawInput)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide this checkout's current revision and a request identifier."
    )
  const input = parsed.data
  await requireActiveAccount(db, actorId)
  const hash = await requestHash("checkout.abandon", { orderId, ...input })
  const replay = await readReceipt(db, actorId, input.requestId, hash)
  if (replay?.responseJson)
    return JSON.parse(replay.responseJson) as CheckoutResponse
  const rows = await loadOrderRows(db, actorId, orderId)
  if (rows.reservation.expires_at <= now && rows.reservation.state === "active")
    await expireReservations(db, rows.order.event_id, now)
  if (rows.reservation.expires_at <= now || rows.reservation.state !== "active")
    throw new ApiFailure(
      "RESERVATION_EXPIRED",
      409,
      "This reservation is no longer active."
    )
  const active = activeCheckoutSql(
    actorId,
    orderId,
    input.expectedRevision,
    now,
    { allowPaymentAttempt: true }
  )
  const response = checkoutResponse({
    ...rows,
    order: {
      ...rows.order,
      state: "abandoned",
      revision: rows.order.revision + 1,
    },
    reservation: { ...rows.reservation, state: "abandoned" },
  })
  try {
    await db.batch([
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
      ...assertSql(db, active.predicate, active.bindings),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ? AND u.email_verified = 1 AND p.suspended_at IS NULL)",
        [actorId]
      ),
      db
        .prepare(
          "UPDATE inventory SET reservation_id = NULL WHERE reservation_id = ? AND order_id IS NULL"
        )
        .bind(rows.reservation.id),
      db
        .prepare(
          "UPDATE promo_allocations SET released_at = ? WHERE order_id = ? AND committed_at IS NULL AND released_at IS NULL"
        )
        .bind(now, orderId),
      db
        .prepare(
          "UPDATE reservations SET state = 'abandoned' WHERE id = ? AND state = 'active'"
        )
        .bind(rows.reservation.id),
      db
        .prepare(
          "UPDATE orders SET state = 'abandoned', revision = revision + 1 WHERE id = ? AND state = 'pending'"
        )
        .bind(orderId),
      db
        .prepare(
          "INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at) VALUES (?, ?, ?, 'account', 'checkout.abandoned', ?, 'Checkout abandoned and unsold inventory released.', ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          rows.order.event_id,
          actorId,
          orderId,
          input.requestId,
          now
        ),
    ])
  } catch (error) {
    const receipt = await readReceipt(db, actorId, input.requestId, hash)
    if (receipt?.responseJson)
      return JSON.parse(receipt.responseJson) as CheckoutResponse
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "This checkout has changed. Reload it before abandoning."
      )
    throw error
  }
  return response
}
