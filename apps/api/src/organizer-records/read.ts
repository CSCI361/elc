import {
  organizerRecordsQuerySchema,
  organizerRecordsResponseSchema,
  type OrganizerRecordsKind,
  type OrganizerRecordsResponse,
} from "@elc/shared"
import { ApiFailure, requestHash } from "../db/transitions"
import {
  encodeCursor,
  readCursor,
  retentionColumns,
  retentionDto,
  retainedSql,
  type RetentionRow,
} from "../history/store"

export type RecordsDependencies = {
  now?: () => number
  beforeRead?: () => Promise<void>
}
type Capability = "manage" | "history" | "analytics" | "support" | "refund"
const permissions: Record<Capability, string> = {
  manage: "event:manage",
  history: "history:read",
  analytics: "analytics:read",
  support: "support:manage",
  refund: "refund:initiate",
}
// Only these server-owned permission names are interpolated into SQL.
const capabilitySql = (capability: Capability) =>
  `(e.organizer_id=u.id OR EXISTS(SELECT 1 FROM event_permissions ep WHERE ep.event_id=e.id AND ep.user_id=u.id AND ep.permission='${permissions[capability]}' AND ep.revoked_at IS NULL))`
const eventContext = `WITH permitted AS (SELECT e.id,e.title,e.time_zone,e.ends_at,e.cancelled_at,e.suspended_at,${retentionColumns},
  ${Object.keys(permissions)
    .map((key) => `${capabilitySql(key as Capability)} AS can_${key}`)
    .join(",")}
  FROM events e JOIN user u ON u.id=? LEFT JOIN profiles p ON p.user_id=u.id
  WHERE e.id=? AND u.email_verified=1 AND p.suspended_at IS NULL AND (${capabilitySql("manage")} OR ${capabilitySql("history")})),
  authorized_event AS (SELECT * FROM permitted WHERE ${retainedSql})`
type Metadata = RetentionRow & {
  id: string
  title: string
  time_zone: string
  can_manage: number
  can_history: number
  can_analytics: number
  can_support: number
  can_refund: number
}
type Row = Record<string, unknown> & { id: string; page_at: number }
const iso = (value: unknown) => new Date(Number(value)).toISOString()
const nullableIso = (value: unknown) => (value === null ? null : iso(value))

function dto(kind: OrganizerRecordsKind, row: Row) {
  if (kind === "orders")
    return {
      id: row.id,
      state: row.state,
      revision: row.revision,
      createdAt: iso(row.created_at),
      completedAt: nullableIso(row.completed_at),
      quantity: row.quantity,
      subtotalMinor: row.subtotal_minor,
      discountMinor: row.discount_minor,
      totalMinor: row.total_minor,
      processingFeeMinor: row.processing_fee_minor,
      currency: row.currency,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      admissionBlocked: Boolean(row.admission_blocked),
      refundState: row.refund_state,
      refundAmountMinor: row.refund_amount_minor,
      ticketCount: row.ticket_count,
    }
  if (kind === "tickets")
    return {
      id: row.id,
      orderId: row.order_id,
      attendeeName: row.attendee_name,
      ticketTypeName: row.ticket_type_name,
      state: row.state,
      createdAt: iso(row.created_at),
      seat: row.seat_json === null ? null : JSON.parse(row.seat_json as string),
      admissionBlocked: Boolean(row.admission_blocked),
      activeCheckinId: row.active_checkin_id,
      activeCheckinAt: nullableIso(row.active_checkin_at),
      unresolvedOfflineAdmission: Boolean(row.unresolved_offline),
    }
  return {
    id: row.id,
    ticketId: row.ticket_id,
    orderId: row.order_id,
    attendeeName: row.attendee_name,
    seat: row.seat_json === null ? null : JSON.parse(row.seat_json as string),
    capturedAt: iso(row.captured_at),
    committedAt: iso(row.committed_at),
    reversedAt: nullableIso(row.reversed_at),
    reversedBy: row.reversed_by,
    reversalReason: row.reversal_reason,
  }
}

/** Safe event-scoped projections, with capabilities, retention and rows read in one final snapshot. */
export async function readOrganizerRecords(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown = {},
  dependencies: RecordsDependencies = {}
): Promise<OrganizerRecordsResponse> {
  const parsed = organizerRecordsQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose valid event record filters."
    )
  const input = parsed.data
  const filter = await requestHash("organizer.records", {
    actorId,
    eventId,
    kind: input.kind,
    q: input.q,
    orderId: input.orderId,
    ticketId: input.ticketId,
  })
  const cursor = readCursor(input.cursor, filter)
  if (input.kind === "tickets" && cursor && cursor.at !== 0)
    throw new ApiFailure("INVALID_INPUT", 400, "The record cursor is invalid.")
  const alias =
    input.kind === "orders" ? "o" : input.kind === "tickets" ? "t" : "ci"
  const timestamp = input.kind === "orders" ? "o.created_at" : "ci.committed_at"
  const conditions: string[] = [],
    bindings: unknown[] = []
  if (input.orderId) {
    conditions.push("o.id=?")
    bindings.push(input.orderId)
  }
  if (input.ticketId) {
    conditions.push(
      input.kind === "orders"
        ? "EXISTS(SELECT 1 FROM tickets ft WHERE ft.order_id=o.id AND ft.event_id=e.id AND ft.id=?)"
        : "t.id=?"
    )
    bindings.push(input.ticketId)
  }
  if (input.q) {
    if (input.kind === "orders") {
      conditions.push(`(o.id=? OR EXISTS(SELECT 1 FROM tickets qt WHERE qt.order_id=o.id AND qt.event_id=e.id AND qt.id=?)
       OR EXISTS(SELECT 1 FROM order_items qi,json_each(qi.attendees_json) name WHERE qi.order_id=o.id AND instr(lower(name.value),lower(?))>0))`)
      bindings.push(input.q, input.q, input.q)
    } else {
      conditions.push(
        `(${alias}.id=? OR t.id=? OR o.id=? OR instr(lower(t.attendee_name),lower(?))>0)`
      )
      bindings.push(input.q, input.q, input.q, input.q)
    }
  }
  if (cursor) {
    if (input.kind === "tickets") {
      conditions.push("t.id>?")
      bindings.push(cursor.id)
    } else {
      conditions.push(`(${timestamp}<? OR (${timestamp}=? AND ${alias}.id<?))`)
      bindings.push(cursor.at, cursor.at, cursor.id)
    }
  }
  await dependencies.beforeRead?.()
  const now = dependencies.now?.() ?? Date.now()
  const blocked = `(o.state<>'completed' OR o.admission_blocked_at IS NOT NULL OR e.cancelled_at IS NOT NULL OR e.suspended_at IS NOT NULL OR e.ends_at<=?)`
  const selection =
    input.kind === "orders"
      ? `SELECT o.id,o.created_at AS page_at,o.state,o.revision,o.created_at,o.completed_at,o.subtotal_minor,o.discount_minor,o.total_minor,o.processing_fee_minor,o.currency,o.campaign_id,c.name AS campaign_name,
       ${blocked} AS admission_blocked, r.state AS refund_state,r.amount_minor AS refund_amount_minor,
       COALESCE((SELECT sum(oi.quantity) FROM order_items oi WHERE oi.order_id=o.id),0) AS quantity,
       (SELECT count(*) FROM tickets ot WHERE ot.order_id=o.id AND ot.event_id=e.id) AS ticket_count
       FROM authorized_event e JOIN orders o ON o.event_id=e.id LEFT JOIN campaigns c ON c.id=o.campaign_id AND c.event_id=e.id
       LEFT JOIN reservations held ON held.order_id=o.id LEFT JOIN refunds r ON r.payment_attempt_id=held.payment_attempt_id`
      : input.kind === "tickets"
        ? `SELECT t.id,0 AS page_at,t.order_id,t.attendee_name,oi.ticket_type_name,t.state,t.created_at,t.seat_json,
         (${blocked} OR t.state IN('cancelled','refunded')) AS admission_blocked,ci.id AS active_checkin_id,ci.committed_at AS active_checkin_at,
         EXISTS(SELECT 1 FROM offline_admission_reports report WHERE report.order_id=o.id AND report.ticket_id=t.id AND report.review_state='unresolved') AS unresolved_offline
         FROM authorized_event e JOIN tickets t ON t.event_id=e.id JOIN orders o ON o.id=t.order_id AND o.event_id=e.id
         JOIN order_items oi ON oi.id=t.order_item_id AND oi.order_id=o.id LEFT JOIN checkins ci ON ci.ticket_id=t.id AND ci.reversed_at IS NULL`
        : `SELECT ci.id,ci.committed_at AS page_at,ci.ticket_id,t.order_id,t.attendee_name,t.seat_json,ci.captured_at,ci.committed_at,ci.reversed_at,ci.reversed_by,ci.reversal_reason
         FROM authorized_event e JOIN tickets t ON t.event_id=e.id JOIN orders o ON o.id=t.order_id AND o.event_id=e.id JOIN checkins ci ON ci.ticket_id=t.id`
  const contextBindings = [actorId, eventId, now]
  const [metadata, records] = await db.batch([
    db
      .prepare(`${eventContext} SELECT * FROM authorized_event`)
      .bind(...contextBindings),
    db
      .prepare(
        `${eventContext} ${selection} ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY ${input.kind === "tickets" ? "t.id" : `${timestamp} DESC,${alias}.id DESC`} LIMIT ?`
      )
      .bind(
        ...contextBindings,
        ...(input.kind === "checkins" ? [] : [now]),
        ...bindings,
        input.limit + 1
      ),
  ])
  const event = metadata!.results[0] as Metadata | undefined
  if (!event)
    throw new ApiFailure(
      "NOT_FOUND",
      404,
      "This event's retained records are unavailable."
    )
  const rows = records!.results as Row[],
    page = rows.slice(0, input.limit),
    last = page.at(-1)
  return organizerRecordsResponseSchema.parse({
    kind: input.kind,
    event: { id: event.id, title: event.title, timeZone: event.time_zone },
    retention: retentionDto(event),
    capabilities: {
      manage: Boolean(event.can_manage),
      history: Boolean(event.can_history),
      analytics: Boolean(event.can_analytics),
      support: Boolean(event.can_support),
      refund: Boolean(event.can_refund),
    },
    items: page.map((row) => dto(input.kind, row)),
    generatedAt: iso(now),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor(last.page_at, last.id, filter)
        : null,
  })
}
