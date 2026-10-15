---
id: TASK-43
title: >-
  P1 — file-backed API routes 500 in compiled sidecar: import.meta.dir is
  /$bunfs (DATA_DIR walk breaks)
status: Done
assignee: []
created_date: '2026-09-09 12:10'
updated_date: '2026-09-09 12:47'
labels:
  - bug
  - p1
  - sidecar
dependencies: []
priority: high
ordinal: 549000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered during TASK-38 E2E: after the libsql native-addon fix, the sidecar boots and db routes work ({"inserted":[]} from /api/cards), but /api/vocab?level=N5 → 500. Root cause: src/routes/jap-data.ts:23 const DATA_DIR = join(import.meta.dir, '../../../../packages/japanese/data') — inside the bun-compiled binary import.meta.dir is /$bunfs/..., so the repo-relative walk dies. Works in  (source) — masked in dev until now. Same class of bug likely for any other import.meta.dir/require.main usage in routes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /api/vocab, /api/grammar, /api/kanji, /api/kanji/stroke return real data from the COMPILED sidecar binary (tauri dev + packaged), not 500
- [x] #2 DATA_DIR (jap-data.ts:23) resolves from a resource/env-provided path (lib.rs passes MANOBU_DATA_DIR like MANOBU_ASSISTANT_DIR) with the repo-relative import.meta.dir walk kept as dev fallback
- [x] #3 jap-data.ts DATA_DIR resolution documented in apps/server/AGENTS.md next to the TASK-38 native-addon note
- [x] #4 bun run test + check-types clean
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 994c31a): AC#1 — all four routes return real data from the compiled sidecar (clean desktop:dev boot): /api/vocab?level=N5 → vocab rows, /api/grammar → points, /api/kanji?character=食 → KANJIDIC2 fields, /api/kanji/stroke → KanjiVG svg (22MB jsonl stream-scan works through the resource-dir copy). AC#2 — MANOBU_DATA_DIR wired: lib.rs resolves resource-dir packages/japanese/data first, repo-tree walk fallback (walks up 6 levels from exe for dev); data-dir.ts resolveDataDir() honors env → dev walk → cwd → exe-parent, first candidate with n5.json wins; learn-chat.ts generateNextCards returns [] when unresolvable instead of throwing into submit-failed. AC#3 — apps/server/AGENTS.md 'Compiled-binary data files (TASK-43)' bullet (resolver contract + tauri resources semantics + shipped-subset rationale); TASK-38 bullet's related-caveat tail trimmed (superseded). AC#4 — server suite 22/0 (new data-dir.test.ts: 4 cases), tsc clean, ultracite clean. Debugging lessons recorded for posterity: tauri v2 resources map VALUE for file sources is the FULL dest file path (dir value = file write → ENOTDIR/EISDIR); resource staging root is target/debug/ itself (survives build/app-* cleans — purge assistant/ jpdata/ packages/ native-libsql/ when iterating); bun compile canary also broke static .node import (__require) — TASK-38 dead ends apply. Discovered during E2E, filed separately: TASK-44 (no db migrations at boot — 'no such table: cards' on fresh install), TASK-45 (/learn/learn/* double prefix, UI masked by offline fallback).
<!-- SECTION:NOTES:END -->
