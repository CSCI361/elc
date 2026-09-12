CREATE TABLE `activation_checklist_history` (
	`event_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`checklist_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `revision`),
	FOREIGN KEY (`event_id`) REFERENCES `event_activations`(`event_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "activation_history_values" CHECK("activation_checklist_history"."revision" > 0 AND json_valid("activation_checklist_history"."checklist_json") = 1)
);
