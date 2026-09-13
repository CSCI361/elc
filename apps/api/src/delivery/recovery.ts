import {
  deliveryDetailResponseSchema,
  deliveryIdSchema,
  deliveryInspectionSchema,
  deliveryListQuerySchema,
  deliveryListResponseSchema,
  deliveryRecoveryResponseSchema,
  requestDeliveryRecoverySchema,
  type DeliveryRecoveryMode,
} from "@elc/shared"
import { z } from "zod"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { emailLimits } from "./email"
import { deliveryOutboxId, type DeliveryRow } from "./jobs"

type Row = DeliveryRow & { last_error: string | null }
export type DeliveryRecoveryOptions = {
  now?: () => number
  beforeCommit?: () => Promise<void>
}
const authority = `EXISTS (SELECT 1 FROM user actor LEFT JOIN profiles profile ON profile.user_id=actor.id
  WHERE actor.id=? AND actor.email_verified=1 AND profile.suspended_at IS NULL
  AND EXISTS (SELECT 1 FROM platform_grants grant_row WHERE grant_row.user_id=actor.id AND grant_row.permission='platform:recover'))`
const databaseNow = "CAST(unixepoch('subsecond') * 1000 AS INTEGER)"
const preparationStates = ["failed", "review_needed", "suppressed"]
const retryStates = ["pending", ...preparationStates]
const iso = (time: number | null) =>
  time === null ? null : new Date(time).toISOString()
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (!result.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Invalid delivery inspection or recovery request."
    )
  return result.data
}
async function requireRecovery(db: D1Database, actorId: string) {
  if (!(await db.prepare(`SELECT 1 WHERE ${authority}`).bind(actorId).first()))
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Current platform recovery permission is required."
    )
}
async function authorizedRow(db: D1Database, actorId: string, id: string) {
  const row = await db
    .prepare(`SELECT d.* FROM email_deliveries d WHERE d.id=? AND ${authority}`)
    .bind(id, actorId)
    .first<Row>()
  if (!row) {
    await requireRecovery(db, actorId)
    throw new ApiFailure("NOT_FOUND", 404, "Delivery not found.")
  }
  return row
}
function modes(row: Row, now: number): DeliveryRecoveryMode[] {
  if (
    (row.lease_until !== null && row.lease_until > now) ||
    ["delivered", "bounced"].includes(row.email_state) ||
    row.provider_id?.startsWith("local:")
  )
    return []
  if (row.provider_id !== null)
    return z.uuid().safeParse(row.provider_id).success &&
      row.first_attempt_at !== null &&
      !!row.payload_key &&
      !!row.payload_hash
      ? ["reconcile"]
      : []
  if (row.first_attempt_at === null)
    return preparationStates.includes(row.email_state)
      ? ["retry_preparation"]
      : []
  return retryStates.includes(row.email_state) &&
    row.last_attempt_at !== null &&
    now >= row.last_attempt_at &&
    now >= row.first_attempt_at &&
    now - row.first_attempt_at < emailLimits.automaticSendWindowMs &&
    !!row.payload_key &&
    !!row.payload_hash
    ? ["retry_same_request"]
    : []
}
function dto(row: Row, now: number) {
  return deliveryInspectionSchema.parse({
    id: row.id,
    sourceId: row.source_id,
    kind: row.kind,
    entityId: row.entity_id,
    eventId: row.event_id,
    recipientId: row.recipient_id,
    pdfState: row.pdf_state,
    emailState: row.email_state,
    providerId: row.provider_id,
    providerStatus: row.provider_status,
    firstAttemptAt: iso(row.first_attempt_at),
    lastAttemptAt: iso(row.last_attempt_at),
    attempts: row.attempts,
    failures: row.failures,
    lastError: row.last_error,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: iso(row.completed_at),
    nextAttemptAt: iso(row.next_attempt_at),
    busyUntil:
      row.lease_until !== null && row.lease_until > now
        ? iso(row.lease_until)
        : null,
    allowedRecoveryModes: modes(row, now),
  })
}

export async function listDeliveries(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  options: Pick<DeliveryRecoveryOptions, "now"> = {}
) {
  await requireRecovery(db, actorId)
  const input = parse(deliveryListQuerySchema, raw),
    predicates = ["d.id>?", authority],
    bindings: unknown[] = [input.after ?? "", actorId]
  for (const [value, column] of [
    [input.emailState, "email_state"],
    [input.pdfState, "pdf_state"],
    [input.kind, "kind"],
    [input.eventId, "event_id"],
  ] as const) {
    if (value !== undefined) {
      predicates.push(`d.${column}=?`)
      bindings.push(value)
    }
  }
  const rows = (
    await db
      .prepare(
        `SELECT d.* FROM email_deliveries d WHERE ${predicates.join(" AND ")} ORDER BY d.id LIMIT ?`
      )
      .bind(...bindings, input.limit + 1)
      .all<Row>()
  ).results
  await requireRecovery(db, actorId)
  const page = rows.slice(0, input.limit),
    now = (options.now ?? Date.now)()
  return deliveryListResponseSchema.parse({
    items: page.map((row) => dto(row, now)),
    nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
  })
}
export async function readDelivery(
  db: D1Database,
  actorId: string,
  rawId: string,
  options: Pick<DeliveryRecoveryOptions, "now"> = {}
) {
  await requireRecovery(db, actorId)
  const row = await authorizedRow(db, actorId, parse(deliveryIdSchema, rawId))
  await requireRecovery(db, actorId)
  return deliveryDetailResponseSchema.parse({
    delivery: dto(row, (options.now ?? Date.now)()),
  })
}

/** Recovery restores the same durable job. It never prepares a PDF or calls a provider. */
export async function requestDeliveryRecovery(
  db: D1Database,
  actorId: string,
  rawId: string,
  raw: unknown,
  options: DeliveryRecoveryOptions = {}
) {
  await requireRecovery(db, actorId)
  const id = parse(deliveryIdSchema, rawId),
    input = parse(requestDeliveryRecoverySchema, raw)
  const hash = await requestHash("delivery.recover", {
    deliveryId: id,
    ...input,
  })
  const cached = await readReceipt(db, actorId, input.requestId, hash)
  if (cached?.responseJson) {
    await requireRecovery(db, actorId)
    return deliveryRecoveryResponseSchema.parse(JSON.parse(cached.responseJson))
  }
  const replayOrConflict = async () => {
    await requireRecovery(db, actorId)
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson) {
      await requireRecovery(db, actorId)
      return deliveryRecoveryResponseSchema.parse(
        JSON.parse(replay.responseJson)
      )
    }
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The delivery changed or this recovery mode is unavailable. Refresh its status."
    )
  }
  const row = await authorizedRow(db, actorId, id),
    clock = options.now ?? Date.now
  if (
    row.updated_at !== Date.parse(input.expectedUpdatedAt) ||
    !modes(row, clock()).includes(input.mode)
  )
    return replayOrConflict()
  await options.beforeCommit?.()
  const at = clock(),
    updatedAt = Math.max(at, row.updated_at + 1),
    jobId = deliveryOutboxId(id)
  const response = deliveryRecoveryResponseSchema.parse({
    deliveryId: id,
    requestId: input.requestId,
    mode: input.mode,
    state: "queued",
    updatedAt: iso(updatedAt),
  })
  const modeGuard =
    input.mode === "retry_preparation"
      ? "d.first_attempt_at IS NULL AND d.provider_id IS NULL AND d.email_state IN ('failed','review_needed','suppressed')"
      : input.mode === "retry_same_request"
        ? `d.provider_id IS NULL AND d.first_attempt_at IS NOT NULL AND d.last_attempt_at IS NOT NULL
        AND d.payload_key IS NOT NULL AND d.payload_hash IS NOT NULL AND clock.at>=d.last_attempt_at AND clock.at>=d.first_attempt_at
        AND clock.at-d.first_attempt_at<${emailLimits.automaticSendWindowMs} AND d.email_state IN ('pending','failed','review_needed','suppressed')`
        : "d.provider_id IS NOT NULL AND d.provider_id NOT LIKE 'local:%' AND d.first_attempt_at IS NOT NULL AND d.payload_key IS NOT NULL AND d.payload_hash IS NOT NULL"
  const snapshot = `EXISTS (SELECT 1 FROM email_deliveries d CROSS JOIN (SELECT ${options.now ? "?" : databaseNow} AS at) clock
    WHERE d.id=? AND d.updated_at=? AND d.email_state=? AND d.pdf_state=? AND d.provider_id IS ? AND d.provider_status IS ?
    AND d.first_attempt_at IS ? AND d.last_attempt_at IS ? AND d.payload_key IS ? AND d.payload_hash IS ?
    AND d.attempts=? AND d.failures=? AND d.completed_at IS ? AND d.lease_token IS ? AND d.lease_until IS ?
    AND (d.lease_until IS NULL OR d.lease_until<=clock.at) AND d.email_state NOT IN ('delivered','bounced') AND (${modeGuard}))`
  try {
    await db.batch([
      ...assertSql(db, authority, [actorId]),
      ...assertSql(db, snapshot, [
        ...(options.now ? [at] : []),
        id,
        row.updated_at,
        row.email_state,
        row.pdf_state,
        row.provider_id,
        row.provider_status,
        row.first_attempt_at,
        row.last_attempt_at,
        row.payload_key,
        row.payload_hash,
        row.attempts,
        row.failures,
        row.completed_at,
        row.lease_token,
        row.lease_until,
      ]),
      ...assertSql(
        db,
        "NOT EXISTS (SELECT 1 FROM outbox WHERE id=? AND (kind<>'email.send' OR entity_id<>?))",
        [jobId, id]
      ),
      db
        .prepare(`UPDATE email_deliveries SET email_state=?,pdf_state=CASE WHEN ?='retry_preparation' AND pdf_state<>'not_required' THEN 'pending' ELSE pdf_state END,
        payload_key=CASE WHEN ?='retry_preparation' THEN NULL ELSE payload_key END,payload_hash=CASE WHEN ?='retry_preparation' THEN NULL ELSE payload_hash END,
        failures=0,last_error=NULL,next_attempt_at=?,updated_at=?,completed_at=NULL,lease_token=NULL,lease_until=NULL WHERE id=?`)
        .bind(
          input.mode === "reconcile" ? "accepted" : "pending",
          input.mode,
          input.mode,
          input.mode,
          at,
          updatedAt,
          id
        ),
      db
        .prepare(`INSERT INTO outbox (id,kind,entity_id,payload_json,created_at,next_attempt_at) VALUES (?,'email.send',?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET completed_at=NULL,dispatched_at=NULL,next_attempt_at=excluded.next_attempt_at`)
        .bind(jobId, id, JSON.stringify({ deliveryId: id }), at, at),
      db
        .prepare(
          "INSERT INTO audit_entries (id,event_id,actor_id,scope,action,entity_id,description,correlation_id,created_at) VALUES (?,NULL,?,'platform','delivery.recovery_requested',?,?,?,?)"
        )
        .bind(
          crypto.randomUUID(),
          actorId,
          id,
          JSON.stringify({
            mode: input.mode,
            reason: input.reason,
            previousEmailState: row.email_state,
            previousPdfState: row.pdf_state,
            previousErrorCode: row.last_error,
            previousUpdatedAt: row.updated_at,
            providerId: row.provider_id,
          }),
          input.requestId,
          at
        ),
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id,request_id,input_hash,resource_id,response_json,created_at) VALUES (?,?,?,?,?,?)"
        )
        .bind(actorId, input.requestId, hash, id, JSON.stringify(response), at),
    ])
    return response
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    return replayOrConflict()
  }
}
