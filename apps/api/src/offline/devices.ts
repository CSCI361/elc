import {
  offlineDevicesSchema,
  offlineListQuerySchema,
  registerOfflineDeviceSchema,
  revokeOfflineDeviceSchema,
} from "@elc/shared"
import {
  requireActiveAccount,
  requireEventPermission,
} from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeAccountSql } from "../events/store"
import { staffAuthorizationSql } from "../tickets/scan"
import {
  deviceDto,
  loadDevice,
  offlineAudit,
  offlineOutbox,
  offlineReceipt,
  parseOffline,
  type DeviceRow,
  type OfflineDependencies,
} from "./store"

function manageDevicesSql(actorId: string, eventId: string) {
  return {
    predicate: `(${activeAccountSql}) AND (EXISTS (SELECT 1 FROM events WHERE id = ? AND organizer_id = ?) OR EXISTS (SELECT 1 FROM platform_grants WHERE user_id = ? AND permission = 'platform:moderate'))`,
    bindings: [actorId, eventId, actorId, actorId],
  }
}
export function offlineCursor(cursor: string | undefined, scope: string) {
  if (!cursor) return ""
  try {
    const data: unknown = JSON.parse(atob(cursor))
    if (
      typeof data !== "object" ||
      data === null ||
      !("scope" in data) ||
      data.scope !== scope ||
      !("id" in data) ||
      typeof data.id !== "string" ||
      data.id.length > 128
    )
      throw new Error("cursor")
    return data.id
  } catch {
    throw new ApiFailure("INVALID_INPUT", 400, "Use a cursor from this list.")
  }
}
export const nextOfflineCursor = (scope: string, id: string) =>
  btoa(JSON.stringify({ scope, id }))

export async function registerOfflineDevice(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: OfflineDependencies = {}
) {
  const input = parseOffline(registerOfflineDeviceSchema, raw)
  await requireEventPermission(db, actorId, eventId, "ticket:scan")
  const hash = await requestHash("offline.device.register", {
    eventId,
    ...input,
  })
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  if (receipt)
    return deviceDto(await loadDevice(db, receipt.resourceId, eventId, actorId))
  const id = crypto.randomUUID()
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const authorization = staffAuthorizationSql(actorId, eventId, "ticket:scan")
  try {
    await db.batch([
      ...assertSql(db, authorization.predicate, authorization.bindings),
      ...assertSql(
        db,
        "(SELECT count(*) FROM offline_devices WHERE account_id = ? AND event_id = ? AND revoked_at IS NULL) < 10",
        [actorId, eventId]
      ),
      db
        .prepare(
          "INSERT INTO offline_devices (id, account_id, event_id, label, registered_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(id, actorId, eventId, input.label, now),
      offlineReceipt(
        db,
        actorId,
        input.requestId,
        hash,
        id,
        { deviceId: id },
        now
      ),
      offlineAudit(
        db,
        actorId,
        eventId,
        id,
        input.requestId,
        "offline.device_registered",
        now
      ),
      offlineOutbox(db, "offline.device_registered", id, eventId, now),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay)
      return deviceDto(
        await loadDevice(db, replay.resourceId, eventId, actorId)
      )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Device registration eligibility changed or the account already has ten active devices for this event."
    )
  }
  return deviceDto(await loadDevice(db, id, eventId, actorId))
}

export async function listOfflineDevices(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown = {}
) {
  await requireActiveAccount(db, actorId)
  const input = parseOffline(offlineListQuerySchema, raw)
  const manage = manageDevicesSql(actorId, eventId)
  const canManage = !!(await db
    .prepare(`SELECT (${manage.predicate}) AS valid`)
    .bind(...manage.bindings)
    .first<number>("valid"))
  const scope = `devices:${eventId}:${actorId}:${canManage}`
  const cursor = offlineCursor(input.cursor, scope)
  const rows = await db
    .prepare(
      `SELECT * FROM offline_devices WHERE event_id = ? AND id > ? ${canManage ? "" : "AND account_id = ?"} ORDER BY id LIMIT ?`
    )
    .bind(eventId, cursor, ...(canManage ? [] : [actorId]), input.limit + 1)
    .all<DeviceRow>()
  const page = rows.results.slice(0, input.limit)
  return offlineDevicesSchema.parse({
    items: page.map(deviceDto),
    nextCursor:
      rows.results.length > input.limit
        ? nextOfflineCursor(scope, page.at(-1)!.id)
        : null,
  })
}

export async function revokeOfflineDevice(
  db: D1Database,
  actorId: string,
  eventId: string,
  deviceId: string,
  raw: unknown,
  dependencies: OfflineDependencies = {}
) {
  const input = parseOffline(revokeOfflineDeviceSchema, raw)
  await requireActiveAccount(db, actorId)
  await loadDevice(db, deviceId, eventId)
  const manage = manageDevicesSql(actorId, eventId)
  if (
    !(await db
      .prepare(`SELECT (${manage.predicate}) AS valid`)
      .bind(...manage.bindings)
      .first<number>("valid"))
  )
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "The organizer or a platform administrator must revoke this device."
    )
  const hash = await requestHash("offline.device.revoke", {
    eventId,
    deviceId,
    ...input,
  })
  if (await readReceipt(db, actorId, input.requestId, hash))
    return deviceDto(await loadDevice(db, deviceId, eventId))
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  try {
    await db.batch([
      ...assertSql(db, manage.predicate, manage.bindings),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM offline_devices WHERE id = ? AND event_id = ? AND revision = ? AND revoked_at IS NULL)",
        [deviceId, eventId, input.expectedRevision]
      ),
      db
        .prepare(
          "UPDATE offline_devices SET revoked_at = ?, revoked_by = ?, revocation_reason = ?, loss_reported = ?, revision = revision + 1 WHERE id = ?"
        )
        .bind(now, actorId, input.reason, input.lost ? 1 : 0, deviceId),
      offlineReceipt(
        db,
        actorId,
        input.requestId,
        hash,
        deviceId,
        { deviceId },
        now
      ),
      offlineAudit(
        db,
        actorId,
        eventId,
        deviceId,
        input.requestId,
        input.lost ? "offline.device_lost" : "offline.device_revoked",
        now,
        input.reason
      ),
      offlineOutbox(
        db,
        input.lost ? "offline.device_loss_incident" : "offline.device_revoked",
        deviceId,
        eventId,
        now
      ),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    if (!(await readReceipt(db, actorId, input.requestId, hash)))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The device or your authorization changed before revocation."
      )
  }
  return deviceDto(await loadDevice(db, deviceId, eventId))
}
