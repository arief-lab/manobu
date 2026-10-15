---
id: TASK-77
title: >-
  Settings: no top bar + state audit (single-source voice, review-desk wiring,
  cron react-query)
status: Done
assignee: []
created_date: '2026-09-14 14:24'
updated_date: '2026-09-14 14:29'
labels:
  - frontend
  - desktop
dependencies: []
priority: high
ordinal: 523000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No top bar on /settings; back pill stays inline with tabs (browser-verified)
- [x] #2 Voice: one source of truth (store); TtsProvider mirror + useTtsSetVoice seam deleted; guard updated
- [x] #3 Review desk reads retention + fsrsAdvanced from the store (header pct + D/S verified live); dead batchSize field removed
- [x] #4 ScheduledTasks on react-query (cron queries + mutations in tauri-queries.ts); decomposed under complexity cap; per-job history filter bug fixed + unit-tested
- [x] #5 392/392 tests, tsc + ultracite clean, fallow new-only gate 0 introduced, DOX rows updated
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in 3fdd534. Top bar: /settings header row deleted (browser: first line is the ← desk pill + Learning/App tabs, pill moved inline inside the provider so useSettings still resolves). Voice: TtsProvider is now a useSyncExternalStore read of lib/settings.ts; the useState mirror, setVoice/useTtsSetVoice, and the never-called setSpeed seam are gone; VoiceCard writes the store once (guard test rewritten to pin the single-source contract). Review desk: review.tsx reads retention + fsrsAdvanced through hooks/use-settings-store.ts and passes desiredRetention/showAdvanced into the compound — verified live: 95% slider → header 'Due at R ≤ 95%' + previews recomputed, Advanced toggle → card shows D=5.00 · S=10.00. Dead batchSize store field removed (parseSettings drops it from old blobs; test updated). Cron: cronJobsQueryOptions/cronHistoryQueryOptions + useCronUpsert/Remove/RunNow/ClearHistory in lib/tauri-queries.ts (shared useCronMutation invalidates both keys); ScheduledTasks decomposed into CreateTaskForm + JobRow (fallow complexity introduced: 0), which surfaced a pre-existing bug — per-job history filtered endsWith('|jobId') against firedAt|jobId|status rows and never matched; fixed to split('|')[1] and pinned by test/scheduled-tasks.test.ts (5 tests). Evidence: 392/392 tests, tsc + ultracite clean, fallow new-only gate exit 0 / 0 introduced, browser-verified all four surfaces. DOX: SCR-11 + review-queue + settings.ts + tts-voice + tauri-queries rows, hooks index, features fetch-tier table, stale loader comment.
<!-- SECTION:FINAL_SUMMARY:END -->
