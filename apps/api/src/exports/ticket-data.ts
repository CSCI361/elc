import type { Ticket } from "@elc/shared"
import {
  requireActiveAccount,
  requireEventPermission,
} from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import type { ExportLocale } from "./labels"

export type TicketPdfData = {
  ticketId: string
  orderId: string
  eventId: string
  attendee: string
  ticketType: string
  state: "valid" | "checked_in" | "cancelled" | "refunded"
  admissionBlocked: boolean
  eventCancelled: boolean
  eventSuspended: boolean
  seat: Ticket["seat"]
  unitPriceMinor: number
  orderDiscountMinor: number
  orderTotalMinor: number
  currency: "KZT"
  eventTitle: string
  startsAt: number
  endsAt: number
  timeZone: string
  venueName: string
  venueAddress: string
  eventUrl: string
  locale: ExportLocale
}

export async function loadTicketPdfSource(
  db: D1Database,
  appOrigin: string,
  actorId: string,
  ticketId: string,
  locale: ExportLocale
) {
  await requireActiveAccount(db, actorId)
  // Resolve only the ownership scope before authorization; credentials and R2 remain unread.
  const access = await db
    .prepare(`SELECT o.account_id, t.event_id FROM tickets t
    JOIN orders o ON o.id = t.order_id WHERE t.id = ?`)
    .bind(ticketId)
    .first<{ account_id: string; event_id: string }>()
  if (!access) throw new ApiFailure("NOT_FOUND", 404, "Ticket not found.")
  if (access.account_id !== actorId)
    await requireEventPermission(db, actorId, access.event_id, "event:manage")
  const row = await db
    .prepare(`SELECT t.id, t.order_id, t.event_id, t.attendee_name, t.state,
    t.seat_json, t.token_hash, t.credential_ciphertext, oi.ticket_type_name, oi.unit_price_minor,
    o.discount_minor, o.total_minor, o.currency, o.admission_blocked_at,
    e.title, e.starts_at, e.ends_at, e.time_zone, e.venue_name, e.venue_address, e.cancelled_at, e.suspended_at
    FROM tickets t JOIN orders o ON o.id = t.order_id JOIN order_items oi ON oi.id = t.order_item_id
    JOIN events e ON e.id = t.event_id WHERE t.id = ?`)
    .bind(ticketId)
    .first<{
      id: string
      order_id: string
      event_id: string
      attendee_name: string
      state: TicketPdfData["state"]
      seat_json: string | null
      token_hash: string
      credential_ciphertext: string
      ticket_type_name: string
      unit_price_minor: number
      discount_minor: number
      total_minor: number
      currency: "KZT"
      admission_blocked_at: number | null
      title: string
      starts_at: number
      ends_at: number
      time_zone: string
      venue_name: string
      venue_address: string
      cancelled_at: number | null
      suspended_at: number | null
    }>()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Ticket not found.")
  const data: TicketPdfData = {
    ticketId: row.id,
    orderId: row.order_id,
    eventId: row.event_id,
    attendee: row.attendee_name,
    ticketType: row.ticket_type_name,
    state: row.state,
    admissionBlocked: row.admission_blocked_at !== null,
    eventCancelled: row.cancelled_at !== null,
    eventSuspended: row.suspended_at !== null,
    seat: row.seat_json === null ? null : JSON.parse(row.seat_json),
    unitPriceMinor: row.unit_price_minor,
    orderDiscountMinor: row.discount_minor,
    orderTotalMinor: row.total_minor,
    currency: row.currency,
    eventTitle: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timeZone: row.time_zone,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    eventUrl: new URL(`/events/${encodeURIComponent(row.event_id)}`, appOrigin)
      .href,
    locale,
  }
  return {
    data,
    tokenHash: row.token_hash,
    ciphertext: row.credential_ciphertext,
  }
}
