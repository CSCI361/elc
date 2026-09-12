export type SqlPredicate = { predicate: string; bindings: unknown[] }

/** Recheck the purchaser and private invitation in the committing transaction. */
export function purchaseEligibilitySql(
  actorId: string,
  eventId: string,
  now: number
): SqlPredicate {
  return {
    predicate: `EXISTS (
      SELECT 1 FROM events e JOIN user u ON u.id = ?
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE e.id = ? AND u.email_verified = 1 AND p.suspended_at IS NULL
      AND e.publication_state = 'published' AND e.suspended_at IS NULL
      AND e.cancelled_at IS NULL AND e.ends_at > ?
      AND e.registration_opens_at <= ? AND e.registration_closes_at > ?
      AND (e.visibility <> 'private' OR EXISTS (
        SELECT 1 FROM invitations i WHERE i.event_id = e.id
        AND i.accepted_by = u.id AND lower(i.email) = lower(u.email)
        AND i.revoked_at IS NULL AND i.accepted_at IS NOT NULL
        AND i.accepted_at <= ? AND i.accepted_at < i.expires_at
        AND i.accepted_at < e.ends_at
      )))`,
    bindings: [actorId, eventId, now, now, now, now],
  }
}

/** Revision prevents an older tab from changing or completing a newer basket. */
export function activeCheckoutSql(
  actorId: string,
  orderId: string,
  revision: number,
  now: number,
  options: { allowPaymentAttempt?: boolean } = {}
): SqlPredicate {
  return {
    predicate: `EXISTS (SELECT 1 FROM orders o JOIN reservations r ON r.order_id = o.id
      WHERE o.id = ? AND o.account_id = ? AND o.state = 'pending' AND o.revision = ?
      AND r.state = 'active' AND r.expires_at > ?
      ${options.allowPaymentAttempt ? "" : `AND NOT EXISTS (SELECT 1 FROM payment_attempts p WHERE p.purpose = 'ticket_order' AND p.subject_id = o.id)`})`,
    bindings: [orderId, actorId, revision, now],
  }
}
