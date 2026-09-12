import { supportAccessExpression } from "../guards"

/** The session ID is an internal reference, never a public bearer credential. */
export async function liveAccess(
  db: D1Database,
  caseId: string,
  actorId: string,
  sessionId: string
) {
  return db
    .prepare(`SELECT c.last_sequence, s.expires_at FROM support_cases c JOIN session s ON s.id = ? AND s.user_id = ?
    WHERE c.id = ? AND s.expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER) AND ${supportAccessExpression("c")}`)
    .bind(sessionId, actorId, caseId, actorId)
    .first<{ last_sequence: number; expires_at: number }>()
}
