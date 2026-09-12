import { orderSchema, reservationSchema } from "@elc/shared"
import {
  checkoutResponseSchema,
  type CheckoutResponse,
} from "../../../../packages/shared/src/checkout-api"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"

export type OrderRow = {
  id: string
  account_id: string
  event_id: string
  state: string
  currency: string
  subtotal_minor: number
  discount_minor: number
  total_minor: number
  processing_fee_basis_points: number
  processing_fee_minor: number
  campaign_id: string | null
  refund_policy_version: string
  refund_policy_json: string
  revision: number
  created_at: number
  completed_at: number | null
  admission_blocked_at: number | null
}
export type ReservationRow = {
  id: string
  order_id: string
  account_id: string
  event_id: string
  state: string
  created_at: number
  expires_at: number
  payment_attempt_id: string | null
}
export type OrderItemRow = {
  id: string
  order_id: string
  ticket_type_id: string
  ticket_type_name: string
  quantity: number
  unit_price_minor: number
  subtotal_minor: number
  discount_minor: number
  total_minor: number
  attendees_json: string
  seats_json: string
}

/** A single D1 batch gives readers a consistent order/reservation/item snapshot. */
export async function loadOrderRows(
  db: D1Database,
  actorId: string,
  orderId: string
) {
  await requireActiveAccount(db, actorId)
  const [orders, reservations, items] = await db.batch([
    db
      .prepare("SELECT * FROM orders WHERE id = ? AND account_id = ?")
      .bind(orderId, actorId),
    db
      .prepare(
        "SELECT r.* FROM reservations r JOIN orders o ON o.id = r.order_id WHERE o.id = ? AND o.account_id = ?"
      )
      .bind(orderId, actorId),
    db
      .prepare(
        "SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.id = ? AND o.account_id = ? ORDER BY i.id"
      )
      .bind(orderId, actorId),
  ])
  const order = orders!.results[0] as OrderRow | undefined
  const reservation = reservations!.results[0] as ReservationRow | undefined
  if (!order || !reservation)
    throw new ApiFailure("NOT_FOUND", 404, "Order not found.")
  return { order, reservation, items: items!.results as OrderItemRow[] }
}

export function checkoutResponse(
  rows: Awaited<ReturnType<typeof loadOrderRows>>
): CheckoutResponse {
  const { order: o, reservation: r, items } = rows
  return checkoutResponseSchema.parse({
    order: orderSchema.parse({
      id: o.id,
      accountId: o.account_id,
      eventId: o.event_id,
      state: o.state,
      currency: o.currency,
      items: items.map((i) => ({
        id: i.id,
        ticketTypeId: i.ticket_type_id,
        ticketTypeName: i.ticket_type_name,
        quantity: i.quantity,
        unitPriceMinor: i.unit_price_minor,
        subtotalMinor: i.subtotal_minor,
        discountMinor: i.discount_minor,
        totalMinor: i.total_minor,
        currency: o.currency,
        seats: JSON.parse(i.seats_json) as unknown,
      })),
      subtotalMinor: o.subtotal_minor,
      discountMinor: o.discount_minor,
      totalMinor: o.total_minor,
      processingFeeBasisPoints: o.processing_fee_basis_points,
      processingFeeMinor: o.processing_fee_minor,
      campaignId: o.campaign_id,
      refundPolicyVersion: o.refund_policy_version,
      createdAt: new Date(o.created_at).toISOString(),
      completedAt:
        o.completed_at === null ? null : new Date(o.completed_at).toISOString(),
    }),
    revision: o.revision,
    refundPolicy: JSON.parse(o.refund_policy_json) as unknown,
    reservation: reservationSchema.parse({
      id: r.id,
      accountId: r.account_id,
      eventId: r.event_id,
      state: r.state,
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      paymentAttemptId: r.payment_attempt_id,
    }),
    attendees: items.map((i) => ({
      orderItemId: i.id,
      names: JSON.parse(i.attendees_json) as unknown,
    })),
  })
}

export async function loadOrder(
  db: D1Database,
  actorId: string,
  orderId: string
) {
  return checkoutResponse(await loadOrderRows(db, actorId, orderId))
}
