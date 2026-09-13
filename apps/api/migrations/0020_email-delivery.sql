CREATE TABLE `delivery_fanout` (
	`source_id` text PRIMARY KEY NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`event_id` text,
	`recipient_id` text NOT NULL,
	`part_key` text DEFAULT '' NOT NULL,
	`metadata_json` text NOT NULL,
	`pdf_state` text DEFAULT 'not_required' NOT NULL,
	`email_state` text DEFAULT 'pending' NOT NULL,
	`payload_key` text,
	`payload_hash` text,
	`provider_id` text,
	`provider_status` text,
	`first_attempt_at` integer,
	`last_attempt_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_delivery_states" CHECK("email_deliveries"."pdf_state" IN ('not_required', 'pending', 'ready', 'failed') AND "email_deliveries"."email_state" IN ('pending', 'accepted', 'delivered', 'bounced', 'failed', 'suppressed', 'review_needed') AND "email_deliveries"."attempts" >= 0 AND "email_deliveries"."failures" >= 0 AND ("email_deliveries"."payload_key" IS NULL) = ("email_deliveries"."payload_hash" IS NULL) AND ("email_deliveries"."first_attempt_at" IS NULL OR ("email_deliveries"."payload_key" IS NOT NULL AND "email_deliveries"."last_attempt_at" >= "email_deliveries"."first_attempt_at")) AND ("email_deliveries"."provider_id" IS NULL OR "email_deliveries"."first_attempt_at" IS NOT NULL) AND json_valid("email_deliveries"."metadata_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_delivery_source_part` ON `email_deliveries` (`source_id`,`recipient_id`,`part_key`);--> statement-breakpoint
CREATE INDEX `email_delivery_pending` ON `email_deliveries` (`email_state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `email_delivery_event` ON `email_deliveries` (`event_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER email_delivery_identity_immutable BEFORE UPDATE OF id, source_id, kind, entity_id, event_id, recipient_id, part_key, metadata_json, created_at ON email_deliveries
BEGIN SELECT RAISE(ABORT, 'email_delivery_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER email_delivery_payload_immutable BEFORE UPDATE OF payload_key, payload_hash, first_attempt_at ON email_deliveries
WHEN OLD.first_attempt_at IS NOT NULL AND (NEW.payload_key IS NOT OLD.payload_key OR NEW.payload_hash IS NOT OLD.payload_hash OR NEW.first_attempt_at IS NOT OLD.first_attempt_at)
BEGIN SELECT RAISE(ABORT, 'email_delivery_payload_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER email_delivery_provider_immutable BEFORE UPDATE OF provider_id ON email_deliveries
WHEN OLD.provider_id IS NOT NULL AND NEW.provider_id IS NOT OLD.provider_id
BEGIN SELECT RAISE(ABORT, 'email_delivery_provider_immutable'); END;
