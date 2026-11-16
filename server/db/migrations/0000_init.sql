CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `ai_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ai_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`task_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`state` text NOT NULL,
	`model` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`at` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`ai_session_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`details` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_site_at` ON `audit_events` (`site_id`,`at`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `brand_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`draft_version_id` text,
	`published_version_id` text,
	`draft_revision` integer DEFAULT 0 NOT NULL,
	`workflow_state` text DEFAULT 'draft' NOT NULL,
	`was_unpublished` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `draft_ops` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_key` text NOT NULL,
	`user_id` text NOT NULL,
	`ai_session_id` text,
	`op` text NOT NULL,
	`inverse` text NOT NULL,
	`touches` text NOT NULL,
	`undo_of` text,
	`undone_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_ops_target_revision` ON `draft_ops` (`target_type`,`target_id`,`revision`);--> statement-breakpoint
CREATE TABLE `embeds` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`lane` text NOT NULL,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	`run_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 4 NOT NULL,
	`lease_until` text,
	`last_error` text,
	`result` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_lane_state_run_at` ON `jobs` (`lane`,`state`,`run_at`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`sha256` text NOT NULL,
	`alt` text,
	`decorative` integer DEFAULT false NOT NULL,
	`focal_x` integer,
	`focal_y` integer,
	`placeholder` text,
	`dominant_color` text,
	`status` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `media_crops` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`media_id` text NOT NULL,
	`ratio` text NOT NULL,
	`breakpoint` text DEFAULT 'all' NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`scope` text NOT NULL,
	`user_id` text,
	`text` text NOT NULL,
	`state` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`message` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`path` text NOT NULL,
	`published_path` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`template` text NOT NULL,
	`title` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`draft_version_id` text,
	`published_version_id` text,
	`draft_revision` integer DEFAULT 0 NOT NULL,
	`workflow_state` text DEFAULT 'draft' NOT NULL,
	`was_unpublished` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pages_site_path` ON `pages` (`site_id`,`locale`,`path`);--> statement-breakpoint
CREATE INDEX `pages_site_state` ON `pages` (`site_id`,`workflow_state`);--> statement-breakpoint
CREATE TABLE `redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`from_path` text NOT NULL,
	`to_path` text NOT NULL,
	`status_code` integer DEFAULT 301 NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `redirects_site_from` ON `redirects` (`site_id`,`from_path`);--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`manifest` text NOT NULL,
	`created_by` text NOT NULL,
	`review_id` text,
	`rolled_back_to` text,
	`reason` text,
	`self_approved` integer DEFAULT false NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`review_id` text NOT NULL,
	`block_id` text,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`version_id` text NOT NULL,
	`state` text NOT NULL,
	`note` text,
	`change_summary` text,
	`submitted_by` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`decision_comment` text,
	`override_reason` text,
	`self_approved` integer DEFAULT false NOT NULL,
	`job_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reviews_site_state` ON `reviews` (`site_id`,`state`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secrets_site_name` ON `secrets` (`site_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `site_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`draft_version_id` text,
	`published_version_id` text,
	`draft_revision` integer DEFAULT 0 NOT NULL,
	`workflow_state` text DEFAULT 'draft' NOT NULL,
	`was_unpublished` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_parts_site_kind_key` ON `site_parts` (`site_id`,`kind`,`key`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`primary_domain` text,
	`default_locale` text DEFAULT 'en' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`draft_version_id` text,
	`published_version_id` text,
	`draft_revision` integer DEFAULT 0 NOT NULL,
	`workflow_state` text DEFAULT 'draft' NOT NULL,
	`was_unpublished` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_site_key` ON `templates` (`site_id`,`key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`is_operator` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`password_hash` text,
	`created_at` text NOT NULL,
	`last_login_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_site_email` ON `users` (`site_id`,`email`);--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`number` integer NOT NULL,
	`doc` text NOT NULL,
	`schema_version` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_key` text NOT NULL,
	`author_id` text NOT NULL,
	`ai_session_id` text,
	`summary` text,
	`sealed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_target_number` ON `versions` (`target_type`,`target_id`,`number`);