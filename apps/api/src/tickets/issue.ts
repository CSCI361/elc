import {
  completedOrderResponseSchema,
  seatSnapshotSchema,
  type CompleteOrder,
  type CompletedOrderResponse,
} from "@elc/shared"
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
import { createTicketCredential } from "./credentials"

type HeldSlot = { id: string; ticket_type_id: string }
type TicketPlan = {
  id: string
  orderItemId: string
  inventoryId: string
  ticketTypeId: string
  attendeeName: string
  seatJson: string | null
  tokenHash: string
  ciphertext: string
}

export async function completeZeroTotalOrder(
  env: Pick<Bindings, "DB" | "TICKET_ENCRYPTION_KEY">,
  actorId: string,
  orderId: string,
  input: CompleteOrder,
  dependencies: { now?: () => number; beforeCommit?: () => Promise<void> } = {}
): Promise<CompletedOrderResponse> {
  const clock = dependencies.now ?? Date.now
  const db = env.DB
  const rows = await loadOrderRows(db, actorId, orderId)
  const hash = await requestHash("complete-zero-order", { orderId, ...input })
  const existing = await readReceipt(db, actorId, input.requestId, hash)
  if (existing?.responseJson)
    return completedOrderResponseSchema.parse(JSON.parse(existing.responseJson))
  const { order, reservation, items } = rows
  if (order.revision !== input.expectedRevision)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The checkout changed. Refresh it before continuing."
    )
  if (order.state !== "pending" || reservation.state !== "active")
    throw new ApiFailure("CONFLICT", 409, "This checkout is no longer active.")
  if (order.total_minor !== 0)
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "This order requires a confirmed payment."
    )
  if (reservation.expires_at <= clock())
    throw new ApiFailure(
      "RESERVATION_EXPIRED",
      409,
      "The checkout reservation expired."
    )

  const slots = await db
    .prepare(
      "SELECT id, ticket_type_id FROM inventory WHERE reservation_id = ? AND order_id IS NULL AND enabled = 1 ORDER BY id"
    )
    .bind(reservation.id)
    .all<HeldSlot>()
  const planned: TicketPlan[] = []
  for (const item of items) {
    const names: string[] = JSON.parse(item.attendees_json)
    const seats = seatSnapshotSchema.array().parse(JSON.parse(item.seats_json))
    const available = slots.results.filter(
      (slot) => slot.ticket_type_id === item.ticket_type_id
    )
    if (available.length !== item.quantity || names.length !== item.quantity)
      throw new ApiFailure(
        "INVENTORY_UNAVAILABLE",
        409,
        "The reserved tickets are no longer available."
      )
    for (let index = 0; index < item.quantity; index++) {
      const slot = seats.length
        ? available.find((candidate) => candidate.id === seats[index]?.seatId)
        : available[index]
      if (!slot)
        throw new ApiFailure(
          "INVENTORY_UNAVAILABLE",
          409,
          "A reserved seat is unavailable."
        )
      const id = crypto.randomUUID()
      const credential = await createTicketCredential(
        id,
        env.TICKET_ENCRYPTION_KEY
      )
      planned.push({
        id,
        orderItemId: item.id,
        inventoryId: slot.id,
        ticketTypeId: item.ticket_type_id,
        attendeeName: names[index]!,
        seatJson: seats[index] ? JSON.stringify(seats[index]) : null,
        tokenHash: credential.tokenHash,
        ciphertext: credential.ciphertext,
      })
    }
  }
  if (!planned.length || planned.length !== slots.results.length)
    throw new ApiFailure(
      "INVENTORY_UNAVAILABLE",
      409,
      "The reserved basket is incomplete."
    )
  const response: CompletedOrderResponse = {
    orderId,
    state: "completed",
    ticketIds: planned.map((ticket) => ticket.id),
  }
  await dependencies.beforeCommit?.()
  const now = clock()
  const active = activeCheckoutSql(
    actorId,
    orderId,
    input.expectedRevision,
    now
  )
  const purchase = purchaseEligibilitySql(actorId, order.event_id, now)
  const payload = JSON.stringify(planned)
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
      ...assertSql(db, purchase.predicate, purchase.bindings),
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM orders WHERE id = ? AND total_minor = 0 AND admission_blocked_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM tickets WHERE order_id = ?)`,
        [orderId, orderId]
      ),
      ...assertSql(
        db,
        `NOT EXISTS (
        SELECT 1 FROM order_items oi JOIN ticket_types tt ON tt.id = oi.ticket_type_id
        JOIN events e ON e.id = tt.event_id WHERE oi.order_id = ?
        AND (tt.hidden = 1 OR tt.sales_start_at > ? OR tt.sales_end_at <= ?
          OR (tt.kind = 'paid' AND e.paid_sales_state <> 'active'))
      )`,
        [orderId, now, now]
      ),
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM orders o JOIN events e ON e.id = o.event_id WHERE o.id = ?
          AND (SELECT COALESCE(sum(quantity), 0) FROM order_items WHERE order_id = o.id) <= e.max_tickets_per_order
          AND (SELECT count(*) FROM inventory WHERE event_id = e.id AND (order_id IS NOT NULL OR reservation_id IS NOT NULL)) <= e.capacity)
        AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN ticket_types t ON t.id = oi.ticket_type_id
          WHERE oi.order_id = ? AND (SELECT count(*) FROM inventory WHERE ticket_type_id = t.id
            AND (order_id IS NOT NULL OR reservation_id IS NOT NULL)) > t.quantity)`,
        [orderId, orderId]
      ),
      ...assertSql(
        db,
        `(SELECT count(*) FROM inventory WHERE reservation_id = ? AND order_id IS NULL AND enabled = 1) = ?
        AND NOT EXISTS (SELECT 1 FROM json_each(?) j LEFT JOIN inventory i ON i.id = json_extract(j.value, '$.inventoryId')
          WHERE i.id IS NULL OR i.reservation_id IS NOT ? OR i.order_id IS NOT NULL OR i.enabled <> 1
          OR i.ticket_type_id IS NOT json_extract(j.value, '$.ticketTypeId'))`,
        [reservation.id, planned.length, payload, reservation.id]
      ),
      ...assertSql(
        db,
        `NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = ? AND o.campaign_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM promo_allocations pa JOIN campaigns c ON c.id = pa.campaign_id
          WHERE pa.order_id = o.id AND pa.reservation_id = ? AND pa.committed_at IS NULL AND pa.released_at IS NULL
          AND c.enabled = 1 AND c.starts_at <= ? AND c.ends_at > ?))`,
        [orderId, reservation.id, now, now]
      ),
      db
        .prepare(
          "UPDATE inventory SET order_id = ?, reservation_id = NULL WHERE reservation_id = ? AND order_id IS NULL"
        )
        .bind(orderId, reservation.id),
      db
        .prepare(
          "UPDATE orders SET state = 'completed', completed_at = ?, revision = revision + 1 WHERE id = ? AND state = 'pending' AND revision = ?"
        )
        .bind(now, orderId, input.expectedRevision),
      db
        .prepare(
          "UPDATE reservations SET state = 'consumed' WHERE id = ? AND state = 'active'"
        )
        .bind(reservation.id),
      db
        .prepare(
          "UPDATE promo_allocations SET committed_at = ? WHERE order_id = ? AND committed_at IS NULL AND released_at IS NULL"
        )
        .bind(now, orderId),
      db
        .prepare(`INSERT INTO tickets (id, order_id, order_item_id, inventory_id, event_id, ticket_type_id,
        attendee_name, token_hash, credential_ciphertext, seat_json, created_at)
        SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.orderItemId'), json_extract(value, '$.inventoryId'), ?,
          json_extract(value, '$.ticketTypeId'), json_extract(value, '$.attendeeName'), json_extract(value, '$.tokenHash'),
          json_extract(value, '$.ciphertext'), json_extract(value, '$.seatJson'), ? FROM json_each(?)`)
        .bind(orderId, order.event_id, now, payload),
      ...assertSql(
        db,
        `(SELECT count(*) FROM tickets WHERE order_id = ?) = ?
        AND (SELECT count(*) FROM inventory WHERE order_id = ?) = ?`,
        [orderId, planned.length, orderId, planned.length]
      ),
      ...(dependencies.now
        ? []
        : assertSql(
            db,
            `EXISTS (
        SELECT 1 FROM orders o JOIN reservations r ON r.order_id = o.id JOIN events e ON e.id = o.event_id
        WHERE o.id = ? AND r.expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        AND e.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        AND e.registration_opens_at <= CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        AND e.registration_closes_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN ticket_types t ON t.id = oi.ticket_type_id
          WHERE oi.order_id = o.id AND (t.sales_start_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
          OR t.sales_end_at <= CAST(unixepoch('subsecond') * 1000 AS INTEGER)))
        AND (o.campaign_id IS NULL OR EXISTS (SELECT 1 FROM campaigns c WHERE c.id = o.campaign_id
          AND c.starts_at <= CAST(unixepoch('subsecond') * 1000 AS INTEGER)
          AND c.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)))
        )`,
            [orderId]
          )),
      db
        .prepare(`INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
        VALUES (?, ?, ?, 'event', 'order.completed', ?, 'Zero-total order completed', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          order.event_id,
          actorId,
          orderId,
          input.requestId,
          now
        ),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'order.completed', ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          orderId,
          JSON.stringify({ orderId }),
          now,
          now
        ),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const receipt = await readReceipt(db, actorId, input.requestId, hash)
    if (receipt?.responseJson)
      return completedOrderResponseSchema.parse(
        JSON.parse(receipt.responseJson)
      )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The checkout is no longer eligible. Refresh its current status."
    )
  }
  return response
}
