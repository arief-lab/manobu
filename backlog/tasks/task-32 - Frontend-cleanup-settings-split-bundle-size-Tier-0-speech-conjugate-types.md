---
id: TASK-32
title: 'Frontend cleanup - settings split, bundle size, Tier 0 speech, conjugate types'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-08 01:35'
updated_date: '2026-09-08 12:00'
labels:
  - frontend
  - refactor
dependencies: []
references:
  - apps/desktop/AGENTS.md
  - apps/desktop/src/components/AGENTS.md
priority: medium
type: task
ordinal: 573000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frontend review of apps/desktop found four structural issues in one subsystem that hurt maintainability and load performance: settings.tsx is a 1456-line god component mixing model/FSRS/voice/speech-models/cron/mcp/privacy concerns, the web bundle ships a 1013 kB index chunk with statically bundled dictionaries and schemas, speech.tsx still hand-rolls async effects against the Tier 1 queryOptions convention, and conjugate.tsx escapes type safety with any for TanStack Form. Fixing them together keeps the SCR compound and loader conventions intact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All four sub-issues are resolved and verified via check-types, ultracite check, and bun test
- [x] #2 No SCR compound contract or route loader behavior regresses (route-loaders guard still passes)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Frontend cleanup complete: settings.tsx split into compounds (32.1), web bundle reduced + cron dynamic import fixed (32.2), dev.speech.tsx migrated to queryOptions loader (32.3), any types removed from conjugate + settings/speech-models/scheduled-tasks/conversation form integration (32.4). Verified with bun run check-types (11 tasks OK), bun x ultracite check (386 files clean), bun run test (9 tasks, 0 fail), desktop suite 212 pass incl. route-loaders guard.
<!-- SECTION:FINAL_SUMMARY:END -->
