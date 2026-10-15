CREATE VIRTUAL TABLE `vocab_fts` USING fts5(
  `jp`, `reading`, `romaji`, `en`,
  content = 'vocab',
  content_rowid = 'id',
  tokenize = 'unicode61'
);
--> statement-breakpoint
CREATE TRIGGER `vocab_ai` AFTER INSERT ON `vocab` BEGIN
  INSERT INTO `vocab_fts`(rowid, `jp`, `reading`, `romaji`, `en`)
  VALUES (new.`id`, new.`jp`, new.`reading`, new.`romaji`, new.`en`);
END;
--> statement-breakpoint
CREATE TRIGGER `vocab_ad` AFTER DELETE ON `vocab` BEGIN
  INSERT INTO `vocab_fts`(`vocab_fts`, rowid, `jp`, `reading`, `romaji`, `en`)
  VALUES ('delete', old.`id`, old.`jp`, old.`reading`, old.`romaji`, old.`en`);
END;
