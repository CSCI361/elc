ALTER TABLE `events` ADD `refund_instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `refund_policy_json` text DEFAULT '{"version":"academic-v1","instructions":""}' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `revision` integer DEFAULT 0 NOT NULL;