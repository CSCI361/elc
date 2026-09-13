CREATE TABLE `organizer_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`legal_name` text NOT NULL,
	`contact` text NOT NULL,
	`dummy_payout_reference` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organizer_profile_values" CHECK(length(trim("organizer_profiles"."display_name")) BETWEEN 1 AND 120 AND length(trim("organizer_profiles"."legal_name")) BETWEEN 1 AND 200 AND length(trim("organizer_profiles"."contact")) BETWEEN 3 AND 200 AND length("organizer_profiles"."dummy_payout_reference") BETWEEN 8 AND 65 AND substr("organizer_profiles"."dummy_payout_reference",1,5)='DEMO-' AND substr("organizer_profiles"."dummy_payout_reference",6) NOT GLOB '*[^A-Za-z0-9_-]*' AND "organizer_profiles"."revision">0 AND "organizer_profiles"."updated_at">="organizer_profiles"."created_at")
);
