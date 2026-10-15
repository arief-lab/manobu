---
id: TASK-46
title: >-
  Dev-tooling hygiene pass — sidecar script staleness, silent fallbacks, persona
  drift, db handle churn
status: Done
assignee: []
created_date: '2026-09-09 13:44'
updated_date: '2026-09-09 14:33'
labels:
  - bug
  - tooling
  - frontend
dependencies: []
priority: high
ordinal: 546000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four dev-hygiene findings from the TASK-38/43/44 fix sessions (doc-9 QA follow-ups), unified — same species: tooling that silently degrades or misleads during development. (1) sidecar-dev.sh freshness check watches only src/index.ts mtime — edits to jap-data.ts/data-dir.ts/index.ts produced a stale binary that served old code during TASK-43 E2E (cost real debugging time). (2) next-cards.ts:89 + mock.ts fetchGrammarLevel swallow fetch failures into local-corpus fallback with zero logging — the same silent-degradation pattern that hid TASK-45 for weeks; convention: log URL + status, never throw. (3) dev has TWO persona copies: lib.rs resolved target/debug/assistant (resource dir) while sidecar-dev.sh syncs binaries/assistant — edit the wrong one and changes vanish. (4) cards.ts calls createUserDb() per request — fd churn + WAL touched every request; module-level singleton fixes it (perf smell now, real cost later).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 sidecar-dev.sh rebuilds when ANY file under apps/server/src/ is newer than the destination binary (find src -newer), not only src/index.ts — stale-binary repro from TASK-43 E2E can no longer occur
- [x] #2 Shared log-and-fallback helper for server-fetch consumers; applied at minimum to lib/next-cards.ts:89 (!res.ok branch) and lib/mock.ts fetchGrammarLevel — every fallback logs URL + status via console.warn before degrading
- [x] #3 Single persona source of truth in dev: either lib.rs resolves MANOBU_ASSISTANT_DIR to the sidecar-dev.sh-synced binaries/assistant first, or the sync target moves — boot log and disk agree on ONE copy
- [x] #4 cards.ts uses a module-level singleton db client (createUserDb once) instead of per-request opens; WAL files no longer touched on every request
- [x] #5 bun run test + check-types + ultracite clean in apps/server and apps/desktop
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 2da731a): AC#1 — sidecar-dev.sh bun-branch freshness now gates on 'find $APP_PATH/src -type f -newer $SRC_BIN -print -quit' + dest-nt-src; repro verified both directions (touch jap-data.ts → '[sidecar] compiling'; clean tree → skip, 0.2s). AC#2 — new apps/desktop/src/lib/server-fetch.ts::fetchJsonWithFallback (never throws; warns URL + HTTP status or error message on every degradation); next-cards.ts queryFn and mock.ts fetchGrammarLevel rewired; desktop suite 232/0. AC#3 — root cause was tauri dev STAGING bundle.resources into target/debug/ (a third copy no script owned); lib.rs exe-parent-first reorder alone could not fix it because resource staging sits in the app exe's parent. Resolution: sidecar-dev.sh syncs personas to BOTH binaries/assistant AND target/debug/assistant from the single repo-root source every boot; drift probe (append junk to one copy → run script → copies identical) passes. lib.rs keeps exe-first/resource-second order (still correct for packaged). AC#4 — cards.ts module-level userDbPromise shared across handlers (createUserDb called once per process; libsql/drizzle clients are share-safe). AC#5 — server 22/0 (21 pass +1 file), desktop 234/0, tsc + ultracite clean in both packages; live desktop:dev boot E2E: /api/vocab + /api/cards/due serve, [db] migrations applied, personas load from synced dir. Docs: apps/desktop/AGENTS.md new Work Guidance section (script contract: find-newer watch + cp -rL for symlinked native pkgs + dual persona sync); apps/server/AGENTS.md Dev-tooling conventions bullet (singleton client + fetchJsonWithFallback mandate).
<!-- SECTION:NOTES:END -->
