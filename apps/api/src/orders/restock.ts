import { paidSalesEligibilitySql } from "../activation/guards"

/** Run inside the cancellation/refund commit; every eligibility fact is read by D1. */
export function restockOrderInventory(
  db: D1Database,
  orderId: string,
  eventId: string,
  now: number,
  injectedClock = false
) {
  const paid = paidSalesEligibilitySql(eventId, now, injectedClock)
  const timestamp = "CAST(unixepoch('subsecond') * 1000 AS INTEGER)"
  const marker = crypto.randomUUID()
  // Keep each expression below D1's depth limit. The temporary eligibility marker
  // exists only inside the caller's atomic batch and is removed before commit.
  return [
    db
      .prepare(
        `INSERT INTO transition_guards (id, valid) SELECT ?, 1 WHERE ${paid.predicate}`
      )
      .bind(marker, ...paid.bindings),
    db
      .prepare(`UPDATE inventory SET order_id = NULL, reservation_id = NULL WHERE order_id = ? AND event_id = ? AND enabled = 1
    AND EXISTS (SELECT 1 FROM events e JOIN ticket_types t ON t.event_id = e.id
      WHERE e.id = inventory.event_id AND t.id = inventory.ticket_type_id
      AND e.publication_state = 'published' AND e.cancelled_at IS NULL AND e.suspended_at IS NULL
      AND e.ends_at > ? AND e.registration_opens_at <= ? AND e.registration_closes_at > ?
      AND t.hidden = 0 AND t.sales_start_at <= ? AND t.sales_end_at > ?
      AND (t.kind = 'free' OR EXISTS (SELECT 1 FROM transition_guards WHERE id = ?))
      ${
        injectedClock
          ? ""
          : `AND e.ends_at > ${timestamp} AND e.registration_opens_at <= ${timestamp}
        AND e.registration_closes_at > ${timestamp} AND t.sales_start_at <= ${timestamp} AND t.sales_end_at > ${timestamp}`
      })`)
      .bind(orderId, eventId, now, now, now, now, now, marker),
    db.prepare("DELETE FROM transition_guards WHERE id = ?").bind(marker),
  ]
}
