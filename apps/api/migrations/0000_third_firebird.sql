CREATE TABLE `audit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`actor_id` text,
	`scope` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text NOT NULL,
	`description` text NOT NULL,
	`correlation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_event_time` ON `audit_entries` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `campaign_ticket_types` (
	`campaign_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	PRIMARY KEY(`campaign_id`, `ticket_type_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`token_hash` text NOT NULL,
	`reporting_id` text NOT NULL,
	`discount_kind` text NOT NULL,
	`discount_value` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`max_redemptions` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaign_limit" CHECK("campaigns"."max_redemptions" > 0),
	CONSTRAINT "campaign_discount" CHECK(("campaigns"."discount_kind" = 'fixed' AND "campaigns"."discount_value" > 0) OR ("campaigns"."discount_kind" = 'percentage' AND "campaigns"."discount_value" BETWEEN 100 AND 10000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_code_unique` ON `campaigns` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_token_hash_unique` ON `campaigns` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_reporting_id_unique` ON `campaigns` (`reporting_id`);--> statement-breakpoint
CREATE INDEX `campaigns_event` ON `campaigns` (`event_id`);--> statement-breakpoint
CREATE TABLE `checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`device_id` text,
	`captured_at` integer NOT NULL,
	`committed_at` integer NOT NULL,
	`reversed_at` integer,
	`reversed_by` text,
	`reversal_reason` text,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkins_operation_id_unique` ON `checkins` (`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_admission` ON `checkins` (`ticket_id`) WHERE "checkins"."reversed_at" IS NULL;--> statement-breakpoint
CREATE TABLE `development_mail` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_permissions` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_at` integer NOT NULL,
	`revoked_at` integer,
	PRIMARY KEY(`event_id`, `user_id`, `permission`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_permissions_user` ON `event_permissions` (`user_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`organizer_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`venue_name` text NOT NULL,
	`venue_address` text NOT NULL,
	`time_zone` text DEFAULT 'Asia/Almaty' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`registration_opens_at` integer NOT NULL,
	`registration_closes_at` integer NOT NULL,
	`capacity` integer NOT NULL,
	`max_tickets_per_order` integer DEFAULT 6 NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`publication_state` text DEFAULT 'draft' NOT NULL,
	`paid_sales_state` text DEFAULT 'pending' NOT NULL,
	`seating_mode` text DEFAULT 'general_admission' NOT NULL,
	`venue_layout_id` text,
	`calendar_uid` text NOT NULL,
	`calendar_sequence` integer DEFAULT 0 NOT NULL,
	`reporting_id` text NOT NULL,
	`suspended_at` integer,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organizer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_dates" CHECK("events"."ends_at" > "events"."starts_at" AND "events"."registration_closes_at" > "events"."registration_opens_at"),
	CONSTRAINT "event_capacity" CHECK("events"."capacity" > 0 AND "events"."max_tickets_per_order" > 0 AND "events"."max_tickets_per_order" <= "events"."capacity")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_calendar_uid_unique` ON `events` (`calendar_uid`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_reporting_id_unique` ON `events` (`reporting_id`);--> statement-breakpoint
CREATE INDEX `events_organizer_start` ON `events` (`organizer_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `events_discovery` ON `events` (`visibility`,`publication_state`,`starts_at`);--> statement-breakpoint
CREATE TABLE `inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`section` text,
	`row` text,
	`number` text,
	`accessible` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`reservation_id` text,
	`order_id` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_event_seat` ON `inventory` (`event_id`,`section`,`row`,`number`);--> statement-breakpoint
CREATE INDEX `inventory_availability` ON `inventory` (`event_id`,`ticket_type_id`,`enabled`,`order_id`,`reservation_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`accepted_by` text,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitation_access` ON `invitations` (`event_id`,`accepted_by`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`ticket_type_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`discount_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`attendees_json` text NOT NULL,
	`seats_json` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_totals" CHECK("order_items"."quantity" > 0 AND "order_items"."unit_price_minor" >= 0 AND "order_items"."subtotal_minor" = "order_items"."quantity" * "order_items"."unit_price_minor" AND "order_items"."discount_minor" BETWEEN 0 AND "order_items"."subtotal_minor" AND "order_items"."total_minor" = "order_items"."subtotal_minor" - "order_items"."discount_minor")
);
--> statement-breakpoint
CREATE INDEX `order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`event_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`currency` text DEFAULT 'KZT' NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`discount_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`processing_fee_basis_points` integer DEFAULT 300 NOT NULL,
	`processing_fee_minor` integer NOT NULL,
	`campaign_id` text,
	`refund_policy_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`admission_blocked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_amounts" CHECK("orders"."currency" = 'KZT' AND "orders"."subtotal_minor" >= 0 AND "orders"."discount_minor" BETWEEN 0 AND "orders"."subtotal_minor" AND "orders"."total_minor" = "orders"."subtotal_minor" - "orders"."discount_minor" AND "orders"."processing_fee_minor" BETWEEN 0 AND "orders"."total_minor")
);
--> statement-breakpoint
CREATE INDEX `orders_account` ON `orders` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_reporting` ON `orders` (`event_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`dispatched_at` integer,
	`completed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_pending` ON `outbox` (`completed_at`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `payment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`subject_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`provider` text NOT NULL,
	`provider_payment_id` text,
	`idempotency_key` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'KZT' NOT NULL,
	`created_at` integer NOT NULL,
	`succeeded_at` integer,
	CONSTRAINT "payment_amount" CHECK("payment_attempts"."amount_minor" > 0 AND "payment_attempts"."currency" = 'KZT')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempts_idempotency_key_unique` ON `payment_attempts` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_payment_identity` ON `payment_attempts` (`provider`,`provider_payment_id`);--> statement-breakpoint
CREATE TABLE `platform_grants` (
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `permission`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'kk' NOT NULL,
	`legal_name` text,
	`contact` text,
	`dummy_payout_reference` text,
	`suspended_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `promo_allocations` (
	`order_id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`committed_at` integer,
	`released_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `promo_usage` ON `promo_allocations` (`campaign_id`,`released_at`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_attempt_id` text NOT NULL,
	`reason` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`amount_minor` integer NOT NULL,
	`provider_refund_id` text,
	`created_at` integer NOT NULL,
	`confirmed_at` integer,
	FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_payment_attempt_id_unique` ON `refunds` (`payment_attempt_id`);--> statement-breakpoint
CREATE TABLE `request_receipts` (
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`resource_id` text NOT NULL,
	`response_json` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`actor_id`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`account_id` text NOT NULL,
	`event_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`payment_attempt_id` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reservation_deadline" CHECK("reservations"."expires_at" = "reservations"."created_at" + 600000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_order_id_unique` ON `reservations` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_reservation` ON `reservations` (`account_id`,`event_id`) WHERE "reservations"."state" = 'active';--> statement-breakpoint
CREATE INDEX `reservation_expiry` ON `reservations` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `ticket_types` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`price_minor` integer NOT NULL,
	`quantity` integer NOT NULL,
	`sales_start_at` integer NOT NULL,
	`sales_end_at` integer NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ticket_type_price" CHECK(("ticket_types"."kind" = 'free' AND "ticket_types"."price_minor" = 0) OR ("ticket_types"."kind" = 'paid' AND "ticket_types"."price_minor" > 0)),
	CONSTRAINT "ticket_type_quantity" CHECK("ticket_types"."quantity" > 0),
	CONSTRAINT "ticket_type_dates" CHECK("ticket_types"."sales_end_at" > "ticket_types"."sales_start_at")
);
--> statement-breakpoint
CREATE INDEX `ticket_types_event` ON `ticket_types` (`event_id`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`inventory_id` text NOT NULL,
	`event_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`attendee_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`credential_ciphertext` text NOT NULL,
	`seat_json` text,
	`state` text DEFAULT 'valid' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_id`) REFERENCES `inventory`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_token_hash_unique` ON `tickets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `tickets_event_order` ON `tickets` (`event_id`,`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_inventory_per_order` ON `tickets` (`inventory_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `transition_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "transition_guard_valid" CHECK("transition_guards"."valid" = 1)
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);