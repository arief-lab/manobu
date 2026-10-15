---
id: TASK-50
title: >-
  DB test-infra hygiene — dist/ echo breaks bun test filter, empty EXT env
  footgun
status: Done
assignee: []
created_date: '2026-09-09 16:31'
updated_date: '2026-09-09 16:44'
labels:
  - bug
  - tooling
  - db
dependencies: []
priority: medium
ordinal: 542000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two follow-ups from TASK-49's verification, both found 2026-09-09, both reproducible: (1) bun's CLI test path argument is a SUBSTRING filter, not a directory restriction — after apps/server check-types runs tsc -b and regenerates packages/db/dist/, the next bun test v1.4.0-canary.1 (a0e221e07)
[assistant] loaded 2 persona(s) from /home/arif/Projects/mano/manobu-gg/assistant: polite-san, sensei
[db] migrations applied (tokenizer=vaporetto, vaporetto=true)
[ai] listening on :3000
<-- GET /
--> GET / 200 5ms
<-- GET /agents
--> GET /agents 200 1ms
<-- GET /assistants
--> GET /assistants 200 0ms
<-- POST /ai
--> POST /ai 400 3ms
<-- GET /nonexistent
--> GET /nonexistent 404 1ms
[fts5-perf] tokenizer=vaporetto vaporettoLoaded=true
[assistant] loaded 2 persona(s) from /home/arif/Projects/mano/manobu-gg/assistant: polite-san, sensei
[db] migrations applied (tokenizer=vaporetto, vaporetto=true) in packages/db also executes dist/test/*.test.js (compiled copies) whose bundled ./migrations/*.sql relative imports don't exist under dist/ → suite errors 'Cannot find module'. TASK-49 only removed the stale dist (symptom); the next check-types recreates it. (2) resolveVaporettoExtPath's  treats empty string as unset and falls through to the dev-dir default — the intuitive way to force unicode61 silently does nothing (TASK-49's guard test had to point at a deliberately nonexistent path instead).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/db test script is immune to tsc -b output: either tsconfig excludes test/** from emit, dist is cleaned before test runs, or the script filters to real test files — verified by running apps/server check-types (regenerates packages/db/dist) immediately followed by packages/db bun run test → all green, no dist/test duplicates executed
- [x] #2 SQLITE_VAPORETTO_EXT='' (empty string) explicitly disables the vaporetto extension in resolveVaporettoExtPath (check for undefined OR empty string, or a documented sentinel) — verified by a unit check that '' returns null/false while an existing dev-dir default still resolves
- [x] #3 A comment or docs line in src/vaporetto.ts states how to disable the extension (empty string honored after the fix)
- [x] #4 bun run test + check-types + ultracite clean in every touched package
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed a6a482d): AC1 — root fix is a tsconfig SPLIT, not a test-script hack: packages/db/tsconfig.json (composite build) now includes src/** only, so tsc -b emits no dist/test copies; new tsconfig.typecheck.json (noEmit, includes test/**) is what check-types runs — full static coverage of tests retained without emitting them. Verified with the exact original failure sequence: apps/server check-types (tsc -b regenerates db dist) → dist contains NO test copies → packages/db bun run test 21/0 (18 prior + 3 new). Chosen over 'rm -rf dist && bun test test/' (works but thrashes the build cache every test run) and over excluding tests entirely (loses static checking). AC2+3 — resolveVaporettoExtPath now: set-but-empty returns null (explicit disable → unicode61), set path honored verbatim, unset resolves dev-dir default; '' vs unset distinction documented in the vaporetto.ts header block; 3 unit tests added to the TASK-49 guard file (6 pass there). AC4 — repo-wide: bun run check-types 12/12 turbo tasks, bun run test 9/9 successful, ultracite clean 275 files. DOX: packages/db/AGENTS.md (scripts bullet: split configs + NEVER re-add test/** to the build tsconfig + dist is disposable), packages/AGENTS.md (db index entry mentions split-typing contract). INCIDENTAL FIND during filing (left unfiled — monitor): the same bun substring-filter semantics affect OTHER packages' compiled test copies too (apps/desktop dist test copies fail on missing VITE_SERVER_URL when picked up); db was the only package with a turbo-wired test script hitting it today — widen TASK-50 scope if another package grows tests.
<!-- SECTION:NOTES:END -->
