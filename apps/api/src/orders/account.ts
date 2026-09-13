import { accountOrdersResponseSchema, paginationQuerySchema } from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"

export async function readAccountOrders(
  db: D1Database,
  actorId: string,
  query: Record<string, string>,
  dependencies: { beforeRead?: () => Promise<void> } = {}
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
  await dependencies.beforeRead?.()
  const context = `WITH authorized_account AS (SELECT u.id FROM user u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=? AND u.email_verified=1 AND p.suspended_at IS NULL)`
  const [access, result] = await db.batch([
    db.prepare(`${context} SELECT id FROM authorized_account`).bind(actorId),
    db
      .prepare(`${context} SELECT o.id, o.event_id, e.title, e.starts_at, o.state, o.total_minor, o.currency, o.created_at
    FROM authorized_account a JOIN orders o ON o.account_id=a.id JOIN events e ON e.id = o.event_id WHERE (o.created_at < ? OR (o.created_at = ? AND o.id > ?))
    ORDER BY o.created_at DESC, o.id LIMIT ?`)
      .bind(actorId, lastTime, lastTime, lastId, limit + 1),
  ])
  if (!access!.results.length)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "An active verified account is required."
    )
  const results = result!.results as Array<{
    id: string
    event_id: string
    title: string
    starts_at: number
    state: string
    total_minor: number
    currency: string
    created_at: number
  }>
  const rows = results.slice(0, limit)
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
      results.length > limit && last
        ? btoa(JSON.stringify([last.created_at, last.id]))
        : null,
  })
}
