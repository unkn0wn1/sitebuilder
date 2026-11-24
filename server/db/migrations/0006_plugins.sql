CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`core_range` text NOT NULL,
	`content_hash` text NOT NULL,
	`trust` text NOT NULL,
	`signing_key_id` text,
	`status` text NOT NULL,
	`status_message` text,
	`manifest_json` text NOT NULL,
	`permissions_json` text NOT NULL,
	`csp_json` text NOT NULL,
	`installed_by` text NOT NULL,
	`installed_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`installed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugins_site_plugin` ON `plugins` (`site_id`,`plugin_id`);
--> statement-breakpoint
CREATE INDEX `plugins_site_status` ON `plugins` (`site_id`,`status`);
--> statement-breakpoint
CREATE TABLE `plugin_files` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_files_site_plugin_path` ON `plugin_files` (`site_id`,`plugin_id`,`path`);
--> statement-breakpoint
CREATE TABLE `plugin_settings` (
	`site_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`doc` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY (`site_id`, `plugin_id`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plugin_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`token_id` text NOT NULL,
	`agent_label` text NOT NULL,
	`status` text NOT NULL,
	`archive` blob NOT NULL,
	`signature` blob,
	`content_hash` text NOT NULL,
	`plugin_id` text NOT NULL,
	`version` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`decision_note` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`token_id`) REFERENCES `agent_tokens`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plugin_proposals_site_created` ON `plugin_proposals` (`site_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_proposals_one_pending` ON `plugin_proposals` (`site_id`,`plugin_id`) WHERE `status` = 'pending';
