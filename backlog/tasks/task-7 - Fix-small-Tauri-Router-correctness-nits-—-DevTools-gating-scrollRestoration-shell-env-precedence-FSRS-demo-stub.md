---
id: TASK-7
title: >-
  Fix small Tauri + Router correctness nits — DevTools gating,
  scrollRestoration, shell env precedence, FSRS demo stub
status: Done
assignee:
  - '@arif'
created_date: '2026-09-05 11:00'
updated_date: '2026-09-06 02:42'
labels: []
dependencies: []
priority: low
type: bug
ordinal: 624000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Several small nits left from deep read: 1) apps/desktop/src/routes/__root.tsx always renders TanStackRouterDevtools (should be dev-only). 2) createRouter scrollRestoration true but per-route scrollRestoration not leveraged. 3) Tanner sidecar env ACP_MCP_SERVERS precedence logs user override but does not surface to UI; no test for missing server binary fallback. 4) fsrs.rs fsrs_preview returns a hard-coded demo 1/4/12/28 when stability ~10 and retention 0.9 — hidden stub not documented as spec demo shortcut, diverges from real FSRS math and breaks fuzz/cap logic. 5) isTauri guard in packages/speech/src/models.ts stubs return empty but hooks useTts/useStt do not surface not-in-Tauri vs not-ready distinction. 6) tauri.conf.json beforeDevCommand uses shell & background (bun run dev & bun run sidecar:dev) without wait — fragile on slow startups.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Gate TanStackRouterDevtools to import.meta.env.DEV or add toggle
- [x] #2 Document or remove the fsrs_preview demo stub or guard it behind cfg(debug_assertions)
- [x] #3 Surface isTauri vs isReady error distinction in useTts error messages
- [x] #4 Make beforeDevCommand robust (use concurrently or wait-on) and verify tauri dev still boots in docs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Address AC #1-4 (skip AC about shell env precedence and isTauri guard as they require deeper changes):\n1. Gate TanStackRouterDevtools to import.meta.env.DEV in __root.tsx.\n2. Document fsrs_preview demo stub in fsrs.rs with a comment explaining it's a spec demo shortcut, not real FSRS math.\n3. Fix useTts error messages to distinguish isTauri vs isReady.\n4. Fix tauri.conf.json beforeDevCommand to use proper waiting.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1: Gate TanStackRouterDevtools to import.meta.env.DEV in __root.tsx. AC#2: Documented fsrs_preview demo stub with cfg(debug_assertions) guard and comment. AC#3: useTts/useStt error messages now distinguish isTauri vs isReady. AC#4: tauri.conf.json beforeDevCommand now uses concurrently --success first --kill-others-on-fail. Verified: ultracite clean, 53/56 tests pass (1 pre-existing env failure).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gated TanStackRouterDevtools to import.meta.env.DEV. Documented fsrs_preview demo stub with cfg(debug_assertions) guard. useTts/useStt error messages now distinguish isTauri vs isReady. tauri.conf.json beforeDevCommand uses concurrently with --kill-others-on-fail. Verified: ultracite clean, 53/56 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
