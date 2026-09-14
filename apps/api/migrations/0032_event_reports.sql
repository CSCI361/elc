CREATE TABLE `event_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`category` text NOT NULL,
	`details` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`resolved_by` text,
	`resolution_reason` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_report_values" CHECK(length(trim("event_reports"."details")) BETWEEN 1 AND 1000 AND "event_reports"."revision" > 0 AND "event_reports"."updated_at" >= "event_reports"."created_at" AND (("event_reports"."state" = 'open' AND "event_reports"."resolved_at" IS NULL AND "event_reports"."resolved_by" IS NULL AND "event_reports"."resolution_reason" IS NULL) OR ("event_reports"."state" <> 'open' AND "event_reports"."resolved_at" IS NOT NULL AND "event_reports"."resolved_by" IS NOT NULL AND length(trim("event_reports"."resolution_reason")) BETWEEN 1 AND 500)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_reports_open_reporter` ON `event_reports` (`event_id`,`reporter_id`) WHERE "event_reports"."state" = 'open';--> statement-breakpoint
CREATE INDEX `event_reports_queue` ON `event_reports` (`state`,`id`);--> statement-breakpoint
CREATE INDEX `event_reports_event_state` ON `event_reports` (`event_id`,`state`);--> statement-breakpoint
CREATE INDEX `event_reports_reporter` ON `event_reports` (`reporter_id`);