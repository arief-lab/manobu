-- TASK-23.6 (doc-2 §2.5/§5.5): JMnedict proper nouns — `names` + `names_fts`.
--
-- ~743k proper nouns (place 227k, surname 128k, given names, station,
-- company…) from data/names.jsonl { id, word, reading, name_type } (see
-- packages/japanese/data/LICENSE.md §10). Deliberately a SEPARATE table from
-- `vocab`: doc-2 §5.5 keeps proper-noun hits out of vocab ranking —
-- `search_vocab` must not return 田中 for a learner query that happens to
-- match a surname; the MCP `lookup_name`/`search_name` tools are the only
-- consumers.
--
-- No English column: JMnedict carries no glosses (its translations are
-- non-English), so there is no `names_fts_en` twin — one vaporetto FTS table
-- over `word` + `reading`. Same `__VAPORETTO_TOKENIZE__` placeholder as 0002
-- (substituted at apply time by packages/db/src/migrate.ts).
--
-- `names` is NOT created in 0000 (the drizzle seed schema): the table is
-- populated at runtime by the MCP/ingestion path, not the seed script —
-- mirroring how `sentences` is filled from sentences.jsonl.

CREATE TABLE IF NOT EXISTS `names` (
  `id` INTEGER PRIMARY KEY,
  `word` TEXT NOT NULL,
  `reading` TEXT NOT NULL DEFAULT '',
  `name_type` TEXT NOT NULL DEFAULT 'unclassified'
);
CREATE INDEX IF NOT EXISTS `idx_names_type` ON `names` (`name_type`);
--> statement-breakpoint
DROP TABLE IF EXISTS `names_fts`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `names_fts` USING fts5(
  `word`, `reading`,
  content = 'names',
  content_rowid = 'id',
  tokenize = '__VAPORETTO_TOKENIZE__'
);
--> statement-breakpoint
CREATE TRIGGER `names_ai` AFTER INSERT ON `names` BEGIN
  INSERT INTO `names_fts`(rowid, `word`, `reading`)
  VALUES (new.`id`, new.`word`, new.`reading`);
END;
CREATE TRIGGER `names_ad` AFTER DELETE ON `names` BEGIN
  INSERT INTO `names_fts`(`names_fts`, rowid, `word`, `reading`)
  VALUES ('delete', old.`id`, old.`word`, old.`reading`);
END;
CREATE TRIGGER `names_au` AFTER UPDATE OF `word`, `reading` ON `names` BEGIN
  INSERT INTO `names_fts`(`names_fts`, rowid, `word`, `reading`)
  VALUES ('delete', old.`id`, old.`word`, old.`reading`);
  INSERT INTO `names_fts`(rowid, `word`, `reading`)
  VALUES (new.`id`, new.`word`, new.`reading`);
END;
