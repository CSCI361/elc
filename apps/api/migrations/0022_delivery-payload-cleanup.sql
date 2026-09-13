CREATE TABLE `delivery_payload_objects` (
	`key` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`hash` text NOT NULL,
	`state` text DEFAULT 'staged' NOT NULL,
	`delete_after` integer NOT NULL,
	`last_swept_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "delivery_payload_state" CHECK("delivery_payload_objects"."state" IN ('staged','deleting','deleted') AND "delivery_payload_objects"."delete_after" > "delivery_payload_objects"."created_at" AND length("delivery_payload_objects"."hash")=64)
);
--> statement-breakpoint
CREATE INDEX `delivery_payload_cleanup` ON `delivery_payload_objects` (`delete_after`,`last_swept_at`);--> statement-breakpoint
CREATE INDEX `delivery_payload_owner` ON `delivery_payload_objects` (`delivery_id`);--> statement-breakpoint
CREATE INDEX `outbox_delivery_source` ON `outbox` (`kind`,`entity_id`,`created_at`,`id`);