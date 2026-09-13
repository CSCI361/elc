import {
  permissionSchema,
  resolveCampaignRequestSchema,
  resolveCampaignResponseSchema,
} from "@elc/shared"
import { requireEventReadAccess } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import { hashCampaignToken } from "../events/mutations"

export type CampaignDependencies = {
  now?: () => number
  beforeReturn?: () => Promise<void>
}

function eventAccess(actorId?: string) {
  if (!actorId)
    return {
      sql: "e.visibility IN ('public','unlisted')",
      bindings: [] as unknown[],
    }
  return {
    sql: `(e.visibility IN ('public','unlisted') OR EXISTS(SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id=u.id
  WHERE u.id=? AND u.email_verified=1 AND p.suspended_at IS NULL AND
   (e.organizer_id=u.id OR EXISTS(SELECT 1 FROM event_permissions ep WHERE ep.event_id=e.id AND ep.user_id=u.id AND ep.revoked_at IS NULL AND ep.permission IN(SELECT value FROM json_each(?)))
    OR EXISTS(SELECT 1 FROM platform_grants g WHERE g.user_id=u.id AND g.permission='platform:moderate')
    OR EXISTS(SELECT 1 FROM invitations inv WHERE inv.event_id=e.id AND inv.accepted_by=u.id AND lower(inv.email)=lower(u.email)
     AND inv.revoked_at IS NULL AND inv.accepted_at IS NOT NULL AND inv.accepted_at<inv.expires_at AND inv.accepted_at<e.ends_at))))`,
    bindings: [actorId, JSON.stringify(permissionSchema.options)],
  }
}
type CampaignTerms = {
  id: string
  name: string
  discount_kind: "percentage" | "fixed"
  discount_value: number
  starts_at: number
  ends_at: number
  ticket_type_ids: string
}

/** Resolution describes current terms. Checkout separately enforces inventory, redemption limits,
 * ticket-type eligibility and pricing in its authoritative reservation transaction. */
export async function resolveCampaign(
  db: D1Database,
  eventId: string,
  raw: unknown,
  actorId?: string,
  dependencies: CampaignDependencies = {}
) {
  const parsed = resolveCampaignRequestSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure("INVALID_INPUT", 400, "Provide a campaign code.")
  await requireEventReadAccess(db, eventId, actorId)
  const hash = await hashCampaignToken(parsed.data.code)
  await dependencies.beforeReturn?.()
  const now = dependencies.now?.() ?? Date.now(),
    access = eventAccess(actorId)
  const eligible = `e.id=? AND e.publication_state='published' AND e.suspended_at IS NULL AND e.cancelled_at IS NULL AND ${access.sql}`
  // Both reads see one final D1 snapshot, after hashing and any permission/campaign changes.
  const [eventResult, campaignResult] = await db.batch([
    db
      .prepare(`SELECT e.id FROM events e WHERE ${eligible}`)
      .bind(eventId, ...access.bindings),
    db
      .prepare(`SELECT c.id,c.name,c.discount_kind,c.discount_value,c.starts_at,c.ends_at,
    (SELECT json_group_array(ticket_type_id) FROM (SELECT link.ticket_type_id FROM campaign_ticket_types link JOIN ticket_types t ON t.id=link.ticket_type_id AND t.event_id=e.id
      WHERE link.campaign_id=c.id ORDER BY link.ticket_type_id)) AS ticket_type_ids
    FROM campaigns c JOIN events e ON e.id=c.event_id WHERE ${eligible}
     AND c.token_hash=? AND c.enabled=1 AND c.starts_at<=? AND c.ends_at>?
     ${dependencies.now ? "" : "AND c.starts_at<=CAST(unixepoch('subsecond')*1000 AS INTEGER) AND c.ends_at>CAST(unixepoch('subsecond')*1000 AS INTEGER)"}
     AND EXISTS(SELECT 1 FROM campaign_ticket_types link JOIN ticket_types t ON t.id=link.ticket_type_id AND t.event_id=e.id WHERE link.campaign_id=c.id)
     LIMIT 1`)
      .bind(eventId, ...access.bindings, hash, now, now),
  ])
  if (!eventResult?.results.length)
    throw new ApiFailure("NOT_FOUND", 404, "This event is unavailable.")
  const campaign = campaignResult?.results[0] as CampaignTerms | undefined
  if (!campaign)
    throw new ApiFailure("PROMO_INVALID", 400, "This campaign is unavailable.")
  return resolveCampaignResponseSchema.parse({
    eventId,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      discount:
        campaign.discount_kind === "percentage"
          ? { kind: "percentage", basisPoints: campaign.discount_value }
          : { kind: "fixed", amountMinor: campaign.discount_value },
      startsAt: new Date(campaign.starts_at).toISOString(),
      endsAt: new Date(campaign.ends_at).toISOString(),
      applicableTicketTypeIds: JSON.parse(campaign.ticket_type_ids),
    },
    serverNow: new Date(now).toISOString(),
  })
}
