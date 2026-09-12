CREATE TRIGGER payout_scope_insert BEFORE INSERT ON simulated_payouts
WHEN NOT EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.organizer_id = NEW.organizer_id
  AND NEW.eligible_at = e.ends_at + 604800000)
BEGIN SELECT RAISE(ABORT, 'payout_scope'); END;
--> statement-breakpoint
CREATE TRIGGER payout_immutable BEFORE UPDATE ON simulated_payouts
BEGIN SELECT RAISE(ABORT, 'payout_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER payout_item_scope_insert BEFORE INSERT ON simulated_payout_items
WHEN NOT EXISTS (
  SELECT 1 FROM simulated_payouts payout JOIN orders o ON o.id = NEW.order_id
  JOIN reservations held ON held.order_id = o.id AND held.payment_attempt_id = NEW.payment_attempt_id AND held.state = 'consumed'
  JOIN payment_attempts p ON p.id = held.payment_attempt_id
  WHERE payout.id = NEW.payout_id AND payout.event_id = o.event_id
    AND o.state = 'completed' AND o.completed_at IS NOT NULL AND o.admission_blocked_at IS NULL
    AND p.purpose = 'ticket_order' AND p.subject_id = o.id AND p.actor_id = o.account_id AND p.state = 'succeeded'
    AND p.amount_minor = o.total_minor AND p.currency = 'KZT' AND o.currency = p.currency
    AND NEW.paid_minor = o.total_minor AND NEW.processing_fee_minor = o.processing_fee_minor
    AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id = p.id)
    AND (SELECT COUNT(*) FROM simulated_payout_items item WHERE item.payout_id = payout.id) < payout.order_count
    AND NEW.contribution_minor + (SELECT COALESCE(SUM(item.contribution_minor), 0)
      FROM simulated_payout_items item WHERE item.payout_id = payout.id) <= payout.amount_minor
)
BEGIN SELECT RAISE(ABORT, 'payout_item_scope'); END;
--> statement-breakpoint
CREATE TRIGGER payout_item_immutable BEFORE UPDATE ON simulated_payout_items
BEGIN SELECT RAISE(ABORT, 'payout_item_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER payout_adjustment_scope_insert BEFORE INSERT ON simulated_payout_adjustments
WHEN NOT EXISTS (SELECT 1 FROM simulated_payout_items item JOIN refunds r ON r.payment_attempt_id = item.payment_attempt_id
  WHERE item.id = NEW.payout_item_id AND r.id = NEW.refund_id AND r.state = 'succeeded'
    AND r.confirmed_at IS NOT NULL AND r.amount_minor = item.paid_minor
    AND NEW.amount_minor = -item.contribution_minor AND NEW.created_at >= r.confirmed_at)
BEGIN SELECT RAISE(ABORT, 'payout_adjustment_scope'); END;
--> statement-breakpoint
CREATE TRIGGER payout_adjustment_immutable BEFORE UPDATE ON simulated_payout_adjustments
BEGIN SELECT RAISE(ABORT, 'payout_adjustment_immutable'); END;
