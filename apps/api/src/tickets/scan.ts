import { scanResponseSchema, type ScanResponse } from "@elc/shared"
import { requireEventPermission } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { credentialHash } from "./credentials"

export function staffAuthorizationSql(
  actorId: string,
  eventId: string,
  permission: string
) {
  return {
    predicate: `EXISTS (SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id = u.id
      JOIN event_permissions ep ON ep.user_id = u.id
      WHERE u.id = ? AND u.email_verified = 1 AND p.suspended_at IS NULL
        AND ep.event_id = ? AND ep.permission = ? AND ep.revoked_at IS NULL)`,
    bindings: [actorId, eventId, permission],
  }
}

/** Used both for the displayed outcome and inside the transaction that records it. */
function outcomeSql(eventId: string, tokenHash: string, now?: number) {
  const timestamp =
    now === undefined ? "CAST(unixepoch('subsecond') * 1000 AS INTEGER)" : "?"
  return {
    expression: `COALESCE((SELECT CASE
      WHEN t.event_id <> ? THEN 'wrong_event'
      WHEN e.cancelled_at IS NOT NULL OR o.state = 'cancelled' OR t.state = 'cancelled' THEN 'cancelled'
      WHEN o.state = 'refunded' OR t.state = 'refunded' THEN 'refunded'
      WHEN o.admission_blocked_at IS NOT NULL OR o.state <> 'completed'
        OR e.suspended_at IS NOT NULL OR e.ends_at <= ${timestamp} THEN 'admission_blocked'
      WHEN t.state = 'checked_in' OR EXISTS (SELECT 1 FROM checkins ci WHERE ci.ticket_id = t.id AND ci.reversed_at IS NULL) THEN 'already_used'
      WHEN t.state = 'valid' THEN 'checked_in'
      ELSE 'invalid' END
      FROM tickets t JOIN orders o ON o.id = t.order_id JOIN events e ON e.id = t.event_id
      WHERE t.token_hash = ?), 'invalid')`,
    bindings:
      now === undefined ? [eventId, tokenHash] : [eventId, now, tokenHash],
  }
}

export async function scanOnline(
  db: D1Database,
  actorId: string,
  input: {
    eventId: string
    operationId: string
    credential: { kind: "elc_admission"; version: 1; token: string }
  },
  dependencies: { now?: () => number; beforeCommit?: () => Promise<void> } = {}
): Promise<ScanResponse> {
  const clock = dependencies.now ?? Date.now
  await requireEventPermission(db, actorId, input.eventId, "ticket:scan")
  const hash = await requestHash("scan-online", input)
  const cached = await readReceipt(db, actorId, input.operationId, hash)
  if (cached?.responseJson)
    return scanResponseSchema.parse(JSON.parse(cached.responseJson))
  const tokenHash = await credentialHash(input.credential.token)
  const authorization = staffAuthorizationSql(
    actorId,
    input.eventId,
    "ticket:scan"
  )
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = clock()
    const outcome = outcomeSql(input.eventId, tokenHash, now)
    const result = await db
      .prepare(`SELECT ${outcome.expression} AS result`)
      .bind(...outcome.bindings)
      .first<ScanResponse["result"]>("result")
    if (!result) throw new Error("Missing scan outcome")
    await dependencies.beforeCommit?.()
    const commitNow = clock()
    const commitOutcome = outcomeSql(
      input.eventId,
      tokenHash,
      dependencies.now ? commitNow : undefined
    )
    const checkInId = result === "checked_in" ? crypto.randomUUID() : null
    const response: ScanResponse = {
      operationId: input.operationId,
      result,
      checkInId,
    }
    const statements = [
      db
        .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(
          actorId,
          input.operationId,
          hash,
          checkInId ?? input.eventId,
          JSON.stringify(response),
          commitNow
        ),
      ...assertSql(db, authorization.predicate, authorization.bindings),
      ...assertSql(db, `${commitOutcome.expression} = ?`, [
        ...commitOutcome.bindings,
        result,
      ]),
    ]
    if (checkInId) {
      statements.push(
        db
          .prepare(
            `UPDATE tickets SET state = 'checked_in' WHERE token_hash = ? AND event_id = ? AND state = 'valid'`
          )
          .bind(tokenHash, input.eventId),
        ...assertSql(
          db,
          `EXISTS (SELECT 1 FROM tickets WHERE token_hash = ? AND event_id = ? AND state = 'checked_in')`,
          [tokenHash, input.eventId]
        ),
        db
          .prepare(`INSERT INTO checkins (id, ticket_id, actor_id, operation_id, captured_at, committed_at)
          SELECT ?, id, ?, ?, ?, ? FROM tickets WHERE token_hash = ? AND event_id = ? AND state = 'checked_in'`)
          .bind(
            checkInId,
            actorId,
            input.operationId,
            now,
            commitNow,
            tokenHash,
            input.eventId
          ),
        ...assertSql(db, "EXISTS (SELECT 1 FROM checkins WHERE id = ?)", [
          checkInId,
        ]),
        db
          .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
          VALUES (?, 'checkin.created', ?, ?, ?, ?)`)
          .bind(
            crypto.randomUUID(),
            checkInId,
            JSON.stringify({ eventId: input.eventId, checkInId }),
            commitNow,
            commitNow
          )
      )
    }
    statements.push(
      db
        .prepare(`INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
      VALUES (?, ?, ?, 'event', ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          input.eventId,
          actorId,
          `scan.${result}`,
          checkInId ?? input.eventId,
          `Online scan result: ${result}`,
          input.operationId,
          commitNow
        )
    )
    try {
      await db.batch(statements)
      return response
    } catch (error) {
      if (!isTransitionConflict(error)) throw error
      await requireEventPermission(db, actorId, input.eventId, "ticket:scan")
      const receipt = await readReceipt(db, actorId, input.operationId, hash)
      if (receipt?.responseJson)
        return scanResponseSchema.parse(JSON.parse(receipt.responseJson))
    }
  }
  throw new ApiFailure(
    "CONFLICT",
    409,
    "The ticket changed during verification. Retry the scan."
  )
}

/** Authorized attendance corrections remain available after the event ends. */
export async function reverseCheckIn(
  db: D1Database,
  actorId: string,
  eventId: string,
  checkInId: string,
  input: { requestId: string; reason: string },
  clock: () => number = Date.now
) {
  await requireEventPermission(db, actorId, eventId, "checkin:reverse")
  const hash = await requestHash("reverse-checkin", {
    eventId,
    checkInId,
    ...input,
  })
  const cached = await readReceipt(db, actorId, input.requestId, hash)
  if (cached) return { checkInId, reversed: true as const }
  const authorization = staffAuthorizationSql(
    actorId,
    eventId,
    "checkin:reverse"
  )
  const now = clock()
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(
          actorId,
          input.requestId,
          hash,
          checkInId,
          JSON.stringify({ checkInId, reversed: true }),
          now
        ),
      ...assertSql(db, authorization.predicate, authorization.bindings),
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM checkins ci JOIN tickets t ON t.id = ci.ticket_id
        JOIN orders o ON o.id = t.order_id JOIN events e ON e.id = t.event_id
        WHERE ci.id = ? AND t.event_id = ? AND ci.reversed_at IS NULL AND t.state = 'checked_in'
          AND o.state = 'completed' AND o.admission_blocked_at IS NULL AND e.cancelled_at IS NULL AND e.suspended_at IS NULL)`,
        [checkInId, eventId]
      ),
      db
        .prepare(
          "UPDATE checkins SET reversed_at = ?, reversed_by = ?, reversal_reason = ? WHERE id = ? AND reversed_at IS NULL"
        )
        .bind(now, actorId, input.reason, checkInId),
      db
        .prepare(
          "UPDATE tickets SET state = 'valid' WHERE id = (SELECT ticket_id FROM checkins WHERE id = ?) AND state = 'checked_in'"
        )
        .bind(checkInId),
      db
        .prepare(`INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
        VALUES (?, ?, ?, 'event', 'checkin.reversed', ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          eventId,
          actorId,
          checkInId,
          input.reason,
          input.requestId,
          now
        ),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'checkin.reversed', ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          checkInId,
          JSON.stringify({ eventId, checkInId }),
          now,
          now
        ),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const receipt = await readReceipt(db, actorId, input.requestId, hash)
    if (receipt) return { checkInId, reversed: true as const }
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This admission can no longer be reversed."
    )
  }
  return { checkInId, reversed: true as const }
}
