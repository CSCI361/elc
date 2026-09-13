import {
  retentionColumns,
  retentionDto,
  type RetentionRow,
} from "../history/store"

export const DAY = 86_400_000
export const HISTORY_MS = 180 * DAY
export const PAYLOAD_MS = 30 * DAY

// Keep one financial/admission policy for organizer history and destructive cleanup.
// Drafts additionally require no orders and no unfinished checkout or support work.
export const eventRetentionProjection = `${retentionColumns},
 CASE WHEN e.publication_state = 'draft' AND e.cancelled_at IS NULL
 THEN e.updated_at + ${HISTORY_MS} ELSE MAX(e.ends_at, COALESCE(e.cancelled_at,0),
 COALESCE((SELECT MAX(c.updated_at) FROM support_cases c WHERE c.event_id=e.id),0)) + ${HISTORY_MS} END AS deadline,
 (e.publication_state = 'draft' AND e.cancelled_at IS NULL AND
  (EXISTS (SELECT 1 FROM orders o WHERE o.event_id=e.id) OR
   EXISTS (SELECT 1 FROM support_cases c WHERE c.event_id=e.id AND c.status <> 'resolved') OR
   EXISTS (SELECT 1 FROM reservations r WHERE r.event_id=e.id AND r.state='active'))) AS draft_hold`

export const eligibleEventSql = `SELECT e.id, ${eventRetentionProjection} FROM events e
 WHERE ((e.publication_state='draft' AND e.cancelled_at IS NULL) OR e.ends_at <= ? OR e.cancelled_at IS NOT NULL)
 AND deadline <= ? AND NOT (refund_hold OR payment_hold OR case_hold OR admission_hold OR draft_hold)`

export type EventRetentionRow = RetentionRow & {
  id: string
  deadline: number
  draft_hold: number
}
export function eventRetentionDto(row: EventRetentionRow) {
  const reasons: string[] = retentionDto(row).holdReasons
  if (row.draft_hold) reasons.push("draft_workflow")
  return {
    id: row.id,
    expiresAt: new Date(row.deadline).toISOString(),
    held: reasons.length > 0,
    holdReasons: reasons,
  }
}
