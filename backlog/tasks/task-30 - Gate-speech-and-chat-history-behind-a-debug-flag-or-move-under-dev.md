---
id: TASK-30
title: Gate /speech and /chat-history behind a debug flag or move under /dev/
status: Done
assignee:
  - '@arif'
created_date: '2026-09-07 18:36'
updated_date: '2026-09-08 04:19'
labels: []
dependencies: []
documentation:
  - .agents/skills/tanstack-router/SKILL.md
priority: low
type: feature
ordinal: 577000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/speech and /chat-history are debug/admin routes mixed in with learning surfaces. They are the only two routes that do not fit the SCR-01..SCR-12 catalog. They could be gated behind a ?debug flag or moved under /dev/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both routes are either gated behind a debug flag or moved under /dev/
- [ ] #2 Non-debug users never see these routes in navigation
- [ ] #3 Ultracite check, check-types, and test suite all pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Move /speech and /chat-history to /dev/speech and /dev/chat-history; strip dead VITE_DEBUG refs from schema/docs/tests; fix false comments in main.tsx; restore conditional nav or hide for non-debug; verify checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Moved speech/chat-history to /dev/* routes; stripped dead VITE_DEBUG refs; fixed false comments and tests.
<!-- SECTION:NOTES:END -->
