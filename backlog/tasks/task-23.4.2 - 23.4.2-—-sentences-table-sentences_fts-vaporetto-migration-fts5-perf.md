---
id: TASK-23.4.2
title: 23.4.2 — sentences table + sentences_fts vaporetto migration + fts5-perf
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 12:30'
updated_date: '2026-09-08 13:08'
labels:
  - datasets
  - doc2
  - fts5
dependencies: []
parent_task_id: TASK-23.4
ordinal: 566000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Subtask of TASK-23.4 (doc-2 §5.2 DB layer). Extend packages/db/src/schema/content.ts: replace/augment existing 12-sentence sentences table per doc-2: sentences {id PK, jp, en, linkedWord, jpLen}. New migration 0003 adding sentences_fts USING fts5(jp, en, tokenize='__VAPORETTO_TOKENIZE__') content='sentences' with triggers, mirroring 0002 patterns. Extend packages/db/test/fts5-perf.test.ts with sentences_fts assertions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 sentences schema {id, jp, en, linkedWord, jpLen} in packages/db/src/schema/content.ts
- [x] #2 Migration 0003_fts5_sentences_fts.sql: sentences_fts (vaporetto jp) + sentences_fts_en (unicode61) external-content with ai/ad/au triggers + rebuild
- [x] #3 fts5-perf.test.ts extended with sentences_fts assertions, all 15 tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Migration 0003 reshapes sentences (adds linked_word, jp_len; drops vocab_ids) + creates sentences_fts/sentences_fts_en mirroring the 0002 dual-tokenizer pattern. migrate.ts MIGRATION_FILES + post-apply verify extended. fts5-perf: 15/15 pass on vaporetto path (tokenizer=vaporetto). Journal updated (idx 3).
<!-- SECTION:NOTES:END -->
