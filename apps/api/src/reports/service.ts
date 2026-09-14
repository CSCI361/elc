import {
  eventReportQueueQuerySchema,
  eventReportQueueResponseSchema,
  eventReportReceiptSchema,
  eventReportResolutionSchema,
  resolveEventReportRequestSchema,
  submitEventReportRequestSchema,
  type EventReportQueueResponse,
  type EventReportReceipt,
  type EventReportResolution,
} from "@elc/shared"
import { HTTPException } from "hono/http-exception"
import { requireEventReadAccess } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeAccountSql } from "../events/store"
import { platformGrantSql } from "../activation/mutations"
import { encodeCursor, readCursor } from "../history/store"

const permission = "platform:moderate" as const
const moderator = `(${activeAccountSql}) AND (${platformGrantSql})`
const iso = (value: number) => new Date(value).toISOString()

interface Dependencies {
  now?: () => number
  beforeCommit?: () => Promise<void>
}

interface QueueRow {
  id: string
  event_id: string
  event_title: string
  organizer_id: string
  suspended_at: number | null
  event_revision: number
  reporter_id: string
  category: EventReportReceipt["category"]
  details: string
  state: EventReportReceipt["state"]
  revision: number
  created_at: number
  updated_at: number
  resolved_at: number | null
  resolution_reason: string | null
  open_reports: number
}

const forbidden = () =>
  new ApiFailure(
    "FORBIDDEN",
    403,
    "Platform moderation permission is required."
  )

async function requireModerator(db: D1Database, actorId: string) {
  const allowed = await db
    .prepare(`SELECT 1 WHERE ${moderator}`)
    .bind(actorId, actorId, permission)
    .first()
  if (!allowed) throw forbidden()
}

const conflict = () =>
  new ApiFailure(
    "CONFLICT",
    409,
    "The report changed. Reload it before trying again."
  )

async function requireReportableEvent(
  db: D1Database,
  eventId: string,
  actorId: string
) {
  try {
    return await requireEventReadAccess(db, eventId, actorId)
  } catch (error) {
    if (error instanceof ApiFailure && error.code !== "NOT_FOUND") throw error
    if (error instanceof HTTPException)
      throw new ApiFailure("NOT_FOUND", 404, "Event not found.")
    throw error
  }
}

export async function submitEventReport(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: Dependencies = {}
): Promise<EventReportReceipt> {
  const parsed = submitEventReportRequestSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose a report category and describe the problem in up to 1,000 characters."
    )
  const input = parsed.data
  if (
    !(await db
      .prepare(`SELECT 1 WHERE ${activeAccountSql}`)
      .bind(actorId)
      .first())
  )
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "A verified, active account is required to report an event."
    )
  const event = await requireReportableEvent(db, eventId, actorId)
  if (event.organizerId === actorId)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Organizers cannot report their own event."
    )
  const hash = await requestHash("event.report", { eventId, ...input })
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  if (receipt?.responseJson)
    return eventReportReceiptSchema.parse(JSON.parse(receipt.responseJson))
  const existing = await db
    .prepare(
      "SELECT id, revision, created_at FROM event_reports WHERE event_id=? AND reporter_id=? AND state='open'"
    )
    .bind(eventId, actorId)
    .first<{ id: string; revision: number; created_at: number }>()
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const reportId = existing?.id ?? crypto.randomUUID()
  const response = eventReportReceiptSchema.parse({
    reportId,
    eventId,
    category: input.category,
    state: "open",
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: iso(now),
  })
  const write = existing
    ? [
        ...assertSql(
          db,
          "EXISTS (SELECT 1 FROM event_reports WHERE id=? AND state='open' AND revision=?)",
          [reportId, existing.revision]
        ),
        db
          .prepare(
            "UPDATE event_reports SET category=?, details=?, revision=revision+1, updated_at=? WHERE id=?"
          )
          .bind(input.category, input.details, now, reportId),
      ]
    : [
        db
          .prepare(
            "INSERT INTO event_reports(id,event_id,reporter_id,category,details,state,revision,created_at,updated_at) VALUES(?,?,?,?,?,'open',1,?,?)"
          )
          .bind(
            reportId,
            eventId,
            actorId,
            input.category,
            input.details,
            now,
            now
          ),
      ]
  try {
    await db.batch([
      ...assertSql(db, activeAccountSql, [actorId]),
      ...write,
      db
        .prepare(
          "INSERT INTO request_receipts(actor_id,request_id,input_hash,resource_id,response_json,created_at) VALUES(?,?,?,?,?,?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          reportId,
          JSON.stringify(response),
          now
        ),
    ])
  } catch (error) {
    const duplicate = await readReceipt(db, actorId, input.requestId, hash)
    if (duplicate?.responseJson)
      return eventReportReceiptSchema.parse(JSON.parse(duplicate.responseJson))
    if (isTransitionConflict(error)) throw conflict()
    throw error
  }
  return response
}

export async function listEventReports(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  dependencies: Pick<Dependencies, "now"> = {}
): Promise<EventReportQueueResponse> {
  const parsed = eventReportQueueQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure("INVALID_INPUT", 400, "Choose valid report filters.")
  await requireModerator(db, actorId)
  const { cursor, ...input } = parsed.data
  const filter = await requestHash("platform.event-reports", {
    actorId,
    ...input,
  })
  const after = readCursor(cursor, filter)
  const conditions = ["r.id>?"],
    bindings: unknown[] = [after?.id ?? ""]
  if (input.state !== "all") {
    conditions.push("r.state=?")
    bindings.push(input.state)
  }
  if (input.eventId) {
    conditions.push("r.event_id=?")
    bindings.push(input.eventId)
  }
  const now = (dependencies.now ?? Date.now)()
  const [allowed, page] = await db.batch([
    db
      .prepare(`SELECT (${moderator}) AS allowed`)
      .bind(actorId, actorId, permission),
    db
      .prepare(`SELECT r.id,r.event_id,e.title AS event_title,e.organizer_id,e.suspended_at,e.revision AS event_revision,
      r.reporter_id,r.category,r.details,r.state,r.revision,r.created_at,r.updated_at,r.resolved_at,r.resolution_reason,
      (SELECT count(*) FROM event_reports o WHERE o.event_id=r.event_id AND o.state='open') AS open_reports
      FROM event_reports r JOIN events e ON e.id=r.event_id
      WHERE ${conditions.join(" AND ")} AND (${moderator}) ORDER BY r.id LIMIT ?`)
      .bind(...bindings, actorId, actorId, permission, input.limit + 1),
  ])
  if (!(allowed!.results[0] as { allowed: number }).allowed) throw forbidden()
  const rows = page!.results as QueueRow[]
  return eventReportQueueResponseSchema.parse({
    items: rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      organizerId: row.organizer_id,
      eventSuspended: row.suspended_at !== null,
      eventRevision: row.event_revision,
      reporterId: row.reporter_id,
      category: row.category,
      details: row.details,
      state: row.state,
      openReportsForEvent: row.open_reports,
      revision: row.revision,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      resolvedAt: row.resolved_at === null ? null : iso(row.resolved_at),
      resolutionReason: row.resolution_reason,
    })),
    nextCursor:
      rows.length > input.limit
        ? encodeCursor(0, rows[input.limit - 1]!.id, filter)
        : null,
    generatedAt: iso(now),
  })
}

export async function resolveEventReport(
  db: D1Database,
  actorId: string,
  reportId: string,
  raw: unknown,
  dependencies: Dependencies = {}
): Promise<EventReportResolution> {
  const parsed = resolveEventReportRequestSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide the current report revision, a resolution and a reason."
    )
  const input = parsed.data
  await requireModerator(db, actorId)
  const hash = await requestHash("platform.event-report.resolve", {
    reportId,
    ...input,
  })
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  if (receipt?.responseJson)
    return eventReportResolutionSchema.parse(JSON.parse(receipt.responseJson))
  const report = await db
    .prepare("SELECT event_id FROM event_reports WHERE id=?")
    .bind(reportId)
    .first<{ event_id: string }>()
  if (!report)
    throw new ApiFailure("NOT_FOUND", 404, "The event report was not found.")
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const response = eventReportResolutionSchema.parse({
    reportId,
    eventId: report.event_id,
    state: input.resolution,
    revision: input.expectedRevision + 1,
    resolvedAt: iso(now),
  })
  try {
    await db.batch([
      ...assertSql(db, moderator, [actorId, actorId, permission]),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM event_reports WHERE id=? AND state='open' AND revision=?)",
        [reportId, input.expectedRevision]
      ),
      ...(input.resolution === "actioned"
        ? assertSql(
            db,
            "EXISTS (SELECT 1 FROM events WHERE id=? AND suspended_at IS NOT NULL)",
            [report.event_id]
          )
        : []),
      db
        .prepare(
          "INSERT INTO request_receipts(actor_id,request_id,input_hash,resource_id,response_json,created_at) VALUES(?,?,?,?,?,?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          reportId,
          JSON.stringify(response),
          now
        ),
      db
        .prepare(
          "UPDATE event_reports SET state=?, revision=revision+1, resolved_at=?, resolved_by=?, resolution_reason=?, updated_at=? WHERE id=?"
        )
        .bind(input.resolution, now, actorId, input.reason, now, reportId),
      db
        .prepare(
          "INSERT INTO audit_entries(id,event_id,actor_id,scope,action,entity_id,description,correlation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          crypto.randomUUID(),
          report.event_id,
          actorId,
          "event",
          `event_report.${input.resolution}`,
          reportId,
          input.reason,
          input.requestId,
          now
        ),
    ])
  } catch (error) {
    await requireModerator(db, actorId)
    const duplicate = await readReceipt(db, actorId, input.requestId, hash)
    if (duplicate?.responseJson)
      return eventReportResolutionSchema.parse(
        JSON.parse(duplicate.responseJson)
      )
    if (isTransitionConflict(error)) throw conflict()
    throw error
  }
  await requireModerator(db, actorId)
  return response
}
