import { z } from "zod"
import {
  eventInvitationApiSchema,
  eventStaffApiSchema,
  type PaginationQuery,
  type Permission,
} from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure, assertSql } from "../db/transitions"
import { activeAccountSql, findEvent } from "../events/store"
import type { Bindings } from "../env"

export type AccessDependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
}
export type AccessEnvironment = Pick<
  Bindings,
  "DB" | "APP_ORIGIN" | "TICKET_ENCRYPTION_KEY"
>
export type InvitationRow = {
  id: string
  event_id: string
  email: string
  token_hash: string
  expires_at: number
  revoked_at: number | null
  accepted_by: string | null
  accepted_at: number | null
  created_at: number
}
export type StaffRow = {
  user_id: string
  name: string
  email: string
  permission: Permission
  granted_at: number
  revoked_at: number | null
}
export const iso = (value: number | null) =>
  value === null ? null : new Date(value).toISOString()
export function parseAccess<Schema extends z.ZodType>(
  schema: Schema,
  raw: unknown
): z.output<Schema> {
  const result = schema.safeParse(raw)
  if (!result.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide valid access fields and the current event revision."
    )
  return result.data
}
export async function accessOwner(
  db: D1Database,
  actorId: string,
  eventId: string
) {
  await requireActiveAccount(db, actorId)
  const event = await findEvent(db, eventId)
  if (event.organizer_id !== actorId)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Only the event owner can manage staff and invitations."
    )
  return event
}
export function ownerGuards(
  db: D1Database,
  actorId: string,
  eventId: string,
  revision: number
) {
  return [
    ...assertSql(db, activeAccountSql, [actorId]),
    ...assertSql(
      db,
      "EXISTS (SELECT 1 FROM events WHERE id = ? AND organizer_id = ? AND revision = ?)",
      [eventId, actorId, revision]
    ),
  ]
}
export function invitationDto(row: InvitationRow, now: number) {
  return eventInvitationApiSchema.parse({
    id: row.id,
    eventId: row.event_id,
    email: row.email,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    acceptedAt: iso(row.accepted_at),
    acceptedBy: row.accepted_by,
    revokedAt: iso(row.revoked_at),
    state:
      row.revoked_at !== null
        ? "revoked"
        : row.accepted_at !== null
          ? "accepted"
          : row.expires_at <= now
            ? "expired"
            : "pending",
  })
}
export function staffDto(
  user: { id: string; name: string; email: string },
  rows: StaffRow[]
) {
  return eventStaffApiSchema.parse({
    userId: user.id,
    name: user.name,
    email: user.email,
    permissions: rows
      .filter((row) => row.revoked_at === null)
      .map((row) => row.permission),
    grants: rows.map((row) => ({
      permission: row.permission,
      grantedAt: iso(row.granted_at),
      revokedAt: iso(row.revoked_at),
    })),
  })
}
export async function staffRows(
  db: D1Database,
  eventId: string,
  userIds: string[]
) {
  return (
    await db
      .prepare(`SELECT ep.user_id, u.name, u.email, ep.permission, ep.granted_at, ep.revoked_at
    FROM event_permissions ep JOIN user u ON u.id = ep.user_id
    WHERE ep.event_id = ? AND ep.user_id IN (SELECT value FROM json_each(?)) ORDER BY ep.user_id, ep.permission`)
      .bind(eventId, JSON.stringify(userIds))
      .all<StaffRow>()
  ).results
}
export async function invitationRow(
  db: D1Database,
  eventId: string,
  id: string
) {
  const row = await db
    .prepare("SELECT * FROM invitations WHERE id = ? AND event_id = ?")
    .bind(id, eventId)
    .first<InvitationRow>()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Invitation not found.")
  return row
}
const cursorSchema = z.strictObject({
  eventId: z.string(),
  revision: z.int().nonnegative(),
  kind: z.enum(["staff", "invitations"]),
  lastId: z.string().min(1).max(128),
})
export function accessCursor(
  query: PaginationQuery,
  eventId: string,
  revision: number,
  kind: "staff" | "invitations"
) {
  if (!query.cursor) return ""
  let parsed: z.infer<typeof cursorSchema>
  try {
    parsed = cursorSchema.parse(JSON.parse(atob(query.cursor)))
  } catch {
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The access-list cursor is invalid."
    )
  }
  if (parsed.eventId !== eventId || parsed.kind !== kind)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The cursor belongs to another access list."
    )
  if (parsed.revision !== revision)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The event access list changed. Reload the first page."
    )
  return parsed.lastId
}
export const nextAccessCursor = (
  eventId: string,
  revision: number,
  kind: "staff" | "invitations",
  lastId: string
) => btoa(JSON.stringify({ eventId, revision, kind, lastId }))
export function accessAudit(
  db: D1Database,
  eventId: string,
  actorId: string,
  action: string,
  resourceId: string,
  description: string,
  correlationId: string,
  now: number
) {
  return db
    .prepare(
      "INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at) VALUES (?, ?, ?, 'event', ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      eventId,
      actorId,
      action,
      resourceId,
      description,
      correlationId,
      now
    )
}
export function accessOutbox(
  db: D1Database,
  kind: string,
  resourceId: string,
  payload: unknown,
  now: number
) {
  return db
    .prepare(
      "INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      kind,
      resourceId,
      JSON.stringify(payload),
      now,
      now
    )
}
