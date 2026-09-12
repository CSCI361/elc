CREATE TABLE `support_case_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`message_id` text,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `support_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `support_messages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "support_change_values" CHECK("support_case_changes"."sequence" >= 1 AND "support_case_changes"."kind" IN ('created', 'message', 'assignment', 'status') AND json_valid("support_case_changes"."before_json") = 1 AND json_valid("support_case_changes"."after_json") = 1 AND json_type("support_case_changes"."before_json") = 'object' AND json_type("support_case_changes"."after_json") = 'object' AND ("support_case_changes"."kind" IN ('created', 'message')) = ("support_case_changes"."message_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_case_changes_message_id_unique` ON `support_case_changes` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_change_sequence` ON `support_case_changes` (`case_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `support_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`audience` text NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`event_id` text,
	`order_id` text,
	`ticket_id` text,
	`assignee_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_sequence` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "support_case_domain" CHECK("support_cases"."audience" IN ('attendee', 'organizer_platform') AND "support_cases"."status" IN ('open', 'in_progress', 'waiting_for_customer', 'resolved') AND "support_cases"."category" IN ('ticket_delivery', 'payment', 'refund', 'seating', 'event_information', 'check_in', 'account', 'activation', 'technical', 'dispute', 'compensation') AND length(trim("support_cases"."subject")) BETWEEN 1 AND 160 AND "support_cases"."revision" >= 1 AND "support_cases"."last_sequence" = "support_cases"."revision" AND "support_cases"."updated_at" >= "support_cases"."created_at" AND ("support_cases"."status" = 'resolved') = ("support_cases"."resolved_at" IS NOT NULL) AND ("support_cases"."resolved_at" IS NULL OR "support_cases"."resolved_at" BETWEEN "support_cases"."created_at" AND "support_cases"."updated_at")),
	CONSTRAINT "support_case_context" CHECK(("support_cases"."ticket_id" IS NULL OR "support_cases"."order_id" IS NOT NULL) AND ("support_cases"."order_id" IS NULL OR "support_cases"."event_id" IS NOT NULL) AND ("support_cases"."audience" <> 'attendee' OR "support_cases"."event_id" IS NOT NULL) AND ("support_cases"."category" NOT IN ('refund', 'dispute', 'compensation') OR "support_cases"."order_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `support_requester_created` ON `support_cases` (`requester_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `support_event_created` ON `support_cases` (`event_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `support_assignee_created` ON `support_cases` (`assignee_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `support_order_resolution` ON `support_cases` (`order_id`,`status`,`category`);--> statement-breakpoint
CREATE TABLE `support_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `support_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "support_message_values" CHECK("support_messages"."sequence" >= 1 AND length(trim("support_messages"."body")) BETWEEN 1 AND 8000 AND length("support_messages"."author_name") BETWEEN 1 AND 256)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_message_sequence` ON `support_messages` (`case_id`,`sequence`);