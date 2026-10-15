---
id: TASK-33
title: Decouple desktop tests from vite env and refresh DOX index for /learn routes
status: Done
assignee: []
created_date: '2026-09-08 01:50'
updated_date: '2026-09-08 01:52'
labels:
  - frontend
  - tests
  - docs
dependencies: []
references:
  - apps/desktop/test/next-cards.test.ts
  - apps/desktop/AGENTS.md
priority: medium
type: task
ordinal: 570000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-29: test/next-cards.test.ts imports lib/next-cards.ts which pulls @manobu/env/web, so the pure-logic unit test only passes when VITE_SERVER_URL happens to be set (bun auto-loads .env locally, CI may not). Separately, the apps/desktop AGENTS.md SCR catalog and components tier table still reference the old flat src/routes/*.tsx paths after the /learn regrouping.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 next-cards.test.ts passes with VITE_SERVER_URL unset (explicit test env setup, no reliance on local .env)
- [x] #2 apps/desktop AGENTS.md and components AGENTS.md reference src/routes/learn/* paths for the moved surfaces
- [x] #3 bun run test, bun run check-types, and bun x ultracite check pass from apps/desktop
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add test/setup.ts preload that defaults VITE_SERVER_URL when unset; wire --preload into the test script so env-coupled imports validate deterministically. 2. Update apps/desktop/AGENTS.md SCR catalog route paths to src/routes/learn/* plus the Existing-routes paragraph; update components/AGENTS.md Tier 3 Route column. 3. Verify: bun test with VITE_SERVER_URL explicitly unset, check-types, ultracite check. (Chart quoting verdict: not a bug — TanStack default JSON search serialization, lossless round-trip; no code change.)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Chart verdict: NOT a bug. TanStack Router default search serialization is JSON-based (router-core searchParams.js: defaultStringifySearch wraps JSON.stringify; strings starting with a digit like 0 re-serialize quoted, plain words like gojuon pass through). Parse side is symmetric (JSON.parse with raw fallback), so validateSearch receives correct values on every path and deep links round-trip — no code change. Test fix: added test/setup.ts preload defaulting VITE_SERVER_URL with ??= plus --preload in the test script; proved by removing .env (207 pass with preload) vs next-cards.test.ts failing without preload (0 pass/1 fail import-time env error). Docs: SCR catalog + Existing-routes paragraph + guard description in apps/desktop/AGENTS.md, Tier 1/3 tables in components/AGENTS.md, and new-route guidance in src/AGENTS.md now reference src/routes/learn/*.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Decoupled desktop tests from vite env via test/setup.ts preload (proven with .env removed) and refreshed the DOX index to src/routes/learn/* paths. Chart quoting investigated and cleared as TanStack default JSON search encoding, not a bug. Verified: 207 tests pass, check-types exit 0, ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
