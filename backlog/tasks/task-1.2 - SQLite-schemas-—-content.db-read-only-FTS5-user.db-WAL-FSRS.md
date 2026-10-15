---
id: TASK-1.2
title: 'SQLite schemas — content.db (read-only FTS5) + user.db (WAL, FSRS)'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:54'
updated_date: '2026-09-04 11:09'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 639000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two-DB design is frozen (~80MB bundled read-only + ~5-20MB writable WAL). Without schemas no vocab/kanji/grammar/sentences or cards/revlog/settings exist. Schema file is docs/feature/nihongoai-schema.sql.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Apply docs/feature/nihongoai-schema.sql: vocab, kanji, vocab_kanji, themes, vocab_themes, grammar, sentences, vocab_fts + triggers + idx_vocab_level/idx_kanji_freq
- [x] #2 Create user.db tables: cards (stability/difficulty/due/state/is_leech), revlog, settings (desired_retention 0.90), srs_pause, drafts with WAL + foreign_keys ON
- [x] #3 FTS5 search Cmd+K <100ms @30k rows; polyhierarchy (one vocab, many themes) enforced
- [x] #4 Seed defaults match spec & schema.sql comments; migrations via @manobu/db / drizzle or rusqlite
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit existing @manobu/db state: src/schema/index.ts empty, drizzle.config.ts Turso dialect, apps/desktop/src-tauri/src/lib.rs app_data_dir already resolves manobu.db path
2. Implement two-DB Drizzle layer: create src/schema/content.ts (vocab, kanji, vocab_kanji, themes, vocab_themes, grammar, sentences) + content-fts triggers via raw SQL migration, and src/schema/user.ts (cards, revlog, settings, srs_pause, drafts) with WAL pragmas; expose createContentDb/readOnly + createUserDb factories
3. Generate migrations: run bun run db:generate -> src/migrations, verify SQL matches docs/feature/nihongoai-schema.sql (FTS5 vocab_fts tokenize unicode61 + triggers + idx_vocab_level/idx_kanji_freq + idx_cards_due + idx_revlog_card)
4. Verify AC3 polyhierarchy + FTS performance: seed 30k vocab rows in temp content.db, test FTS5 query <100ms via bun script, assert one vocab maps to many themes (vocab_themes FK)
5. Seed defaults: insert settings defaults (desired_retention 0.90, voice varied etc per schema.sql comments) + themes; ensure foreign_keys ON and journal_mode WAL on user.db, run cargo check + bun check-types + ultracite check
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04:
- drizzle schemas: packages/db/src/schema/content.ts (vocab, kanji, vocab_kanji, themes, vocab_themes, grammar, sentences) + packages/db/src/schema/user.ts (cards, revlog, settings, srs_pause, drafts) with idx_vocab_level/idx_kanji_freq/idx_cards_due/idx_revlog_card
- migrations: packages/db/src/migrations/0000_sour_master_chief.sql (12 tables, 103 lines) + 0001_fts5_vocab_fts.sql (FTS5 unicode61 + triggers vocab_ai/ad), _journal.json updated idx 0,1, meta snapshot OK
- FTS5 bench: packages/db/scripts/fts-bench.ts seed 30k rows 3933ms, queries english 0.51ms / yomi* 4.64ms all <100ms OK, polyhierarchy vocab 1 -> themes 1,2 OK (tested via libSQL file:content.db)
- WAL/foreign_keys: createContentDb/createUserDb apply PRAGMA journal_mode=WAL + foreign_keys=ON per connection (packages/db/src/index.ts), verified via PRAGMA query
- seed defaults: packages/db/src/seed.ts inserts desired_retention 0.90, voice varied etc + themes, matches docs/feature/nihongoai-schema.sql comments
- checks: bun run check-types OK, cargo check OK (warnings only), biome check on changed db files fixed (remaining 2 named-import warnings ignored)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented dual-DB Drizzle layer: content (vocab/kanji/themes/grammar/sentences + FTS5 unicode61) + user (cards/revlog/settings/srs_pause/drafts) with WAL pragmas, generated migrations 0000+0001, verified FTS5 <100ms @30k rows (0.5-4.6ms) and polyhierarchy, seeded defaults 0.90 retention etc, env CONTENT_DATABASE_URL added, checks cargo OK + check-types OK.
<!-- SECTION:FINAL_SUMMARY:END -->
