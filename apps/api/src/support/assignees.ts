import { paginationQuerySchema, supportAssigneeListSchema } from "@elc/shared"
import { parseSupport, requireSupportCase } from "./store"

/** This is a case-scoped staff picker, never a general account search. */
export async function listSupportAssignees(
  db: D1Database,
  actorId: string,
  caseId: string,
  raw: unknown = {}
) {
  const query = parseSupport(paginationQuerySchema, raw)
  await requireSupportCase(db, actorId, caseId, "manage")
  const rows = (
    await db
      .prepare(`SELECT candidate.id AS userId, candidate.name FROM support_cases c
    JOIN user candidate LEFT JOIN profiles p ON p.user_id = candidate.id
    WHERE c.id = ? AND candidate.id > ? AND candidate.email_verified = 1 AND p.suspended_at IS NULL AND (
      EXISTS (SELECT 1 FROM platform_grants g WHERE g.user_id = candidate.id AND g.permission IN ('platform:support', 'platform:moderate'))
      OR (c.audience = 'attendee' AND (
        EXISTS (SELECT 1 FROM events e WHERE e.id = c.event_id AND e.organizer_id = candidate.id)
        OR EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.event_id = c.event_id AND ep.user_id = candidate.id AND ep.permission = 'support:manage' AND ep.revoked_at IS NULL)
      ))
    ) ORDER BY candidate.id LIMIT ?`)
      .bind(caseId, query.cursor ?? "", query.limit + 1)
      .all<{ userId: string; name: string }>()
  ).results
  await requireSupportCase(db, actorId, caseId, "manage")
  const selected = rows.slice(0, query.limit)
  return supportAssigneeListSchema.parse({
    caseId,
    items: selected,
    nextCursor: rows.length > query.limit ? selected.at(-1)!.userId : null,
  })
}
