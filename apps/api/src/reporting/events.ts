import {
  analyticsEventsQuerySchema,
  analyticsEventsResponseSchema,
} from "@elc/shared"
import { ApiFailure } from "../db/transitions"
import { activeAccountSql } from "../events/store"
import { reportAccess } from "./sql"

export async function listAnalyticsEvents(
  db: D1Database,
  actorId: string,
  raw: unknown = {}
) {
  const parsed = analyticsEventsQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose valid event filters and page sizes."
    )
  const query = parsed.data
  const [active, result] = await db.batch([
    db.prepare(`SELECT (${activeAccountSql}) allowed`).bind(actorId),
    db
      .prepare(`SELECT e.id,e.title,e.time_zone,e.reporting_id,e.starts_at,e.ends_at FROM events e
      WHERE e.id > ? AND instr(lower(e.title),lower(?)) > 0 AND ${reportAccess} ORDER BY e.id LIMIT ?`)
      .bind(query.after ?? "", query.q ?? "", actorId, query.limit + 1),
  ])
  if (!(active!.results[0] as { allowed: number }).allowed)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "A verified active account is required."
    )
  const rows = result!.results as {
    id: string
    title: string
    time_zone: string
    reporting_id: string
    starts_at: number
    ends_at: number
  }[]
  const page = rows.slice(0, query.limit)
  return analyticsEventsResponseSchema.parse({
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      timeZone: row.time_zone,
      reportingId: row.reporting_id,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
    })),
    nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
  })
}
