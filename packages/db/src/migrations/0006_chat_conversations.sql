-- TASK-80.2: server-side AI chat persistence (native ACP migration).
-- History moves out of the browser's localStorage blob into user.db so it
-- survives reloads/restarts and pending permission/ask cards can be
-- re-projected (GET confirmations). `messages` stores one row per
-- normalized AcpStreamEvent card (frame_type + JSON content), keyed for
-- the client reducer by the deterministic ui_id (plan:{msg},
-- term:{msg}:{terminal}). ref_id carries the toolCallId/requestId used to
-- rebuild parked confirmations.
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY,
	`agent` text,
	`assistant` text,
	`acp_session_id` text,
	`title` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_updated` ON `conversations` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`msg_id` text NOT NULL,
	`turn_id` text,
	`frame_type` text NOT NULL,
	`content` text NOT NULL,
	`ui_id` text,
	`ref_id` text,
	`status` text DEFAULT 'finish' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (conversation_id) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `messages` (`conversation_id`, `id`);
CREATE INDEX `idx_messages_seq` ON `messages` (`conversation_id`, `seq`);
CREATE INDEX `idx_messages_ref` ON `messages` (`ref_id`);
--> statement-breakpoint
CREATE INDEX `idx_messages_ui` ON `messages` (`conversation_id`, `ui_id`);
