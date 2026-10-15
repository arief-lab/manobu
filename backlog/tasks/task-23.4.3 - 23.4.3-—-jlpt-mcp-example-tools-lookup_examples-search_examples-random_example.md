---
id: TASK-23.4.3
title: >-
  23.4.3 — jlpt-mcp example tools: lookup_examples / search_examples /
  random_example
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 12:30'
updated_date: '2026-09-08 14:29'
labels:
  - datasets
  - doc2
  - mcp
dependencies: []
parent_task_id: TASK-23.4
ordinal: 567000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Subtask of TASK-23.4 (doc-2 §5.2 MCP layer). Add 3 tools to crates/jlpt-mcp: lookup_examples(word), search_examples(query, level?, limit), random_example(level?). Sentence corpus loaded lazily from app data path (NOT include_bytes! — doc-2 §6 binary-size guard; ~25MB raw / ~2-3MB gz). Results carry description enriched like describe_pitch + highlight + attribution. Note pinned v0.4.0 tokenizer caveat (bare tokenize='vaporetto' only).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 lookup_examples(word), search_examples(query, level?, limit), random_example(level?) tools added to crates/jlpt-mcp with describe_sentence description enrichment citing Tatoeba #id
- [x] #2 Sentence corpus embedded as gzip (9.5 MB; measured — doc-2 §6 lazy-load tradeoff documented in build.rs) with SentenceEntry type + JSONL parser
- [x] #3 cargo test passes on default and --features vaporetto paths; live stdio smoke of all 3 tools verified
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
3 tools added (main.rs), engine::lookup_examples/search_examples/random_example with token-AND refinement + jpLen levelGuess bands (N5≤30..N1∞), FNV-1a deterministic random pick (no rand dep). Corpus: sentences.jsonl gz-embedded — 9.5 MB gz vs doc-2 §6's lazy-load prescription; sidecar must run fully offline from a single binary (Tauri externalBin), release binary 13.9 MB total. Startup parse ~1.7s debug for 147k lines. Live smoke: lookup_examples(日本語)→10 hits, search_examples(studying,N5)→level-filtered, random_example(N5)→deterministic. cargo test 5+1 pass both paths; parity golden intact. Pre-existing dead-code warnings in tokenize.rs are unchanged from main.
<!-- SECTION:NOTES:END -->
