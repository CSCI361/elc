import {
  calculateOrderTotals,
  policy,
  startCheckoutSchema,
  type StartCheckout,
} from "@elc/shared"
import {
  replaceCheckoutSchema,
  type CheckoutResponse,
  type RefundPolicySnapshot,
} from "../../../../packages/shared/src/checkout-api"
import { requireActiveAccount } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeCheckoutSql, purchaseEligibilitySql } from "./guards"
import {
  checkoutResponse,
  loadOrderRows,
  type OrderItemRow,
  type OrderRow,
  type ReservationRow,
} from "./read"
import { expireReservations } from "./lifecycle"

type EventRow = {
  id: string
  seating_mode: string
  refund_instructions: string
  max_tickets_per_order: number
}
type TypeRow = { id: string; name: string; kind: string; price_minor: number }
type CampaignRow = {
  id: string
  discount_kind: "percentage" | "fixed"
  discount_value: number
}
type SeatRow = {
  id: string
  ticket_type_id: string
  section: string
  row: string
  number: string
  accessible: number
}
type PlannedItem = {
  id: string
  ticketTypeId: string
  ticketTypeName: string
  kind: string
  quantity: number
  unitPriceMinor: number
  subtotalMinor: number
  discountMinor: number
  totalMinor: number
  attendeeNames: string[]
  seats: {
    seatId: string
    section: string
    row: string
    number: string
    accessible: boolean
  }[]
  discountEligible: boolean
}

/** The hook coordinates real database races in tests without mocking D1 statements. */
export type CheckoutDependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
}

async function buildPlan(db: D1Database, input: StartCheckout, now: number) {
  const event = await db
    .prepare(
      "SELECT id, seating_mode, refund_instructions, max_tickets_per_order FROM events WHERE id = ?"
    )
    .bind(input.eventId)
    .first<EventRow>()
  if (!event) throw new ApiFailure("NOT_FOUND", 404, "Event not found.")
  const quantity = input.items.reduce((sum, item) => sum + item.quantity, 0)
  if (!Number.isSafeInteger(quantity) || quantity > event.max_tickets_per_order)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "This basket exceeds the event's ticket limit."
    )
  if (
    input.items.some((item) =>
      event.seating_mode === "assigned" ? !item.seatIds : Boolean(item.seatIds)
    )
  )
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose seats only for an assigned-seat event, one per ticket."
    )
  const types = (
    await db
      .prepare(
        "SELECT id, name, kind, price_minor FROM ticket_types WHERE event_id = ? AND id IN (SELECT value FROM json_each(?))"
      )
      .bind(
        input.eventId,
        JSON.stringify(input.items.map((i) => i.ticketTypeId))
      )
      .all<TypeRow>()
  ).results
  if (types.length !== input.items.length)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "A ticket type does not belong to this event."
    )
  const campaign = input.promoCode
    ? await db
        .prepare(
          "SELECT id, discount_kind, discount_value FROM campaigns WHERE event_id = ? AND code = ? AND enabled = 1 AND starts_at <= ? AND ends_at > ?"
        )
        .bind(input.eventId, input.promoCode, now, now)
        .first<CampaignRow>()
    : null
  if (input.promoCode && !campaign)
    throw new ApiFailure(
      "PROMO_INVALID",
      409,
      "This promo code is not available."
    )
  const applicable = campaign
    ? (
        await db
          .prepare(
            "SELECT ticket_type_id AS id FROM campaign_ticket_types WHERE campaign_id = ?"
          )
          .bind(campaign.id)
          .all<{ id: string }>()
      ).results.map((r) => r.id)
    : []
  if (campaign && !input.items.some((i) => applicable.includes(i.ticketTypeId)))
    throw new ApiFailure(
      "PROMO_INVALID",
      409,
      "This promo code does not apply to this basket."
    )
  const seatIds = input.items.flatMap((i) => i.seatIds ?? [])
  const seats = seatIds.length
    ? (
        await db
          .prepare(
            "SELECT id, ticket_type_id, section, row, number, accessible FROM inventory WHERE event_id = ? AND enabled = 1 AND id IN (SELECT value FROM json_each(?))"
          )
          .bind(input.eventId, JSON.stringify(seatIds))
          .all<SeatRow>()
      ).results
    : []
  if (
    seats.length !== seatIds.length ||
    input.items.some((i) =>
      i.seatIds?.some(
        (id) =>
          !seats.some((s) => s.id === id && s.ticket_type_id === i.ticketTypeId)
      )
    )
  )
    throw new ApiFailure(
      "INVENTORY_UNAVAILABLE",
      409,
      "A selected seat is unavailable for this ticket type."
    )
  const priced = input.items.map((item) => {
    const type = types.find((t) => t.id === item.ticketTypeId)!
    return {
      unitPriceMinor: type.price_minor,
      quantity: item.quantity,
      discountEligible: applicable.includes(type.id),
    }
  })
  const discount = campaign
    ? campaign.discount_kind === "percentage"
      ? { kind: "percentage" as const, basisPoints: campaign.discount_value }
      : { kind: "fixed" as const, amountMinor: campaign.discount_value }
    : undefined
  const totals = calculateOrderTotals(priced, discount)
  const items: PlannedItem[] = input.items.map((item, index) => {
    const type = types.find((t) => t.id === item.ticketTypeId)!
    return {
      id: `${String(index).padStart(3, "0")}-${crypto.randomUUID()}`,
      ticketTypeId: type.id,
      ticketTypeName: type.name,
      kind: type.kind,
      quantity: item.quantity,
      unitPriceMinor: type.price_minor,
      ...totals.items[index]!,
      attendeeNames: item.attendeeNames,
      discountEligible: applicable.includes(type.id),
      seats: (item.seatIds ?? []).map((id) => {
        const s = seats.find((s) => s.id === id)!
        return {
          seatId: s.id,
          section: s.section,
          row: s.row,
          number: s.number,
          accessible: Boolean(s.accessible),
        }
      }),
    }
  })
  const refundPolicy: RefundPolicySnapshot = {
    version: "academic-v1",
    instructions: event.refund_instructions,
    voluntaryBeforeEventStart: true,
    requiresNoAdmission: true,
    fullRefundOnly: true,
    automaticEventCancellation: true,
    technicalCompensation: true,
  }
  return { event, campaign, items, totals, refundPolicy, quantity }
}

function planGuards(
  db: D1Database,
  actorId: string,
  input: StartCheckout,
  plan: Awaited<ReturnType<typeof buildPlan>>,
  now: number
) {
  const eligibility = purchaseEligibilitySql(actorId, input.eventId, now)
  const json = JSON.stringify(plan.items)
  const statements = [
    ...assertSql(db, eligibility.predicate, eligibility.bindings),
    ...assertSql(
      db,
      `EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND e.seating_mode = ? AND e.refund_instructions = ? AND e.max_tickets_per_order >= ?)
      AND NOT EXISTS (SELECT 1 FROM json_each(?) p LEFT JOIN ticket_types t ON t.id = json_extract(p.value, '$.ticketTypeId')
      JOIN events e ON e.id = ? WHERE t.id IS NULL OR t.event_id <> e.id
      OR t.name <> json_extract(p.value, '$.ticketTypeName') OR t.kind <> json_extract(p.value, '$.kind')
      OR t.price_minor <> json_extract(p.value, '$.unitPriceMinor') OR t.hidden <> 0
      OR t.sales_start_at > ? OR t.sales_end_at <= ? OR t.quantity < json_extract(p.value, '$.quantity')
      OR (t.kind = 'paid' AND e.paid_sales_state <> 'active'))`,
      [
        input.eventId,
        plan.event.seating_mode,
        plan.event.refund_instructions,
        plan.quantity,
        json,
        input.eventId,
        now,
        now,
      ]
    ),
    ...assertSql(
      db,
      `NOT EXISTS (SELECT 1 FROM json_each(?) p, json_each(p.value, '$.seats') s
      LEFT JOIN inventory i ON i.id = json_extract(s.value, '$.seatId')
      WHERE i.id IS NULL OR i.event_id <> ? OR i.ticket_type_id <> json_extract(p.value, '$.ticketTypeId')
      OR i.enabled <> 1 OR i.section IS NOT json_extract(s.value, '$.section') OR i.row IS NOT json_extract(s.value, '$.row')
      OR i.number IS NOT json_extract(s.value, '$.number') OR i.accessible <> json_extract(s.value, '$.accessible'))`,
      [json, input.eventId]
    ),
  ]
  if (plan.campaign)
    statements.push(
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ? AND c.event_id = ? AND c.code = ?
    AND c.enabled = 1 AND c.starts_at <= ? AND c.ends_at > ? AND c.discount_kind = ? AND c.discount_value = ?)
    AND NOT EXISTS (SELECT 1 FROM json_each(?) p WHERE json_extract(p.value, '$.discountEligible') <>
      EXISTS (SELECT 1 FROM campaign_ticket_types a WHERE a.campaign_id = ? AND a.ticket_type_id = json_extract(p.value, '$.ticketTypeId')))`,
        [
          plan.campaign.id,
          input.eventId,
          input.promoCode!,
          now,
          now,
          plan.campaign.discount_kind,
          plan.campaign.discount_value,
          json,
          plan.campaign.id,
        ]
      )
    )
  return statements
}

export async function startCheckout(
  db: D1Database,
  actorId: string,
  rawInput: unknown,
  dependencies: CheckoutDependencies = {}
) {
  const parsed = startCheckoutSchema.safeParse(rawInput)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide valid ticket quantities, seats and attendee names."
    )
  return writeCheckout(db, actorId, parsed.data, undefined, dependencies)
}

export async function replaceCheckout(
  db: D1Database,
  actorId: string,
  orderId: string,
  rawInput: unknown,
  dependencies: CheckoutDependencies = {}
) {
  const parsed = replaceCheckoutSchema.safeParse(rawInput)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide a valid basket and its current revision."
    )
  return writeCheckout(
    db,
    actorId,
    parsed.data,
    { orderId, revision: parsed.data.expectedRevision },
    dependencies
  )
}

async function writeCheckout(
  db: D1Database,
  actorId: string,
  input: StartCheckout,
  replacement: { orderId: string; revision: number } | undefined,
  dependencies: CheckoutDependencies
): Promise<CheckoutResponse> {
  await requireActiveAccount(db, actorId)
  const hash = await requestHash(
    replacement ? "checkout.replace" : "checkout.start",
    { ...input, ...replacement }
  )
  const replay = await readReceipt(db, actorId, input.requestId, hash)
  if (replay?.responseJson)
    return JSON.parse(replay.responseJson) as CheckoutResponse
  const now = (dependencies.now ?? Date.now)()
  await expireReservations(db, input.eventId, now)
  const existing = replacement
    ? await loadOrderRows(db, actorId, replacement.orderId)
    : null
  if (
    existing &&
    (existing.order.event_id !== input.eventId ||
      existing.order.revision !== replacement!.revision)
  )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This basket has changed. Reload the checkout."
    )
  if (
    existing &&
    (existing.reservation.state !== "active" ||
      existing.reservation.expires_at <= now)
  )
    throw new ApiFailure(
      "RESERVATION_EXPIRED",
      409,
      "This reservation is no longer active."
    )
  if (
    existing &&
    (await db
      .prepare(
        "SELECT 1 FROM payment_attempts WHERE purpose = 'ticket_order' AND subject_id = ?"
      )
      .bind(existing.order.id)
      .first())
  )
    throw new ApiFailure(
      "CHECKOUT_FROZEN",
      409,
      "Abandon this checkout before changing a basket with a payment attempt."
    )
  const plan = await buildPlan(db, input, now)
  const orderId = existing?.order.id ?? crypto.randomUUID()
  const reservationId = existing?.reservation.id ?? crypto.randomUUID()
  const revision = existing ? existing.order.revision + 1 : 0
  const createdAt = existing?.order.created_at ?? now
  const expiresAt =
    existing?.reservation.expires_at ?? now + policy.reservationDurationMs
  const order: OrderRow = {
    id: orderId,
    account_id: actorId,
    event_id: input.eventId,
    state: "pending",
    currency: "KZT",
    subtotal_minor: plan.totals.subtotalMinor,
    discount_minor: plan.totals.discountMinor,
    total_minor: plan.totals.totalMinor,
    processing_fee_basis_points: policy.processingFeeBasisPoints,
    processing_fee_minor: plan.totals.processingFeeMinor,
    campaign_id: plan.campaign?.id ?? null,
    refund_policy_version: "academic-v1",
    refund_policy_json: JSON.stringify(plan.refundPolicy),
    revision,
    created_at: createdAt,
    completed_at: null,
    admission_blocked_at: null,
  }
  const reservation: ReservationRow = existing?.reservation ?? {
    id: reservationId,
    order_id: orderId,
    account_id: actorId,
    event_id: input.eventId,
    state: "active",
    created_at: now,
    expires_at: expiresAt,
    payment_attempt_id: null,
  }
  const items: OrderItemRow[] = plan.items.map((i) => ({
    id: i.id,
    order_id: orderId,
    ticket_type_id: i.ticketTypeId,
    ticket_type_name: i.ticketTypeName,
    quantity: i.quantity,
    unit_price_minor: i.unitPriceMinor,
    subtotal_minor: i.subtotalMinor,
    discount_minor: i.discountMinor,
    total_minor: i.totalMinor,
    attendees_json: JSON.stringify(i.attendeeNames),
    seats_json: JSON.stringify(i.seats),
  }))
  const response = checkoutResponse({ order, reservation, items })
  const json = JSON.stringify(plan.items)
  await dependencies.beforeCommit?.()
  const commitNow = (dependencies.now ?? Date.now)()
  const statements: D1PreparedStatement[] = [
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
    ...planGuards(db, actorId, input, plan, commitNow),
    ...assertSql(db, "? > ?", [expiresAt, commitNow]),
  ]
  if (existing) {
    const active = activeCheckoutSql(
      actorId,
      orderId,
      replacement!.revision,
      commitNow
    )
    statements.push(
      ...assertSql(db, active.predicate, active.bindings),
      db
        .prepare(
          "DELETE FROM promo_allocations WHERE order_id = ? AND committed_at IS NULL"
        )
        .bind(orderId),
      db
        .prepare(
          "UPDATE inventory SET reservation_id = NULL WHERE reservation_id = ? AND order_id IS NULL"
        )
        .bind(reservationId),
      db.prepare("DELETE FROM order_items WHERE order_id = ?").bind(orderId),
      db
        .prepare(
          "UPDATE orders SET subtotal_minor = ?, discount_minor = ?, total_minor = ?, processing_fee_minor = ?, campaign_id = ?, refund_policy_json = ?, revision = revision + 1 WHERE id = ? AND revision = ?"
        )
        .bind(
          order.subtotal_minor,
          order.discount_minor,
          order.total_minor,
          order.processing_fee_minor,
          order.campaign_id,
          order.refund_policy_json,
          orderId,
          replacement!.revision
        )
    )
  } else
    statements.push(
      db
        .prepare(
          "INSERT INTO orders (id, account_id, event_id, subtotal_minor, discount_minor, total_minor, processing_fee_minor, campaign_id, refund_policy_version, refund_policy_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'academic-v1', ?, ?)"
        )
        .bind(
          orderId,
          actorId,
          input.eventId,
          order.subtotal_minor,
          order.discount_minor,
          order.total_minor,
          order.processing_fee_minor,
          order.campaign_id,
          order.refund_policy_json,
          now
        ),
      db
        .prepare(
          "INSERT INTO reservations (id, order_id, account_id, event_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(reservationId, orderId, actorId, input.eventId, now, expiresAt)
    )
  statements.push(
    db
      .prepare(`INSERT INTO order_items (id, order_id, ticket_type_id, ticket_type_name, quantity, unit_price_minor, subtotal_minor, discount_minor, total_minor, attendees_json, seats_json)
    SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.ticketTypeId'), json_extract(value, '$.ticketTypeName'), json_extract(value, '$.quantity'), json_extract(value, '$.unitPriceMinor'), json_extract(value, '$.subtotalMinor'), json_extract(value, '$.discountMinor'), json_extract(value, '$.totalMinor'), json_extract(value, '$.attendeeNames'), json_extract(value, '$.seats') FROM json_each(?)`)
      .bind(orderId, json),
    db
      .prepare(`UPDATE inventory SET reservation_id = ? WHERE id IN (
      SELECT id FROM (SELECT i.id, p.value AS plan, row_number() OVER (PARTITION BY i.ticket_type_id ORDER BY i.id) AS ordinal
      FROM inventory i JOIN json_each(?) p ON i.ticket_type_id = json_extract(p.value, '$.ticketTypeId')
      WHERE i.event_id = ? AND i.enabled = 1 AND i.order_id IS NULL AND i.reservation_id IS NULL)
      WHERE (json_array_length(plan, '$.seats') = 0 AND ordinal <= json_extract(plan, '$.quantity'))
      OR id IN (SELECT json_extract(value, '$.seatId') FROM json_each(plan, '$.seats'))
    )`)
      .bind(reservationId, json, input.eventId),
    ...assertSql(
      db,
      `NOT EXISTS (SELECT 1 FROM json_each(?) p WHERE
      (SELECT count(*) FROM inventory i WHERE i.reservation_id = ? AND i.ticket_type_id = json_extract(p.value, '$.ticketTypeId')) <> json_extract(p.value, '$.quantity'))
      AND (SELECT count(*) FROM inventory WHERE reservation_id = ?) = ?
      AND EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND e.capacity >= (SELECT count(*) FROM inventory WHERE event_id = e.id AND (order_id IS NOT NULL OR reservation_id IS NOT NULL)))
      AND NOT EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id = ? AND t.quantity < (SELECT count(*) FROM inventory WHERE ticket_type_id = t.id AND (order_id IS NOT NULL OR reservation_id IS NOT NULL)))`,
      [
        json,
        reservationId,
        reservationId,
        plan.quantity,
        input.eventId,
        input.eventId,
      ]
    )
  )
  if (plan.campaign)
    statements.push(
      db
        .prepare(`INSERT INTO promo_allocations (order_id, campaign_id, reservation_id)
      SELECT ?, c.id, ? FROM campaigns c WHERE c.id = ? AND c.max_redemptions > (
      SELECT count(*) FROM promo_allocations a JOIN reservations r ON r.id = a.reservation_id WHERE a.campaign_id = c.id
      AND (a.committed_at IS NOT NULL OR (a.released_at IS NULL AND r.state = 'active' AND r.expires_at > ?)))`)
        .bind(orderId, reservationId, plan.campaign.id, commitNow),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM promo_allocations WHERE order_id = ? AND campaign_id = ? AND reservation_id = ? AND released_at IS NULL AND committed_at IS NULL)",
        [orderId, plan.campaign.id, reservationId]
      )
    )
  statements.push(
    db
      .prepare(
        "INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at) VALUES (?, ?, ?, 'account', ?, ?, 'Checkout basket reserved.', ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        input.eventId,
        actorId,
        replacement ? "checkout.replaced" : "checkout.started",
        orderId,
        input.requestId,
        now
      )
  )
  // Production checks the database clock as well, including time spent awaiting D1.
  if (!dependencies.now)
    statements.push(
      ...assertSql(
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
      )
    )
  try {
    await db.batch(statements)
  } catch (error) {
    const receipt = await readReceipt(db, actorId, input.requestId, hash)
    if (receipt?.responseJson)
      return JSON.parse(receipt.responseJson) as CheckoutResponse
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "Checkout availability or eligibility changed. Reload the basket and retry."
      )
    throw error
  }
  return response
}
