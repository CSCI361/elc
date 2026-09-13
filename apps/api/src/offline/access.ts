import {
  offlineAccessSchema,
  offlineEventsSchema,
  offlineListQuerySchema,
} from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import { activeAccountSql } from "../events/store"
import { nextOfflineCursor, offlineCursor } from "./devices"
import { parseOffline } from "./store"

type AccessRow = {
  id: string
  title: string
  owner: number
  moderator: number
  reviewer: number
  scanner: number
}
const selection = `SELECT e.id,e.title,e.organizer_id=u.id AS owner,
  EXISTS(SELECT 1 FROM platform_grants g WHERE g.user_id=u.id AND g.permission='platform:moderate') AS moderator,
  EXISTS(SELECT 1 FROM event_permissions ep WHERE ep.event_id=e.id AND ep.user_id=u.id AND ep.permission='checkin:review' AND ep.revoked_at IS NULL) AS reviewer,
  EXISTS(SELECT 1 FROM event_permissions ep WHERE ep.event_id=e.id AND ep.user_id=u.id AND ep.permission='ticket:scan' AND ep.revoked_at IS NULL) AS scanner
  FROM events e JOIN user u ON u.id=? LEFT JOIN profiles p ON p.user_id=u.id
  WHERE u.email_verified=1 AND p.suspended_at IS NULL`
const dto = (row: AccessRow) =>
  offlineAccessSchema.parse({
    event: { id: row.id, title: row.title },
    capabilities: {
      manageDevices: !!(row.owner || row.moderator),
      reviewAdmissions: !!(row.owner || row.reviewer),
      openIncident: !!row.owner,
    },
  })
export type OfflineReadDependencies = { beforeReturn?: () => Promise<void> }

export async function readOfflineAccess(
  db: D1Database,
  actorId: string,
  eventId: string,
  dependencies: OfflineReadDependencies = {}
) {
  await requireActiveAccount(db, actorId)
  await dependencies.beforeReturn?.()
  const row = await db
    .prepare(
      `SELECT * FROM (${selection} AND e.id=?) WHERE owner OR moderator OR reviewer OR scanner`
    )
    .bind(actorId, eventId)
    .first<AccessRow>()
  if (!row)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Current offline event access is required."
    )
  return dto(row)
}

export async function listOfflineEvents(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  dependencies: OfflineReadDependencies = {}
) {
  await requireActiveAccount(db, actorId)
  const input = parseOffline(offlineListQuerySchema, raw)
  const scope = `offline-events:${actorId}`
  const after = offlineCursor(input.cursor, scope)
  await dependencies.beforeReturn?.()
  // The list discovers owned/assigned events; moderators use the platform event list.
  const [access, rows] = await db.batch([
    db.prepare(`SELECT (${activeAccountSql}) AS valid`).bind(actorId),
    db
      .prepare(
        `SELECT * FROM (${selection} AND e.id>?) WHERE owner OR reviewer OR scanner ORDER BY id LIMIT ?`
      )
      .bind(actorId, after, input.limit + 1),
  ])
  if (!(access!.results[0] as { valid: number } | undefined)?.valid)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "An active verified account is required."
    )
  const page = (rows!.results as AccessRow[]).slice(0, input.limit)
  return offlineEventsSchema.parse({
    items: page.map(dto),
    nextCursor:
      rows!.results.length > input.limit
        ? nextOfflineCursor(scope, page.at(-1)!.id)
        : null,
  })
}
