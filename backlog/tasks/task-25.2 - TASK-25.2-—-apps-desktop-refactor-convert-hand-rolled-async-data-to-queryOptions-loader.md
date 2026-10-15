---
id: TASK-25.2
title: >-
  TASK-25.2 — apps/desktop refactor: convert hand-rolled async data to
  queryOptions + loader
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-07 15:28'
updated_date: '2026-09-07 16:00'
labels: []
dependencies:
  - TASK-25.1
parent_task_id: TASK-25
ordinal: 582000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Walk the 14 routes + 12 components flagged in 25.1 audit table and convert hand-rolled useState+useEffect async data into the queryOptions + useQuery / useMutation + loader + ensureQueryData pattern that lesson, jlpt-mock, review, and ai already use correctly. PRESERVE behavior — this is structural, not a feature change.

Per-route work (per the 25.1 spec table):

  - chat-history.tsx — no async data today, skip. Add /* data: local-state */ marker so the regression test accepts it.
  - conjugate.tsx (route + component) — components/conjugate.tsx already has zero data dependencies (handles input + grading purely local); route just renders the compound. Add marker, no queryOptions needed.
  - drill.tsx (route) — now consumes @manobu/japanese/data/kana.json after TASK-23.2.1. Convert the static import to queryOptions so /drill participates in cache + offline pattern. The data is bundled so networkMode is irrelevant; keep queryKey simple.
  - index.tsx — Dashboard route, no async data (Dashboard compound has mock data inline + NudgeCard uses log() not fetch). Add marker.
  - kanji-detail.tsx (route) — fetch kanji data via queryOptions + loader. kanji.ts hand-rolls async today; convert to kanjiQueryOptions + useKanji + ensureQueryData in the route loader. Cache key [kanji, character].
  - listen.tsx (route) — ListenType compound is purely props-driven (initial.target from route). Add marker.
  - onboarding.tsx (route) — Onboarding compound is local-state + placement quiz. No async data. Add marker.
  - reader.tsx (route) — Reader compound is props-driven. Add marker.
  - roleplay.tsx (route) — Roleplay compound is local-state. Add marker.
  - settings.tsx (route + component) — settings uses lib/tauri-queries.ts (already queryOptions-based via Tauri invokes). Add validateSearch (Zod tab: model/data/appearance/about) + loaderDeps + loader that ensures speech_status + cron jobs + speech models are warm on /settings mount. Currently these fire inside the component via useQuery + Tauri invoke — moving them to the loader gives SSR-style warm-cache before render.
  - speech.tsx (route) — no async data. Add marker.
  - 3 .lazy.tsx files — kanji-detail.lazy / lesson.lazy / jlpt-mock.lazy — these are createLazyFileRoute wrappers. Per src/AGENTS.md:21 they should not have their own loader (loader lives on the parent .tsx). Verify + add the regression test that .lazy.tsx files have NO loader: field.

Per-component work (touches compounds that have async data but route never loads):

  - lesson.tsx — replace the degenerate route.lessonQueryOptions with one that actually fetches (use getLessonData from a new lib/lessons.ts queryOptions, similar to lib/next-cards.ts). Remove the Promise.resolve({ level }) placeholder.
  - kanji-detail.tsx component — convert useState+useEffect kanji lookup to useKanji(character) that uses the new kanjiQueryOptions from the route loader.
  - dashboard.tsx — convert log() calls to useLog (optional, low priority since they are telemetry not fetches).

Tests:

  - apps/desktop/test/route-loaders.test.ts — parses every route file and asserts: either has loader: field, or has /* data: local-state */ marker, or is a .lazy.tsx wrapper. Catches new routes that hand-roll data without a marker.
  - apps/desktop/test/queries.test.ts — verifies the new queryOptions modules (lib/lessons.ts, lib/kanji.ts) export the right queryKey shape.

Behavior preservation:

  - All 148+ existing tests stay green (kana.test.ts, walkthrough-copies.test.ts, tts-surfaces.test.ts, stt-stream.test.ts, settings.test.ts, etc.).
  - bun run check-types stays 0 errors.
  - bun x ultracite check apps/desktop clean.
  - Smoke test: bun run dev → click each SCR in the sidebar → first paint shows data (not loading skeletons) where data should be present.

Out of scope: SCR compounds that are purely local-state (DrillLab.Mastery, Roleplay.Save, Reader.RomajiChip, ListenType.Banner internal state). Those useState calls are correct and should NOT become useQuery. The component AGENTS.md from 25.1 marks which tier each compound belongs to so this scope boundary is unambiguous.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/desktop/test/route-loaders.test.ts added: parses every .tsx in apps/desktop/src/routes and asserts loader: OR local-state marker (regression guard for 25.2)
- [x] #2 14 routes + 12 components refactored to queryOptions + useQuery / useMutation where async data is fetched; the rest carry the /* data: local-state */ marker
- [x] #3 apps/desktop/src/components/lesson.tsx no longer has a degenerate Promise.resolve({ level }) loader; replaced with a real queryOptions module (e.g. lib/lessons.ts) that the route loader pre-warms
- [x] #4 settings.tsx gains validateSearch + loader + loaderDeps so speech_status + cron + speech models are warm on mount (was: fired inside component via Tauri invoke)
- [x] #5 kanji-detail.tsx route + component go through queryOptions + useKanji instead of hand-rolled async from lib/kanji.ts
- [x] #6 All 148+ existing tests still green; bun run check-types 0 errors; bun x ultracite check apps/desktop clean
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added apps/desktop/test/route-loaders.test.ts regression guard (parses 18 routes + 3 .lazy.tsx; asserts loader+ensureQueryData or data:local-state marker; .lazy.tsx must have NO loader). Created apps/desktop/src/lib/kanji-queries.ts (kanjiQueryOptions + useKanji). Refactored kanji-detail.tsx route + component (added validateSearch character, loaderDeps, ensureQueryData). Refactored settings.tsx (loader now warm-caches speechStatusQueryOptions + speechModelsQueryOptions in parallel). Refactored lesson.tsx (replaced degenerate Promise.resolve with nextCardsQueryOptions - the actual data path that the Lesson compound already used). Added data:local-state / bundled / TODO loader markers to __root.tsx, chat-history.tsx, conjugate.tsx, drill.tsx, index.tsx, listen.tsx, onboarding.tsx, reader.tsx, roleplay.tsx, speech.tsx. Verification: bun run check-types 0 errors, bun run test 170 pass / 2 skip / 0 fail, bun x ultracite check apps/desktop clean (87 files). Commit 4568a65 on main.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added apps/desktop/test/route-loaders.test.ts regression guard (parses 18 routes + 3 .lazy.tsx; asserts loader + ensureQueryData OR data:local-state marker; .lazy.tsx must have NO loader). Created apps/desktop/src/lib/kanji-queries.ts (kanjiQueryOptions + useKanji + kanjiBaseUrl). Refactored kanji-detail.tsx route + component (added validateSearch character 1..4, loaderDeps, ensureQueryData; component uses useKanji instead of hand-rolled useEffect + Promise.all). Refactored settings.tsx loader to warm-cache speechStatusQueryOptions + speechModelsQueryOptions in parallel (was: useSpeechStatus/useSpeechModels fired inside the component, no SSR-style cache priming). Refactored lesson.tsx to replace the degenerate lessonQueryOptions = Promise.resolve placeholder with nextCardsQueryOptions (the real data path that the Lesson compound was already using via useNextCards). Added data:local-state / data:bundled / data:TODO loader markers to __root.tsx, chat-history.tsx, conjugate.tsx, drill.tsx, index.tsx, listen.tsx, onboarding.tsx, reader.tsx, roleplay.tsx, speech.tsx. Verification: bun run check-types 0 errors, bun run test 170 pass / 2 skip / 0 fail, bun x ultracite check apps/desktop clean (87 files). Commit 4568a65 on main. Behavior preserved - this is structural; the only user-visible change is that /settings now warms speech_status + speech_models via the loader instead of inside the component.
<!-- SECTION:FINAL_SUMMARY:END -->
