import {
  organizerHistoryQuerySchema,
  organizerHistoryResponseSchema,
  eventHistoryQuerySchema,
  eventHistoryResponseSchema,
  type HistoryActivityType,
} from "../../../../packages/shared/src/history-api"
import { policy } from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure, requestHash } from "../db/transitions"
import { eventDto, eventImageProjection, type EventRow } from "../events/store"
import { reportingPeriod } from "../reporting/dates"
import { supportAccessExpression } from "../support/guards"
import {
  encodeCursor,
  eventAuthoritySql,
  parseHistory,
  readCursor,
  retainedEvent,
  retainedSql,
  retentionColumns,
  retentionDto,
  type RetentionRow,
  type HistoryDependencies,
} from "./store"

export const activityTypeSql = `CASE
 WHEN a.action LIKE 'event.%' THEN 'event'
 WHEN a.action LIKE 'ticket_type.%' OR a.action LIKE 'seat.%' THEN 'ticket_type'
 WHEN a.action LIKE 'campaign.%' OR a.action LIKE 'promo.%' THEN 'campaign'
 WHEN a.action LIKE 'permission.%' OR a.action LIKE 'staff.%' OR a.action LIKE 'access.%' OR a.action LIKE 'invitation.%' THEN 'permission'
 WHEN a.action LIKE 'activation.%' THEN 'activation'
 WHEN a.action LIKE 'moderation.%' THEN 'moderation'
 WHEN a.action LIKE 'payment.%' OR a.action LIKE 'order.%' THEN 'payment'
 WHEN a.action LIKE 'refund.%' THEN 'refund'
 WHEN a.action LIKE 'checkin.%' OR a.action LIKE 'ticket.scan%' THEN 'checkin'
 WHEN a.action LIKE 'support.%' THEN 'support'
 WHEN a.action LIKE 'payout.%' THEN 'payout'
 WHEN a.action LIKE 'offline.%' OR a.action LIKE 'device.%' THEN 'offline'
 ELSE 'other' END`

export async function listOrganizerHistory(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  dependencies: HistoryDependencies = {}
) {
  const input = parseHistory(organizerHistoryQuerySchema, raw)
  await requireActiveAccount(db, actorId)
  const now = dependencies.now?.() ?? Date.now()
  const filter = await requestHash("history.list", {
    actorId,
    phase: input.phase,
    q: input.q,
    start: input.start,
    end: input.end,
  })
  const cursor = readCursor(input.cursor, filter)
  const conditions = [
    eventAuthoritySql("history:read"),
    "(e.ends_at <= ? OR e.cancelled_at IS NOT NULL)",
    retainedSql,
  ]
  const bindings: unknown[] = [actorId, now, now]
  if (input.phase)
    conditions.push(
      input.phase === "cancelled"
        ? "e.cancelled_at IS NOT NULL"
        : "e.cancelled_at IS NULL"
    )
  if (input.q) {
    conditions.push("instr(lower(e.title), lower(?)) > 0")
    bindings.push(input.q)
  }
  if (input.start && input.end) {
    const period = reportingPeriod(
      { range: "custom", start: input.start, end: input.end, limit: 20 },
      policy.defaultTimeZone,
      now
    )
    conditions.push("e.starts_at >= ? AND e.starts_at < ?")
    bindings.push(period.startAt, period.endExclusive)
  }
  if (cursor) {
    conditions.push("(e.starts_at < ? OR (e.starts_at = ? AND e.id < ?))")
    bindings.push(cursor.at, cursor.at, cursor.id)
  }
  await dependencies.beforeReturn?.()
  const rows = (
    await db
      .prepare(`SELECT e.*, ${eventImageProjection}, ${retentionColumns}, (${eventAuthoritySql("event:manage")}) AS can_manage
    FROM events e WHERE ${conditions.join(" AND ")} ORDER BY e.starts_at DESC, e.id DESC LIMIT ?`)
      .bind(actorId, ...bindings, input.limit + 1)
      .all<EventRow & RetentionRow & { can_manage: number }>()
  ).results
  await requireActiveAccount(db, actorId)
  // Recheck returned event grants together so revocation between reads cannot expose a stale row.
  const ids = rows.map((row) => row.id)
  const authorized = new Set(
    (
      await db
        .prepare(
          `SELECT e.id FROM events e JOIN json_each(?) selected ON selected.value = e.id WHERE ${eventAuthoritySql("history:read")}`
        )
        .bind(JSON.stringify(ids), actorId)
        .all<{ id: string }>()
    ).results.map((row) => row.id)
  )
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return organizerHistoryResponseSchema.parse({
    items: page
      .filter((row) => authorized.has(row.id))
      .map((row) => ({
        event: eventDto(row, now),
        retention: retentionDto(row),
        canDuplicate: Boolean(row.can_manage) && row.suspended_at === null,
      })),
    timeZone: policy.defaultTimeZone,
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor(last.starts_at, last.id, filter)
        : null,
  })
}

type AuditRow = {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  activity_type: HistoryActivityType
  entity_id: string
  description: string
  correlation_id: string
  created_at: number
}
export async function readEventHistory(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown = {},
  dependencies: HistoryDependencies = {}
) {
  const input = parseHistory(eventHistoryQuerySchema, raw)
  const now = dependencies.now?.() ?? Date.now()
  const event = await retainedEvent(db, actorId, eventId, now)
  const supportAuditAccess = `(a.action NOT LIKE 'support.%' OR EXISTS (SELECT 1 FROM support_cases c WHERE c.id = a.entity_id AND c.event_id = a.event_id AND c.audience = 'attendee' AND ${supportAccessExpression("c")}))`
  const latest = await db
    .prepare(
      `SELECT MAX(a.created_at) AS latest FROM audit_entries a JOIN events e ON e.id = a.event_id WHERE a.event_id = ? AND a.scope = 'event' AND ${eventAuthoritySql("history:read")} AND ${supportAuditAccess}`
    )
    .bind(eventId, actorId, actorId)
    .first<number>("latest")
  const anchor = Math.min(now, Math.max(event.updated_at, latest ?? 0))
  const period = reportingPeriod(
    {
      range: input.range,
      start: input.start,
      end: input.end,
      limit: input.limit,
    },
    event.time_zone,
    anchor
  )
  const filter = await requestHash("history.timeline", {
    actorId,
    eventId,
    start: period.start,
    end: period.end,
    timeZone: event.time_zone,
    activityType: input.activityType,
  })
  const cursor = readCursor(input.cursor, filter)
  const conditions = [
    "a.event_id = ?",
    "a.scope = 'event'",
    eventAuthoritySql("history:read"),
    "a.created_at >= ? AND a.created_at < ?",
    supportAuditAccess,
    "e.time_zone = ?",
  ]
  const bindings: unknown[] = [
    eventId,
    actorId,
    period.startAt,
    period.endExclusive,
    actorId,
    event.time_zone,
  ]
  if (input.activityType) {
    conditions.push(`(${activityTypeSql}) = ?`)
    bindings.push(input.activityType)
  }
  if (cursor) {
    conditions.push("(a.created_at > ? OR (a.created_at = ? AND a.id > ?))")
    bindings.push(cursor.at, cursor.at, cursor.id)
  }
  const sql = `SELECT a.*, u.name AS actor_name, ${activityTypeSql} AS activity_type FROM audit_entries a JOIN events e ON e.id = a.event_id LEFT JOIN user u ON u.id = a.actor_id WHERE ${conditions.join(" AND ")} ORDER BY a.created_at, a.id LIMIT ?`
  await dependencies.beforeReturn?.()
  const currentNow = dependencies.now?.() ?? Date.now()
  const [metadata, entries] = await db.batch([
    db
      .prepare(`SELECT e.*, ${eventImageProjection}, ${retentionColumns}, (${eventAuthoritySql("event:manage")}) AS can_manage FROM events e
      WHERE e.id = ? AND ${eventAuthoritySql("history:read")} AND ${retainedSql}`)
      .bind(actorId, eventId, actorId, currentNow),
    db.prepare(sql).bind(...bindings, input.limit + 1),
  ])
  const current = metadata!.results[0] as
    | (EventRow & RetentionRow & { can_manage: number })
    | undefined
  if (!current) {
    await retainedEvent(db, actorId, eventId, currentNow)
    throw new ApiFailure(
      "NOT_FOUND",
      404,
      "This event's retained history is unavailable."
    )
  }
  if (current.time_zone !== event.time_zone)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The event time zone changed. Reload its history."
    )
  const rows = entries!.results as AuditRow[]
  const page = rows.slice(0, input.limit),
    last = page.at(-1)
  return eventHistoryResponseSchema.parse({
    event: eventDto(current, currentNow),
    retention: retentionDto(current),
    canDuplicate:
      Boolean(current.can_manage) &&
      current.suspended_at === null &&
      (current.ends_at <= currentNow || current.cancelled_at !== null),
    timeZone: current.time_zone,
    period: { start: period.start, end: period.end },
    items: page.map((row) => ({
      id: row.id,
      createdAt: new Date(row.created_at).toISOString(),
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorType: row.actor_id?.startsWith("system:")
        ? "system"
        : row.actor_name !== null
          ? "user"
          : "unknown",
      action: row.action,
      activityType: row.activity_type,
      entityId: row.entity_id,
      description: row.description,
      correlationId: row.correlation_id,
    })),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor(last.created_at, last.id, filter)
        : null,
  })
}
