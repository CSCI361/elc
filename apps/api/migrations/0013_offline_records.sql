CREATE TABLE `offline_admission_reports` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`review_state` text DEFAULT 'unresolved' NOT NULL,
	`resolution` text,
	`reviewed_at` integer,
	`reviewed_by` text,
	`reason` text,
	FOREIGN KEY (`operation_id`) REFERENCES `offline_operations`(`operation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offline_unresolved_order` ON `offline_admission_reports` (`order_id`,`review_state`);--> statement-breakpoint
CREATE TABLE `offline_admission_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`resolution` text NOT NULL,
	`reason` text NOT NULL,
	`checkin_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `offline_operations`(`operation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkin_id`) REFERENCES `checkins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offline_one_review` ON `offline_admission_reviews` (`operation_id`);--> statement-breakpoint
CREATE TABLE `offline_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`event_id` text NOT NULL,
	`label` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`registered_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`revocation_reason` text,
	`loss_reported` integer DEFAULT false NOT NULL,
	`last_sync_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offline_devices_event_account` ON `offline_devices` (`event_id`,`account_id`,`id`);--> statement-breakpoint
CREATE TABLE `offline_operations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`device_id` text NOT NULL,
	`event_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`kind` text NOT NULL,
	`original_operation_id` text,
	`device_sequence` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`reported_at` integer NOT NULL,
	`input_hash` text NOT NULL,
	`unit_hash` text NOT NULL,
	`result` text NOT NULL,
	`checkin_id` text,
	`ticket_id` text,
	`order_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `offline_devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkin_id`) REFERENCES `checkins`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offline_device_sequence` ON `offline_operations` (`device_id`,`device_sequence`);--> statement-breakpoint
CREATE INDEX `offline_operations_event` ON `offline_operations` (`event_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `offline_snapshot_tickets` (
	`snapshot_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`token_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `ticket_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `offline_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offline_snapshot_page_order` ON `offline_snapshot_tickets` (`snapshot_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `offline_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`device_id` text NOT NULL,
	`event_id` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`event_ends_at` integer NOT NULL,
	`ticket_count` integer NOT NULL,
	`key_id` text NOT NULL,
	`manifest_json` text,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `offline_devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offline_snapshots_expiry` ON `offline_snapshots` (`expires_at`);--> statement-breakpoint
CREATE INDEX `offline_snapshots_device` ON `offline_snapshots` (`device_id`,`issued_at`);
