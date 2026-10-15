---
id: TASK-51
title: >-
  DB build/typecheck split hardening — phantom tsbuildinfo interleaving,
  cross-package dist echo, fixture log noise
status: Done
assignee: []
created_date: '2026-09-09 16:47'
updated_date: '2026-09-09 17:12'
labels:
  - bug
  - tooling
dependencies: []
priority: medium
ordinal: 541000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three follow-ups from TASK-50's own verification (2026-09-09), same tooling-lies family: (1) PHANTOM UP-TO-DATE RISK: TASK-50 split packages/db into build (composite, emits src/) and typecheck (noEmit, covers test/) tsconfigs. Both configs typecheck overlapping files with different option sets and separate default tsbuildinfo caches. The happy path was verified once, but the interleaved sequence (rm -rf dist; typecheck; typecheck; tsc -b; typecheck, and the inverse) was NOT — if tsc -b's incremental state can say up-to-date while dist/ lacks files, a consumer of @manobu/db/dist gets phantom-up-to-date builds. Needs proof-or-fix. (2) WIDENING: bun's substring test-path filter applies repo-wide — during the TASK-50 filing run, apps/desktop dist test copies executed and failed on missing VITE_SERVER_URL. db was the only turbo-wired test script that trips today; eliminate the class, not the instance. (3) NOISE: intentional fixtures print error-shaped lines (acp JSON parse errors, desktop fallback probes, db unicode61-forced warnings) that read as failures in CI and skim — [fixture] prefix on the log lines.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Interleaving proof or fix: a scripted sequence (rm -rf packages/db/dist; typecheck; typecheck; tsc -b; typecheck — plus the inverse order) runs with zero phantom-up-to-date states; if tsc -b can report up-to-date while dist/ lacks emitted files (stale tsbuildinfo from the split configs disagreeing), fix the tsBuildInfoFile locations so build and typecheck caches cannot interact, and encode the passing sequence as a script or test
- [x] #2 Cross-package dist echo eliminated: no compiled test copy (dist/test/*.test.js) in ANY package can be picked up by bun's substring test filter — either every composite tsconfig excludes test/** from emit (same split as db: typecheck config covers tests with noEmit) or turbo test tasks filter explicitly; verified by running the repo-wide bun run test after a full turbo check-types and asserting no dist/test file executes
- [x] #3 Fixture log lines are self-identifying: intentional error-path fixtures in tests (acp malformed mcp-servers.json, desktop HTTP 400 / missing-VITE_SERVER_URL fallback probes, db unicode61-forced warnings) print a [fixture] prefix so CI/skims cannot mistake them for real failures
- [x] #4 bun run check-types + bun run test + bunx ultracite check all green from repo root after the changes
- [x] #5 DOX updated: packages/db AGENTS build-config bullet extended with the tsbuildinfo isolation rule if AC1 changes file layout; any package gaining the split gets its AGENTS bullet
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 592b9f7): AC1 — verify-tsbuild-state.mjs proves: (a) typecheck config writes NO tsbuildinfo (composite:false + noEmit, incremental off outside tsc -b) → caches cannot interact by construction; (b) the script REPRODUCED the phantom — after PARTIAL dist deletion tsc -b reports up-to-date while index.js missing (buildinfo lies). Fix: fresh-dist-guard.mjs runs before every tsc -b via the db 'build' script — buildinfo present but any src/*.ts lacking its dist/*.js → wipe dist → full rebuild. verify:build-state routes builds through the guarded script (raw tsc -b in the script bypassed the guard on first attempt — caught because the phantom re-fired); all four assertions green. Blast radius documented: db exports point at src/*.ts, dist is dev-only byproduct. AC2 — apps/server split: new tsconfig.typecheck.json (noEmit + test/**), build tsconfig includes src/** only; dist/test copies (data-dir.test.js, routes.smoke.test.js) no longer emitted. agent/skills include test but have no composite/outDir — never emitted, no change needed. AC3 — acp mcp-catalog.test.ts intercepts console.warn (accumulate, afterAll re-print with [fixture] prefix); first attempt reset the buffer per-test so afterAll flushed nothing — fixed to accumulate; verified 4 [fixture] lines print, 9/0. AC4 — repo check-types 12/12, test 9/9, ultracite clean after fixing 9 auto-fixables (tsconfig formatting, sorted keys, useConst) + 1 manual (guard's inner regex → TS_TO_JS module const). AC5 — packages/db/AGENTS.md split bullet extended (guard + verify + blast radius); apps/server/AGENTS.md gains Typecheck/build split bullet.
<!-- SECTION:NOTES:END -->
