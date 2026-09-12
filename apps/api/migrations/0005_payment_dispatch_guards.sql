-- One frozen provider attempt funds a ticket basket. A new basket requires abandonment.
CREATE UNIQUE INDEX one_ticket_payment_attempt ON payment_attempts (subject_id) WHERE purpose = 'ticket_order';
--> statement-breakpoint
CREATE TRIGGER payment_dispatch_insert BEFORE INSERT ON payment_attempts
WHEN NEW.dispatch_state NOT IN ('prepared', 'dispatched', 'uncertain', 'reconciled')
  OR (NEW.request_json IS NOT NULL AND (json_valid(NEW.request_json) = 0 OR NEW.request_hash IS NULL OR NEW.actor_id IS NULL))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: payment_dispatch'); END;
--> statement-breakpoint
CREATE TRIGGER payment_dispatch_update BEFORE UPDATE ON payment_attempts
WHEN NEW.dispatch_state NOT IN ('prepared', 'dispatched', 'uncertain', 'reconciled')
  OR (OLD.dispatch_state <> 'prepared' AND NEW.dispatch_state = 'prepared')
  OR (OLD.state = 'succeeded' AND NEW.state <> 'succeeded')
  OR NEW.actor_id IS NOT OLD.actor_id OR NEW.request_hash IS NOT OLD.request_hash OR NEW.request_json IS NOT OLD.request_json
  OR (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS NOT OLD.provider_payment_id)
  OR (OLD.provider_order_id IS NOT NULL AND NEW.provider_order_id IS NOT OLD.provider_order_id)
  OR (OLD.checkout_url IS NOT NULL AND NEW.checkout_url IS NOT OLD.checkout_url)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: payment_dispatch'); END;
--> statement-breakpoint
CREATE TRIGGER refund_dispatch_insert BEFORE INSERT ON refunds
WHEN NEW.dispatch_state NOT IN ('prepared', 'dispatched', 'uncertain', 'reconciled')
  OR (NEW.request_json IS NOT NULL AND json_valid(NEW.request_json) = 0)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: refund_dispatch'); END;
--> statement-breakpoint
CREATE TRIGGER refund_dispatch_update BEFORE UPDATE ON refunds
WHEN NEW.dispatch_state NOT IN ('prepared', 'dispatched', 'uncertain', 'reconciled')
  OR (OLD.dispatch_state <> 'prepared' AND NEW.dispatch_state = 'prepared')
  OR (OLD.state = 'succeeded' AND NEW.state <> 'succeeded')
  OR (OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS NOT OLD.provider_refund_id)
  OR NEW.request_json IS NOT OLD.request_json
BEGIN SELECT RAISE(ABORT, 'ELC invariant: refund_dispatch'); END;
