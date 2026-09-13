/** Every report statement independently selects the same currently authorized event. */
export const reportAccess = `EXISTS (SELECT 1 FROM user actor LEFT JOIN profiles profile ON profile.user_id = actor.id
  WHERE actor.id = ? AND actor.email_verified = 1 AND profile.suspended_at IS NULL
  AND (e.organizer_id = actor.id OR EXISTS (SELECT 1 FROM event_permissions ep
    WHERE ep.event_id = e.id AND ep.user_id = actor.id AND ep.permission = 'analytics:read' AND ep.revoked_at IS NULL)))`

// Bound parameters: event, zone, actor, date start/end, type id (or null).
export const reportContext = `WITH authorized_event AS (
  SELECT e.* FROM events e WHERE e.id = ? AND e.time_zone = ? AND ${reportAccess}
), filters AS (SELECT ? AS starts, ? AS ends, ? AS type_id)`

/**
 * Fees were rounded once for each order using its frozen basis-point rate.
 * Allocate whole minor units to items by largest remainder, ties by item ID.
 * Splitting at 10,000 avoids overflowing integer multiplication for safe amounts.
 * All items participate before the ticket-type filter, so filtering cannot move a fee.
 */
export const salesEntries = `${reportContext}, selected_orders AS (
  SELECT o.id FROM authorized_event e CROSS JOIN filters f CROSS JOIN orders o INDEXED BY orders_reporting ON o.event_id = e.id
    WHERE o.completed_at >= f.starts AND o.completed_at < f.ends
  UNION
  SELECT o.id FROM authorized_event e CROSS JOIN filters f CROSS JOIN refunds r INDEXED BY refund_confirmation_reporting
    CROSS JOIN payment_attempts p ON p.id = r.payment_attempt_id AND p.purpose = 'ticket_order'
    CROSS JOIN orders o ON o.id = p.subject_id AND o.event_id = e.id
    WHERE r.state = 'succeeded' AND r.confirmed_at >= f.starts AND r.confirmed_at < f.ends AND o.completed_at IS NOT NULL
), relevant_orders AS MATERIALIZED (
  SELECT o.*, CASE WHEN r.state = 'succeeded' THEN r.confirmed_at END AS refunded_at,
    CASE WHEN a.committed_at IS NOT NULL AND a.campaign_id = o.campaign_id THEN a.campaign_id END AS attributed_campaign
  FROM selected_orders selected CROSS JOIN orders o ON o.id = selected.id
  LEFT JOIN reservations reservation ON reservation.order_id = o.id
  LEFT JOIN refunds r ON r.payment_attempt_id = reservation.payment_attempt_id
  LEFT JOIN promo_allocations a ON a.order_id = o.id
), fee_floors AS (
  SELECT item.*, o.completed_at, o.refunded_at, o.attributed_campaign, o.processing_fee_minor AS order_fee,
    (item.total_minor / 10000) * o.processing_fee_basis_points
      + ((item.total_minor % 10000) * o.processing_fee_basis_points) / 10000 AS fee_floor,
    ((item.total_minor % 10000) * o.processing_fee_basis_points) % 10000 AS fee_remainder
  FROM relevant_orders o CROSS JOIN order_items item ON item.order_id = o.id
), allocated_items AS (
  SELECT *, fee_floor + CASE WHEN ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY fee_remainder DESC, id)
    <= order_fee - SUM(fee_floor) OVER (PARTITION BY order_id) THEN 1 ELSE 0 END AS item_fee
  FROM fee_floors
), entries AS (
  SELECT item.*, 'sale' AS kind, item.completed_at AS recorded_at FROM allocated_items item CROSS JOIN filters f
  WHERE item.completed_at >= f.starts AND item.completed_at < f.ends AND (f.type_id IS NULL OR item.ticket_type_id = f.type_id)
  UNION ALL
  SELECT item.*, 'refund' AS kind, item.refunded_at AS recorded_at FROM allocated_items item CROSS JOIN filters f
  WHERE item.refunded_at >= f.starts AND item.refunded_at < f.ends AND (f.type_id IS NULL OR item.ticket_type_id = f.type_id)
)`

/** Works with a left join too, yielding exact zero metrics for empty buckets. */
export const metricSelection = `
  COUNT(DISTINCT CASE WHEN entry.kind = 'sale' THEN entry.order_id END) completed_orders,
  COALESCE(SUM(CASE WHEN entry.kind = 'sale' THEN entry.quantity ELSE 0 END), 0) tickets_issued,
  COALESCE(SUM(CASE WHEN entry.kind = 'sale' THEN entry.subtotal_minor ELSE 0 END), 0) gross,
  COALESCE(SUM(CASE WHEN entry.kind = 'sale' THEN entry.discount_minor ELSE 0 END), 0) discount,
  COALESCE(SUM(CASE WHEN entry.kind = 'refund' THEN entry.quantity ELSE 0 END), 0) refunded_tickets,
  COALESCE(SUM(CASE WHEN entry.kind = 'refund' THEN entry.total_minor ELSE 0 END), 0) refunded,
  COALESCE(SUM(CASE WHEN entry.kind = 'sale' THEN entry.item_fee ELSE 0 END), 0) fee,
  COALESCE(SUM(CASE WHEN entry.kind = 'refund' THEN entry.item_fee ELSE 0 END), 0) fee_reversed,
  COUNT(DISTINCT CASE WHEN entry.kind = 'sale' AND entry.attributed_campaign IS NOT NULL THEN entry.order_id END) redemptions`

export const currentState = `${reportContext}, inventory_counts AS (
  SELECT COUNT(*) enabled,
    COALESCE(SUM(CASE WHEN i.order_id IS NULL AND (r.id IS NULL OR r.state <> 'active' OR r.expires_at <= ?) THEN 1 ELSE 0 END),0) remaining,
    COALESCE(SUM(CASE WHEN i.order_id IS NULL AND r.state = 'active' AND r.expires_at > ? THEN 1 ELSE 0 END),0) reserved
  FROM authorized_event e JOIN inventory i ON i.event_id = e.id LEFT JOIN reservations r ON r.id = i.reservation_id
  CROSS JOIN filters f WHERE i.enabled = 1 AND (f.type_id IS NULL OR i.ticket_type_id = f.type_id)
), ticket_counts AS (
  SELECT COUNT(*) issued,
    COALESCE(SUM(CASE WHEN t.state IN ('valid','checked_in') THEN 1 ELSE 0 END),0) active_sold,
    COALESCE(SUM(CASE WHEN t.state = 'cancelled' THEN 1 ELSE 0 END),0) cancelled,
    COALESCE(SUM(CASE WHEN t.state = 'refunded' THEN 1 ELSE 0 END),0) refunded,
    COALESCE(SUM(CASE WHEN t.state IN ('valid','checked_in') AND o.state = 'completed' AND o.admission_blocked_at IS NULL
      AND e.cancelled_at IS NULL AND e.suspended_at IS NULL THEN 1 ELSE 0 END),0) eligible,
    COALESCE(SUM(CASE WHEN t.state IN ('valid','checked_in') AND o.state = 'completed' AND o.admission_blocked_at IS NULL
      AND e.cancelled_at IS NULL AND e.suspended_at IS NULL AND EXISTS (SELECT 1 FROM checkins ci WHERE ci.ticket_id = t.id AND ci.reversed_at IS NULL)
      THEN 1 ELSE 0 END),0) attendance
  FROM authorized_event e JOIN tickets t ON t.event_id = e.id JOIN orders o ON o.id = t.order_id
  CROSS JOIN filters f WHERE o.completed_at IS NOT NULL AND (f.type_id IS NULL OR t.ticket_type_id = f.type_id)
) SELECT inventory_counts.*, ticket_counts.*,
  CASE WHEN f.type_id IS NULL THEN e.capacity ELSE (SELECT quantity FROM ticket_types WHERE id = f.type_id AND event_id = e.id) END capacity,
  (SELECT COUNT(*) FROM offline_operations op JOIN offline_admission_reports report ON report.operation_id = op.operation_id
    JOIN tickets t ON t.id = report.ticket_id WHERE op.event_id = e.id AND report.review_state = 'unresolved'
    AND (f.type_id IS NULL OR t.ticket_type_id = f.type_id)) unresolved_offline
  FROM authorized_event e CROSS JOIN filters f CROSS JOIN inventory_counts CROSS JOIN ticket_counts`

export const otherPayments = `${reportContext} SELECT
  (SELECT COALESCE(SUM(p.amount_minor),0) FROM payment_attempts p WHERE p.purpose = 'event_activation' AND p.subject_id = e.id
    AND p.state = 'succeeded' AND p.succeeded_at >= f.starts AND p.succeeded_at < f.ends) activation_fees,
  (SELECT COALESCE(SUM(r.amount_minor),0) FROM payment_attempts p JOIN refunds r ON r.payment_attempt_id = p.id
    WHERE p.purpose = 'event_activation' AND p.subject_id = e.id AND r.state = 'succeeded'
      AND r.confirmed_at >= f.starts AND r.confirmed_at < f.ends) activation_refunds,
  (SELECT COALESCE(SUM(r.amount_minor),0) FROM orders o JOIN payment_attempts p ON p.purpose = 'ticket_order' AND p.subject_id = o.id
    JOIN refunds r ON r.payment_attempt_id = p.id WHERE o.event_id = e.id AND o.completed_at IS NULL AND r.state = 'succeeded'
      AND r.confirmed_at >= f.starts AND r.confirmed_at < f.ends) compensation
  FROM authorized_event e CROSS JOIN filters f`
