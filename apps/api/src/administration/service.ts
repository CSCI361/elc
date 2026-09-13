import {
  accountAdministrationListSchema,
  administrationQuerySchema,
  eventAdministrationListSchema,
  suspensionRequestSchema,
  suspensionResponseSchema,
} from "@elc/shared"
import { requirePlatformPermission } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeAccountSql } from "../events/store"
import { platformGrantSql } from "../activation/mutations"

const permission = "platform:moderate" as const
const authorized = `(${activeAccountSql}) AND (${platformGrantSql})`
const iso = (value: number | null) =>
  value === null ? null : new Date(value).toISOString()
type Dependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
  beforeRead?: () => Promise<void>
}

export async function listAdministration(
  db: D1Database,
  actorId: string,
  kind: "accounts" | "events",
  raw: unknown = {},
  dependencies: Dependencies = {}
) {
  const parsed = administrationQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose valid search filters and page sizes."
    )
  await requirePlatformPermission(db, actorId, permission)
  const query = parsed.data
  const suspended =
    query.suspended === "all"
      ? "1"
      : `${kind === "accounts" ? "p" : "e"}.suspended_at IS ${query.suspended === "yes" ? "NOT " : ""}NULL`
  const sql =
    kind === "accounts"
      ? `SELECT u.id,u.name,u.email,u.email_verified AS emailVerified,p.suspended_at AS suspendedAt,COALESCE(p.moderation_revision,0) AS revision
       FROM user u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id>? AND (instr(lower(u.name),lower(?))>0 OR instr(lower(u.email),lower(?))>0 OR u.id=?) AND ${suspended} AND ${authorized} ORDER BY u.id LIMIT ?`
      : `SELECT e.id,e.title,e.organizer_id AS organizerId,e.visibility,e.publication_state AS publicationState,e.starts_at AS startsAt,e.suspended_at AS suspendedAt,e.revision
       FROM events e WHERE e.id>? AND (instr(lower(e.title),lower(?))>0 OR e.id=? OR e.organizer_id=?) AND ${suspended} AND ${authorized} ORDER BY e.id LIMIT ?`
  await dependencies.beforeRead?.()
  const result = await db.batch([
    db
      .prepare(`SELECT (${authorized}) AS allowed`)
      .bind(actorId, actorId, permission),
    db
      .prepare(sql)
      .bind(
        query.after ?? "",
        query.q,
        query.q,
        query.q,
        actorId,
        actorId,
        permission,
        query.limit + 1
      ),
  ])
  if (!(result[0]!.results[0] as { allowed: number }).allowed)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Platform moderation permission is required."
    )
  const rows = result[1]!.results as Record<string, unknown>[]
  const nextCursor =
    rows.length > query.limit ? rows[query.limit - 1]!.id : null
  const items = rows.slice(0, query.limit).map((row) => ({
    ...row,
    suspendedAt: iso(row.suspendedAt as number | null),
    ...(kind === "accounts"
      ? { emailVerified: !!row.emailVerified }
      : { startsAt: iso(row.startsAt as number) }),
  }))
  return kind === "accounts"
    ? accountAdministrationListSchema.parse({ items, nextCursor })
    : eventAdministrationListSchema.parse({ items, nextCursor })
}

/** The receipt, suspension, session revocation and audit share the guarded D1 transition. */
export async function setSuspension(
  db: D1Database,
  actorId: string,
  kind: "account" | "event",
  id: string,
  raw: unknown,
  dependencies: Dependencies = {}
) {
  const parsed = suspensionRequestSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide the current revision and a moderation reason."
    )
  const input = parsed.data
  await requirePlatformPermission(db, actorId, permission)
  if (kind === "account" && id === actorId)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Another moderator must change your account's suspension."
    )
  const hash = await requestHash("platform.suspension", { kind, id, ...input })
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  if (receipt?.responseJson)
    return suspensionResponseSchema.parse(JSON.parse(receipt.responseJson))
  const exists = await db
    .prepare(
      kind === "account"
        ? "SELECT id FROM user WHERE id=?"
        : "SELECT id FROM events WHERE id=?"
    )
    .bind(id)
    .first()
  if (!exists)
    throw new ApiFailure(
      "NOT_FOUND",
      404,
      "The moderation subject was not found."
    )
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const response = suspensionResponseSchema.parse({
    kind,
    id,
    revision: input.expectedRevision + 1,
    suspendedAt: input.suspended ? iso(now) : null,
  })
  const snapshotScope = kind === "account" ? "account_id" : "event_id"
  try {
    await db.batch([
      ...assertSql(db, authorized, [actorId, actorId, permission]),
      ...assertSql(
        db,
        kind === "account"
          ? "EXISTS (SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=? AND COALESCE(p.moderation_revision,0)=? AND (p.suspended_at IS NULL)=?)"
          : "EXISTS (SELECT 1 FROM events WHERE id=? AND revision=? AND (suspended_at IS NULL)=?)",
        [id, input.expectedRevision, input.suspended ? 1 : 0]
      ),
      db
        .prepare(
          "INSERT INTO request_receipts(actor_id,request_id,input_hash,resource_id,response_json,created_at) VALUES(?,?,?,?,?,?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          id,
          JSON.stringify(response),
          now
        ),
      ...(kind === "account"
        ? [
            db
              .prepare(
                "INSERT INTO profiles(user_id,updated_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING"
              )
              .bind(id, now),
            db
              .prepare(
                "UPDATE profiles SET suspended_at=?,moderation_revision=moderation_revision+1,updated_at=? WHERE user_id=?"
              )
              .bind(input.suspended ? now : null, now, id),
            ...(input.suspended
              ? [db.prepare("DELETE FROM session WHERE user_id=?").bind(id)]
              : []),
          ]
        : [
            db
              .prepare(
                "UPDATE events SET suspended_at=?,revision=revision+1,updated_at=? WHERE id=?"
              )
              .bind(input.suspended ? now : null, now, id),
          ]),
      ...(input.suspended
        ? [
            db
              .prepare(
                `UPDATE offline_snapshots SET invalidated_at=? WHERE ${snapshotScope}=? AND expires_at>? AND invalidated_at IS NULL AND issued_at<=?`
              )
              .bind(now, id, now, now),
          ]
        : []),
      db
        .prepare(
          "INSERT INTO audit_entries(id,event_id,actor_id,scope,action,entity_id,description,correlation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          crypto.randomUUID(),
          kind === "event" ? id : null,
          actorId,
          kind,
          `${kind}.${input.suspended ? "suspended" : "resumed"}`,
          id,
          input.reason,
          input.requestId,
          now
        ),
    ])
  } catch (error) {
    await requirePlatformPermission(db, actorId, permission)
    const duplicate = await readReceipt(db, actorId, input.requestId, hash)
    if (duplicate?.responseJson)
      return suspensionResponseSchema.parse(JSON.parse(duplicate.responseJson))
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The subject or moderation permission changed. Reload before trying again."
      )
    throw error
  }
  await requirePlatformPermission(db, actorId, permission)
  return response
}
