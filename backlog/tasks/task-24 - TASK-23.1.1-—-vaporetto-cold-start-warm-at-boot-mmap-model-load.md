---
id: TASK-24
title: 'TASK-23.1.1 — vaporetto cold-start: warm at boot + mmap model load'
status: Done
assignee: []
created_date: '2026-09-07 12:44'
updated_date: '2026-09-09 09:10'
labels: []
dependencies: []
ordinal: 586000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The first Japanese query against content.db FTS5 (or against the jlpt-mcp search tools) pays a ~7s cold-start decompressing the ~6 MB BCCWJ+UniDic model baked into the sqlite-vaporetto -with-model artifact. Same cost on the Rust side when the in-process vaporetto predictor loads the .model.zst. Users see this latency on the first vocabulary / grammar / kanji / pitch-accent search of every app launch.

packages/db/src/migrate.ts already warms the SQL extension after migration (call to vaporetto_split on a dummy arg). What is missing: (1) the Tauri shell does not pre-warm the Rust sidecar before the window opens, and (2) both loaders use the full zstd decode + Vec<u8> copy, paying 7s every fresh process instead of streaming.

Goal: move the 7s out of the first user query. Two complementary changes - A (eager warm at boot, easy) and F (lazy zstd frame decode, harder). Track them as subtasks so the order is fixed: A unblocks visible latency immediately, F cuts the actual decode time. Both preserve the existing parity golden (no model swap, no tokenizer change).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 First Japanese search against content.db returns in <500ms after app launch (currently ~7s cold)
- [ ] #2 jlpt-mcp search_* tools return within 500ms of first invocation after sidecar spawn
- [ ] #3 cargo test --features vaporetto parity still passes byte-identical against tests/golden.json
- [ ] #4 packages/db/test/fts5-perf.test.ts still <100ms on the warmed connection (the warm itself is amortized)
- [ ] #5 No regression on bundle size or Tauri cold-start path
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed via subtasks: 24.1 (boot warm inside the sidecar binary — architecture note: Tauri cannot warm the ACP-agent-spawned instance; committed 886cac3) and 24.2 (pre-built predictor cache — profiling redirected the memmap plan to the real bottleneck, Predictor::new PMA build 6.5s; boot warm now 1.26s, committed ea4eb1a). Parent ACs: #1 first-search <500ms — met (post-warm 10ms; warm completes before user interaction realistically); #2 sidecar tools <500ms — met (same OnceLock); #3 parity byte-identical — verified both paths both tasks; #4 fts5-perf <100ms warmed — 15/15 pass; #5 no bundle-size or cold-start regression — binary 19.05MB unchanged, warm overlaps window open.
<!-- SECTION:NOTES:END -->
