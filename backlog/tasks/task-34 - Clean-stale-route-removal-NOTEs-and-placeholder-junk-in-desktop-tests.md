---
id: TASK-34
title: Clean stale route-removal NOTEs and placeholder junk in desktop tests
status: Done
assignee: []
created_date: '2026-09-08 01:55'
updated_date: '2026-09-08 01:56'
labels:
  - frontend
  - tests
dependencies: []
references:
  - apps/desktop/test/kana-chart.test.ts
  - apps/desktop/test/stt-stream.test.ts
  - apps/desktop/test/walkthrough.test.ts
priority: low
type: task
ordinal: 569000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-29 reinstated the drill/listen/lesson surfaces under src/routes/learn/* plus legacy redirect stubs, but kana-chart.test.ts, stt-stream.test.ts, and walkthrough.test.ts still carry NOTEs claiming those route files are gone, with gutted assertions and _unused_* placeholder constants. Restoring the assertions against the new paths brings back the structural coverage that was dropped.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No stale NOTE claiming drill/listen/lesson routes are removed remains in the three files
- [x] #2 Route-file assertions are reinstated against src/routes/learn/* paths and pass
- [x] #3 No _unused_* placeholder constants remain; bun run test and ultracite check pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. kana-chart.test.ts: re-point gutted drill/listen assertions at src/routes/learn/drill.tsx + learn/listen.tsx, drop _unused_* junk and _DATA_ rename. 2. stt-stream.test.ts: re-point Shadow assertion at learn/listen.tsx, drop _unused_existsSafe, restore strict file reads. 3. walkthrough.test.ts: refresh NOTE and reinstate goal-plumbing checks against learn/lesson.tsx. 4. Verify with bun test + ultracite check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Restored assertions against reinstated paths: kana-chart.test.ts re-reads learn/drill.tsx (marker + KATAKANA_GOJUON filter) and learn/listen.tsx (KanaChart + ALL_CELLS); stt-stream.test.ts asserts learn/listen.tsx mounts <ListenType.Shadow /> with strict file reads (error-swallowing helper removed); walkthrough.test.ts reinstates three goal-plumbing checks against learn/lesson.tsx (goal enum, loader + loaderDeps + ensureQueryData, default travel). Removed _DATA_ rename and all _unused_* placeholders. Validation: 212 pass / 0 fail (+5 vs TASK-33 baseline), ultracite 101 files clean, check-types exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Cleaned stale route-removal NOTEs and placeholder junk from kana-chart, stt-stream, and walkthrough tests; assertions reinstated against src/routes/learn/* paths. Verified: 212 tests pass, check-types exit 0, ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
