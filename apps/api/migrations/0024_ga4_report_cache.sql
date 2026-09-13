CREATE TABLE `ga4_reports` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`result_json` text,
	`fetched_at` integer,
	`expires_at` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`touched_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ga4_reports_payload_size" CHECK("ga4_reports"."result_json" IS NULL OR length("ga4_reports"."result_json") <= 262144)
);
--> statement-breakpoint
CREATE INDEX `ga4_reports_event` ON `ga4_reports` (`event_id`,`touched_at`,`cache_key`);--> statement-breakpoint
CREATE INDEX `ga4_reports_cleanup` ON `ga4_reports` (`touched_at`);