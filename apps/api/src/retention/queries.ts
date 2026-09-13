import { z } from "zod"
import { requirePlatformPermission } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import {
  eventRetentionProjection,
  eventRetentionDto,
  type EventRetentionRow,
} from "./policy"
const querySchema = z.strictObject({
  after: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export async function listRetention(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  dependencies: { now?: () => number; beforeReturn?: () => Promise<void> } = {}
) {
  const parsed = querySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The retention query is invalid."
    )
  await requirePlatformPermission(db, actorId, "platform:recover")
  const now = dependencies.now?.() ?? Date.now(),
    input = parsed.data
  await dependencies.beforeReturn?.()
  const rows = (
    await db
      .prepare(`SELECT e.id,${eventRetentionProjection} FROM events e
 WHERE e.id>? AND (e.ends_at<=? OR e.cancelled_at IS NOT NULL OR e.publication_state='draft')
 ORDER BY e.id LIMIT ?`)
      .bind(input.after ?? "", now, input.limit + 1)
      .all<EventRetentionRow>()
  ).results
  // No event title, support content, or account identity is returned. Recheck the current recovery grant.
  await requirePlatformPermission(db, actorId, "platform:recover")
  const page = rows.slice(0, input.limit)
  return {
    items: page.map(eventRetentionDto),
    nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
  }
}
