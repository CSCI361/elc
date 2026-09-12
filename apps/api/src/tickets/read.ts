import { ticketSchema } from "@elc/shared"
import {
  requireActiveAccount,
  requireEventPermission,
} from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { recoverTicketCredential } from "./credentials"

export async function readOrderTickets(
  env: Pick<Bindings, "DB" | "TICKET_ENCRYPTION_KEY">,
  actorId: string,
  orderId: string,
  cursor?: string
) {
  await requireActiveAccount(env.DB, actorId)
  const order = await env.DB.prepare(
    "SELECT account_id, event_id FROM orders WHERE id = ?"
  )
    .bind(orderId)
    .first<{ account_id: string; event_id: string }>()
  if (!order) throw new ApiFailure("NOT_FOUND", 404, "Order not found.")
  if (order.account_id !== actorId)
    await requireEventPermission(
      env.DB,
      actorId,
      order.event_id,
      "event:manage"
    )
  const rows = await env.DB.prepare(
    "SELECT id FROM tickets WHERE order_id = ? AND id > ? ORDER BY id LIMIT 101"
  )
    .bind(orderId, cursor ?? "")
    .all<{ id: string }>()
  const selected = rows.results.slice(0, 100)
  const items = await Promise.all(
    selected.map(async (row) => (await readTicket(env, actorId, row.id)).ticket)
  )
  return {
    items,
    nextCursor: rows.results.length > 100 ? selected.at(-1)!.id : null,
  }
}

export async function readTicket(
  env: Pick<Bindings, "DB" | "TICKET_ENCRYPTION_KEY">,
  actorId: string,
  ticketId: string,
  includeCredential = false
) {
  await requireActiveAccount(env.DB, actorId)
  const row =
    await env.DB.prepare(`SELECT t.*, o.account_id, o.admission_blocked_at
    FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.id = ?`)
      .bind(ticketId)
      .first<{
        id: string
        order_id: string
        event_id: string
        ticket_type_id: string
        attendee_name: string
        state: string
        seat_json: string | null
        account_id: string
        admission_blocked_at: number | null
        credential_ciphertext: string
      }>()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Ticket not found.")
  if (row.account_id !== actorId)
    await requireEventPermission(env.DB, actorId, row.event_id, "event:manage")
  const ticket = ticketSchema.parse({
    id: row.id,
    orderId: row.order_id,
    eventId: row.event_id,
    ticketTypeId: row.ticket_type_id,
    attendeeName: row.attendee_name,
    state: row.state,
    admissionBlocked: row.admission_blocked_at !== null,
    seat: row.seat_json === null ? null : JSON.parse(row.seat_json),
  })
  if (!includeCredential) return { ticket }
  return {
    ticket,
    credential: await recoverTicketCredential(
      row.id,
      row.credential_ciphertext,
      env.TICKET_ENCRYPTION_KEY
    ),
  }
}
