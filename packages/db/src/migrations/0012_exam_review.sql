ALTER TABLE `items` ADD COLUMN `disputed` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `items` ADD COLUMN `disputed_at` text;
