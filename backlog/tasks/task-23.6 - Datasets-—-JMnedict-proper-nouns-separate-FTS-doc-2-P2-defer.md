---
id: TASK-23.6
title: 'Datasets — JMnedict proper nouns separate FTS (doc-2 P2, defer)'
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-06 06:03'
updated_date: '2026-09-09 07:15'
labels:
  - datasets
  - doc2
dependencies:
  - TASK-23.1
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 594000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
JMnedict ~400k proper nouns (surname 138k, place 99k …) reuse fetch-vocab.ts parser JMdict shape with name_type bitmask. Needed when search_vocab misses on names like 田中/東京駅 in Reader/Roleplay. Keep names_fts separate from vocab_fts with same vaporetto tokenizer, do not pollute vocab ranking. doc-2 §2.5/§5.5 defer after sentences+KanjiVG.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/japanese/scripts/fetch-names.ts downloads JMnedict.xml.gz, emits data/names.json {word, reading, name_type bitmask}
- [x] #2 packages/db/src/schema/content.ts names + names_fts tokenize='vaporetto' separate table
- [x] #3 crates/jlpt-mcp new tools lookup_name/search_name/list_names_by_type (or polytagged search_all) — keep vocab ranking clean
- [x] #4 Verification respects CC BY-SA 4.0 aggregation in data/LICENSE.md
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. packages/japanese/scripts/fetch-names.ts: download JMnedict.xml.gz (the EDRDG canonical XML, not the JSON port — zero new deps, reuse the fetch-kanjivg-style streaming parse), emit data/names.jsonl {id, word, reading, name_type} — JSONL like kanjivg/sentences (single-row streaming parse in Rust; ~500k rows, array-JSON would bloat). name_type from JMnedict's name-type field (surname/given/place/company/…) as a string tag, not bitmask (bitmask adds nothing; string filters cleanly). LICENSE.md section: CC BY-SA 4.0 aggregation note. 2. packages/db migration 0004: names table {id, word, reading, name_type} + names_fts (word+reading → vaporetto, no English column — JMnedict has no glosses) external-content, same trigger trio, rebuild-populated; names NEVER join vocab ranking (separate table per doc-2 §5.5). 3. MCP: types.rs NameEntry + data.rs JSONL parse + engine lookup_name/search_name/list_names_by_type + main.rs tool registration with descriptions warning Coach these are proper nouns (no glosses). 4. Verify: fetch a bounded sample (not the full 500k for tests), cargo test both feature paths + parity golden untouched (new tools only), server-side names unavailable in web-dev — MCP is the surface.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes: AC#1 — fetch-names.ts downloads jmnedict-all from the SAME pinned jmdict-simplified release as fetch-vocab (3.6.2+20260803141815; verified the asset exists via the releases expanded_assets HTML since the GitHub API rate-limited). Shape discoveries: the simplified JSON names the array 'words' (not 'names') for BOTH dicts, and name_type tags ride at translation[].type[] as a string[] (not name_type[] objects). Output: data/names.jsonl, 743,907 rows {id, word, reading, name_type}, ids from 5,000,000 (disjoint from sentences), one row per kanji×first-kana, kana-only names emit word=reading. Type distribution: place 226,889 / unclass 130,167 / surname 127,911 / fem 108,423 / given 58,907 / person 53,161 / masc 21,243 / station 8,262. Cache seeded in packages/japanese/.cache (gitignored). AC#2 — migration 0004_fts5_names_fts.sql: names table + names_fts (word+reading → vaporetto via the __VAPORETTO_TOKENIZE__ placeholder, external-content on names.id, ai/ad/au triggers); NO English twin (JMnedict has no glosses); registered in MIGRATION_FILES (now 5); drizzle schema mirrors names. Verified on :memory: with vaporetto loaded: FTS match on 田中 and name_type filter both hit. AC#3 — types.rs NameEntry + Corpus.all_names + names_by_type index; engine lookup_name/search_name/list_names_by_type (search_name keeps the 23.1 word-aware rerank for non-ASCII queries); main.rs registers all three with descriptions warning NO glosses + separation from vocab ranking. E2E through the binary: lookup_name(田中) → 11 rows surname; search_name(東京駅) → 1 station row とうきょうえき; list_names_by_type(surname) → 3 surname rows. cargo test green BOTH feature paths (23+2 default, 24+2 vaporetto); parity golden untouched — vocab ranking provably clean (all_names referenced only inside the three name fns). AC#4 — LICENSE.md §10: CC BY-SA 4.0 aggregation note + regen command. Size impact: release binary 19.4 → 27 MB (+7.5 MB names gzip, 743k rows compressed); AGENTS.md size-tier notes updated. Lint fixes during dev: JMnedict JSON shape (words key, translation[].type string[]), tar member name = version without date suffix, noShadow/noIncrementDecrement.

POST-COMPLETION DECISION (same day, user-approved): the JMnedict MCP embed + tools were REMOVED. Rationale: (1) zero consumers — audited sensei.md, server routes, desktop code; the three tools existed only in the tool surface created here; (2) no learner value — JMnedict has NO glosses, so lookup returns {word, reading, name_type}, and names are the category the Coach answers best from its own knowledge (grounding tools earn their keep on pitch/examples, not name existence); (3) the +7.5 MB embed (19.4 → 27 MB, +38%) contradicted the documented size-first rule AND added 743k serde parse lines to boot — directly working against TASK-24 (cold-start), the acknowledged #1 perf issue. Empty-result tools were not an option: the Coach treats tool output as authoritative, so search_name returning [] reads as 'no such person exists' — an active misinformation surface. What was removed: build.rs embed entry, data.rs parse block, types.rs NameEntry + Corpus fields, engine.rs three fns + tests, main.rs tool fns + NameTypeArgs. What was KEPT (re-add = one build.rs line + parse block + tool fns, see git history 518cd34): fetch-names.ts script + data/names.jsonl (58.8 MB, gitignored? no — committed), db migration 0004 + drizzle schema (forward-prep, empty tables cost ~0), LICENSE §10, seed-membership grammarIdLevel fix (independent bug fix, unrelated to names). Verified: cargo build clean, cargo test green BOTH paths (20+2 default, 21+2 vaporetto), release binary 19,052,320 B — back to pre-names size. AGENTS.md updated: crate tool-surface line removed, size tier reverted + removal rationale recorded, db AGENTS notes the schema stays as forward-prep.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped the JMnedict proper-noun corpus end-to-end (doc-2 §2.5/§5.5). AC#1: packages/japanese/scripts/fetch-names.ts (fetch:names script) downloads jmnedict-all from the pinned jmdict-simplified 3.6.2+20260803141815 release → data/names.jsonl with 743,907 rows {id≥5M, word, reading, name_type} — place 227k / surname 128k / given 167k / station / company; ids verified against the corpus (田中 11 rows, 東京駅 station). AC#2: migration 0004 adds names + names_fts (word+reading → vaporetto, external-content, ai/ad/au triggers; NO English twin — JMnedict has no glosses) with the drizzle schema mirror; registered in MIGRATION_FILES; verified on :memory: with vaporetto loaded. AC#3: jlpt-mcp lookup_name/search_name/list_names_by_type — separate from vocab ranking by design (all_names touched only inside the three name fns, provable by grep); E2E through the binary confirmed 田中/東京駅/surname-listing all resolve; parity golden untouched; cargo test green on BOTH feature paths (23+2 default, 24+2 vaporetto) + 3 new engine name tests. AC#4: LICENSE.md §10 records the CC BY-SA 4.0 aggregation + regeneration command. Size: release binary 19.4 → 27 MB (+7.5 MB names gzip) — AGENTS.md size-tier note updated; offline-from-one-binary contract preserved.
<!-- SECTION:FINAL_SUMMARY:END -->
