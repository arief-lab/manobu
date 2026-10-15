ALTER TABLE `exam_sections` ADD COLUMN `active_ms` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `exam_sections` ADD COLUMN `paused_ms` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `exam_sections` ADD COLUMN `pause_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `exam_sections` ADD COLUMN `timer_started_at` text;
--> statement-breakpoint
ALTER TABLE `exam_sections` ADD COLUMN `paused_at` text;
--> statement-breakpoint
UPDATE `exam_sections`
SET `timer_started_at` = `started_at`
WHERE `status` = 'in_progress' AND `started_at` IS NOT NULL;
