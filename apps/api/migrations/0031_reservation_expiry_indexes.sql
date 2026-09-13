CREATE INDEX `inventory_reservation` ON `inventory` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `reservation_event_expiry` ON `reservations` (`event_id`,`state`,`expires_at`);