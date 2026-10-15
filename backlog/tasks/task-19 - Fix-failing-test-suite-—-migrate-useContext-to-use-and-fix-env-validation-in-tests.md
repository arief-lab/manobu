---
id: TASK-19
title: >-
  Fix failing test suite — migrate useContext to use() and fix env validation in
  tests
status: Done
assignee:
  - '@arief'
created_date: '2026-09-06 00:51'
updated_date: '2026-09-06 10:03'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 605000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test suite has 4 failures: (1) rule-8 test fails because packages/ui/src/hooks/use-shortcuts.tsx:27 still uses useContext(ShortcutContext) — the React 19 migration to use() is incomplete; (2-4) 3 environment validation errors when VITE_SERVER_URL is undefined during bun test runs. Fix the useContext call to use() pattern and ensure tests load environment or skip env-dependent tests gracefully.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No useContext() callsites remain in packages/ui/src (rule-8 test passes)
- [x] #2 All 228 tests pass with bun test (0 failures, 0 errors)
- [x] #3 Environment-dependent tests handle missing VITE_SERVER_URL gracefully or load it from .env
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Fix useContext → use() migration in use-shortcuts.tsx: replace useContext(ShortcutContext) with use(ShortcutContext), add 'use' to imports from react. 2. Fix env validation in tests: either load .env in test setup or mark tests that depend on VITE_SERVER_URL to skip gracefully when missing. 3. Run bun test to verify all 228 tests pass.

Follow-up (user-requested): the 3 mock.test.ts failures come from bun auto-loading apps/desktop/.env (VITE_SERVER_URL set) so hasServer=true and fetchGrammarLevel's un-guarded fetch rejects with ConnectionRefused, escaping deriveWeakPatterns/computeMockResult. Fix: make fetchGrammarLevel never throw — try/catch around the fetch plus LOCAL_GRAMMAR fallback on connection failure and non-ok responses (matches the repo never-throw offlineFirst contracts and the AGENTS.md 'local test fallback data' description).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed useContext → use() migration in packages/ui/src/hooks/use-shortcuts.tsx (replaced useContext with use, added 'use' to imports). Fixed packages/chat-session/src/multi-mount.test.tsx to wrap with QueryClientProvider (tests were missing this). Test suite now passes with SKIP_ENV_VALIDATION=1 (252/252). Remaining 3 failures without the flag are env validation errors in tests that import @manobu/env/web - these load VITE_SERVER_URL which is undefined in test env. SKIP_ENV_VALIDATION is the supported bypass per packages/env/src/web.ts.

Follow-up (2026-09-06): fixed the 3 mock.test.ts failures. Root cause: bun auto-loads apps/desktop/.env so VITE_SERVER_URL=http://localhost:4317 is set during bun test; mock.ts saw hasServer=true and fetchGrammarLevel's un-guarded fetch rejected with ConnectionRefused, escaping deriveWeakPatterns/computeMockResult (and it would equally crash the SCR-10 result flow during a real server outage). Fix in src/lib/mock.ts: fetchGrammarLevel is now never-throw — returns LOCAL_GRAMMAR when no server is configured, and wraps the fetch in try/catch falling back to LOCAL_GRAMMAR on connection failure, non-ok status, or malformed payload (missing/non-array grammar). Verified: bun test test/ → 100 tests, 0 fail (2 skip) — first fully green desktop suite; mock.test.ts 14 pass incl. a new regression test that stubs globalThis.fetch to reject ConnectionRefused and asserts LOCAL_GRAMMAR fallback + unknown-id degrade to raw grammarId. check-types unchanged (2 pre-existing ai.tsx errors), Ultracite clean on mock.ts + mock.test.ts. DOX: apps/desktop/AGENTS.md mock.ts entry updated.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the 3 failing mock.test.ts cases (TASK-19 AC2 follow-up): bun auto-loads apps/desktop/.env so VITE_SERVER_URL is set in tests, and mock.ts fetchGrammarLevel let the ConnectionRefused fetch rejection escape deriveWeakPatterns/computeMockResult. Made fetchGrammarLevel never-throw with LOCAL_GRAMMAR fallback (also on non-ok/malformed responses) — matching the repo's offline-first never-throw contracts — and added a regression test stubbing fetch to reject. Verified: bun test test/ 100 pass / 0 fail (2 skip); check-types 2 pre-existing ai.tsx errors; Ultracite clean. AC2 now holds without the SKIP_ENV_VALIDATION caveat.
<!-- SECTION:FINAL_SUMMARY:END -->
