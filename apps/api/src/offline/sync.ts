import {
  offlineOperationResultSchema,
  offlineSyncResponseSchema,
  syncOfflineScansSchema,
  type OfflineOperationResult,
  type OfflineSyncUnit,
} from "@elc/shared"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { admissionOutcomeSql, staffAuthorizationSql } from "../tickets/scan"
import {
  deviceGuard,
  iso,
  loadDevice,
  offlineAudit,
  offlineOutbox,
  offlineReceipt,
  parseOffline,
  type OfflineDependencies,
  type OperationRow,
} from "./store"

const journalLifetime = 7 * 24 * 60 * 60_000

function syncOutcomeSql(
  actorId: string,
  eventId: string,
  deviceId: string,
  unit: OfflineSyncUnit,
  now: number,
  injectedClock: boolean
) {
  const scan = unit.scan
  const capturedAt = Date.parse(scan.deviceTimestamp)
  if (unit.undo)
    return { expression: "'locally_reversed'", bindings: [] as unknown[] }
  const auth = staffAuthorizationSql(actorId, eventId, "ticket:scan")
  const canonical = admissionOutcomeSql(
    eventId,
    scan.tokenHash,
    injectedClock ? now : undefined
  )
  return {
    expression: `CASE
      WHEN NOT (${auth.predicate}) OR NOT EXISTS (SELECT 1 FROM offline_devices WHERE id = ? AND account_id = ? AND event_id = ? AND revoked_at IS NULL) THEN 'forbidden'
      WHEN NOT EXISTS (SELECT 1 FROM offline_snapshots s JOIN offline_snapshot_tickets st ON st.snapshot_id = s.id
        WHERE s.id = ? AND s.account_id = ? AND s.device_id = ? AND s.event_id = ? AND s.manifest_json IS NOT NULL AND st.ticket_id = ? AND st.token_hash = ?) THEN 'invalid'
      WHEN NOT EXISTS (SELECT 1 FROM offline_snapshots WHERE id = ? AND issued_at <= ? AND expires_at > ?)
        OR ? > ? OR ? < ? OR EXISTS (SELECT 1 FROM offline_operations WHERE device_id = ? AND ((device_sequence < ? AND captured_at > ?) OR (device_sequence > ? AND captured_at < ?))) THEN 'snapshot_expired'
      WHEN EXISTS (SELECT 1 FROM offline_snapshot_tickets WHERE snapshot_id = ? AND ticket_id = ? AND (json_extract(payload_json, '$.admissionBlocked') = 1 OR json_extract(payload_json, '$.state') <> 'valid' OR json_extract(payload_json, '$.activeCheckInId') IS NOT NULL)) THEN 'admission_blocked'
      WHEN EXISTS (SELECT 1 FROM tickets t JOIN payment_attempts p ON p.subject_id = t.order_id AND p.purpose = 'ticket_order' JOIN refunds r ON r.payment_attempt_id = p.id WHERE t.id = ? AND r.state IN ('pending', 'succeeded')) THEN 'admission_blocked'
      ELSE ${canonical.expression} END`,
    bindings: [
      ...auth.bindings,
      deviceId,
      actorId,
      eventId,
      scan.snapshotId,
      actorId,
      deviceId,
      eventId,
      scan.ticketId,
      scan.tokenHash,
      scan.snapshotId,
      capturedAt,
      capturedAt,
      capturedAt,
      now,
      capturedAt,
      now - journalLifetime,
      deviceId,
      scan.deviceSequence,
      capturedAt,
      scan.deviceSequence,
      capturedAt,
      scan.snapshotId,
      scan.ticketId,
      scan.ticketId,
      ...canonical.bindings,
    ],
  }
}

async function operationResult(
  db: D1Database,
  row: OperationRow
): Promise<OfflineOperationResult> {
  const report = await db
    .prepare(
      "SELECT review_state FROM offline_admission_reports WHERE operation_id = ?"
    )
    .bind(row.operation_id)
    .first<{ review_state: "unresolved" | "resolved" }>()
  return offlineOperationResultSchema.parse({
    operationId: row.operation_id,
    result: row.result,
    serverTimestamp: iso(row.reported_at),
    checkInId: row.checkin_id,
    conflict: row.result !== "checked_in" && row.result !== "locally_reversed",
    reviewState: report?.review_state ?? "none",
  })
}

async function synchronizeUnit(
  db: D1Database,
  actorId: string,
  eventId: string,
  deviceId: string,
  unit: OfflineSyncUnit,
  dependencies: OfflineDependencies
): Promise<OfflineOperationResult[]> {
  const clock = dependencies.now ?? Date.now
  const operations = unit.undo ? [unit.scan, unit.undo] : [unit.scan]
  const unitHash = await requestHash("offline.sealed-unit", {
    deviceId,
    eventId,
    unit,
  })
  const inputHashes = await Promise.all(
    operations.map((operation) => requestHash("offline.operation", operation))
  )
  const replay = async () => {
    const rows: OperationRow[] = []
    for (const operation of operations) {
      const existing = await db
        .prepare("SELECT * FROM offline_operations WHERE operation_id = ?")
        .bind(operation.operationId)
        .first<OperationRow>()
      if (existing) {
        if (
          existing.account_id !== actorId ||
          existing.device_id !== deviceId ||
          existing.event_id !== eventId ||
          existing.unit_hash !== unitHash
        )
          throw new ApiFailure(
            "CONFLICT",
            409,
            "A sealed operation cannot be changed. Confirmed admissions require an authorized correction."
          )
        rows.push(existing)
      }
    }
    if (rows.length && rows.length !== operations.length)
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The sealed operation pair is incomplete."
      )
    return rows.length
      ? Promise.all(rows.map((row) => operationResult(db, row)))
      : null
  }
  const cached = await replay()
  if (cached) return cached
  let hookInvoked = false
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = clock()
    const outcome = syncOutcomeSql(
      actorId,
      eventId,
      deviceId,
      unit,
      now,
      !!dependencies.now
    )
    const result = await db
      .prepare(`SELECT ${outcome.expression} AS result`)
      .bind(...outcome.bindings)
      .first<OfflineOperationResult["result"]>("result")
    if (!result) throw new Error("Missing offline outcome")
    const matched = await db
      .prepare(`SELECT t.id, t.order_id FROM offline_snapshot_tickets st JOIN offline_snapshots s ON s.id = st.snapshot_id JOIN tickets t ON t.id = st.ticket_id
      WHERE s.id = ? AND s.account_id = ? AND s.device_id = ? AND s.event_id = ? AND st.ticket_id = ? AND st.token_hash = ? AND t.event_id = s.event_id AND t.token_hash = st.token_hash`)
      .bind(
        unit.scan.snapshotId,
        actorId,
        deviceId,
        eventId,
        unit.scan.ticketId,
        unit.scan.tokenHash
      )
      .first<{ id: string; order_id: string }>()
    if (!hookInvoked) {
      hookInvoked = true
      await dependencies.beforeCommit?.()
    }
    const committedAt = clock()
    const commitOutcome = syncOutcomeSql(
      actorId,
      eventId,
      deviceId,
      unit,
      committedAt,
      !!dependencies.now
    )
    const checkinId = result === "checked_in" ? crypto.randomUUID() : null
    const report =
      !!matched && result !== "checked_in" && result !== "locally_reversed"
    const statements: D1PreparedStatement[] = [
      ...deviceGuard(db, actorId, eventId, deviceId, true),
      ...assertSql(db, `${commitOutcome.expression} = ?`, [
        ...commitOutcome.bindings,
        result,
      ]),
    ]
    if (checkinId) {
      statements.push(
        db
          .prepare(
            "UPDATE tickets SET state = 'checked_in' WHERE id = ? AND token_hash = ? AND state = 'valid'"
          )
          .bind(unit.scan.ticketId, unit.scan.tokenHash),
        ...assertSql(db, "changes() = 1"),
        db
          .prepare(
            "INSERT INTO checkins (id, ticket_id, actor_id, operation_id, device_id, captured_at, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            checkinId,
            unit.scan.ticketId,
            actorId,
            unit.scan.operationId,
            deviceId,
            Date.parse(unit.scan.deviceTimestamp),
            committedAt
          ),
        offlineOutbox(db, "checkin.created", checkinId, eventId, committedAt)
      )
    }
    for (const [index, operation] of operations.entries()) {
      statements.push(
        db
          .prepare(`INSERT INTO offline_operations (operation_id, account_id, device_id, event_id, snapshot_id, kind, original_operation_id, device_sequence, captured_at, reported_at, input_hash, unit_hash, result, checkin_id, ticket_id, order_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            operation.operationId,
            actorId,
            deviceId,
            eventId,
            operation.snapshotId,
            operation.kind,
            operation.kind === "undo" ? operation.originalOperationId : null,
            operation.deviceSequence,
            Date.parse(operation.deviceTimestamp),
            committedAt,
            inputHashes[index],
            unitHash,
            result,
            operation.kind === "scan" ? checkinId : null,
            matched?.id ?? null,
            matched?.order_id ?? null
          ),
        offlineAudit(
          db,
          actorId,
          eventId,
          operation.operationId,
          operation.operationId,
          `offline.${operation.kind}.${result}`,
          committedAt
        )
      )
    }
    if (report)
      statements.push(
        db
          .prepare(
            "INSERT INTO offline_admission_reports (operation_id, ticket_id, order_id) VALUES (?, ?, ?)"
          )
          .bind(unit.scan.operationId, matched!.id, matched!.order_id),
        offlineOutbox(
          db,
          "offline.admission_reported",
          unit.scan.operationId,
          eventId,
          committedAt
        )
      )
    statements.push(
      db
        .prepare(
          "UPDATE offline_devices SET last_sync_at = max(COALESCE(last_sync_at, 0), ?) WHERE id = ?"
        )
        .bind(committedAt, deviceId)
    )
    try {
      await db.batch(statements)
      return operations.map((operation) =>
        offlineOperationResultSchema.parse({
          operationId: operation.operationId,
          result,
          serverTimestamp: iso(committedAt),
          checkInId: operation.kind === "scan" ? checkinId : null,
          conflict: result !== "checked_in" && result !== "locally_reversed",
          reviewState:
            report && operation.kind === "scan" ? "unresolved" : "none",
        })
      )
    } catch (error) {
      if (!isTransitionConflict(error)) throw error
      const repeated = await replay()
      if (repeated) return repeated
      const usedSequence = await db
        .prepare(
          `SELECT 1 FROM offline_operations WHERE device_id = ? AND device_sequence IN (SELECT value FROM json_each(?)) LIMIT 1`
        )
        .bind(
          deviceId,
          JSON.stringify(
            operations.map((operation) => operation.deviceSequence)
          )
        )
        .first()
      if (usedSequence)
        throw new ApiFailure(
          "CONFLICT",
          409,
          "A device sequence was already used by another operation."
        )
    }
  }
  throw new ApiFailure(
    "CONFLICT",
    409,
    "The ticket changed repeatedly. Retry this sealed batch."
  )
}

/** Units are atomic; a request interrupted between units is resumed through operation receipts. */
export async function syncOfflineScans(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: OfflineDependencies = {}
) {
  const input = parseOffline(syncOfflineScansSchema, raw)
  if (input.accountId !== actorId)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Only the device account can synchronize its journal."
    )
  await loadDevice(db, input.deviceId, eventId, actorId)
  const hash = await requestHash("offline.sync", { eventId, ...input })
  const cached = await readReceipt(db, actorId, input.requestId, hash)
  if (cached?.responseJson)
    return offlineSyncResponseSchema.parse(JSON.parse(cached.responseJson))
  const results: OfflineOperationResult[] = []
  for (const unit of input.units)
    results.push(
      ...(await synchronizeUnit(
        db,
        actorId,
        eventId,
        input.deviceId,
        unit,
        dependencies
      ))
    )
  const now = (dependencies.now ?? Date.now)()
  const response = offlineSyncResponseSchema.parse({
    requestId: input.requestId,
    deviceId: input.deviceId,
    eventId,
    acknowledgedAt: iso(now),
    results,
  })
  try {
    await db.batch([
      ...deviceGuard(db, actorId, eventId, input.deviceId, true),
      offlineReceipt(
        db,
        actorId,
        input.requestId,
        hash,
        input.deviceId,
        response,
        now
      ),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson)
      return offlineSyncResponseSchema.parse(JSON.parse(replay.responseJson))
    throw error
  }
  return response
}
