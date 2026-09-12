import {
  calendarUid,
  createCampaignSchema,
  demoVenue,
  type CreateCampaignRequest,
  type CreateEventRequest,
  type CreateTicketTypeRequest,
  type EventRevisionRequest,
  type UpdateEventRequest,
} from "@elc/shared"
import { ApiFailure, assertSql } from "../db/transitions"
import {
  commitMutation,
  existingMutation,
  findEvent,
  iso,
  type EventContext,
} from "./store"

function validateLayout(input: CreateEventRequest) {
  if (
    input.seatingMode === "assigned" &&
    (input.venueLayoutId !== demoVenue.id ||
      input.capacity !== demoVenue.capacity)
  ) {
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Assigned seating uses the predefined 80-seat demo hall."
    )
  }
}

function seedAssigned(
  context: EventContext,
  eventId: string,
  input: CreateEventRequest
) {
  return demoVenue.sections.flatMap((section) => {
    const typeId = crypto.randomUUID()
    return [
      context.db
        .prepare(`INSERT INTO ticket_types
        (id, event_id, name, description, kind, price_minor, quantity, sales_start_at, sales_end_at, hidden, updated_at)
        VALUES (?, ?, ?, '', 'paid', ?, 40, ?, ?, 0, ?)`)
        .bind(
          typeId,
          eventId,
          section.name,
          section.priceMinor,
          Date.parse(input.registrationOpensAt),
          Date.parse(input.registrationClosesAt),
          context.now
        ),
      context.db
        .prepare(`WITH RECURSIVE seats(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seats WHERE n < 39)
        INSERT INTO inventory (id, event_id, ticket_type_id, section, row, number, accessible, enabled)
        SELECT lower(hex(randomblob(16))), ?, ?, ?, substr('ABCDE', CAST(n / 8 AS INTEGER) + 1, 1),
          CAST((n % 8) + 1 AS TEXT), CASE WHEN n IN (0, 7) THEN 1 ELSE 0 END, 1 FROM seats`)
        .bind(eventId, typeId, section.name),
    ]
  })
}

function addGeneralInventory(
  context: EventContext,
  eventId: string,
  ticketTypeId: string,
  quantity: number
) {
  return context.db
    .prepare(`WITH RECURSIVE slots(n) AS (
      SELECT 1 WHERE ? > 0 UNION ALL SELECT n + 1 FROM slots WHERE n < ?
    ) INSERT INTO inventory (id, event_id, ticket_type_id)
    SELECT lower(hex(randomblob(16))), ?, ? FROM slots`)
    .bind(quantity, quantity, eventId, ticketTypeId)
}

export async function createEvent(
  context: EventContext,
  input: CreateEventRequest
) {
  const mutation = await existingMutation(context, null, "event.create", input)
  if (mutation.response) return mutation.response
  validateLayout(input)
  const id = crypto.randomUUID()
  const statements = [
    context.db
      .prepare(`INSERT INTO events (
      id, organizer_id, title, description, category, venue_name, venue_address, starts_at, ends_at,
      registration_opens_at, registration_closes_at, time_zone, visibility, seating_mode, venue_layout_id,
      capacity, max_tickets_per_order, calendar_uid, reporting_id, refund_instructions, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(
        id,
        context.actorId,
        input.title,
        input.description,
        input.category,
        input.venueName,
        input.venueAddress,
        Date.parse(input.startsAt),
        Date.parse(input.endsAt),
        Date.parse(input.registrationOpensAt),
        Date.parse(input.registrationClosesAt),
        input.timeZone,
        input.visibility,
        input.seatingMode,
        input.venueLayoutId ?? null,
        input.capacity,
        input.maxTicketsPerOrder,
        calendarUid(id),
        `rpt_${crypto.randomUUID().replaceAll("-", "")}`,
        input.refundInstructions,
        context.now,
        context.now
      ),
  ]
  if (input.seatingMode === "assigned")
    statements.push(...seedAssigned(context, id, input))
  return commitMutation(context, {
    eventId: id,
    resourceId: id,
    requestId: input.requestId,
    inputHash: mutation.hash,
    action: "event.created",
    description: "Created an event draft.",
    statements,
  })
}

export async function updateEvent(
  context: EventContext,
  eventId: string,
  input: UpdateEventRequest
) {
  const mutation = await existingMutation(context, eventId, "event.update", {
    ...input,
    eventId,
  })
  if (mutation.response) return mutation.response
  validateLayout(input)
  const previous = await findEvent(context.db, eventId)
  const changesLayout =
    previous.seating_mode !== input.seatingMode ||
    previous.venue_layout_id !== (input.venueLayoutId ?? null)
  const statements: D1PreparedStatement[] = []
  if (changesLayout) {
    statements.push(
      ...assertSql(
        context.db,
        `NOT EXISTS (SELECT 1 FROM inventory WHERE event_id = ?)
      AND NOT EXISTS (SELECT 1 FROM ticket_types WHERE event_id = ?)
      AND NOT EXISTS (SELECT 1 FROM orders WHERE event_id = ?)`,
        [eventId, eventId, eventId]
      )
    )
  }
  statements.push(
    context.db
      .prepare(`UPDATE events SET title = ?, description = ?, category = ?, venue_name = ?,
    venue_address = ?, starts_at = ?, ends_at = ?, registration_opens_at = ?, registration_closes_at = ?,
    time_zone = ?, visibility = ?, seating_mode = ?, venue_layout_id = ?, capacity = ?, max_tickets_per_order = ?,
    refund_instructions = ?, calendar_sequence = calendar_sequence + 1 WHERE id = ?`)
      .bind(
        input.title,
        input.description,
        input.category,
        input.venueName,
        input.venueAddress,
        Date.parse(input.startsAt),
        Date.parse(input.endsAt),
        Date.parse(input.registrationOpensAt),
        Date.parse(input.registrationClosesAt),
        input.timeZone,
        input.visibility,
        input.seatingMode,
        input.venueLayoutId ?? null,
        input.capacity,
        input.maxTicketsPerOrder,
        input.refundInstructions,
        eventId
      )
  )
  if (changesLayout && input.seatingMode === "assigned")
    statements.push(...seedAssigned(context, eventId, input))
  return commitMutation(context, {
    eventId,
    resourceId: eventId,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    inputHash: mutation.hash,
    action: "event.updated",
    description: "Updated event details and calendar metadata.",
    statements,
  })
}

export async function setPublication(
  context: EventContext,
  eventId: string,
  input: EventRevisionRequest,
  published: boolean
) {
  const action = published ? "event.published" : "event.unpublished"
  const mutation = await existingMutation(context, eventId, action, {
    ...input,
    eventId,
  })
  if (mutation.response) return mutation.response
  const statements: D1PreparedStatement[] = []
  if (published) {
    statements.push(
      ...assertSql(
        context.db,
        `EXISTS (SELECT 1 FROM events WHERE id = ? AND suspended_at IS NULL AND ends_at > ?)
      AND EXISTS (SELECT 1 FROM ticket_types WHERE event_id = ?)`,
        [eventId, context.now, eventId]
      )
    )
  }
  statements.push(
    context.db
      .prepare("UPDATE events SET publication_state = ? WHERE id = ?")
      .bind(published ? "published" : "unpublished", eventId)
  )
  return commitMutation(context, {
    eventId,
    resourceId: eventId,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    inputHash: mutation.hash,
    action,
    description: published ? "Published the event." : "Unpublished the event.",
    statements,
  })
}

export async function createTicketType(
  context: EventContext,
  eventId: string,
  input: CreateTicketTypeRequest
) {
  if (eventId !== input.eventId)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The ticket type belongs to another event."
    )
  const mutation = await existingMutation(
    context,
    eventId,
    "ticket_type.create",
    input
  )
  if (mutation.response) return mutation.response
  const id = crypto.randomUUID()
  const statements = [
    ...assertSql(
      context.db,
      `EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND e.seating_mode = 'general_admission'
      AND (SELECT COALESCE(SUM(quantity), 0) FROM ticket_types WHERE event_id = e.id) + ? <= e.capacity)`,
      [eventId, input.quantity]
    ),
    context.db
      .prepare(`INSERT INTO ticket_types
      (id, event_id, name, description, kind, price_minor, quantity, sales_start_at, sales_end_at, hidden, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        eventId,
        input.name,
        input.description,
        input.kind,
        input.priceMinor,
        input.quantity,
        Date.parse(input.salesStartAt),
        Date.parse(input.salesEndAt),
        input.hidden ? 1 : 0,
        context.now
      ),
    addGeneralInventory(context, eventId, id, input.quantity),
  ]
  return commitMutation(context, {
    eventId,
    resourceId: id,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    inputHash: mutation.hash,
    action: "ticket_type.created",
    description: "Created a ticket type and its inventory.",
    statements,
  })
}

export async function updateTicketType(
  context: EventContext,
  eventId: string,
  ticketTypeId: string,
  input: CreateTicketTypeRequest
) {
  if (eventId !== input.eventId)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The ticket type belongs to another event."
    )
  const mutation = await existingMutation(
    context,
    eventId,
    "ticket_type.update",
    { ...input, ticketTypeId }
  )
  if (mutation.response) return mutation.response
  const previous = await context.db
    .prepare(`SELECT t.quantity, e.seating_mode AS seatingMode FROM ticket_types t
    JOIN events e ON e.id = t.event_id WHERE t.id = ? AND t.event_id = ?`)
    .bind(ticketTypeId, eventId)
    .first<{ quantity: number; seatingMode: string }>()
  if (!previous)
    throw new ApiFailure("NOT_FOUND", 404, "Ticket type not found.")
  if (
    previous.seatingMode === "assigned" &&
    input.quantity !== previous.quantity
  ) {
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Seat-section quantities are fixed by the venue layout. Mark individual seats unavailable instead."
    )
  }
  const statements: D1PreparedStatement[] = []
  if (input.quantity > previous.quantity) {
    statements.push(
      ...assertSql(
        context.db,
        `EXISTS (SELECT 1 FROM events e WHERE e.id = ?
      AND (SELECT COALESCE(SUM(quantity), 0) FROM ticket_types WHERE event_id = e.id) + ? <= e.capacity)`,
        [eventId, input.quantity - previous.quantity]
      )
    )
    statements.push(
      addGeneralInventory(
        context,
        eventId,
        ticketTypeId,
        input.quantity - previous.quantity
      )
    )
  } else if (input.quantity < previous.quantity) {
    statements.push(
      context.db
        .prepare(`DELETE FROM inventory WHERE id IN (
      SELECT i.id FROM inventory i WHERE i.ticket_type_id = ? AND i.event_id = ?
        AND i.order_id IS NULL AND i.reservation_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.inventory_id = i.id)
      ORDER BY i.id DESC LIMIT ?
    )`)
        .bind(ticketTypeId, eventId, previous.quantity - input.quantity)
    )
  }
  statements.push(
    context.db
      .prepare(`UPDATE ticket_types SET name = ?, description = ?, kind = ?, price_minor = ?,
    quantity = ?, sales_start_at = ?, sales_end_at = ?, hidden = ?, updated_at = ? WHERE id = ? AND event_id = ?`)
      .bind(
        input.name,
        input.description,
        input.kind,
        input.priceMinor,
        input.quantity,
        Date.parse(input.salesStartAt),
        Date.parse(input.salesEndAt),
        input.hidden ? 1 : 0,
        context.now,
        ticketTypeId,
        eventId
      )
  )
  return commitMutation(context, {
    eventId,
    resourceId: ticketTypeId,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    inputHash: mutation.hash,
    action: "ticket_type.updated",
    description:
      "Updated a ticket type without changing historical order items.",
    statements,
  })
}

export async function setSeatEnabled(
  context: EventContext,
  eventId: string,
  seatId: string,
  input: EventRevisionRequest & { enabled: boolean }
) {
  const mutation = await existingMutation(
    context,
    eventId,
    "seat.availability",
    { ...input, eventId, seatId }
  )
  if (mutation.response) return mutation.response
  const statements = [
    ...assertSql(
      context.db,
      `EXISTS (SELECT 1 FROM inventory i JOIN events e ON e.id = i.event_id
      WHERE i.id = ? AND i.event_id = ? AND e.seating_mode = 'assigned' AND i.order_id IS NULL
      AND (i.reservation_id IS NULL OR EXISTS (SELECT 1 FROM reservations r WHERE r.id = i.reservation_id
        AND (r.state != 'active' OR r.expires_at <= ?))))`,
      [seatId, eventId, context.now]
    ),
    context.db
      .prepare("UPDATE inventory SET enabled = ? WHERE id = ? AND event_id = ?")
      .bind(input.enabled ? 1 : 0, seatId, eventId),
  ]
  return commitMutation(context, {
    eventId,
    resourceId: seatId,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    inputHash: mutation.hash,
    action: "seat.availability_changed",
    description: "Changed availability of an unallocated seat.",
    statements,
  })
}

function campaignCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return `ELC-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => alphabet[value % alphabet.length]).join("")}`
}

export async function hashCampaignToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  )
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("")
}

export async function createCampaign(
  context: EventContext,
  eventId: string,
  input: CreateCampaignRequest
) {
  if (eventId !== input.eventId)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The campaign belongs to another event."
    )
  const mutation = await existingMutation(
    context,
    eventId,
    "campaign.create",
    input
  )
  if (mutation.response) return mutation.response
  const event = await findEvent(context.db, eventId)
  const { requestId, expectedRevision, ...definition } = input
  const parsed = createCampaignSchema.safeParse({
    ...definition,
    startsAt: definition.startsAt ?? iso(event.registration_opens_at),
    endsAt: definition.endsAt ?? iso(event.registration_closes_at),
  })
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The campaign window or ticket-type selection is invalid."
    )
  const campaign = parsed.data
  const id = crypto.randomUUID()
  const code = campaignCode()
  const discountValue =
    campaign.discount.kind === "percentage"
      ? campaign.discount.basisPoints
      : campaign.discount.amountMinor
  const statements = [
    ...assertSql(
      context.db,
      `(
      SELECT COUNT(*) FROM ticket_types WHERE event_id = ? AND id IN (SELECT value FROM json_each(?))
    ) = ?`,
      [
        eventId,
        JSON.stringify(campaign.applicableTicketTypeIds),
        campaign.applicableTicketTypeIds.length,
      ]
    ),
    context.db
      .prepare(`INSERT INTO campaigns (id, event_id, name, code, token_hash, reporting_id, discount_kind,
      discount_value, starts_at, ends_at, max_redemptions, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .bind(
        id,
        eventId,
        campaign.name,
        code,
        await hashCampaignToken(code),
        `rpt_${crypto.randomUUID().replaceAll("-", "")}`,
        campaign.discount.kind,
        discountValue,
        Date.parse(campaign.startsAt),
        Date.parse(campaign.endsAt),
        campaign.maxRedemptions,
        context.now
      ),
    context.db
      .prepare(`INSERT INTO campaign_ticket_types (campaign_id, ticket_type_id)
      SELECT ?, value FROM json_each(?)`)
      .bind(id, JSON.stringify(campaign.applicableTicketTypeIds)),
  ]
  return commitMutation(context, {
    eventId,
    resourceId: id,
    expectedRevision,
    requestId,
    inputHash: mutation.hash,
    action: "campaign.created",
    description: "Created a disabled promotional campaign.",
    statements,
  })
}

export async function setCampaignEnabled(
  context: EventContext,
  eventId: string,
  campaignId: string,
  input: EventRevisionRequest,
  enabled: boolean
) {
  const action = enabled ? "campaign.enabled" : "campaign.disabled"
  const mutation = await existingMutation(context, eventId, action, {
    ...input,
    eventId,
    campaignId,
  })
  if (mutation.response) return mutation.response
  const statements = [
    ...assertSql(
      context.db,
      "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND event_id = ?)",
      [campaignId, eventId]
    ),
    context.db
      .prepare(
        "UPDATE campaigns SET enabled = ?, updated_at = ? WHERE id = ? AND event_id = ?"
      )
      .bind(enabled ? 1 : 0, context.now, campaignId, eventId),
  ]
  return commitMutation(context, {
    eventId,
    resourceId: campaignId,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    inputHash: mutation.hash,
    action,
    description: enabled
      ? "Enabled a promotional campaign."
      : "Disabled a promotional campaign.",
    statements,
  })
}
