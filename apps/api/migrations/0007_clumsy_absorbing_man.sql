CREATE TABLE `activation_attempts` (
	`payment_attempt_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`checklist_revision` integer NOT NULL,
	`fee_settings_revision` integer NOT NULL,
	`fee_minor` integer NOT NULL,
	`currency` text DEFAULT 'KZT' NOT NULL,
	`checklist_snapshot_json` text NOT NULL,
	`terms_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `event_activations`(`event_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "activation_attempt_values" CHECK("activation_attempts"."checklist_revision" >= 0 AND "activation_attempts"."fee_settings_revision" >= 0 AND "activation_attempts"."fee_minor" >= 30000 AND "activation_attempts"."currency" = 'KZT' AND json_valid("activation_attempts"."checklist_snapshot_json") = 1)
);
--> statement-breakpoint
CREATE INDEX `activation_event_attempts` ON `activation_attempts` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `activation_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`fee_minor` integer DEFAULT 500000 NOT NULL,
	`currency` text DEFAULT 'KZT' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	CONSTRAINT "activation_settings_values" CHECK("activation_settings"."id" = 'default' AND "activation_settings"."fee_minor" >= 30000 AND "activation_settings"."fee_minor" <= 100000000 AND "activation_settings"."currency" = 'KZT' AND "activation_settings"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `event_activations` (
	`event_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`display_name` text NOT NULL,
	`legal_name` text NOT NULL,
	`contact` text NOT NULL,
	`dummy_payout_reference` text NOT NULL,
	`profile_updated_at` integer NOT NULL,
	`email_checked_at` integer NOT NULL,
	`identity_check` text DEFAULT 'pending' NOT NULL,
	`identity_checked_at` integer,
	`payout_check` text DEFAULT 'pending' NOT NULL,
	`payout_checked_at` integer,
	`terms_version` text,
	`terms_accepted_at` integer,
	`successful_payment_attempt_id` text,
	`activated_at` integer,
	`suspended_at` integer,
	`suspension_reason` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`successful_payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "activation_values" CHECK("event_activations"."revision" >= 0 AND "event_activations"."identity_check" IN ('pending', 'passed', 'failed') AND "event_activations"."payout_check" IN ('pending', 'passed', 'failed') AND ("event_activations"."successful_payment_attempt_id" IS NULL) = ("event_activations"."activated_at" IS NULL) AND ("event_activations"."terms_version" IS NULL) = ("event_activations"."terms_accepted_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_activations_successful_payment_attempt_id_unique` ON `event_activations` (`successful_payment_attempt_id`);