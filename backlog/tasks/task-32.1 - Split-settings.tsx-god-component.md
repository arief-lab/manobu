---
id: TASK-32.1
title: Split settings.tsx god component
status: Done
assignee:
  - '@arif'
created_date: '2026-09-08 01:35'
updated_date: '2026-09-08 02:29'
labels:
  - frontend
  - refactor
dependencies: []
references:
  - apps/desktop/src/components/settings.tsx
  - apps/desktop/src/lib/cron.ts
  - apps/desktop/src/lib/tauri-queries.ts
parent_task_id: TASK-32
priority: medium
type: task
ordinal: 574000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/components/settings.tsx is 1456 lines covering SCR-11 Settings tabs plus SpeechModels, ScheduledTasks (cron), mcp catalog, and Privacy. It mixes Tier 1 loader-warmed speech queries with in-component cron and mcp invokes, making review and ownership hard. Splitting along existing tab and section boundaries restores the Vercel composition pattern without changing behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SpeechModels section extracted to its own compound file, imported by Settings, no behavior change
- [x] #2 ScheduledTasks cron section extracted to its own compound file backed by lib/cron.ts, no behavior change
- [x] #3 settings.tsx under 600 lines and each new compound follows Object.assign Root Sub pattern
- [x] #4 bun run check-types, bun x ultracite check, and bun run test pass from apps/desktop
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extract lines 300-707 (VadRow + SpeechModels section) to settings-speech-models.tsx and lines 709-1134 (ScheduledTasks + helpers) to settings-scheduled-tasks.tsx via exact line-slice; settings.tsx imports both back. 2. Trim imports per file (tsc + ultracite fix to converge). 3. Keep Settings compound API identical (ScheduledTasks stays a member via re-export). 4. Verify settings.tsx under 600 lines plus check-types, ultracite check, bun test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified: settings.tsx 415 lines (<600); SpeechModels (431 lines) + ScheduledTasks (441 lines, backed by lib/cron.ts) + PrivacyTab extracted; compound API unchanged (Settings.ScheduledTasks still a member). Fixed stale SettingsTab import in routes/settings.tsx (now from settings-scope) and env key sort in packages/env/src/web.ts. bun run check-types: pass. bun x ultracite check: clean (255 files). bun run test: 212 pass, 2 skip, 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split the 1456-line settings.tsx god component along tab/section boundaries: SpeechModels -> settings-speech-models.tsx (Tier 1 loader-warmed speech queries), ScheduledTasks -> settings-scheduled-tasks.tsx (lib/cron.ts invokes), PrivacyTab -> settings-privacy.tsx. settings.tsx is now 415 lines and imports both back; Settings compound API (Object.assign Root Sub) unchanged. Fixed a stale SettingsTab re-export in routes/settings.tsx (now imported from settings-scope) and an env key-sort lint in packages/env/src/web.ts. Verified with bun run check-types (pass), bun x ultracite check (clean, 255 files), and bun run test (212 pass, 2 skip, 0 fail).
<!-- SECTION:FINAL_SUMMARY:END -->
