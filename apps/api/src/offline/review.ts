import {
  offlineListQuerySchema,
  reportedOfflineAdmissionsSchema,
  reportedOfflineAdmissionSchema,
  reviewOfflineAdmissionSchema,
} from "@elc/shared"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { admissionOutcomeSql } from "../tickets/scan"
import { nextOfflineCursor, offlineCursor } from "./devices"
import {
  iso,
  offlineAudit,
  offlineOutbox,
  offlineReceipt,
  parseOffline,
  requireOfflineReview,
  type OfflineDependencies,
  type OperationRow,
} from "./store"

type ReportRow = OperationRow & {
  review_state: "unresolved" | "resolved" | null
  revision: number | null
  resolution: "no_admission" | "admission_confirmed" | null
  reviewed_at: number | null
  reviewed_by: string | null
  reason: string | null
}
const reportSelection = `SELECT op.*, r.review_state, r.revision, r.resolution, r.reviewed_at, r.reviewed_by, r.reason FROM offline_operations op LEFT JOIN offline_admission_reports r ON r.operation_id = op.operation_id`
function reportDto(row: ReportRow) {
  return reportedOfflineAdmissionSchema.parse({
    operationId: row.operation_id,
    eventId: row.event_id,
    deviceId: row.device_id,
    accountId: row.account_id,
    ticketId: row.ticket_id,
    orderId: row.order_id,
    capturedAt: iso(row.captured_at),
    reportedAt: iso(row.reported_at),
    result: row.result,
    reviewState: row.review_state ?? "none",
    revision: row.revision ?? 0,
    resolution: row.resolution,
    reviewedAt: row.reviewed_at === null ? null : iso(row.reviewed_at),
    reviewedBy: row.reviewed_by,
    reason: row.reason,
  })
}
export async function listOfflineAdmissions(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown = {}
) {
  await requireOfflineReview(db, actorId, eventId)
  const input = parseOffline(offlineListQuerySchema, raw)
  const scope = `admissions:${eventId}:${actorId}`
  const cursor = offlineCursor(input.cursor, scope)
  const rows = await db
    .prepare(
      `${reportSelection} WHERE op.event_id = ? AND op.operation_id > ? ORDER BY op.operation_id LIMIT ?`
    )
    .bind(eventId, cursor, input.limit + 1)
    .all<ReportRow>()
  const page = rows.results.slice(0, input.limit)
  return reportedOfflineAdmissionsSchema.parse({
    items: page.map(reportDto),
    nextCursor:
      rows.results.length > input.limit
        ? nextOfflineCursor(scope, page.at(-1)!.operation_id)
        : null,
  })
}
export async function reviewOfflineAdmission(
  db: D1Database,
  actorId: string,
  eventId: string,
  operationId: string,
  raw: unknown,
  dependencies: OfflineDependencies = {}
) {
  const input = parseOffline(reviewOfflineAdmissionSchema, raw)
  const authorization = await requireOfflineReview(db, actorId, eventId)
  const hash = await requestHash("offline.review", {
    eventId,
    operationId,
    ...input,
  })
  const cached = await readReceipt(db, actorId, input.requestId, hash)
  if (cached?.responseJson)
    return reportedOfflineAdmissionSchema.parse(JSON.parse(cached.responseJson))
  const row = await db
    .prepare(`${reportSelection} WHERE op.operation_id = ? AND op.event_id = ?`)
    .bind(operationId, eventId)
    .first<ReportRow>()
  if (!row?.review_state || !row.ticket_id)
    throw new ApiFailure("NOT_FOUND", 404, "Reported admission not found.")
  const tokenHash = await db
    .prepare("SELECT token_hash FROM tickets WHERE id = ?")
    .bind(row.ticket_id)
    .first<string>("token_hash")
  if (!tokenHash)
    throw new ApiFailure("NOT_FOUND", 404, "Reported ticket not found.")
  const clock = dependencies.now ?? Date.now
  let checkinId: string | null = null
  let canonicalResult: string | null = null
  if (input.resolution === "admission_confirmed") {
    const outcome = admissionOutcomeSql(eventId, tokenHash, clock())
    canonicalResult = await db
      .prepare(`SELECT ${outcome.expression} AS result`)
      .bind(...outcome.bindings)
      .first<string>("result")
    if (canonicalResult !== "checked_in" && canonicalResult !== "already_used")
      throw new ApiFailure(
        "CONFLICT",
        409,
        "An ineligible ticket cannot become a canonical admission through review."
      )
    checkinId =
      canonicalResult === "checked_in"
        ? crypto.randomUUID()
        : await db
            .prepare(
              "SELECT id FROM checkins WHERE ticket_id = ? AND reversed_at IS NULL"
            )
            .bind(row.ticket_id)
            .first<string>("id")
    if (!checkinId)
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The active check-in changed. Refresh this report."
      )
  }
  await dependencies.beforeCommit?.()
  const now = clock()
  const response = reportDto({
    ...row,
    review_state: "resolved",
    revision: input.expectedRevision + 1,
    resolution: input.resolution,
    reviewed_at: now,
    reviewed_by: actorId,
    reason: input.reason,
  })
  const statements = [
    ...assertSql(db, authorization.predicate, authorization.bindings),
    ...assertSql(
      db,
      "EXISTS (SELECT 1 FROM offline_admission_reports WHERE operation_id = ? AND revision = ? AND review_state = 'unresolved')",
      [operationId, input.expectedRevision]
    ),
  ]
  if (checkinId) {
    const outcome = admissionOutcomeSql(
      eventId,
      tokenHash,
      dependencies.now ? now : undefined
    )
    statements.push(
      ...assertSql(db, `${outcome.expression} = ?`, [
        ...outcome.bindings,
        canonicalResult,
      ]),
      ...assertSql(
        db,
        "NOT EXISTS (SELECT 1 FROM refunds r JOIN payment_attempts p ON p.id = r.payment_attempt_id WHERE p.purpose = 'ticket_order' AND p.subject_id = ? AND r.state IN ('pending', 'succeeded'))",
        [row.order_id]
      )
    )
    if (canonicalResult === "checked_in")
      statements.push(
        db
          .prepare(
            "UPDATE tickets SET state = 'checked_in' WHERE id = ? AND state = 'valid'"
          )
          .bind(row.ticket_id),
        ...assertSql(db, "changes() = 1"),
        db
          .prepare(
            "INSERT INTO checkins (id, ticket_id, actor_id, operation_id, device_id, captured_at, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            checkinId,
            row.ticket_id,
            actorId,
            `review:${checkinId}`,
            row.device_id,
            row.captured_at,
            now
          ),
        offlineOutbox(db, "checkin.created", checkinId, eventId, now)
      )
    else
      statements.push(
        ...assertSql(
          db,
          "EXISTS (SELECT 1 FROM checkins WHERE id = ? AND ticket_id = ? AND reversed_at IS NULL)",
          [checkinId, row.ticket_id]
        )
      )
  }
  statements.push(
    db
      .prepare(
        "UPDATE offline_admission_reports SET review_state = 'resolved', revision = revision + 1, resolution = ?, reviewed_at = ?, reviewed_by = ?, reason = ? WHERE operation_id = ?"
      )
      .bind(input.resolution, now, actorId, input.reason, operationId),
    db
      .prepare(
        "INSERT INTO offline_admission_reviews (id, operation_id, actor_id, resolution, reason, checkin_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        operationId,
        actorId,
        input.resolution,
        input.reason,
        checkinId,
        now
      ),
    offlineReceipt(
      db,
      actorId,
      input.requestId,
      hash,
      operationId,
      response,
      now
    ),
    offlineAudit(
      db,
      actorId,
      eventId,
      operationId,
      input.requestId,
      "offline.admission_reviewed",
      now,
      input.reason
    ),
    offlineOutbox(db, "offline.admission_reviewed", operationId, eventId, now)
  )
  try {
    await db.batch(statements)
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson)
      return reportedOfflineAdmissionSchema.parse(
        JSON.parse(replay.responseJson)
      )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The report, ticket, or your authorization changed before review."
    )
  }
  return response
}
