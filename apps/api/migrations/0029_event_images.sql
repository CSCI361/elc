CREATE TABLE `event_image_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`request_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`alt_text` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`original_size` integer NOT NULL,
	`content_size` integer NOT NULL,
	`content_sha256` text NOT NULL,
	`state` text DEFAULT 'staged' NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`retired_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_image_asset_values" CHECK("event_image_assets"."content_type" IN ('image/jpeg','image/png') AND "event_image_assets"."original_size" BETWEEN 1 AND 5242880 AND "event_image_assets"."content_size" BETWEEN 1 AND 5242880 AND length("event_image_assets"."content_sha256")=64 AND length("event_image_assets"."input_hash")=64 AND "event_image_assets"."expected_revision">=0 AND length(trim("event_image_assets"."alt_text")) BETWEEN 1 AND 500 AND "event_image_assets"."attempts">=0 AND "event_image_assets"."state" IN ('staged','ready','deleting','deleted') AND "event_image_assets"."expires_at">"event_image_assets"."created_at" AND "event_image_assets"."expires_at"<="event_image_assets"."created_at"+86400000),
	CONSTRAINT "event_image_asset_retirement" CHECK(("event_image_assets"."state" IN ('deleting','deleted'))=("event_image_assets"."retired_at" IS NOT NULL) AND ("event_image_assets"."state"='deleted')=("event_image_assets"."deleted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_image_assets_object_key_unique` ON `event_image_assets` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_image_upload_request` ON `event_image_assets` (`uploader_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `event_image_asset_cleanup` ON `event_image_assets` (`state`,`expires_at`,`retired_at`);--> statement-breakpoint
CREATE INDEX `event_image_asset_upload_event` ON `event_image_assets` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_images` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`position` integer NOT NULL,
	`alt_text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `event_image_assets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_image_link_values" CHECK("event_images"."position" BETWEEN 0 AND 4 AND length(trim("event_images"."alt_text")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_image_position` ON `event_images` (`event_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_image_asset_link` ON `event_images` (`event_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `event_image_asset_references` ON `event_images` (`asset_id`);--> statement-breakpoint
CREATE TRIGGER event_image_asset_identity_immutable BEFORE UPDATE OF id,event_id,uploader_id,request_id,input_hash,expected_revision,alt_text,object_key,content_type,original_size,content_size,content_sha256,created_at,expires_at ON event_image_assets
BEGIN SELECT RAISE(ABORT,'event_image_asset_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER event_image_asset_staging BEFORE INSERT ON event_image_assets
WHEN NEW.state<>'staged'
BEGIN SELECT RAISE(ABORT,'event_image_asset_staging'); END;
--> statement-breakpoint
CREATE TRIGGER event_image_asset_transition BEFORE UPDATE OF state ON event_image_assets
WHEN NOT (NEW.state=OLD.state OR (OLD.state='staged' AND NEW.state IN ('ready','deleting')) OR (OLD.state='ready' AND NEW.state='deleting') OR (OLD.state='deleting' AND NEW.state='deleted'))
BEGIN SELECT RAISE(ABORT,'event_image_asset_transition'); END;
--> statement-breakpoint
CREATE TRIGGER event_image_asset_retire_unreferenced BEFORE UPDATE OF state ON event_image_assets
WHEN NEW.state IN ('deleting','deleted') AND EXISTS(SELECT 1 FROM event_images WHERE asset_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'event_image_asset_still_referenced'); END;
--> statement-breakpoint
CREATE TRIGGER event_image_asset_retirement_immutable BEFORE UPDATE OF retired_at,deleted_at ON event_image_assets
WHEN (OLD.retired_at IS NOT NULL AND NEW.retired_at IS NOT OLD.retired_at) OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT OLD.deleted_at)
BEGIN SELECT RAISE(ABORT,'event_image_asset_retirement_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER event_image_link_ready BEFORE INSERT ON event_images
WHEN NOT EXISTS(SELECT 1 FROM event_image_assets WHERE id=NEW.asset_id AND state='ready')
BEGIN SELECT RAISE(ABORT,'event_image_asset_not_ready'); END;
--> statement-breakpoint
CREATE TRIGGER event_image_link_identity_immutable BEFORE UPDATE OF id,event_id,asset_id,created_at ON event_images
BEGIN SELECT RAISE(ABORT,'event_image_link_identity_immutable'); END;
