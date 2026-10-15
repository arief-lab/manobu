-- TASK-23.4.2 (doc-2 §5.2): sentences_fts — word-aware Japanese sentence
-- search over the Tatoeba/Tanaka corpus (data/sentences/sentences.jsonl,
-- 147,705 pairs). Mirrors the 0002 pattern: Japanese column → vaporetto,
-- English column → unicode61 (see 0002 header for the ASCII-regression
-- rationale), external-content on sentences.rowid.
--
-- The sentences table itself is reshaped here (doc-2 shape): the original
-- 0000 seed table { id, jp, en, level, vocab_ids } gains `linked_word` and
-- `jp_len` and drops the unused `vocab_ids`. Existing seed rows survive the
-- rebuild (linked_word/jp_len default NULL/derived).
--
-- `__VAPORETTO_TOKENIZE__` is substituted at apply time by
-- packages/db/src/migrate.ts (`vaporetto` when the extension loads,
-- else `unicode61`).

ALTER TABLE `sentences` DROP COLUMN `vocab_ids`;
ALTER TABLE `sentences` ADD COLUMN `linked_word` TEXT;
ALTER TABLE `sentences` ADD COLUMN `jp_len` INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `sentences` SET `jp_len` = length(`jp`);
--> statement-breakpoint
DROP TABLE IF EXISTS `sentences_fts`;
DROP TABLE IF EXISTS `sentences_fts_en`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `sentences_fts` USING fts5(
  `jp`,
  content = 'sentences',
  content_rowid = 'id',
  tokenize = '__VAPORETTO_TOKENIZE__'
);
CREATE VIRTUAL TABLE `sentences_fts_en` USING fts5(
  `en`,
  content = 'sentences',
  content_rowid = 'id',
  tokenize = '__ASCII_TOKENIZE__'
);
--> statement-breakpoint
CREATE TRIGGER `sentences_ai` AFTER INSERT ON `sentences` BEGIN
  INSERT INTO `sentences_fts`(rowid, `jp`)
  VALUES (new.`id`, new.`jp`);
  INSERT INTO `sentences_fts_en`(rowid, `en`)
  VALUES (new.`id`, new.`en`);
END;
CREATE TRIGGER `sentences_ad` AFTER DELETE ON `sentences` BEGIN
  INSERT INTO `sentences_fts`(`sentences_fts`, rowid, `jp`)
  VALUES ('delete', old.`id`, old.`jp`);
  INSERT INTO `sentences_fts_en`(`sentences_fts_en`, rowid, `en`)
  VALUES ('delete', old.`id`, old.`en`);
END;
CREATE TRIGGER `sentences_au` AFTER UPDATE OF `jp`, `en` ON `sentences` BEGIN
  INSERT INTO `sentences_fts`(`sentences_fts`, rowid, `jp`)
  VALUES ('delete', old.`id`, old.`jp`);
  INSERT INTO `sentences_fts`(rowid, `jp`)
  VALUES (new.`id`, new.`jp`);
  INSERT INTO `sentences_fts_en`(`sentences_fts_en`, rowid, `en`)
  VALUES ('delete', old.`id`, old.`en`);
  INSERT INTO `sentences_fts_en`(rowid, `en`)
  VALUES (new.`id`, new.`en`);
END;
--> statement-breakpoint
INSERT INTO `sentences_fts`(`sentences_fts`) VALUES('rebuild');
INSERT INTO `sentences_fts_en`(`sentences_fts_en`) VALUES('rebuild');
