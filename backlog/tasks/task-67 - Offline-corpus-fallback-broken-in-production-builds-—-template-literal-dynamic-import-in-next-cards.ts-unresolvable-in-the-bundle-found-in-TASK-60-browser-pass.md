---
id: TASK-67
title: >-
  Offline corpus fallback broken in production builds — template-literal dynamic
  import in next-cards.ts unresolvable in the bundle (found in TASK-60 browser
  pass)
status: Done
assignee: []
created_date: '2026-09-10 09:56'
updated_date: '2026-09-10 10:18'
labels:
  - bug
  - frontend
  - offline
dependencies: []
priority: high
ordinal: 530000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during the TASK-60 browser pass (vite dev log) and confirmed against the production build (2026-09-10). next-cards.ts:32: await import(`@manobu/japanese/data/${fileLevel}.json`) — rolldown cannot analyze the template literal, so it emits the BARE PACKAGE SPECIFIER into the bundle: dist/assets/index-*.js contains import(`@manobu/japanese/data/n5.json`) verbatim, which cannot resolve in a browser (no import map, bare specifier). Evidence: dist/assets has exactly ONE data chunk (n4-CSiHXZT7.js) — from the STATIC literal import at line 141 (the 'work' goal branch) — proving static imports bundle and the glob does not. Impact: loadLocalNextCards is the offline fallback for jlpt/anime goals (TASK-46/47 protected this path); in the Tauri production bundle (frontendDist ../dist) its import throws, the catch returns the static 3-card placeholder — offline users silently get fake cards instead of the real corpus. Dev-mode masking: vite dev serves package paths via node resolution so the SAME code works in dev — only the built bundle breaks. Fix shape: import.meta.glob with eager:false over the five files (vite-analyzable, emits all five chunks), or explicit switch of five static imports; keep the never-throws contract. The lesson_start-per-char GSM noise also spotted in drill-lab.tsx is filed separately.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 loadLocalNextCards resolves all five level files from the PRODUCTION bundle (vite build + preview / tauri bundle): replace the template-literal import at next-cards.ts:32 with a static glob (import.meta.glob) or an explicit switch of five static imports
- [x] #2 vite build emits no 'dynamic import cannot be analyzed' warning for apps/desktop
- [x] #3 Verified in a built bundle (not dev): with the sidecar stopped, the lesson next-cards offline fallback shows REAL corpus entries (n5 first-3), not the static placeholder set — for each of n5..n1 at least once
- [x] #4 bun run test + check-types + ultracite clean (apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed ea7f3f4): AC1 — template-literal import replaced by LEVEL_LOADERS: Record<LevelFile, () => Promise<{default: unknown}>> of five static import() literals (n1..n5), keyed lookup in loadLocalNextCards; never-throws contract + static placeholder fallback kept. AC2 — vite build now emits NO 'dynamic import cannot be analyzed' warning for apps/desktop (next-cards was the only site). AC3 — verified in the BUILT bundle (vite preview :4173, sidecar stopped): route loader per level fetches its OWN chunk — N5→n5-CVxrEmN2.js, N4→n4-CSiHXZT7.js, N3→n3-bJoPKJtv.js, N2→n2-BuKdnW2h.js, N1→n1-CW5R3AOQ.js; the placeholder path returns WITHOUT any chunk fetch, so a level-chunk request is the proof the corpus resolved (n1 chunk contains 嗚呼 — first real N1 entry). AC4 — turbo 9/9, tsc clean, ultracite 285 files clean. Note: lesson.tsx hardcodes useNextCards('N5') for its practice chips (pre-existing, out of scope here) — the loader-level verification above exercises the same loadLocalNextCards path with the real level param. DOX: apps/desktop AGENTS next-cards row records the bundler trap + 'new levels get a static loader + dist/assets chunk check'.
<!-- SECTION:NOTES:END -->
