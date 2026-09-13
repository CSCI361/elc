CREATE INDEX `email_delivery_state_cursor` ON `email_deliveries` (`email_state`,`id`);--> statement-breakpoint
CREATE INDEX `email_delivery_event_cursor` ON `email_deliveries` (`event_id`,`id`);--> statement-breakpoint
CREATE INDEX `email_delivery_pdf_cursor` ON `email_deliveries` (`pdf_state`,`id`);--> statement-breakpoint
CREATE INDEX `email_delivery_kind_cursor` ON `email_deliveries` (`kind`,`id`);