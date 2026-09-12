ALTER TABLE refunds ADD COLUMN requested_by TEXT REFERENCES user(id);
--> statement-breakpoint
ALTER TABLE refunds ADD COLUMN support_case_id TEXT REFERENCES support_cases(id);
--> statement-breakpoint
ALTER TABLE refunds ADD COLUMN authorization_reason TEXT;
--> statement-breakpoint
CREATE TRIGGER refund_authorization_insert BEFORE INSERT ON refunds
WHEN (NEW.reason = 'voluntary' AND (NEW.requested_by IS NULL OR NEW.support_case_id IS NULL OR NEW.authorization_reason IS NULL))
  OR (NEW.authorization_reason IS NOT NULL AND length(trim(NEW.authorization_reason)) NOT BETWEEN 1 AND 500)
  OR (NEW.reason <> 'voluntary' AND (NEW.requested_by IS NOT NULL OR NEW.support_case_id IS NOT NULL OR NEW.authorization_reason IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: refund_authorization'); END;
--> statement-breakpoint
CREATE TRIGGER refund_authorization_update BEFORE UPDATE ON refunds
WHEN NEW.requested_by IS NOT OLD.requested_by OR NEW.support_case_id IS NOT OLD.support_case_id
  OR NEW.authorization_reason IS NOT OLD.authorization_reason
BEGIN SELECT RAISE(ABORT, 'ELC invariant: refund_authorization_immutable'); END;
