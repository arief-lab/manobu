ALTER TABLE `exams` ADD COLUMN `ready_at` text;
--> statement-breakpoint
ALTER TABLE `exams` ADD COLUMN `started_at` text;
--> statement-breakpoint
ALTER TABLE `exams` ADD COLUMN `submitted_at` text;
--> statement-breakpoint
ALTER TABLE `exams` ADD COLUMN `abandoned_at` text;
--> statement-breakpoint
ALTER TABLE `exams` ADD COLUMN `current_section` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `exam_sections` (
	`exam_id` text NOT NULL,
	`section` text NOT NULL,
	`position` integer NOT NULL,
	`requested_items` integer NOT NULL DEFAULT 0,
	`time_limit_seconds` integer,
	`status` text NOT NULL DEFAULT 'pending',
	`started_at` text,
	`submitted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY (`exam_id`, `section`),
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_exam_sections_position` ON `exam_sections` (`exam_id`, `position`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_exam_sections_status` ON `exam_sections` (`exam_id`, `status`, `position`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `exam_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exam_id` text NOT NULL,
	`section` text NOT NULL,
	`item_id` text NOT NULL,
	`answer_index` integer NOT NULL,
	`answered_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`exam_id`, `section`) REFERENCES `exam_sections`(`exam_id`, `section`) ON DELETE CASCADE,
	UNIQUE (`exam_id`, `item_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_exam_answers_item` ON `exam_answers` (`exam_id`, `item_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_exam_answers_section` ON `exam_answers` (`exam_id`, `section`);
