import { offlineDeviceSchema, type OfflineOperationResult } from "@elc/shared"
import type { z } from "zod"
import { ApiFailure, assertSql } from "../db/transitions"
import { activeAccountSql } from "../events/store"
import type { Bindings } from "../env"

export type OfflineEnvironment = Pick<
  Bindings,
  "DB" | "OFFLINE_SIGNING_PRIVATE_JWK" | "OFFLINE_SIGNING_KEY_ID"
>
export type OfflineDependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
}
export type DeviceRow = {
  id: string
  account_id: string
  event_id: string
  label: string
  revision: number
  registered_at: number
  revoked_at: number | null
  last_sync_at: number | null
  loss_reported: number
}
export type SnapshotRow = {
  id: string
  account_id: string
  device_id: string
  event_id: string
  issued_at: number
  expires_at: number
  event_ends_at: number
  ticket_count: number
  key_id: string
  manifest_json: string | null
}
export type OperationRow = {
  operation_id: string
  account_id: string
  device_id: string
  event_id: string
  snapshot_id: string
  kind: "scan" | "undo"
  original_operation_id: string | null
  device_sequence: number
  captured_at: number
  reported_at: number
  input_hash: string
  unit_hash: string
  result: OfflineOperationResult["result"]
  checkin_id: string | null
  ticket_id: string | null
  order_id: string | null
}
export const iso = (timestamp: number) => new Date(timestamp).toISOString()
export function parseOffline<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide a valid offline operation request."
    )
  return parsed.data
}
export async function loadDevice(
  db: D1Database,
  id: string,
  eventId: string,
  actorId?: string
) {
  const row = await db
    .prepare("SELECT * FROM offline_devices WHERE id = ? AND event_id = ?")
    .bind(id, eventId)
    .first<DeviceRow>()
  if (!row || (actorId && row.account_id !== actorId))
    throw new ApiFailure("NOT_FOUND", 404, "Device not found.")
  return row
}
export function deviceDto(row: DeviceRow) {
  return offlineDeviceSchema.parse({
    id: row.id,
    eventId: row.event_id,
    accountId: row.account_id,
    label: row.label,
    revision: row.revision,
    registeredAt: iso(row.registered_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
    lastSyncAt: row.last_sync_at === null ? null : iso(row.last_sync_at),
    lossReported: !!row.loss_reported,
  })
}
export function deviceGuard(
  db: D1Database,
  actorId: string,
  eventId: string,
  deviceId: string,
  allowRevoked = false
) {
  return assertSql(
    db,
    `EXISTS (SELECT 1 FROM offline_devices WHERE id = ? AND account_id = ? AND event_id = ?${allowRevoked ? "" : " AND revoked_at IS NULL"})`,
    [deviceId, actorId, eventId]
  )
}
export function reviewAuthorizationSql(actorId: string, eventId: string) {
  return {
    predicate: `(${activeAccountSql}) AND EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND (e.organizer_id = ? OR EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.event_id = e.id AND ep.user_id = ? AND ep.permission = 'checkin:review' AND ep.revoked_at IS NULL)))`,
    bindings: [actorId, eventId, actorId, actorId],
  }
}
export async function requireOfflineReview(
  db: D1Database,
  actorId: string,
  eventId: string
) {
  const authorization = reviewAuthorizationSql(actorId, eventId)
  if (
    !(await db
      .prepare(`SELECT (${authorization.predicate}) AS valid`)
      .bind(...authorization.bindings)
      .first<number>("valid"))
  )
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "The organizer or an assigned check-in lead must review this record."
    )
  return authorization
}
export function offlineAudit(
  db: D1Database,
  actorId: string,
  eventId: string,
  entityId: string,
  requestId: string,
  action: string,
  now: number,
  description = action
) {
  return db
    .prepare(
      "INSERT INTO audit_entries (id, actor_id, event_id, scope, action, entity_id, correlation_id, description, created_at) VALUES (?, ?, ?, 'event', ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      actorId,
      eventId,
      action,
      entityId,
      requestId,
      description,
      now
    )
}
export function offlineOutbox(
  db: D1Database,
  kind: string,
  entityId: string,
  eventId: string,
  now: number
) {
  return db
    .prepare(
      "INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      kind,
      entityId,
      JSON.stringify({ eventId, entityId }),
      now,
      now
    )
}
export function offlineReceipt(
  db: D1Database,
  actorId: string,
  requestId: string,
  hash: string,
  entityId: string,
  response: unknown,
  now: number
) {
  return db
    .prepare(
      "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(actorId, requestId, hash, entityId, JSON.stringify(response), now)
}
