CREATE TABLE `support_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`message_id` text,
	`position` integer,
	`upload_request_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`safe_filename` text NOT NULL,
	`declared_type` text NOT NULL,
	`original_size` integer NOT NULL,
	`original_sha256` text NOT NULL,
	`quarantine_key` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text,
	`content_size` integer,
	`content_sha256` text,
	`validator_version` text NOT NULL,
	`status` text NOT NULL,
	`rejection_code` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`validated_at` integer,
	`attached_at` integer,
	`deleted_at` integer,
	`cleanup_after` integer,
	FOREIGN KEY (`case_id`) REFERENCES `support_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `support_messages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "support_attachment_domain" CHECK("support_attachments"."status" IN ('quarantined','ready','attached','rejected','deleting','deleted') AND "support_attachments"."declared_type" IN ('image/jpeg','image/png','application/pdf') AND "support_attachments"."original_size" BETWEEN 1 AND 5242880 AND length("support_attachments"."safe_filename") BETWEEN 1 AND 160 AND length("support_attachments"."input_hash") = 64 AND length("support_attachments"."original_sha256") = 64 AND "support_attachments"."expires_at" > "support_attachments"."created_at" AND "support_attachments"."expires_at" <= "support_attachments"."created_at" + 86400000 AND ("support_attachments"."content_type" IS NULL OR "support_attachments"."content_type" = "support_attachments"."declared_type") AND ("support_attachments"."content_size" IS NULL OR "support_attachments"."content_size" BETWEEN 1 AND 5242880) AND ("support_attachments"."content_sha256" IS NULL OR length("support_attachments"."content_sha256") = 64)),
	CONSTRAINT "support_attachment_ready" CHECK("support_attachments"."status" NOT IN ('ready','attached') OR ("support_attachments"."content_type" IS NOT NULL AND "support_attachments"."content_size" IS NOT NULL AND "support_attachments"."content_sha256" IS NOT NULL AND "support_attachments"."validated_at" IS NOT NULL AND "support_attachments"."rejection_code" IS NULL)),
	CONSTRAINT "support_attachment_link" CHECK(("support_attachments"."message_id" IS NULL AND "support_attachments"."position" IS NULL AND "support_attachments"."attached_at" IS NULL AND "support_attachments"."status" <> 'attached') OR ("support_attachments"."message_id" IS NOT NULL AND "support_attachments"."position" IS NOT NULL AND "support_attachments"."position" BETWEEN 0 AND 2 AND "support_attachments"."attached_at" IS NOT NULL AND "support_attachments"."status" = 'attached')),
	CONSTRAINT "support_attachment_deleted" CHECK(("support_attachments"."status" = 'deleted') = ("support_attachments"."deleted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_attachments_quarantine_key_unique` ON `support_attachments` (`quarantine_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_attachments_object_key_unique` ON `support_attachments` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_upload_request` ON `support_attachments` (`uploader_id`,`upload_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_attachment_position` ON `support_attachments` (`message_id`,`position`) WHERE "support_attachments"."message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `support_upload_cleanup` ON `support_attachments` (`cleanup_after`,`status`);--> statement-breakpoint
CREATE INDEX `support_attachment_message` ON `support_attachments` (`case_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `support_upload_uploader` ON `support_attachments` (`uploader_id`,`status`);