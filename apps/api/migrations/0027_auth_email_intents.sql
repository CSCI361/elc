CREATE TABLE `account_activity` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_sign_in_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_email_intents` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`encrypted_payload` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`delivery_id`) REFERENCES `email_deliveries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_email_lifetime" CHECK("auth_email_intents"."expires_at" > "auth_email_intents"."created_at" AND "auth_email_intents"."expires_at" <= "auth_email_intents"."created_at" + 3600000)
);
--> statement-breakpoint
CREATE INDEX `auth_email_expiry` ON `auth_email_intents` (`expires_at`);--> statement-breakpoint
CREATE TRIGGER auth_email_intent_identity_immutable BEFORE UPDATE OF delivery_id, expires_at, created_at ON auth_email_intents
BEGIN SELECT RAISE(ABORT, 'auth_email_intent_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER auth_email_intent_payload_clear_only BEFORE UPDATE OF encrypted_payload ON auth_email_intents
WHEN NEW.encrypted_payload IS NOT NULL AND NEW.encrypted_payload IS NOT OLD.encrypted_payload
BEGIN SELECT RAISE(ABORT, 'auth_email_intent_payload_clear_only'); END;
--> statement-breakpoint
-- Older sign-in history cannot be reconstructed after sessions expire. Give existing
-- accounts a full retention period from rollout instead of guessing inactivity.
INSERT INTO account_activity(user_id,last_sign_in_at)
SELECT id,MAX(created_at,CAST(strftime('%s','now') AS INTEGER)*1000) FROM user;
