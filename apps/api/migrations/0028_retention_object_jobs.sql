CREATE TABLE `retention_object_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`mode` text NOT NULL,
	`object_key` text NOT NULL,
	`cursor` text,
	`created_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_swept_at` integer,
	`completed_at` integer,
	CONSTRAINT "retention_object_values" CHECK("retention_object_jobs"."bucket"='files' AND "retention_object_jobs"."mode" IN ('key','prefix') AND "retention_object_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retention_object_identity` ON `retention_object_jobs` (`bucket`,`mode`,`object_key`);--> statement-breakpoint
CREATE INDEX `retention_object_due` ON `retention_object_jobs` (`next_attempt_at`,`lease_until`);