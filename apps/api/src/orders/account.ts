import { accountOrdersResponseSchema, paginationQuerySchema } from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"

export async function readAccountOrders(
  db: D1Database,
  actorId: string,
  query: Record<string, string>
) {
  await requireActiveAccount(db, actorId)
  const parsed = paginationQuerySchema.safeParse(query)
  if (!parsed.success)
    throw new ApiFailure("INVALID_INPUT", 400, "Invalid order pagination.")
  const { limit, cursor } = parsed.data
  let lastTime = Number.MAX_SAFE_INTEGER
  let lastId = ""
  if (cursor) {
    try {
      const value: unknown = JSON.parse(atob(cursor))
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !Number.isSafeInteger(value[0]) ||
        typeof value[1] !== "string" ||
        value[1].length > 128
      )
        throw new Error()
      lastTime = value[0] as number
      lastId = value[1]
    } catch {
      throw new ApiFailure("INVALID_INPUT", 400, "Invalid order cursor.")
    }
  }
  const result = await db
    .prepare(`SELECT o.id, o.event_id, e.title, e.starts_at, o.state, o.total_minor, o.currency, o.created_at
    FROM orders o JOIN events e ON e.id = o.event_id WHERE o.account_id = ? AND (o.created_at < ? OR (o.created_at = ? AND o.id > ?))
    ORDER BY o.created_at DESC, o.id LIMIT ?`)
    .bind(actorId, lastTime, lastTime, lastId, limit + 1)
    .all<{
      id: string
      event_id: string
      title: string
      starts_at: number
      state: string
      total_minor: number
      currency: string
      created_at: number
    }>()
  const rows = result.results.slice(0, limit)
  const last = rows.at(-1)
  return accountOrdersResponseSchema.parse({
    items: rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.title,
      eventStartsAt: new Date(row.starts_at).toISOString(),
      state: row.state,
      totalMinor: row.total_minor,
      currency: row.currency,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    nextCursor:
      result.results.length > limit && last
        ? btoa(JSON.stringify([last.created_at, last.id]))
        : null,
  })
}
