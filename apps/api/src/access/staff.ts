import {
  eventAccessListQuerySchema,
  eventStaffListSchema,
  eventStaffMutationSchema,
  replaceEventStaffSchema,
} from "@elc/shared"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeAccountSql } from "../events/store"
import {
  accessAudit,
  accessCursor,
  accessOutbox,
  accessOwner,
  nextAccessCursor,
  ownerGuards,
  parseAccess,
  staffDto,
  staffRows,
  type AccessDependencies,
} from "./store"

export async function listEventStaff(
  db: D1Database,
  actorId: string,
  eventId: string,
  rawQuery: unknown = {}
) {
  const query = parseAccess(eventAccessListQuerySchema, rawQuery)
  const event = await accessOwner(db, actorId, eventId)
  const cursor = accessCursor(query, eventId, event.revision, "staff")
  const users = (
    await db
      .prepare(`SELECT u.id, u.name, u.email FROM user u WHERE u.id IN (
    SELECT user_id FROM event_permissions WHERE event_id = ? AND user_id > ?
    GROUP BY user_id ORDER BY user_id LIMIT ?)
    ORDER BY u.id`)
      .bind(eventId, cursor, query.limit + 1)
      .all<{ id: string; name: string; email: string }>()
  ).results
  const page = users.slice(0, query.limit)
  const grants = await staffRows(
    db,
    eventId,
    page.map((user) => user.id)
  )
  return eventStaffListSchema.parse({
    eventId,
    revision: event.revision,
    items: page.map((user) =>
      staffDto(
        user,
        grants.filter((grant) => grant.user_id === user.id)
      )
    ),
    nextCursor:
      users.length > query.limit
        ? nextAccessCursor(eventId, event.revision, "staff", page.at(-1)!.id)
        : null,
  })
}

export async function replaceEventStaff(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: AccessDependencies = {}
) {
  const input = parseAccess(replaceEventStaffSchema, raw)
  input.permissions.sort()
  await accessOwner(db, actorId, eventId)
  const hash = await requestHash("staff.replace", { eventId, ...input })
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  if (receipt?.responseJson)
    return eventStaffMutationSchema.parse(JSON.parse(receipt.responseJson))
  const matches = (
    await db
      .prepare(
        "SELECT id, name, email FROM user WHERE lower(email) = ? LIMIT 2"
      )
      .bind(input.email)
      .all<{ id: string; name: string; email: string }>()
  ).results
  const target = matches[0]
  if (!target || matches.length !== 1)
    throw new ApiFailure(
      "NOT_FOUND",
      404,
      "No account with that email is available for this assignment."
    )
  const before = await staffRows(db, eventId, [target.id])
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const grants = before.map((grant) => ({
    ...grant,
    revoked_at: input.permissions.includes(grant.permission)
      ? null
      : (grant.revoked_at ?? now),
    granted_at:
      input.permissions.includes(grant.permission) && grant.revoked_at !== null
        ? now
        : grant.granted_at,
  }))
  for (const permission of input.permissions)
    if (!grants.some((grant) => grant.permission === permission))
      grants.push({
        user_id: target.id,
        name: target.name,
        email: target.email,
        permission,
        granted_at: now,
        revoked_at: null,
      })
  grants.sort((left, right) => left.permission.localeCompare(right.permission))
  const response = eventStaffMutationSchema.parse({
    eventId,
    revision: input.expectedRevision + 1,
    staff: staffDto(target, grants),
  })
  try {
    await db.batch([
      ...ownerGuards(db, actorId, eventId, input.expectedRevision),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM user WHERE id = ? AND lower(email) = ?)",
        [target.id, input.email]
      ),
      ...(input.permissions.length
        ? assertSql(db, activeAccountSql, [target.id])
        : []),
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          target.id,
          JSON.stringify(response),
          now
        ),
      db
        .prepare(
          "UPDATE event_permissions SET revoked_at = COALESCE(revoked_at, ?) WHERE event_id = ? AND user_id = ? AND permission NOT IN (SELECT value FROM json_each(?))"
        )
        .bind(now, eventId, target.id, JSON.stringify(input.permissions)),
      db
        .prepare(`INSERT INTO event_permissions (event_id, user_id, permission, granted_at) SELECT ?, ?, value, ? FROM json_each(?) WHERE 1
        ON CONFLICT(event_id, user_id, permission) DO UPDATE SET granted_at = CASE WHEN event_permissions.revoked_at IS NOT NULL THEN excluded.granted_at ELSE event_permissions.granted_at END, revoked_at = NULL`)
        .bind(eventId, target.id, now, JSON.stringify(input.permissions)),
      db
        .prepare(
          "UPDATE events SET revision = revision + 1, updated_at = ? WHERE id = ?"
        )
        .bind(now, eventId),
      accessAudit(
        db,
        eventId,
        actorId,
        "staff.permissions_replaced",
        target.id,
        `Explicit permissions set to ${input.permissions.join(", ") || "none"}`,
        input.requestId,
        now
      ),
      accessOutbox(
        db,
        "staff.permissions_changed",
        target.id,
        { eventId, userId: target.id, permissions: input.permissions },
        now
      ),
    ])
  } catch (error) {
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson)
      return eventStaffMutationSchema.parse(JSON.parse(replay.responseJson))
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The event, owner or target account changed before the assignment."
      )
    throw error
  }
  return response
}
