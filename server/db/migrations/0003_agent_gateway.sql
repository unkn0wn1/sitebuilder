CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`secret_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`access` text NOT NULL,
	`rules` text NOT NULL,
	`always_allow_until` text,
	`limits` text,
	`ip_allow` text,
	`status` text NOT NULL,
	`paused_reason` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`last_used_at` text,
	`last_used_ip` text,
	`revoked_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_secret_hash` ON `agent_tokens` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `agent_tokens_site` ON `agent_tokens` (`site_id`);--> statement-breakpoint
CREATE TABLE `agent_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`token_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`targets` text NOT NULL,
	`decision` text,
	`undo_of` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`applied_at` text,
	`published_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`token_id`) REFERENCES `agent_tokens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_changes_site_created` ON `agent_changes` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_changes_token_status` ON `agent_changes` (`token_id`,`status`);--> statement-breakpoint
CREATE TABLE `agent_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_calls_token_kind_at` ON `agent_calls` (`token_id`,`kind`,`at`);
