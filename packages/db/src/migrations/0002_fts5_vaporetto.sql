-- TASK-23.1 (doc-2 §5.1): word-aware Japanese FTS5 via sqlite-vaporetto.
--
-- Tokenizer choice is per FTS5 table (SQLite allows exactly one tokenizer per
-- virtual table), so columns are split by script:
--   - Japanese columns (jp/reading/point/pattern/kana readings) → `vaporetto`
--     (word-aware: 東京特許許可局 → 東京/特許/許可/局)
--   - ASCII columns (en/romaji/meanings) → `unicode61`
--     Rationale (probed against the pinned v0.4.0 -with-model build): the full
--     model chunks ASCII into space-containing tokens (`english gloss`,
--     `eat/drink/go/see/`), so bare vaporetto would REGRESS English/romaji
--     recall. Revisit when upstream releases multi-tag `tags` + `model <path>`
--     tokenizer arguments (unreleased as of v0.4.0).
--
-- The `__VAPORETTO_TOKENIZE__` placeholder is substituted at apply time by
-- packages/db/src/migrate.ts: `vaporetto` when the extension loads on the
-- connection, else `unicode61` (vaporetto-less dev/CI degrade gracefully).
-- `__ASCII_TOKENIZE__` is always unicode61.

-- 1) vocab: Japanese half (vaporetto) + ASCII half (unicode61), both
--    external-content on vocab.rowid with identical trigger sets.
DROP TRIGGER IF EXISTS `vocab_ai`;
DROP TRIGGER IF EXISTS `vocab_ad`;
DROP TABLE IF EXISTS `vocab_fts`;
DROP TABLE IF EXISTS `vocab_fts_en`;

CREATE VIRTUAL TABLE `vocab_fts` USING fts5(
  `jp`, `reading`,
  content = 'vocab',
  content_rowid = 'id',
  tokenize = '__VAPORETTO_TOKENIZE__'
);
CREATE VIRTUAL TABLE `vocab_fts_en` USING fts5(
  `romaji`, `en`,
  content = 'vocab',
  content_rowid = 'id',
  tokenize = '__ASCII_TOKENIZE__'
);

CREATE TRIGGER `vocab_ai` AFTER INSERT ON `vocab` BEGIN
  INSERT INTO `vocab_fts`(rowid, `jp`, `reading`)
  VALUES (new.`id`, new.`jp`, new.`reading`);
  INSERT INTO `vocab_fts_en`(rowid, `romaji`, `en`)
  VALUES (new.`id`, new.`romaji`, new.`en`);
END;
CREATE TRIGGER `vocab_ad` AFTER DELETE ON `vocab` BEGIN
  INSERT INTO `vocab_fts`(`vocab_fts`, rowid, `jp`, `reading`)
  VALUES ('delete', old.`id`, old.`jp`, old.`reading`);
  INSERT INTO `vocab_fts_en`(`vocab_fts_en`, rowid, `romaji`, `en`)
  VALUES ('delete', old.`id`, old.`romaji`, old.`en`);
END;

INSERT INTO `vocab_fts`(`vocab_fts`) VALUES('rebuild');
INSERT INTO `vocab_fts_en`(`vocab_fts_en`) VALUES('rebuild');

-- 2) grammar_fts — new (TASK-23.1 AC#1). point/pattern/ref are Japanese
--    content → vaporetto.
CREATE VIRTUAL TABLE `grammar_fts` USING fts5(
  `point`, `pattern`, `ref`,
  content = 'grammar',
  content_rowid = 'id',
  tokenize = '__VAPORETTO_TOKENIZE__'
);

CREATE TRIGGER `grammar_ai` AFTER INSERT ON `grammar` BEGIN
  INSERT INTO `grammar_fts`(rowid, `point`, `pattern`, `ref`)
  VALUES (new.`id`, new.`point`, new.`pattern`, new.`ref`);
END;
CREATE TRIGGER `grammar_ad` AFTER DELETE ON `grammar` BEGIN
  INSERT INTO `grammar_fts`(`grammar_fts`, rowid, `point`, `pattern`, `ref`)
  VALUES ('delete', old.`id`, old.`point`, old.`pattern`, old.`ref`);
END;

INSERT INTO `grammar_fts`(`grammar_fts`) VALUES('rebuild');

-- 3) kanji_fts — new (TASK-23.1 AC#1). Readings (kana) → vaporetto; English
--    meanings → unicode61. Both are STANDALONE FTS5 tables (char UNINDEXED):
--    kanji's PK is TEXT, and external-content mode requires FTS column names
--    to mirror the content table (invalid: reading_on etc.); standalone keeps
--    the trigger/`rebuild` story simple at 13k rows.
CREATE VIRTUAL TABLE `kanji_fts` USING fts5(
  `reading_on`, `reading_kun`, `char` UNINDEXED,
  tokenize = '__VAPORETTO_TOKENIZE__'
);
CREATE VIRTUAL TABLE `kanji_fts_en` USING fts5(
  `meaning`, `char` UNINDEXED,
  tokenize = '__ASCII_TOKENIZE__'
);

CREATE TRIGGER `kanji_ai` AFTER INSERT ON `kanji` BEGIN
  INSERT INTO `kanji_fts`(`reading_on`, `reading_kun`, `char`)
  VALUES (new.`on`, new.`kun`, new.`char`);
  INSERT INTO `kanji_fts_en`(`meaning`, `char`)
  VALUES (new.`meaning`, new.`char`);
END;
CREATE TRIGGER `kanji_ad` AFTER DELETE ON `kanji` BEGIN
  DELETE FROM `kanji_fts` WHERE `char` = old.`char`;
  DELETE FROM `kanji_fts_en` WHERE `char` = old.`char`;
END;
