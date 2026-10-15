CREATE TABLE IF NOT EXISTS `items` (
	`id` text PRIMARY KEY NOT NULL,
	`surface` text NOT NULL,
	`level` text NOT NULL,
	`item_type` text NOT NULL,
	`prompt` text NOT NULL,
	`passage` text,
	`options` text NOT NULL,
	`answer_index` integer NOT NULL,
	`explanation` text,
	`anchors` text NOT NULL,
	`script` text,
	`fsrs_vocab_id` integer,
	`seed_part` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`level` text NOT NULL,
	`mode` text NOT NULL,
	`source` text NOT NULL,
	`seed` text NOT NULL,
	`budgets` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`result` text,
	FOREIGN KEY (conversation_id) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_exams_conversation` ON `exams` (`conversation_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `exam_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exam_id` text NOT NULL,
	`item_id` text NOT NULL,
	`section` text NOT NULL,
	`item_type` text NOT NULL,
	`order` integer NOT NULL,
	FOREIGN KEY (exam_id) REFERENCES `exams`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (item_id) REFERENCES `items`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_exam_items_order` ON `exam_items` (`exam_id`, `order`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_exam_items_item` ON `exam_items` (`exam_id`, `item_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drill_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`tier` text NOT NULL,
	`level` text,
	`anchors` text NOT NULL,
	`declared_count` integer NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (conversation_id) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_drill_sessions_conversation` ON `drill_sessions` (`conversation_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drill_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`item_id` text NOT NULL,
	`chosen_index` integer,
	`correct` integer,
	`at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (session_id) REFERENCES `drill_sessions`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (item_id) REFERENCES `items`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_drill_attempts_item` ON `drill_attempts` (`session_id`, `item_id`);
