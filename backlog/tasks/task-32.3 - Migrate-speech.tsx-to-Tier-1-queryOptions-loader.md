---
id: TASK-32.3
title: Migrate speech.tsx to Tier 1 queryOptions loader
status: Done
assignee:
  - '@arif'
created_date: '2026-09-08 01:36'
updated_date: '2026-09-08 12:00'
labels:
  - frontend
  - refactor
dependencies: []
references:
  - apps/desktop/src/routes/speech.tsx
  - apps/desktop/src/lib/tauri-queries.ts
parent_task_id: TASK-32
priority: low
type: task
ordinal: 571000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/routes/speech.tsx is marked data local-state but hand-rolls useEffect calls for speechStatus, speechVersion, and listModels instead of using lib/tauri-queries.ts queryOptions plus a route loader. The file itself carries a TODO to migrate. This is the last known Tier 0 async pattern outside the component tier split and blocks the convention that every async fetch goes through queryOptions plus ensureQueryData.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 speech.tsx consumes speechStatusQueryOptions and speechModelsQueryOptions from lib/tauri-queries.ts
- [x] #2 Route defines a loader with ensureQueryData or keeps an explicit data local-state marker with a documented reason
- [x] #3 No hand-rolled useEffect remains for async speech data
- [x] #4 route-loaders guard and bun run test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Migrate dev.speech.tsx useEffect data to queryOptions loader via lib/tauri-queries.ts; remove hand-rolled async useEffect; verify tests/pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Migrated dev.speech.tsx to loader (queryOptions) + removed useEffect. Tested format.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migrated dev.speech.tsx to Tier 1 loader with speechStatus/speechModels queryOptions + ensureQueryData; removed hand-rolled useEffect. Verified: route-loaders guard 28 pass, desktop suite 212 pass, check-types + ultracite check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
