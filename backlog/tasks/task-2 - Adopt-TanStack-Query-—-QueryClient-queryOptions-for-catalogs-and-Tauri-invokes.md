---
id: TASK-2
title: >-
  Adopt TanStack Query — QueryClient + queryOptions for catalogs and Tauri
  invokes
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 10:59'
updated_date: '2026-09-05 13:58'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 625000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
All server-state currently uses raw fetch + useEffect + useState in packages/chat-session/src/fetcher.tsx (useAgentCatalog, usePersonaCatalog, useModelCatalog) and manual fetch in apps/desktop/src/routes/learn/conversation/$sessionId.tsx. This bypasses TanStack Query caching, staleTime, gcTime, retry, signal cancellation, deduplication, background refetch, and the TanStack Router loader integration (ensureQueryData). No QueryClientProvider exists anywhere in apps/web (main.tsx mounts RouterProvider alone) and @tanstack/react-query is not even in apps/desktop/package.json dependencies despite being required by the tanstack-query skill. Tauri invokes (speech_status, fsrs preview/optimize) also lack query wrapping.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add @tanstack/react-query and @tanstack/react-query-devtools to apps/web dependencies
- [x] #2 Create QueryClient with defaultOptions (staleTime 60s, gcTime 5m, retry 2-3, refetchOnWindowFocus true) and wrap RouterProvider in QueryClientProvider in apps/desktop/src/main.tsx
- [x] #3 Refactor useAgentCatalog/usePersonaCatalog/useModelCatalog to use queryOptions + useQuery (hierarchical keys like ["agents"], ["assistants"], ["agents", agentId, "models"]), with enabled guards, staleTime, and signal support
- [x] #4 Convert POST /learn/chat streaming route to useMutation with abort signal and isPending handling in $sessionId.tsx
- [x] #5 Optionally wrap Tauri speech/fsrs invokes as useQuery/useMutation with networkMode offlineFirst where appropriate and verify with bun run check-types + test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add @tanstack/react-query + devtools to apps/web (and @manobu/chat-session peer) — version ^5.90, catalog alignment
2. Create QueryClient in apps/desktop/src/lib/query-client.ts with defaultOptions queries: staleTime 60s, gcTime 5m, retry 3, refetchOnWindowFocus true, refetchOnReconnect true; also define mutation defaults
3. Wrap RouterProvider in QueryClientProvider + ReactQueryDevtools (dev-only) in apps/desktop/src/main.tsx; populate RouterAppContext = { queryClient } in routes/__root.tsx and pass context={queryClient} to createRouter
4. Refactor packages/chat-session/src/fetcher.tsx: create queryOptions helpers (agentCatalogOptions, personaCatalogOptions, modelCatalogOptions(agentId)) with hierarchical keys ["agents"], ["assistants"], ["agents", agentId, "models"], queryFn using fetch with signal, staleTime/gcTime, retry 2, enabled guard for models; keep exported hooks useAgentCatalog/usePersonaCatalog/useModelCatalog as thin wrappers over useQuery(options) returning same shapes (empty fallback)
5. Convert apps/desktop/src/routes/learn/conversation/$sessionId.tsx POST /learn/chat from manual fetch+pending useState to useMutation with mutationFn receiving {message, signal}, abort signal wired to fetch, SSE consumeStream inside mutation, onSuccess appends Message, isPending replaces pending flag, cancel on unmount via mutation abort
6. Optionally wrap Tauri invokes (speech_status, fsrs_preview/optimize) as useQuery/useMutation with networkMode offlineFirst in new apps/desktop/src/lib/tauri-queries.ts or packages/speech hooks
7. Verify: bun run check-types (turbo), bun x ultracite check, manual review of routeTree + ensureQueryData readiness for TASK-3
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: bun run check-types 10/10 pass (web rebuilt 2.78s, chat-session tsc pass), bun x ultracite check 199 files pass (0 errors after fix), bun test apps/web 52/52 pass. Implemented queryClient, provider wrapper, fetcher queryOptions with signal, conversation mutation with AbortController + isPending, tauri queries offlineFirst.

DOX pass 2026-09-05: re-read root/apps/apps/desktop/apps/desktop/src + packages + packages/chat-session AGENTS.md. Updated apps/desktop/src/AGENTS.md (entry points QueryClientProvider, RouterAppContext, lib query-client/tauri-queries, Work Guidance tanstack-query/router). Updated apps/desktop/AGENTS.md (deps @tanstack/react-query/devtools + @tauri-apps/api, Work Guidance tanstack, cross-cutting lib query-client/tauri-queries, conversation  useMutation note). Updated packages/chat-session/AGENTS.md (fetcher exports queryOptions, depends on QueryClientProvider, Work Guidance tanstack). Updated packages/AGENTS.md child index for chat-session. Verified check-types 10/10, ultracite 0 errors. Root + apps/AGENTS.md intentionally unchanged (no hierarchy change).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adopted TanStack Query v5.102: added @tanstack/react-query + devtools to apps/web and chat-session, created QueryClient with staleTime 60s/gcTime 5m/retry 3/refetchOnWindowFocus, wrapped RouterProvider in QueryClientProvider + dev-only ReactQueryDevtools, populated RouterAppContext {queryClient} for loader ensureQueryData. Refactored fetcher.tsx to queryOptions with hierarchical keys ["agents"], ["assistants"], ["agents", agentId, "models"], signal cancellation, enabled guards. Converted /learn/chat SSE route to useMutation with AbortController signal and isPending UI. Added tauri-queries.ts wrapping fsrs_preview/speech_status as offlineFirst useQuery and fsrs_optimize/reschedule as offlineFirst useMutation. Verified with bun run check-types 10/10, ultracite 199 files clean, web tests 52/52.
<!-- SECTION:FINAL_SUMMARY:END -->
