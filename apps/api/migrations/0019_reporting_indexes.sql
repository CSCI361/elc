CREATE INDEX `audit_scope_event_time` ON `audit_entries` (`scope`,`event_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `payment_subject_reporting` ON `payment_attempts` (`purpose`,`subject_id`,`succeeded_at`);--> statement-breakpoint
CREATE INDEX `refund_confirmation_reporting` ON `refunds` (`state`,`confirmed_at`,`payment_attempt_id`);--> statement-breakpoint
CREATE TRIGGER audit_entries_immutable BEFORE UPDATE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries_immutable');
END;
