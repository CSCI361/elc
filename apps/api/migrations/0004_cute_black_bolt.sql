CREATE TABLE `provider_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`payment_attempt_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_event_identity` ON `provider_events` (`provider`,`provider_event_id`);--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `provider_order_id` text;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `actor_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `request_hash` text;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `request_json` text;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `checkout_url` text;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `dispatch_state` text DEFAULT 'prepared' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `last_error_code` text;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_order_identity` ON `payment_attempts` (`provider`,`provider_order_id`);--> statement-breakpoint
ALTER TABLE `refunds` ADD `dispatch_state` text DEFAULT 'prepared' NOT NULL;--> statement-breakpoint
ALTER TABLE `refunds` ADD `request_json` text;--> statement-breakpoint
ALTER TABLE `refunds` ADD `last_error_code` text;--> statement-breakpoint
ALTER TABLE `refunds` ADD `updated_at` integer DEFAULT 0 NOT NULL;