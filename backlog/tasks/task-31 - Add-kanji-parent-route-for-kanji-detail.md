---
id: TASK-31
title: Add /kanji parent route for /kanji-detail
status: Done
assignee:
  - '@arif'
created_date: '2026-09-07 18:36'
updated_date: '2026-09-08 12:16'
labels: []
dependencies: []
documentation:
  - .agents/skills/tanstack-router/SKILL.md
priority: low
type: feature
ordinal: 578000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/kanji-detail is a detail route with no parent. It is a leaf with no parent route. Same pattern as /learn/conversation/$sessionId — it could be a child of a /kanji parent route, but there is no such parent. Adding a /kanji parent route would give it a proper hierarchy and a place to host shared kanji chrome (e.g., a kanji grid or search surface).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Create src/routes/kanji.tsx parent route with createFileRoute("/kanji") and Outlet layout
- [x] #2 Regenerate routeTree.gen.ts via bun run dev — verify /kanji-detail is now a child of /kanji
- [x] #3 Update apps/desktop/AGENTS.md route audit table with the new /kanji parent route
- [x] #4 Update route-loaders.test.ts regression guard if needed
- [x] #5 Ultracite check, check-types, and test suite all pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create src/routes/kanji.tsx parent layout (createFileRoute('/kanji') + header + Outlet, data:local-state marker) mirroring learn.tsx. 2. Move kanji-detail under /kanji: create src/routes/kanji/detail.tsx (+ detail.lazy.tsx) with the existing validateSearch/loader/loaderDeps and delete flat kanji-detail.tsx/lazy. 3. Update navigation links to /kanji-detail if any. 4. Regenerate routeTree.gen.ts via bun run dev (or vite build). 5. Update route-loaders.test.ts ROUTES/LAZY_WRAPPERS. 6. Update apps/desktop/AGENTS.md route audit + child index. 7. Verify: ultracite check, check-types, bun test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created kanji.tsx parent layout + moved SCR-09 to kanji/detail.tsx (+ detail.lazy.tsx); flat kanji-detail routes removed (no inbound links found, no redirect stub needed). routeTree.gen.ts regenerated via vite build — /kanji/detail confirmed child of /kanji. Guard updated to kanji/detail.tsx + kanji/detail.lazy.tsx (29 pass). DOX updated in apps/desktop/AGENTS.md (SCR-09 row + routes-not-in-index + stale dev.speech TODO removed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added /kanji parent route and moved /kanji-detail under it as /kanji/detail (kept validateSearch/loader/loaderDeps/pending/error/notFound + lazy code-split). Verified: route-loaders guard 29 pass, desktop suite 213 pass / 0 fail, bun run check-types 11/11, ultracite check clean (257 files), vite build regenerated routeTree.gen.ts with /kanji/detail nested under /kanji.
<!-- SECTION:FINAL_SUMMARY:END -->
