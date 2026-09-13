import {
  platformCampaignsQuerySchema,
  platformCampaignsResponseSchema,
} from "@elc/shared"
import { ApiFailure, requestHash } from "../db/transitions"
import {
  encodeCursor,
  readCursor,
  retentionColumns,
  retentionDto,
  type RetentionRow,
} from "../history/store"

const authority = `EXISTS (SELECT 1 FROM user actor LEFT JOIN profiles profile ON profile.user_id=actor.id
 WHERE actor.id=? AND actor.email_verified=1 AND profile.suspended_at IS NULL
 AND EXISTS (SELECT 1 FROM platform_grants g WHERE g.user_id=actor.id AND g.permission='platform:moderate'))`
const forbidden = () =>
  new ApiFailure(
    "FORBIDDEN",
    403,
    "Platform moderation permission is required."
  )
type Row = RetentionRow & {
  id: string
  event_id: string
  event_title: string
  organizer_id: string
  name: string
  enabled: number
  discount_kind: "percentage" | "fixed"
  discount_value: number
  starts_at: number
  ends_at: number
  max_redemptions: number
  updated_at: number
  active_holds: number
  committed_redemptions: number
}

/** Usage is computed only for the bounded retained campaign page in the final authorization snapshot. */
export async function listPlatformCampaigns(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  dependencies: { now?: () => number; beforeRead?: () => Promise<void> } = {}
) {
  const parsed = platformCampaignsQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose valid campaign activity filters."
    )
  if (!(await db.prepare(`SELECT 1 WHERE ${authority}`).bind(actorId).first()))
    throw forbidden()
  const { cursor, ...input } = parsed.data
  const filter = await requestHash("platform.campaigns", { actorId, ...input })
  const after = readCursor(cursor, filter)
  const conditions = ["c.id>?"],
    bindings: unknown[] = [after?.id ?? ""]
  if (input.q) {
    conditions.push("(instr(lower(c.name),lower(?))>0 OR c.id=?)")
    bindings.push(input.q, input.q)
  }
  if (input.eventId) {
    conditions.push("e.id=?")
    bindings.push(input.eventId)
  }
  if (input.organizerId) {
    conditions.push("e.organizer_id=?")
    bindings.push(input.organizerId)
  }
  if (input.enabled !== "all") {
    conditions.push("c.enabled=?")
    bindings.push(input.enabled === "yes" ? 1 : 0)
  }
  await dependencies.beforeRead?.()
  const now = (dependencies.now ?? Date.now)()
  const result = await db.batch([
    db.prepare(`SELECT (${authority}) AS allowed`).bind(actorId),
    db
      .prepare(`WITH retained_events AS (
      SELECT e.id,e.title,e.organizer_id,${retentionColumns} FROM events e
    ), page AS MATERIALIZED (
      SELECT c.id,c.event_id,c.name,c.enabled,c.discount_kind,c.discount_value,c.starts_at,c.ends_at,c.max_redemptions,c.updated_at,
      e.title AS event_title,e.organizer_id,e.expires_at,e.refund_hold,e.payment_hold,e.case_hold,e.admission_hold
      FROM campaigns c JOIN retained_events e ON e.id=c.event_id
      WHERE ${conditions.join(" AND ")} AND (e.expires_at>? OR e.refund_hold OR e.payment_hold OR e.case_hold OR e.admission_hold)
      AND (${authority}) ORDER BY c.id LIMIT ?
    ) SELECT page.*,
      (SELECT count(*) FROM promo_allocations a
       WHERE a.campaign_id=page.id AND a.released_at IS NULL AND a.committed_at IS NULL
       AND EXISTS (SELECT 1 FROM orders o JOIN reservations r ON r.id=a.reservation_id AND r.order_id=o.id
         WHERE o.id=a.order_id AND o.campaign_id=page.id AND o.event_id=page.event_id AND r.event_id=page.event_id
         AND r.state='active' AND r.expires_at>? AND o.state='pending' AND o.completed_at IS NULL)) AS active_holds,
      (SELECT count(*) FROM promo_allocations a WHERE a.campaign_id=page.id AND a.committed_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.campaign_id=page.id AND o.event_id=page.event_id
         AND o.completed_at IS NOT NULL AND o.state IN ('completed','refunded','cancelled'))) AS committed_redemptions
      FROM page ORDER BY page.id`)
      .bind(...bindings, now, actorId, input.limit + 1, now),
  ])
  if (!(result[0]!.results[0] as { allowed: number }).allowed) throw forbidden()
  const rows = result[1]!.results as Row[]
  const items = rows.slice(0, input.limit).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    organizerId: row.organizer_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    discount:
      row.discount_kind === "percentage"
        ? { kind: "percentage", basisPoints: row.discount_value }
        : { kind: "fixed", amountMinor: row.discount_value },
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    maxRedemptions: row.max_redemptions,
    activeHolds: row.active_holds,
    committedRedemptions: row.committed_redemptions,
    updatedAt: new Date(row.updated_at).toISOString(),
    retention: retentionDto(row),
  }))
  return platformCampaignsResponseSchema.parse({
    items,
    nextCursor:
      rows.length > input.limit
        ? encodeCursor(0, rows[input.limit - 1]!.id, filter)
        : null,
    generatedAt: new Date(now).toISOString(),
  })
}
