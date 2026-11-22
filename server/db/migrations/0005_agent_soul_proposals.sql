CREATE TABLE `agent_soul_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`token_id` text NOT NULL,
	`agent_label` text NOT NULL,
	`text` text NOT NULL,
	`base_hash` text,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`decision_note` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`token_id`) REFERENCES `agent_tokens`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_soul_proposals_site_created` ON `agent_soul_proposals` (`site_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_soul_proposals_one_pending` ON `agent_soul_proposals` (`site_id`,`token_id`) WHERE `status` = 'pending';
