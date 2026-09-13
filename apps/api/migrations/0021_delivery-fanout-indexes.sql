CREATE INDEX `event_permissions_delivery` ON `event_permissions` (`event_id`,`permission`,`user_id`);--> statement-breakpoint
CREATE INDEX `orders_delivery_recipients` ON `orders` (`event_id`,`completed_at`,`id`);--> statement-breakpoint
CREATE INDEX `outbox_kind_pending` ON `outbox` (`kind`,`completed_at`,`next_attempt_at`,`id`);--> statement-breakpoint
CREATE INDEX `platform_grants_delivery` ON `platform_grants` (`permission`,`user_id`);--> statement-breakpoint
CREATE INDEX `tickets_delivery_parts` ON `tickets` (`event_id`,`order_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER email_delivery_attempt_insert BEFORE INSERT ON email_deliveries
WHEN (NEW.first_attempt_at IS NOT NULL AND (NEW.last_attempt_at IS NULL OR NEW.last_attempt_at < NEW.first_attempt_at)) OR (NEW.email_state='accepted' AND NEW.provider_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'email_delivery_attempt_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER email_delivery_attempt_update BEFORE UPDATE OF first_attempt_at,last_attempt_at,provider_id,email_state ON email_deliveries
WHEN (NEW.first_attempt_at IS NOT NULL AND (NEW.last_attempt_at IS NULL OR NEW.last_attempt_at < NEW.first_attempt_at)) OR (OLD.last_attempt_at IS NOT NULL AND (NEW.last_attempt_at IS NULL OR NEW.last_attempt_at < OLD.last_attempt_at)) OR (NEW.email_state='accepted' AND NEW.provider_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'email_delivery_attempt_invalid'); END;
