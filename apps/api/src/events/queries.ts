import {
  campaignListResponseSchema,
  campaignResponseSchema,
  eventDetailResponseSchema,
  eventListResponseSchema,
  inventoryResponseSchema,
  ticketTypeApiSchema,
  type EventListQuery,
  type PaginationQuery,
} from "@elc/shared"
import { z } from "zod"
import {
  requireActiveAccount,
  requireEventPermission,
  requireEventReadAccess,
} from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import {
  eventDto,
  eventImageProjection,
  findEvent,
  iso,
  type EventRow,
} from "./store"

const cursorSchema = z.strictObject({
  at: z.int(),
  id: z.string().min(1).max(128),
})

function decodeCursor(value: string) {
  try {
    return cursorSchema.parse(JSON.parse(atob(value)))
  } catch {
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The pagination cursor is invalid."
    )
  }
}

export async function listEvents(
  db: D1Database,
  query: EventListQuery,
  now: number,
  ownerId?: string
) {
  const where: string[] = []
  const bindings: unknown[] = []
  if (ownerId) {
    await requireActiveAccount(db, ownerId)
    where.push(`(e.organizer_id = ? OR EXISTS (SELECT 1 FROM event_permissions ep
      WHERE ep.event_id = e.id AND ep.user_id = ? AND ep.permission = 'event:manage' AND ep.revoked_at IS NULL))`)
    bindings.push(ownerId, ownerId)
  } else {
    where.push(
      "e.visibility = 'public' AND e.publication_state = 'published' AND e.suspended_at IS NULL"
    )
    if (!query.phase) {
      where.push("e.cancelled_at IS NULL AND e.ends_at > ?")
      bindings.push(now)
    }
  }
  if (query.q) {
    where.push(
      "(instr(lower(e.title), lower(?)) > 0 OR instr(lower(e.description), lower(?)) > 0)"
    )
    bindings.push(query.q, query.q)
  }
  if (query.category) {
    where.push("e.category = ?")
    bindings.push(query.category)
  }
  if (query.startsFrom) {
    where.push("e.starts_at >= ?")
    bindings.push(Date.parse(query.startsFrom))
  }
  if (query.startsBefore) {
    where.push("e.starts_at < ?")
    bindings.push(Date.parse(query.startsBefore))
  }
  if (query.phase === "cancelled") where.push("e.cancelled_at IS NOT NULL")
  if (query.phase && query.phase !== "cancelled") {
    where.push("e.cancelled_at IS NULL")
    if (query.phase === "upcoming") {
      where.push("e.starts_at > ?")
      bindings.push(now)
    }
    if (query.phase === "active") {
      where.push("e.starts_at <= ? AND e.ends_at > ?")
      bindings.push(now, now)
    }
    if (query.phase === "completed") {
      where.push("e.ends_at <= ?")
      bindings.push(now)
    }
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor)
    where.push("(e.starts_at > ? OR (e.starts_at = ? AND e.id > ?))")
    bindings.push(cursor.at, cursor.at, cursor.id)
  }
  const result = await db
    .prepare(`SELECT e.*,${eventImageProjection} FROM events e WHERE ${where.join(" AND ")}
    ORDER BY e.starts_at ASC, e.id ASC LIMIT ?`)
    .bind(...bindings, query.limit + 1)
    .all<EventRow>()
  const rows = result.results.slice(0, query.limit)
  const last = rows.at(-1)
  return eventListResponseSchema.parse({
    items: rows.map((event) => eventDto(event, now)),
    nextCursor:
      result.results.length > query.limit && last
        ? btoa(JSON.stringify({ at: last.starts_at, id: last.id }))
        : null,
  })
}

type TicketTypeRow = {
  id: string
  event_id: string
  name: string
  description: string
  kind: "free" | "paid"
  price_minor: number
  quantity: number
  sales_start_at: number
  sales_end_at: number
  hidden: number
  available: number
  reserved: number
  sold: number
  unavailable: number
}

async function ticketTypes(
  db: D1Database,
  eventId: string,
  now: number,
  preview: boolean
) {
  const result = await db
    .prepare(`SELECT t.*,
    COALESCE(SUM(CASE WHEN i.enabled = 1 AND i.order_id IS NULL AND
      (i.reservation_id IS NULL OR r.state != 'active' OR r.expires_at <= ?) THEN 1 ELSE 0 END), 0) AS available,
    COALESCE(SUM(CASE WHEN i.order_id IS NULL AND i.reservation_id IS NOT NULL AND r.state = 'active' AND r.expires_at > ? THEN 1 ELSE 0 END), 0) AS reserved,
    COALESCE(SUM(CASE WHEN i.order_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS sold,
    COALESCE(SUM(CASE WHEN i.enabled = 0 AND i.order_id IS NULL AND
      (i.reservation_id IS NULL OR r.state != 'active' OR r.expires_at <= ?) THEN 1 ELSE 0 END), 0) AS unavailable
    FROM ticket_types t LEFT JOIN inventory i ON i.ticket_type_id = t.id
    LEFT JOIN reservations r ON r.id = i.reservation_id
    WHERE t.event_id = ? ${preview ? "" : "AND t.hidden = 0"} GROUP BY t.id ORDER BY t.name, t.id`)
    .bind(now, now, now, eventId)
    .all<TicketTypeRow>()
  return result.results.map((type) =>
    ticketTypeApiSchema.parse({
      id: type.id,
      eventId: type.event_id,
      name: type.name,
      description: type.description,
      kind: type.kind,
      priceMinor: type.price_minor,
      currency: "KZT",
      quantity: type.quantity,
      salesStartAt: iso(type.sales_start_at),
      salesEndAt: iso(type.sales_end_at),
      hidden: Boolean(type.hidden),
      available: type.available,
      reserved: type.reserved,
      sold: type.sold,
      unavailable: type.unavailable,
    })
  )
}

async function allowRead(
  db: D1Database,
  eventId: string,
  actorId: string | undefined,
  preview: boolean
) {
  if (preview) {
    if (!actorId)
      throw new ApiFailure(
        "UNAUTHENTICATED",
        401,
        "Sign in to preview the event."
      )
    await requireEventPermission(db, actorId, eventId, "event:manage")
  } else {
    await requireEventReadAccess(db, eventId, actorId)
  }
}

export async function readEvent(
  db: D1Database,
  eventId: string,
  now: number,
  actorId?: string,
  preview = false
) {
  await allowRead(db, eventId, actorId, preview)
  const event = await findEvent(db, eventId)
  const types = await ticketTypes(db, eventId, now, preview)
  await allowRead(db, eventId, actorId, preview)
  return eventDetailResponseSchema.parse({
    event: eventDto(event, now),
    ticketTypes: types,
  })
}

type SeatRow = {
  id: string
  ticket_type_id: string
  section: string
  row: string
  number: string
  accessible: number
  enabled: number
  order_id: string | null
  reservation_id: string | null
  reservation_state: string | null
  expires_at: number | null
  price_minor: number
  hidden: number
}

export async function readInventory(
  db: D1Database,
  eventId: string,
  now: number,
  actorId?: string,
  preview = false
) {
  await allowRead(db, eventId, actorId, preview)
  const event = await findEvent(db, eventId)
  const result =
    event.seating_mode === "assigned"
      ? await db
          .prepare(`SELECT i.*, t.price_minor, t.hidden,
    r.state AS reservation_state, r.expires_at FROM inventory i
    JOIN ticket_types t ON t.id = i.ticket_type_id LEFT JOIN reservations r ON r.id = i.reservation_id
    WHERE i.event_id = ? ORDER BY i.section, i.row, CAST(i.number AS INTEGER), i.id`)
          .bind(eventId)
          .all<SeatRow>()
      : { results: [] }
  return inventoryResponseSchema.parse({
    eventId,
    revision: event.revision,
    seatingMode: event.seating_mode,
    ticketTypes: await ticketTypes(db, eventId, now, preview),
    seats: result.results.map((seat) => {
      const hidden = Boolean(seat.hidden) && !preview
      const held =
        seat.reservation_id !== null &&
        seat.reservation_state === "active" &&
        (seat.expires_at ?? 0) > now
      return {
        id: seat.id,
        ticketTypeId: hidden ? null : seat.ticket_type_id,
        section: seat.section,
        row: seat.row,
        number: seat.number,
        accessible: Boolean(seat.accessible),
        enabled: Boolean(seat.enabled),
        priceMinor: hidden ? null : seat.price_minor,
        state: hidden
          ? "unavailable"
          : seat.order_id !== null
            ? "sold"
            : held
              ? "held"
              : seat.enabled
                ? "available"
                : "unavailable",
      }
    }),
  })
}

type CampaignRow = {
  id: string
  event_id: string
  name: string
  code: string
  reporting_id: string
  discount_kind: "percentage" | "fixed"
  discount_value: number
  starts_at: number
  ends_at: number
  max_redemptions: number
  enabled: number
  updated_at: number
}

export async function readCampaigns(
  db: D1Database,
  eventId: string,
  actorId: string,
  appOrigin: string,
  campaignId?: string,
  query: PaginationQuery = { limit: 20 },
  beforeReturn?: () => Promise<void>
) {
  await requireEventPermission(db, actorId, eventId, "event:manage")
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const bindings: unknown[] = [eventId]
  if (campaignId) bindings.push(campaignId)
  if (cursor) bindings.push(cursor.at, cursor.at, cursor.id)
  bindings.push(query.limit + 1)
  const result = await db
    .prepare(`SELECT * FROM campaigns WHERE event_id = ? ${campaignId ? "AND id = ?" : ""}
    ${cursor ? "AND (updated_at < ? OR (updated_at = ? AND id > ?))" : ""}
    ORDER BY updated_at DESC, id ASC LIMIT ?`)
    .bind(...bindings)
    .all<CampaignRow>()
  if (campaignId && result.results.length === 0)
    throw new ApiFailure("NOT_FOUND", 404, "Campaign not found.")
  const rows = result.results.slice(0, query.limit)
  const applicability = await db
    .prepare(`SELECT ctt.campaign_id, ctt.ticket_type_id FROM campaign_ticket_types ctt
    WHERE ctt.campaign_id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(rows.map((row) => row.id)))
    .all<{ campaign_id: string; ticket_type_id: string }>()
  const items = rows.map((campaign) => {
    const url = new URL(`/events/${encodeURIComponent(eventId)}`, appOrigin)
    url.searchParams.set("campaign", campaign.code)
    return campaignResponseSchema.parse({
      id: campaign.id,
      eventId: eventId,
      name: campaign.name,
      code: campaign.code,
      campaignUrl: url.toString(),
      reportingId: campaign.reporting_id,
      discount:
        campaign.discount_kind === "percentage"
          ? { kind: "percentage", basisPoints: campaign.discount_value }
          : { kind: "fixed", amountMinor: campaign.discount_value },
      startsAt: iso(campaign.starts_at),
      endsAt: iso(campaign.ends_at),
      maxRedemptions: campaign.max_redemptions,
      enabled: Boolean(campaign.enabled),
      updatedAt: iso(campaign.updated_at),
      applicableTicketTypeIds: applicability.results
        .filter((entry) => entry.campaign_id === campaign.id)
        .map((entry) => entry.ticket_type_id),
    })
  })
  const last = rows.at(-1)
  await beforeReturn?.()
  await requireEventPermission(db, actorId, eventId, "event:manage")
  return campaignListResponseSchema.parse({
    items,
    nextCursor:
      result.results.length > query.limit && last
        ? btoa(JSON.stringify({ at: last.updated_at, id: last.id }))
        : null,
  })
}
