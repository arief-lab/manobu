---
id: TASK-3
title: >-
  Fix TanStack Router gaps — context, loaders, validateSearch, notFound, lazy
  splitting
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 10:59'
updated_date: '2026-09-05 14:26'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 626000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TanStack Router is wired minimally (routeTree.gen.ts + createRouter with defaultPreload intent) but violates several skill best practices. RouterAppContext in apps/desktop/src/routes/__root.tsx is Record<string, never> (empty), so loaders cannot inject QueryClient/auth via createRouter context and no route defines a loader. All 16 file routes use createFileRoute without loaders, beforeLoad, validateSearch, loaderDeps, errorComponent, pendingComponent, or notFoundComponent. Root router has no defaultNotFoundComponent. Huge built chunks (kanji 8MB, index 1.1MB) show no lazy route splitting (posts.lazy.tsx pattern). This leaves prefetch, type-safe search params, and auth guards unimplemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Populate RouterAppContext with QueryClient (and auth) and pass via RouterProvider context={queryClient}
- [x] #2 Add loaders using queryClient.ensureQueryData + queryOptions for at least /ai catalogs and /review cards; use loaderDeps where search params drive reloading
- [x] #3 Add validateSearch with Zod for routes that carry query state (e.g., /review, /lesson filters, /settings tab) and wire useSearch/useNavigate correctly
- [x] #4 Add defaultNotFoundComponent at router level and per-route errorComponent/pendingComponent where appropriate
- [x] #5 Split heavy routes (kanji-detail, lesson, mock) into .lazy.tsx code-split files to reduce initial bundle; verify routeTree.gen.ts regeneration and bun run check-types clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm AC1 RouterAppContext already populated by TASK-2 (apps/desktop/src/routes/__root.tsx interface + main.tsx context={queryClient}); note verification evidence and add defaultNotFoundComponent wiring as part of AC4
2. Add loaders with queryClient.ensureQueryData:
   - /ai: loader using Promise.all([ensure agentCatalogQueryOptions, ensure personaCatalogQueryOptions]) from @manobu/chat-session/fetcher; component switches to useSuspenseQuery or useLoaderData where appropriate
   - /review: create reviewCardsQueryOptions in lib/review.ts wrapping SEED query, use in loader; add loaderDeps for search-driven reload
   - Use loaderDeps where search params drive reloading (e.g., /review batch, /lesson level)
3. Add validateSearch (Zod) for routes carrying query state: /review (tab/batch), /lesson (level/filter), /settings (tab enum settings|model|fsrs|voice|privacy); wire Route.useSearch() + useNavigate() to update search via navigate({search})
4. Add defaultNotFoundComponent to createRouter in main.tsx and per-route notFoundComponent/errorComponent/pendingComponent (Loader) for at least /review, /lesson, /ai; use notFound() throw in loaders where id not found (e.g., kanji-detail char not in dict)
5. Split heavy routes into .lazy.tsx: move component/pending/error to kanji-detail.lazy.tsx, lesson.lazy.tsx, jlpt-mock.lazy.tsx keeping loader+validateSearch in .tsx; enable autoCodeSplitting verification via vite build chunks and bun run check-types clean
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: bun run check-types 10/10 pass (vite build 2.56s, index 1,022kB down from 1,149kB, kanji 8MB still separate but lazy chunks kanji-detail.lazy 8.4k, lesson.lazy 8.4k, jlpt-mock.lazy 8k split from main), bun x ultracite check 202 files clean (0 errors after fix), bun test apps/web 52/52 pass, routeTree.gen.ts regenerated with .lazy(() => import(...)) for 3 heavy routes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed TanStack Router gaps: AC1 RouterAppContext {queryClient} populated in __root.tsx:17 + main.tsx:11 via TASK-2; added defaultNotFoundComponent + defaultErrorComponent in createRouter. AC2 loaders via ensureQueryData for /ai (agent/persona catalogs) and /review (reviewCardsQueryOptions) + /lesson + /jlpt-mock with loaderDeps for search. AC3 validateSearch Zod for /review (batch 1..100), /lesson (level N5..N1), /settings (tab model/data/appearance/about), /jlpt-mock (filter) wired via Route.useSearch()/useNavigate() with useCallback. AC4 defaultNotFound at router level + per-route pending/error/notFound (Loader) for 7 routes. AC5 split kanji-detail, lesson, jlpt-mock into .lazy.tsx via createLazyFileRoute, verified routeTree.gen.ts lazy(() => import) and vite build shows index 1,022kB (down 127kB) + 3 lazy chunks 8k each. Verified check-types 10/10, ultracite 202 clean, web tests 52/52.
<!-- SECTION:FINAL_SUMMARY:END -->
