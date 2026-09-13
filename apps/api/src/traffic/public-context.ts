import {
  publicTrafficContextRequestSchema,
  publicTrafficContextSchema,
} from "@elc/shared"
import { ApiFailure } from "../db/transitions"

/** Public collection can resolve reporting IDs without exposing a redeemable campaign credential. */
export async function readPublicTrafficContext(
  db: D1Database,
  eventId: string,
  raw: unknown,
  now = Date.now()
) {
  const input = publicTrafficContextRequestSchema.safeParse(raw)
  if (!input.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Invalid public analytics context."
    )
  const row = await db
    .prepare(`SELECT e.reporting_id AS eventReportingId,
    (SELECT c.reporting_id FROM campaigns c WHERE c.event_id=e.id AND c.code=? AND c.enabled=1 AND c.starts_at<=? AND c.ends_at>? LIMIT 1) AS campaignReportingId
    FROM events e WHERE e.id=? AND e.visibility='public' AND e.publication_state='published' AND e.suspended_at IS NULL`)
    .bind(input.data.campaignCode ?? null, now, now, eventId)
    .first()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Public event not found.")
  return publicTrafficContextSchema.parse(row)
}
