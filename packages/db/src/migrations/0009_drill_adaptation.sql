ALTER TABLE `drill_attempts` ADD COLUMN `skipped` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_drill_attempts_item`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_drill_attempts_item` ON `drill_attempts` (`session_id`, `item_id`, `id`);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_drill_pool_item`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_drill_pool_item` ON `drill_pool_items` (`session_id`, `item_id`);
