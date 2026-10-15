---
id: TASK-23.4
title: 'Datasets — Tatoeba/Tanaka sentences sent_fts (doc-2 P1, grounds Teacher)'
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-06 06:03'
updated_date: '2026-09-08 15:18'
labels:
  - datasets
  - doc2
  - fts5
dependencies:
  - TASK-23.1
parent_task_id: TASK-23
priority: high
type: feature
ordinal: 592000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tatoeba 13M+ / JP ~250k + Tanaka 150k/jpn_indices are the only bulk-licensed sentences where textbook corpora don't exist. doc-2 §5.2 prescribes fetch-sentences.ts from jpn_indices.tar.bz2 (sentence_id \t meaning_id) → data/sentences/sentences.jsonl + JMdict 31k embedded subset, sentences_fts vaporetto-guarded. Enables lookup_examples(search_examples) grounding for sensei instead of hallucinated Example: 私は… . Reader SCR-05 currently 12 sentences.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/japanese/scripts/fetch-sentences.ts downloads sentences.tar.bz2 + jpn_indices.tar.bz2 into .cache/, emits data/sentences/sentences.jsonl {id, jp, en, linkedWords} with attribution Tatoeba CC BY 2.0 / Tanaka PD
- [x] #2 packages/db/src/schema/content.ts: sentences {id PK, jp, en, linkedWord, jpLen} + sentences_fts USING fts5(jp,en, tokenize='vaporetto …') + triggers; content='sentences'
- [x] #3 crates/jlpt-mcp (or crates/eju-mcp) new tools lookup_examples(word)/search_examples(query,level?,limit)/random_example(level?) with highlight() + BM25, description enriched like describe_pitch
- [x] #4 Verification: cargo test + fts5-perf with sentences_fts; lesson.tsx sensei fallback local→BYOK→cache cites source Tatoeba #id
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. TASK-23.4.1: fetch-sentences.ts downloads Tatoeba sentences.tar.bz2 + jpn_indices.tar.bz2 to .cache/, emits data/sentences/sentences.jsonl {id, jp, en, linkedWords, attribution}; LICENSE.md updated.
2. TASK-23.4.2: sentences schema (id, jp, en, linkedWord, jpLen) + migration 0003 sentences_fts vaporetto external-content + triggers; fts5-perf extended.
3. TASK-23.4.3: jlpt-mcp lookup_examples/search_examples/random_example; corpus loaded lazily from app-data path (doc-2 §6: no include_bytes! for ~25MB); cargo test.
4. TASK-23.4.4: lesson.tsx sensei fallback grounds examples citing Tatoeba #id.
5. Finalize: verify ACs with evidence, check ACs, close.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split into 4 subtasks (TASK-23.4.1..23.4.4) — spans fetch pipeline, DB migration, Rust MCP, UI.

All 4 subtasks done (TASK-23.4.1 fetch+data, 23.4.2 DB migration, 23.4.3 MCP tools, 23.4.4 persona+UI). AC#4 UI portion: sensei offline badge grounds via pickGroundedExample citing Tatoeba #id; the local→BYOK→cache chain itself lives in @manobu/acp unchanged. cargo test + parity pass both feature paths; bun --filter @manobu/db test 15/15; apps/desktop 218 tests; check-types 11/11; ultracite repo-clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tatoeba/Tanaka sentence grounding shipped end-to-end (doc-2 §5.2): fetch-sentences.ts produces data/sentences/sentences.jsonl (147,705 pairs, verified by running it — output inspected); migration 0003 adds sentences_fts/sentences_fts_en (dual vaporetto/unicode61, triggers+rebuild) verified by bun --filter @manobu/db test 15/15 incl. 3 new sentences_fts tests; crates/jlpt-mcp gains lookup_examples/search_examples/random_example with describe_sentence citing Tatoeba #id — verified by cargo test on default + --features vaporetto (parity golden intact) and a live stdio smoke of all 3 tools; Teacher persona (assistant/sensei.md) now forbids invented examples and the lesson SenseiHint offline badge grounds its example via lib/grounded-examples.ts citing Tatoeba #id (3 new tests, apps/desktop suite 218 green). Repo-wide: check-types 11/11, ultracite clean. Split into TASK-23.4.1..4, all Done.
<!-- SECTION:FINAL_SUMMARY:END -->
