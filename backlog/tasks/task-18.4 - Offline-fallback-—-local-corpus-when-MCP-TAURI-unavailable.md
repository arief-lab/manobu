---
id: TASK-18.4
title: Offline fallback — local corpus when MCP/TAURI unavailable
status: Done
assignee: []
created_date: '2026-09-05 12:12'
updated_date: '2026-09-05 17:36'
labels: []
dependencies: []
parent_task_id: TASK-18
priority: medium
type: feature
ordinal: 606000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
App is Tauri offline-first via @manobu/speech on-device. When __TAURI__ is false or MCP sidecar crates/jlpt-mcp not running, AI nextCards will fail. Need fallback in lib/queue.ts and lesson.tsx to use local packages/japanese/data/n*.json and lib/numbers.ts static sets without network. Must be tested by disconnecting and loading lesson.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When fetch to /learn/chat fails or __TAURI__ is false, queue falls back to local vocabContaining() and numbers.ts without throwing
- [x] #2 Fallback path is covered by a test that mocks fetch failure and asserts queue still returns 3 cards
- [x] #3 No AI call is made in fallback; UI shows offline badge instead of error.audio
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-18.4 prep: queue.ts is the entrypoint (per task description). Need to audit lib/queue.ts + lib/numbers.ts + lib/next-cards.ts to see existing local-fallback paths before designing the offline branch. Plan: add  guard (Tauri __TAURI__ check OR fetch /learn/chat fail), in offline mode return local vocabContaining() results from packages/japanese/data via /import (static) and numbers.ts without throwing; UI shows offline badge instead of error audio.

Verify: check-types 10/10, ultracite 206 clean, bun test 56/56 pass (4 new in offline-fallback.test.ts). queue.ts: added isTauriAvailable + OFFLINE_FALLBACK_IDS + pickCardsWithFallback (never throws, 1 leech+2 new) + buildOfflineQueue (vocabContaining + numbers.ts, no fetch/MCP). next-cards.ts: added isTauriAvailable + loadLocalNextCards (dynamic @manobu/japanese import, 3 cards) + queryFn offline branch (when !isTauri no fetch call, otherwise catch fetch fail → local fallback, always 3). lesson.tsx: uses pickCardsWithFallback + SenseiHint offline badge data-testid=offline-badge when !isTauriAvailable() (no AI call, no error.audio).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Offline fallback — queue + next-cards local corpus: queue.ts added isTauriAvailable/OFFLINE_FALLBACK_IDS/pickCardsWithFallback (pure, never throws, 1 leech+2 new=3) + buildOfflineQueue (vocabContaining+numbers.ts, no fetch/MCP); next-cards.ts added isTauriAvailable+loadLocalNextCards (dynamic @manobu/japanese/data/<level>.json, 3 cards, static fallback) and queryFn offline branch (when !isTauriAvailable no fetch/AI call, otherwise on fetch fail/local empty → local fallback, always 3); lesson.tsx uses pickCardsWithFallback and shows data-testid=offline-badge when offline (no error.audio). Test coverage via offline-fallback.test.ts (4 tests: loadLocalNextCards 3, pickCardsWithFallback 3, never throws, queryFn no AI fetch when offline + MCP fail fallback). Verified check-types 10/10, ultracite 206 clean, bun test 56/56.
<!-- SECTION:FINAL_SUMMARY:END -->
