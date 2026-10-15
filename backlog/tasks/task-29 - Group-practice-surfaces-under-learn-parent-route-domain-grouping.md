---
id: TASK-29
title: Group practice surfaces under /learn parent route (domain grouping)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-07 18:36'
updated_date: '2026-09-08 01:45'
labels: []
dependencies: []
documentation:
  - .agents/skills/tanstack-router/SKILL.md
priority: medium
type: feature
ordinal: 576000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The route tree is 17 flat routes with no parent hierarchy. The mental model is really: practice surfaces (drill, listen, reader, conjugate, roleplay, lesson) + assessment (jlpt-mock, review) + meta (settings, onboarding, ai, chat-history, speech, kanji-detail, dashboard). A /learn parent route with children would let __root__ render the sidebar only on learn routes instead of everywhere. Right now AppShell is global, so the sidebar shows on /onboarding and /settings where it is noise. TASK-28 added the /learn parent route for /learn/conversation/$sessionId; this task extends it to host the practice surfaces.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Move drill, listen, reader, conjugate, roleplay, lesson under /learn/ as children
- [x] #2 AppShell sidebar renders only on /learn routes, not on /onboarding or /settings
- [x] #3 All existing deep links preserved (or updated with 301-style redirects)
- [x] #4 Ultracite check, check-types, and test suite all pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AC1 verify-only: confirm drill/listen/reader/conjugate/roleplay/lesson already live under src/routes/learn/* with createFileRoute(/learn/*) and routeTree parenting (done per routeTree.gen.ts). 2. AC2: move AppShell out of __root.tsx (global wrapper) into learn.tsx layout so sidebar + AI pane render only on /learn/*; keep Header/Theme/Tts/Toaster/AskSensei global in __root with a plain centered Outlet for non-learn routes. 3. AC3: add six legacy redirect stubs at old flat paths (src/routes/drill|listen|reader|conjugate|roleplay|lesson.tsx) using beforeLoad redirect to /learn/* preserving search params, each carrying a data:local-state marker for the route-loaders guard. 4. Extend test/route-loaders.test.ts ROUTES with learn/* children plus redirect stubs. 5. Verify: bun x ultracite check, bun run check-types, bun run test from apps/desktop.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1 was already staged in the tree (learn/* children + routeTree parenting); verified via regenerated routeTree.gen.ts, no code change needed. AC2: moved AppShell from __root.tsx to learn.tsx layout; __root keeps Header/Theme/Tts/Toaster/AskSensei global with a plain centered main for non-learn routes. AC3: six beforeLoad redirect stubs (drill/listen/reader/conjugate/roleplay/lesson) forwarding search; $sessionId.tsx gained a data:local-state marker and route-loaders guard now covers learn/* + stubs (13 new assertions). Validation: bun test 207 pass/2 skip/0 fail; check-types exit 0; ultracite 100 files clean; browser checks on vite preview confirmed all six redirects with search preserved and sidebar present on /learn/drill but absent on /onboarding and /settings.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Grouped practice surfaces under /learn: AppShell moved from __root to the /learn layout so the sidebar shows only on learn routes, six legacy flat paths redirect to /learn/* preserving search, and the route-loaders guard covers the new tree. Verified with bun test (207 pass), check-types (exit 0), ultracite clean, and browser checks of all redirects plus sidebar presence/absence.
<!-- SECTION:FINAL_SUMMARY:END -->
