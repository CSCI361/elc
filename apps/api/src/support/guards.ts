import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import type { SqlPredicate } from "../orders/guards"

type AccessMode = "read" | "manage"

/** The alias is server-authored SQL. This expression binds exactly one actor ID. */
export function supportAccessExpression(
  alias: "c" | "sc",
  mode: AccessMode = "read"
) {
  return `EXISTS (SELECT 1 FROM user support_actor LEFT JOIN profiles support_profile ON support_profile.user_id = support_actor.id
    WHERE support_actor.id = ? AND support_actor.email_verified = 1 AND support_profile.suspended_at IS NULL AND (
      ${mode === "read" ? `${alias}.requester_id = support_actor.id OR` : ""}
      EXISTS (SELECT 1 FROM platform_grants support_platform WHERE support_platform.user_id = support_actor.id
        AND support_platform.permission IN ('platform:support', 'platform:moderate'))
      OR (${alias}.audience = 'attendee' AND (
        EXISTS (SELECT 1 FROM events support_event WHERE support_event.id = ${alias}.event_id AND support_event.organizer_id = support_actor.id)
        OR EXISTS (SELECT 1 FROM event_permissions support_grant WHERE support_grant.event_id = ${alias}.event_id
          AND support_grant.user_id = support_actor.id AND support_grant.permission = 'support:manage' AND support_grant.revoked_at IS NULL)
      ))
    ))`
}

/** Assignment alone never grants access; reuse this in transactions and later live delivery. */
export function supportCaseAccessSql(
  actorId: string,
  caseId: string,
  mode: AccessMode = "read"
): SqlPredicate {
  return {
    predicate: `EXISTS (SELECT 1 FROM support_cases c WHERE c.id = ? AND ${supportAccessExpression("c", mode)})`,
    bindings: [caseId, actorId],
  }
}

/** Refund permission can act on a validated reference without exposing the conversation. */
export function voluntaryRefundSupportSql(
  actorId: string,
  caseId: string,
  orderId: string
): SqlPredicate {
  return {
    predicate: `EXISTS (SELECT 1 FROM support_cases c JOIN orders o ON o.id = c.order_id JOIN events e ON e.id = o.event_id
      JOIN user u ON u.id = ? LEFT JOIN profiles p ON p.user_id = u.id
      WHERE c.id = ? AND o.id = ? AND c.audience = 'attendee' AND c.category = 'refund' AND c.status <> 'resolved'
        AND c.event_id = o.event_id AND c.requester_id = o.account_id
        AND u.email_verified = 1 AND p.suspended_at IS NULL
        AND (e.organizer_id = u.id OR EXISTS (SELECT 1 FROM event_permissions refund_grant
          WHERE refund_grant.event_id = e.id AND refund_grant.user_id = u.id AND refund_grant.permission = 'refund:initiate' AND refund_grant.revoked_at IS NULL)))`,
    bindings: [actorId, caseId, orderId],
  }
}

export async function requireVoluntaryRefundSupport(
  db: D1Database,
  actorId: string,
  caseId: string,
  orderId: string
) {
  await requireActiveAccount(db, actorId)
  const guard = voluntaryRefundSupportSql(actorId, caseId, orderId)
  const result = await db
    .prepare(`SELECT 1 WHERE ${guard.predicate}`)
    .bind(...guard.bindings)
    .first()
  if (!result)
    throw new ApiFailure(
      "REFUND_INELIGIBLE",
      409,
      "An unresolved refund request for this order and current refund permission are required."
    )
  return guard
}

/** Pending financial records are an additional hold source, checked by the payout service. */
export function unresolvedOrderSupportSql(orderId: string): SqlPredicate {
  return {
    predicate:
      "EXISTS (SELECT 1 FROM support_cases WHERE order_id = ? AND status <> 'resolved' AND category IN ('refund', 'dispute', 'compensation'))",
    bindings: [orderId],
  }
}

/** An event-only request follows event read access; an owned order remains supportable after unpublishing. */
export function supportEventReadSql(
  actorId: string,
  eventId: string
): SqlPredicate {
  return {
    predicate: `EXISTS (SELECT 1 FROM events e JOIN user u ON u.id = ? LEFT JOIN profiles p ON p.user_id = u.id
      WHERE e.id = ? AND u.email_verified = 1 AND p.suspended_at IS NULL AND (
        (e.visibility <> 'private' AND e.publication_state = 'published' AND e.suspended_at IS NULL)
        OR e.organizer_id = u.id
        OR EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.event_id = e.id AND ep.user_id = u.id AND ep.revoked_at IS NULL
          AND ep.permission IN ('event:manage','support:manage','refund:initiate','ticket:scan','checkin:reverse','checkin:review','analytics:read','history:read'))
        OR EXISTS (SELECT 1 FROM platform_grants pg WHERE pg.user_id = u.id AND pg.permission = 'platform:moderate')
        OR (e.visibility = 'private' AND e.publication_state = 'published' AND e.suspended_at IS NULL AND EXISTS (
          SELECT 1 FROM invitations i WHERE i.event_id = e.id AND i.accepted_by = u.id AND lower(i.email) = lower(u.email)
          AND i.revoked_at IS NULL AND i.accepted_at IS NOT NULL AND i.accepted_at < i.expires_at AND i.accepted_at < e.ends_at
        ))
      ))`,
    bindings: [actorId, eventId],
  }
}
