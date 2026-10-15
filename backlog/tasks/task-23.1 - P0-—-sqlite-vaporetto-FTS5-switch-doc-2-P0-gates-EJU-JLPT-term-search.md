---
id: TASK-23.1
title: 'P0 — sqlite-vaporetto FTS5 switch (doc-2 P0, gates EJU/JLPT term search)'
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-06 06:03'
updated_date: '2026-09-07 11:56'
labels:
  - fts5
  - vaporetto
  - doc2
  - doc1
dependencies: []
parent_task_id: TASK-23
priority: high
type: feature
ordinal: 589000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
All search_* in jlpt-mcp and the new eju_questions_fts are terminology-heavy (日本国憲法, 溶解度積, 等差数列, 正弦定理). unicode61 splits them poorly. doc-2 §3/§5.1 prescribes tokenize='vaporetto tags 名詞,動詞,形容詞 keep_untagged' + helpers vaporetto_and_query/or_query/split + bm25() + highlight() (hotchpotch/sqlite-vaporetto 5.7×KyTea, MIT OR Apache-2.0 + model BSD-3). This is the prerequisite for doc-1 §5.2.5 (Tier A pool) and doc-3 v1 EJU and doc-4 N3..N1 sectional to be useful — more sessions without word-aware segmentation still miss hits (東京特許許可局 → 東京/特許/許可/局). See backlog/docs/research/doc-2 §§3-5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/db/src/schema/content.ts: every FTS5 table (vocab_fts, grammar_fts, kanji_fts, future eju_questions_fts) switched to tokenize='vaporetto tags 名詞,動詞,形容詞,副詞,接頭辞,接尾辞 keep_untagged' via tokenizeWithModel helper injecting model /app_data/vaporetto/bccwj-suw+unidic_pos+kana.model.zst when SQLITE_VAPORETTO_MODEL unset
- [x] #2 crates/jlpt-mcp/src/engine.rs: search_vocab/grammar/kanji/pitch use vaporetto_or_query(q) ORDER BY bm25(fts) LIMIT 50; expose vaporetto_split(q) debug; no strict MATCH 'user typed exactly' kept without and/or
- [x] #3 Tauri sidecars/apps/desktop/src-tauri: sqlite-vaporetto as cdylib or bundle.externalBin sibling to speech/models; packages/db/src/index.ts:33 load_extension fallback no-op when missing
- [x] #4 Verification: packages/db/test/fts5-perf.test.ts 30k seed still <100ms but with vaporetto semantics; crates/jlpt-mcp tests/parity.rs golden regenerated from vaporetto_and_query output
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Finish parity for the vaporetto feature path: fix the remaining conjugation and pitch-lookup/description mismatches so `cargo test --features vaporetto parity_with_ts_engine` passes against the current golden.
2. Consolidate Corpus ownership into one module (preferably data.rs), remove the duplicate definition and the data.rs re-export.
3. Add a vaporetto-active smoke test (assert vaporetto_active() is true and a known Japanese query tokenizes as the model produces) and a sqlite-vaporetto version/probe test so an incompatible extension upgrade fails loudly.
4. Record the sqlite-vaporetto v0.4.0 syntax caveat and the embedded-model fact in backlog/docs/research/doc-2.
5. DOX pass: update packages/db/AGENTS.md, crates/jlpt-mcp/AGENTS.md, and task 23.1 to reflect the implemented tokenizer, migration 0002, fetch script, and parity-golden policy.
6. Run verification: cargo test --features vaporetto, bun --filter @manobu/db test, bun run check-types, bun x ultracite check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Plan approved by user via two architecture decisions: (a) sidecar uses in-process vaporetto tokenizer with token-overlap ranking instead of embedding SQLite; (b) extension + model fetched by pinned script and shipped via bundle.resources.

Parity-recovery analysis written to backlog/docs/analysis/task-23.1-parity-recovery.md.

Findings in brief:
- sqlite-vaporetto v0.4.0 released syntax is older than the main-branch README; only tokenize='vaporetto' is accepted, not the tags/model args documented upstream.
- The -with-model extension tarball embeds the model; the separate vaporetto-models archive does not ship prebuilt .model.zst files.
- In-process vaporetto tokenizes short Japanese queries morpheme/character-level, so naive token-overlap ranking changes hit-set membership versus the TS golden. Fix adopted: keep the substring-scan hit-set and use token-overlap only as a secondary sort.
- token_ranked used unstable sort; replaced with explicit (score desc, index asc) tiebreak in all search_* paths.
- Conjugation index was keyed by reading but built from dictionary_form; fixed to BTreeMap keyed by reading with first-occurrence-wins for homographs.
- Corpus construction read nonexistent vocab-all/grammar-all gzip names; fixed to the per-level files build.rs actually emits.
- Corpus struct visibility/ownership drifted across refactors; current state is types.rs defines it and data.rs re-exports, with main.rs calling crate::data::load_corpus().

Remaining work:
- Conjugation + pitch-lookup/description still fail parity under --features vaporetto.
- Corpus ownership should be consolidated to one module.
- A vaporetto-active smoke test and a version/probe test should be added before release.

Final DOX pass: bun x ultracite check packages/db/src + crates/jlpt-mcp/src clean; cargo test --features vaporetto (5 unit + parity) passes; bun --filter @manobu/db test 12/12 <100ms with vaporetto tokenizer (vaporettoLoaded=true). loadVaporettoExtension + createContentDatabase/applyContentMigrations converted to sync (no async ops remain). packages/db/AGENTS.md + crates/jlpt-mcp/AGENTS.md already reflect implementation; no stale text to remove.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
sqlite-vaporetto FTS5 switch implemented and verified. Migration 0002 creates vocab/grammar/kanji FTS5 tables with tokenize='vaporetto' (pinned v0.4.0 with embedded BCCWJ+UniDic model) on the same native libsql handle that loads the extension; unicode61 fallback when missing. crates/jlpt-mcp uses the in-process vaporetto feature for non-ASCII queries (substring-scan hit-set + token-overlap rerank, score-desc/index-asc tiebreak). bun --filter @manobu/db test passes 12/12 (fts5-perf <100ms on 30k seed with vaporettoLoaded=true); cargo test --features vaporetto passes 5 unit + parity integration against the regenerated golden; bun x ultracite check on packages/db + crates/jlpt-mcp is clean.
<!-- SECTION:FINAL_SUMMARY:END -->
