import {
  offlineListQuerySchema,
  scannerAttendeeQuerySchema,
  scannerAttendeesResponseSchema,
  scannerEventSchema,
  scannerEventsResponseSchema,
} from "@elc/shared"
import {
  requireActiveAccount,
  requireEventPermission,
} from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import { activeAccountSql } from "../events/store"
import { staffAuthorizationSql } from "../tickets/scan"
import { nextOfflineCursor, offlineCursor } from "./devices"
import { iso, parseOffline } from "./store"

type ScannerEventRow = {
  id: string
  title: string
  venue_name: string
  time_zone: string
  starts_at: number
  ends_at: number
  cancelled_at: number | null
  suspended_at: number | null
  permissions: string
  registered: number
  checked_in: number
  unresolved_offline: number
  cover_image_url: string | null
}
const eventSelection = `SELECT e.id, e.title, e.venue_name, e.time_zone, e.starts_at, e.ends_at, e.cancelled_at, e.suspended_at,
  (SELECT json_group_array(permission) FROM event_permissions WHERE event_id = e.id AND user_id = ? AND revoked_at IS NULL) AS permissions,
  (SELECT count(*) FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.event_id = e.id AND t.state IN ('valid', 'checked_in') AND o.state = 'completed' AND o.admission_blocked_at IS NULL AND e.cancelled_at IS NULL AND e.suspended_at IS NULL) AS registered,
  (SELECT count(*) FROM tickets t JOIN orders o ON o.id = t.order_id JOIN checkins ci ON ci.ticket_id = t.id AND ci.reversed_at IS NULL WHERE t.event_id = e.id AND t.state = 'checked_in' AND o.state = 'completed' AND o.admission_blocked_at IS NULL AND e.cancelled_at IS NULL AND e.suspended_at IS NULL) AS checked_in,
  (SELECT count(*) FROM offline_admission_reports r JOIN offline_operations op ON op.operation_id = r.operation_id WHERE op.event_id = e.id AND r.review_state = 'unresolved') AS unresolved_offline,
  (SELECT '/api/events/' || l.event_id || '/images/' || l.id FROM event_images l JOIN event_image_assets a ON a.id = l.asset_id WHERE l.event_id = e.id AND a.state = 'ready' ORDER BY l.position, l.id LIMIT 1) AS cover_image_url
  FROM events e`
function eventDto(row: ScannerEventRow) {
  return scannerEventSchema.parse({
    id: row.id,
    title: row.title,
    venueName: row.venue_name,
    timeZone: row.time_zone,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    cancelledAt: row.cancelled_at === null ? null : iso(row.cancelled_at),
    suspendedAt: row.suspended_at === null ? null : iso(row.suspended_at),
    permissions: JSON.parse(row.permissions),
    counts: {
      registered: row.registered,
      checkedIn: row.checked_in,
      unresolvedOffline: row.unresolved_offline,
    },
    coverImageUrl: row.cover_image_url,
  })
}
export async function listScannerEvents(
  db: D1Database,
  actorId: string,
  raw: unknown = {}
) {
  await requireActiveAccount(db, actorId)
  const input = parseOffline(offlineListQuerySchema, raw)
  const scope = `scanner-events:${actorId}`
  const cursor = offlineCursor(input.cursor, scope)
  const [active, records] = await db.batch([
    db.prepare(`SELECT (${activeAccountSql}) AS allowed`).bind(actorId),
    db
      .prepare(
        `${eventSelection} WHERE e.id > ? AND EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.event_id = e.id AND ep.user_id = ? AND ep.permission = 'ticket:scan' AND ep.revoked_at IS NULL) ORDER BY e.id LIMIT ?`
      )
      .bind(actorId, cursor, actorId, input.limit + 1),
  ])
  if (!(active!.results[0] as { allowed: number }).allowed)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Verify an active account before opening the scanner."
    )
  const rows = records!.results as ScannerEventRow[]
  const page = rows.slice(0, input.limit)
  return scannerEventsResponseSchema.parse({
    items: page.map(eventDto),
    nextCursor:
      rows.length > input.limit
        ? nextOfflineCursor(scope, page.at(-1)!.id)
        : null,
  })
}
export async function getScannerEvent(
  db: D1Database,
  actorId: string,
  eventId: string
) {
  await requireEventPermission(db, actorId, eventId, "ticket:scan")
  const authorization = staffAuthorizationSql(actorId, eventId, "ticket:scan")
  const row = await db
    .prepare(
      `${eventSelection} WHERE e.id = ? AND (${authorization.predicate})`
    )
    .bind(actorId, eventId, ...authorization.bindings)
    .first<ScannerEventRow>()
  if (!row)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Your scanning assignment is no longer available."
    )
  return eventDto(row)
}
export async function searchScannerAttendees(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown = {},
  dependencies: { beforeRead?: () => Promise<void> } = {}
) {
  await requireEventPermission(db, actorId, eventId, "ticket:scan")
  const input = parseOffline(scannerAttendeeQuerySchema, raw)
  const scope = `scanner-attendees:${eventId}:${actorId}:${input.q}`
  const cursor = offlineCursor(input.cursor, scope)
  const authorization = staffAuthorizationSql(actorId, eventId, "ticket:scan")
  await dependencies.beforeRead?.()
  const query = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`
  const [authorized, rows] = await db.batch([
    db
      .prepare(`SELECT (${authorization.predicate}) AS allowed`)
      .bind(...authorization.bindings),
    db
      .prepare(`SELECT t.id, t.attendee_name, t.state, t.seat_json,
      (o.state <> 'completed' OR o.admission_blocked_at IS NOT NULL OR e.cancelled_at IS NOT NULL OR e.suspended_at IS NOT NULL) AS admission_blocked,
      (SELECT id FROM checkins WHERE ticket_id = t.id AND reversed_at IS NULL) AS active_checkin_id
      FROM tickets t JOIN orders o ON o.id = t.order_id JOIN events e ON e.id = t.event_id
      WHERE t.event_id = ? AND t.id > ? AND t.attendee_name LIKE ? ESCAPE '\\' ORDER BY t.id LIMIT ?`)
      .bind(eventId, cursor, query, input.limit + 1),
  ])
  if (!(authorized!.results[0] as { allowed: number }).allowed)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Your scanning assignment is no longer available."
    )
  const records = rows!.results as {
    id: string
    attendee_name: string
    state: string
    seat_json: string | null
    admission_blocked: number
    active_checkin_id: string | null
  }[]
  const page = records.slice(0, input.limit)
  return scannerAttendeesResponseSchema.parse({
    eventId,
    items: page.map((row) => ({
      ticketId: row.id,
      attendeeName: row.attendee_name,
      state: row.state,
      admissionBlocked: !!row.admission_blocked,
      seat: row.seat_json ? JSON.parse(row.seat_json) : null,
      activeCheckInId: row.active_checkin_id,
    })),
    nextCursor:
      records.length > input.limit
        ? nextOfflineCursor(scope, page.at(-1)!.id)
        : null,
  })
}
