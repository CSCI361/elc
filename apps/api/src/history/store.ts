import { z } from "zod"
import { ApiFailure } from "../db/transitions"
import { requireEventPermission } from "../auth/permissions"
import { findEvent, type EventRow } from "../events/store"

export type HistoryDependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
  beforeReturn?: () => Promise<void>
}
export function parseHistory<T extends z.ZodType>(
  schema: T,
  raw: unknown
): z.output<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The history request contains missing or invalid fields."
    )
  return parsed.data
}
export function eventAuthoritySql(permission: "history:read" | "event:manage") {
  return `EXISTS (SELECT 1 FROM user hu LEFT JOIN profiles hp ON hp.user_id = hu.id
    WHERE hu.id = ? AND hu.email_verified = 1 AND hp.suspended_at IS NULL AND
    (e.organizer_id = hu.id OR EXISTS (SELECT 1 FROM event_permissions hg WHERE hg.event_id = e.id
      AND hg.user_id = hu.id AND hg.permission = '${permission}' AND hg.revoked_at IS NULL)))`
}
const paymentEvent = `(p.purpose = 'event_activation' AND p.subject_id = e.id) OR
  (p.purpose = 'ticket_order' AND EXISTS (SELECT 1 FROM orders ho WHERE ho.id = p.subject_id AND ho.event_id = e.id))`
export const retentionColumns = `MAX(e.ends_at, COALESCE(e.cancelled_at,0), COALESCE((SELECT MAX(hsc.updated_at) FROM support_cases hsc WHERE hsc.event_id = e.id),0)) + 15552000000 AS expires_at,
  EXISTS (SELECT 1 FROM refunds hr JOIN payment_attempts p ON p.id = hr.payment_attempt_id WHERE hr.state <> 'succeeded' AND (${paymentEvent})) AS refund_hold,
  EXISTS (SELECT 1 FROM payment_attempts p WHERE (${paymentEvent}) AND (p.state = 'pending' OR p.dispatch_state = 'uncertain'
    OR (p.state = 'succeeded' AND p.purpose = 'ticket_order' AND EXISTS (SELECT 1 FROM orders ho WHERE ho.id = p.subject_id AND ho.state <> 'completed')
      AND NOT EXISTS (SELECT 1 FROM refunds hr WHERE hr.payment_attempt_id = p.id AND hr.state = 'succeeded')))) AS payment_hold,
  EXISTS (SELECT 1 FROM support_cases hsc WHERE hsc.event_id = e.id AND hsc.order_id IS NOT NULL AND hsc.status <> 'resolved' AND hsc.category IN ('refund','dispute','compensation')) AS case_hold,
  EXISTS (SELECT 1 FROM offline_admission_reports har JOIN orders ho ON ho.id = har.order_id WHERE ho.event_id = e.id AND har.review_state = 'unresolved') AS admission_hold`
export type RetentionRow = {
  expires_at: number
  refund_hold: number
  payment_hold: number
  case_hold: number
  admission_hold: number
}
export const retainedSql =
  "(expires_at > ? OR refund_hold OR payment_hold OR case_hold OR admission_hold)"
export function retentionDto(row: RetentionRow) {
  const holdReasons: Array<
    | "refund"
    | "payment_reconciliation"
    | "financial_case"
    | "reported_admission"
  > = []
  if (row.refund_hold) holdReasons.push("refund")
  if (row.payment_hold) holdReasons.push("payment_reconciliation")
  if (row.case_hold) holdReasons.push("financial_case")
  if (row.admission_hold) holdReasons.push("reported_admission")
  return {
    expiresAt: new Date(row.expires_at).toISOString(),
    held: holdReasons.length > 0,
    holdReasons,
  }
}
export async function retainedEvent(
  db: D1Database,
  actorId: string,
  eventId: string,
  now: number,
  permission: "history:read" | "event:manage" = "history:read"
) {
  await requireEventPermission(db, actorId, eventId, permission)
  const row = await db
    .prepare(
      `SELECT e.*, ${retentionColumns} FROM events e WHERE e.id = ? AND ${retainedSql}`
    )
    .bind(eventId, now)
    .first<EventRow & RetentionRow>()
  if (!row)
    throw new ApiFailure(
      "NOT_FOUND",
      404,
      "This event's retained history is unavailable."
    )
  return row
}
export const cursorSchema = z.strictObject({
  at: z.int(),
  id: z.string().min(1).max(128),
  filter: z.string().length(64),
})
export function readCursor(value: string | undefined, filter: string) {
  if (!value) return null
  let parsed: z.infer<typeof cursorSchema>
  try {
    parsed = cursorSchema.parse(JSON.parse(atob(value)))
  } catch {
    throw new ApiFailure("INVALID_INPUT", 400, "The history cursor is invalid.")
  }
  if (parsed.filter !== filter)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The cursor belongs to another history query."
    )
  return parsed
}
export const encodeCursor = (at: number, id: string, filter: string) =>
  btoa(JSON.stringify({ at, id, filter }))
export async function canDuplicate(
  db: D1Database,
  actorId: string,
  eventId: string,
  now: number
) {
  const result = await db
    .prepare(
      `SELECT 1 FROM events e WHERE e.id = ? AND (e.ends_at <= ? OR e.cancelled_at IS NOT NULL) AND e.suspended_at IS NULL AND ${eventAuthoritySql("event:manage")}`
    )
    .bind(eventId, now, actorId)
    .first()
  return Boolean(result)
}
export { findEvent }
