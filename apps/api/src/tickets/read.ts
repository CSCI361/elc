import { ticketSchema } from "@elc/shared"
import {
  requireActiveAccount,
  requireEventPermission,
} from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { recoverTicketCredential } from "./credentials"

type ReadDependencies = { beforeReturn?: () => Promise<void> }
type TicketRow = {
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
}
const authorizedOrder = `FROM orders o JOIN events e ON e.id=o.event_id JOIN user u ON u.id=? LEFT JOIN profiles p ON p.user_id=u.id
  WHERE o.id=? AND u.email_verified=1 AND p.suspended_at IS NULL AND
  (o.account_id=u.id OR e.organizer_id=u.id OR EXISTS(SELECT 1 FROM event_permissions ep WHERE ep.event_id=e.id AND ep.user_id=u.id AND ep.permission='event:manage' AND ep.revoked_at IS NULL))`
const authorizedTicket = `FROM tickets t JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=o.event_id
  JOIN user u ON u.id=? LEFT JOIN profiles p ON p.user_id=u.id WHERE t.id=? AND u.email_verified=1 AND p.suspended_at IS NULL
  AND (o.account_id=u.id OR e.organizer_id=u.id OR EXISTS(SELECT 1 FROM event_permissions ep WHERE ep.event_id=e.id AND ep.user_id=u.id AND ep.permission='event:manage' AND ep.revoked_at IS NULL))`
function ticketDto(row: TicketRow) {
  return ticketSchema.parse({
    id: row.id,
    orderId: row.order_id,
    eventId: row.event_id,
    ticketTypeId: row.ticket_type_id,
    attendeeName: row.attendee_name,
    state: row.state,
    admissionBlocked: row.admission_blocked_at !== null,
    seat: row.seat_json === null ? null : JSON.parse(row.seat_json),
  })
}

export async function readOrderTickets(
  env: Pick<Bindings, "DB" | "TICKET_ENCRYPTION_KEY">,
  actorId: string,
  orderId: string,
  cursor?: string,
  dependencies: ReadDependencies = {}
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
  await dependencies.beforeReturn?.()
  const context = `WITH authorized_order AS (SELECT o.id,o.admission_blocked_at ${authorizedOrder})`
  const [access, rows] = await env.DB.batch([
    env.DB.prepare(`${context} SELECT id FROM authorized_order`).bind(
      actorId,
      orderId
    ),
    env.DB.prepare(
      `${context} SELECT t.*,o.admission_blocked_at FROM authorized_order o JOIN tickets t ON t.order_id=o.id WHERE t.id>? ORDER BY t.id LIMIT 101`
    ).bind(actorId, orderId, cursor ?? ""),
  ])
  if (!access!.results.length)
    throw new ApiFailure("NOT_FOUND", 404, "Order not found.")
  const selected = (rows!.results as TicketRow[]).slice(0, 100)
  return {
    items: selected.map(ticketDto),
    nextCursor: rows!.results.length > 100 ? selected.at(-1)!.id : null,
  }
}

export async function readTicket(
  env: Pick<Bindings, "DB" | "TICKET_ENCRYPTION_KEY">,
  actorId: string,
  ticketId: string,
  includeCredential = false,
  dependencies: ReadDependencies = {}
) {
  await requireActiveAccount(env.DB, actorId)
  const row =
    await env.DB.prepare(`SELECT t.*, o.account_id, o.admission_blocked_at
    FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.id = ?`)
      .bind(ticketId)
      .first<TicketRow>()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Ticket not found.")
  if (row.account_id !== actorId)
    await requireEventPermission(env.DB, actorId, row.event_id, "event:manage")
  const credential = includeCredential
    ? await recoverTicketCredential(
        row.id,
        row.credential_ciphertext,
        env.TICKET_ENCRYPTION_KEY
      )
    : undefined
  await dependencies.beforeReturn?.()
  const current =
    await env.DB.prepare(`SELECT t.*,o.account_id,o.admission_blocked_at ${authorizedTicket}
    AND t.credential_ciphertext=? AND t.order_id=? AND t.event_id=?`)
      .bind(
        actorId,
        ticketId,
        row.credential_ciphertext,
        row.order_id,
        row.event_id
      )
      .first<TicketRow>()
  if (!current) throw new ApiFailure("NOT_FOUND", 404, "Ticket not found.")
  const ticket = ticketDto(current)
  return includeCredential ? { ticket, credential: credential! } : { ticket }
}
