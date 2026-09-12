CREATE TABLE `simulated_payout_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`payout_item_id` text NOT NULL,
	`refund_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payout_item_id`) REFERENCES `simulated_payout_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payout_adjustment_amount" CHECK("simulated_payout_adjustments"."amount_minor" <= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simulated_payout_adjustments_refund_id_unique` ON `simulated_payout_adjustments` (`refund_id`);--> statement-breakpoint
CREATE INDEX `payout_adjustments_item` ON `simulated_payout_adjustments` (`payout_item_id`);--> statement-breakpoint
CREATE TABLE `simulated_payout_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payout_id` text NOT NULL,
	`order_id` text NOT NULL,
	`payment_attempt_id` text NOT NULL,
	`paid_minor` integer NOT NULL,
	`processing_fee_minor` integer NOT NULL,
	`contribution_minor` integer NOT NULL,
	FOREIGN KEY (`payout_id`) REFERENCES `simulated_payouts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payout_item_amounts" CHECK("simulated_payout_items"."paid_minor" > 0 AND "simulated_payout_items"."processing_fee_minor" BETWEEN 0 AND "simulated_payout_items"."paid_minor" AND "simulated_payout_items"."contribution_minor" = "simulated_payout_items"."paid_minor" - "simulated_payout_items"."processing_fee_minor")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simulated_payout_items_order_id_unique` ON `simulated_payout_items` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `simulated_payout_items_payment_attempt_id_unique` ON `simulated_payout_items` (`payment_attempt_id`);--> statement-breakpoint
CREATE INDEX `payout_items_run` ON `simulated_payout_items` (`payout_id`);--> statement-breakpoint
CREATE TABLE `simulated_payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`organizer_id` text NOT NULL,
	`currency` text DEFAULT 'KZT' NOT NULL,
	`amount_minor` integer NOT NULL,
	`order_count` integer NOT NULL,
	`eligible_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organizer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payout_amounts" CHECK("simulated_payouts"."currency" = 'KZT' AND "simulated_payouts"."amount_minor" >= 0 AND "simulated_payouts"."order_count" BETWEEN 1 AND 20 AND "simulated_payouts"."completed_at" >= "simulated_payouts"."eligible_at")
);
--> statement-breakpoint
CREATE INDEX `payout_event_time` ON `simulated_payouts` (`event_id`,`completed_at`);