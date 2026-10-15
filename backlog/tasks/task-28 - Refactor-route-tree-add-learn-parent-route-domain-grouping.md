---
id: TASK-28
title: 'Refactor route tree: add /learn parent route + domain grouping'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-07 18:26'
updated_date: '2026-09-07 18:38'
labels: []
dependencies: []
documentation:
  - .agents/skills/tanstack-router/SKILL.md
priority: high
type: feature
ordinal: 579000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The generated route tree (`apps/desktop/src/routeTree.gen.ts`) is a flat 17-route surface with no nested grouping. Three design smells: (1) `/learn/conversation/$sessionId` is orphaned — the on-disk path `src/routes/learn/conversation/$sessionId.tsx` implies a parent that does not exist, so TanStack Router flattens it to a root-level path. (2) No domain grouping — practice surfaces (drill, listen, reader, conjugate, roleplay, lesson), assessment (jlpt-mock, review), and meta (settings, onboarding, ai, chat-history, speech, kanji-detail, dashboard) are all flat siblings of `__root__`, so `AppShell` renders the sidebar everywhere including `/onboarding` and `/settings` where it is noise. (3) `/speech` and `/chat-history` are debug/admin routes mixed in with learning surfaces.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Create `src/routes/learn.tsx` parent route with `createFileRoute("/learn")` and `<Outlet />` layout
- [x] #2 Regenerate `routeTree.gen.ts` via `bun run dev` — verify `/learn/conversation/$sessionId` is now a child of `/learn`
- [x] #3 Update `apps/desktop/AGENTS.md` route audit table with the new `/learn` parent route
- [x] #4 Update `route-loaders.test.ts` regression guard if needed
- [x] #5 Ultracite check, check-types, and test suite all pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create `src/routes/learn.tsx` parent route with `createFileRoute("/learn")` + `<Outlet />` layout, no loader (data: local-state). Reuse existing `AppShell` chrome for learn routes only.
2. Run `bun run dev` to regenerate `routeTree.gen.ts`. Verify `/learn/conversation/$sessionId` is now a child of `/learn` in the generated file.
3. Update `apps/desktop/AGENTS.md` route audit table: add SCR-?? row for the new `/learn` parent route (Tier 2 local-state), update SCR-01 Dashboard description if needed.
4. Update `apps/desktop/test/route-loaders.test.ts` regression guard if the new route requires special handling.
5. Run `bun x ultracite check .`, `bun run check-types`, and `bun run test` from `apps/desktop` to verify all pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ultracite check: clean. bun test: 209 pass / 2 skip / 0 fail. bun run check-types: clean. route-loaders.test.ts: 23 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created src/routes/learn.tsx parent route (createFileRoute("/learn") + Outlet layout, no loader). Regenerated routeTree.gen.ts — /learn/conversation/$sessionId is now a child of /learn. Updated apps/desktop/AGENTS.md with the new /learn parent route entry. Updated route-loaders.test.ts ROUTES array to include learn.tsx. Verified: Ultracite clean, bun test 209 pass / 2 skip / 0 fail, check-types clean.
<!-- SECTION:FINAL_SUMMARY:END -->
