CREATE TABLE IF NOT EXISTS `drill_session_lifecycle` (
	`session_id` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL DEFAULT 0,
	`max_per_type` integer NOT NULL DEFAULT 1,
	`supersession_count` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (session_id) REFERENCES `drill_sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drill_pool_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	`generation` integer NOT NULL DEFAULT 0,
	`state` text NOT NULL DEFAULT 'ready',
	`drop_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (session_id) REFERENCES `drill_sessions`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (item_id) REFERENCES `items`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_drill_pool_item` ON `drill_pool_items` (`session_id`, `item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_drill_pool_position` ON `drill_pool_items` (`session_id`, `position`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_drill_pool_ready` ON `drill_pool_items` (`session_id`, `state`, `position`);
