CREATE TABLE `grammar` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`point` text NOT NULL,
	`level` text NOT NULL,
	`pattern` text NOT NULL,
	`ref` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kanji` (
	`char` text PRIMARY KEY NOT NULL,
	`strokes` integer NOT NULL,
	`on` text,
	`kun` text,
	`meaning` text NOT NULL,
	`level` text NOT NULL,
	`grade` integer,
	`freq` integer
);
--> statement-breakpoint
CREATE INDEX `idx_kanji_freq` ON `kanji` (`freq`);--> statement-breakpoint
CREATE TABLE `sentences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jp` text NOT NULL,
	`en` text NOT NULL,
	`level` text NOT NULL,
	`vocab_ids` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `themes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `themes_name_unique` ON `themes` (`name`);--> statement-breakpoint
CREATE TABLE `vocab` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jp` text NOT NULL,
	`reading` text NOT NULL,
	`romaji` text NOT NULL,
	`en` text NOT NULL,
	`level` text NOT NULL,
	`audio_path` text,
	`pitch` text
);
--> statement-breakpoint
CREATE INDEX `idx_vocab_level` ON `vocab` (`level`);--> statement-breakpoint
CREATE TABLE `vocab_kanji` (
	`vocab_id` integer NOT NULL,
	`kanji` text NOT NULL,
	PRIMARY KEY(`vocab_id`, `kanji`),
	FOREIGN KEY (`vocab_id`) REFERENCES `vocab`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kanji`) REFERENCES `kanji`(`char`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vocab_themes` (
	`vocab_id` integer NOT NULL,
	`theme_id` integer NOT NULL,
	PRIMARY KEY(`vocab_id`, `theme_id`),
	FOREIGN KEY (`vocab_id`) REFERENCES `vocab`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vocab_id` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 5 NOT NULL,
	`due` text NOT NULL,
	`state` text DEFAULT 'new' NOT NULL,
	`is_leech` integer DEFAULT false NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cards_due` ON `cards` (`due`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`lesson_id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`context` text NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `revlog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`grade` integer NOT NULL,
	`ts` text DEFAULT '(datetime(''now''))' NOT NULL,
	`delta_t` real NOT NULL,
	`r_snapshot` real,
	`s_snapshot` real,
	`d_snapshot` real,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_revlog_card` ON `revlog` (`card_id`,`ts`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `srs_pause` (
	`paused_until` text
);
