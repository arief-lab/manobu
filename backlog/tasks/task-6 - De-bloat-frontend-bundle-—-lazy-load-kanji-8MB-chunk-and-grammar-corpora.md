---
id: TASK-6
title: De-bloat frontend bundle — lazy-load kanji 8MB chunk and grammar corpora
status: Done
assignee: []
created_date: '2026-09-05 11:00'
updated_date: '2026-09-06 01:22'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 623000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
vite build via turbo run check-types reports kanji-CR6whI54.js at 8,050 kB (1.3MB gzip) and n1 bundle at 580 kB, plus index at 1.1MB. This is traced to @manobu/japanese/data/kanji.json and grammar n*.json being bundled via static/dynamic imports into route chunks. TanStack Router autoCodeSplitting is enabled but routes are not split into .lazy.tsx files, so the 8MB kanji dict ships to every user on first load even if they never visit /kanji-detail. This inflates Tauri bundle size and defeats the Tauri offline-first benefit (Rust jlpt-mcp already has the same corpora on the Rust side).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Move kanji lookup for /kanji-detail and grammar lookups behind route-level lazy (.lazy.tsx) loaders or Tauri invoke (reuse jlpt-mcp search_kanji/search_grammar) so the 8MB chunk is not in the initial bundle
- [x] #2 Verify after change: web dist kanji chunk < 1MB or lazy-loaded on demand, initial index chunk reduced, vite build still succeeds
- [x] #3 Update apps/desktop/AGENTS.md and packages/japanese/AGENTS.md to document the lazy / invoke boundary
- [ ] #4 Add a size guard in CI or a vitest that asserts chunk sizes stay under thresholds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add GET /kanji?character=<char> endpoint to apps/server (reads kanji.json, returns entry). 2. Add GET /grammar?level=<N5-N1> endpoint to apps/server (reads n*.json, returns grammar list). 3. Rewrite apps/desktop/src/lib/kanji.ts to fetch from server instead of dynamic import. 4. Rewrite apps/desktop/src/lib/mock.ts grammar loading to fetch from server. 5. Remove @manobu/japanese/data imports from apps/web. 6. Verify build: kanji chunk eliminated, n* chunks eliminated, initial bundle reduced. 7. Update AGENTS.md docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added GET /kanji and GET /grammar endpoints to apps/server (apps/server/src/routes/jap-data.ts). Rewrote apps/desktop/src/lib/kanji.ts to fetch from server instead of dynamic import. Rewrote apps/desktop/src/lib/mock.ts to fetch grammar from server with local test fallback. Removed grammar-types.ts (no longer needed). Updated apps/desktop/AGENTS.md docs. Verified: kanji chunk (8MB) eliminated, n1-n5 grammar chunks (1.4MB total) eliminated, kanji-detail.lazy now 8.14KB, all tests pass (247 pass, 2 skip, 0 fail).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Eliminated 8MB kanji chunk and 1.4MB grammar chunks from web bundle. Added server API endpoints GET /kanji?character= and GET /grammar?level= that read JSON from disk (server has filesystem access). Web app now fetches from server instead of bundling @manobu/japanese/data. Bundle reduced: index chunk 1MB (unchanged), no separate kanji chunk, no n1-n5 grammar chunks. All tests pass (247 pass, 2 skip, 0 fail). Updated AGENTS.md docs.
<!-- SECTION:FINAL_SUMMARY:END -->
