INSERT INTO activation_settings (id, fee_minor, currency, revision, updated_at, updated_by)
VALUES ('default', 500000, 'KZT', 0, CAST(unixepoch('subsecond') * 1000 AS INTEGER), 'system:activation-defaults');
--> statement-breakpoint
CREATE TRIGGER immutable_activation_attempt_update BEFORE UPDATE ON activation_attempts
BEGIN SELECT RAISE(ABORT, 'ELC invariant: immutable_activation_attempt'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_activation_history_update BEFORE UPDATE ON activation_checklist_history
BEGIN SELECT RAISE(ABORT, 'ELC invariant: immutable_activation_history'); END;
--> statement-breakpoint
CREATE TRIGGER activation_attempt_binding BEFORE INSERT ON activation_attempts
WHEN NOT EXISTS (SELECT 1 FROM payment_attempts pa JOIN event_activations a ON a.event_id = NEW.event_id
  JOIN events e ON e.id = a.event_id WHERE pa.id = NEW.payment_attempt_id
  AND pa.purpose = 'event_activation' AND pa.subject_id = e.id AND pa.actor_id = e.organizer_id
  AND pa.amount_minor = NEW.fee_minor AND pa.currency = NEW.currency AND pa.request_json IS NOT NULL
  AND a.revision = NEW.checklist_revision AND a.terms_version = NEW.terms_version
  AND a.successful_payment_attempt_id IS NULL)
  OR EXISTS (SELECT 1 FROM activation_attempts aa JOIN payment_attempts pa ON pa.id = aa.payment_attempt_id
    WHERE aa.event_id = NEW.event_id AND NOT (
      (pa.state IN ('failed', 'cancelled') AND pa.provider_payment_id IS NULL AND pa.dispatch_state = 'reconciled')
      OR EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id = pa.id AND r.state = 'succeeded'
        AND r.amount_minor = pa.amount_minor)))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: activation_attempt_binding'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_activation_success BEFORE UPDATE ON event_activations
WHEN NEW.event_id IS NOT OLD.event_id
  OR (OLD.successful_payment_attempt_id IS NOT NULL AND
    (NEW.successful_payment_attempt_id IS NOT OLD.successful_payment_attempt_id OR NEW.activated_at IS NOT OLD.activated_at))
  OR (NEW.successful_payment_attempt_id IS NOT NULL AND OLD.successful_payment_attempt_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM payment_attempts pa JOIN activation_attempts aa ON aa.payment_attempt_id = pa.id
    WHERE pa.id = NEW.successful_payment_attempt_id AND pa.purpose = 'event_activation' AND pa.subject_id = NEW.event_id
    AND aa.event_id = NEW.event_id AND aa.checklist_revision = OLD.revision
    AND pa.state = 'succeeded' AND pa.succeeded_at IS NOT NULL AND pa.provider_order_id IS NOT NULL
    AND pa.provider_payment_id IS NOT NULL AND pa.amount_minor = aa.fee_minor AND pa.currency = aa.currency
    AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id = pa.id)))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: immutable_activation_success'); END;
--> statement-breakpoint
CREATE TRIGGER activation_success_insert BEFORE INSERT ON event_activations
WHEN NEW.successful_payment_attempt_id IS NOT NULL OR NEW.activated_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'ELC invariant: immutable_activation_success'); END;
--> statement-breakpoint
CREATE TRIGGER activation_revision_guard BEFORE UPDATE ON event_activations
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'ELC invariant: activation_revision'); END;
--> statement-breakpoint
CREATE TRIGGER activation_refund_exclusion BEFORE INSERT ON refunds
WHEN EXISTS (SELECT 1 FROM event_activations WHERE successful_payment_attempt_id = NEW.payment_attempt_id)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: activation_nonrefundable'); END;
--> statement-breakpoint
CREATE TRIGGER activation_refund_update_exclusion BEFORE UPDATE ON refunds
WHEN EXISTS (SELECT 1 FROM event_activations WHERE successful_payment_attempt_id = NEW.payment_attempt_id)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: activation_nonrefundable'); END;
--> statement-breakpoint
CREATE TRIGGER activation_email_demote AFTER UPDATE OF email_verified, email ON user
WHEN NEW.email_verified = 0 OR NEW.email IS NOT OLD.email
BEGIN
  UPDATE events SET paid_sales_state = 'pending', revision = revision + 1
  WHERE organizer_id = NEW.id AND paid_sales_state = 'active';
END;
--> statement-breakpoint
CREATE TRIGGER activation_suspended_profile_insert AFTER INSERT ON profiles
WHEN NEW.suspended_at IS NOT NULL
BEGIN
  UPDATE events SET paid_sales_state = 'pending', revision = revision + 1
  WHERE organizer_id = NEW.user_id AND paid_sales_state = 'active';
END;
--> statement-breakpoint
CREATE TRIGGER activation_suspended_profile_update AFTER UPDATE OF suspended_at ON profiles
WHEN NEW.suspended_at IS NOT NULL
BEGIN
  UPDATE events SET paid_sales_state = 'pending', revision = revision + 1
  WHERE organizer_id = NEW.user_id AND paid_sales_state = 'active';
END;
