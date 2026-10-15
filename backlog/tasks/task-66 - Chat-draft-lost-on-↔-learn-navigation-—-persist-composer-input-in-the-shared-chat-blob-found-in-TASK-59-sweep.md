---
id: TASK-66
title: >-
  Chat draft lost on / ↔ /learn navigation — persist composer input in the
  shared chat blob (found in TASK-59 sweep)
status: Done
assignee: []
created_date: '2026-09-10 07:50'
updated_date: '2026-09-10 08:17'
labels:
  - bug
  - frontend
  - ux
dependencies: []
priority: low
ordinal: 532000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in the TASK-59 post-fix sweep (2026-09-10). TASK-59 mounted the AppShell on /; / and /learn/* are route-tree siblings, so / ↔ /learn navigation unmounts one shell and mounts the other — the AI pane's ChatSessionProvider remounts and the composer draft is lost (PersistedChat stores agent/messages/model/persona but NOT input — persistence.ts:27; provider.tsx:115 initializes input as ''). Messages/persona/model survive via the TASK-58 shared blob; only the in-flight draft dies. Newly visible because TASK-59 made / → /learn the app's most common navigation. Fix shape: add input to the persisted shape + persist effect + load path — aligns with the TASK-58 shared-by-design contract. NOT the pathless-layout refactor (one shell across / + /learn/*) — cleaner long-term but a route-tree refactor disproportionate to a draft; record that option here for a future pass if the shells ever need to share more than the blob.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PersistedChat gains input?: string (packages/chat-session/src/types.ts) — persisted via the existing shared-blob effect in provider.tsx, restored on provider mount (input initialized from persisted.input)
- [x] #2 Browser-verified: type a draft in the AppShell rail on /, navigate to /learn/lesson (AppShell remounts), rail shows the draft intact; and the reverse direction
- [x] #3 persistence.test.ts extended: input round-trips through persistChat/loadPersistedChat alongside agent/messages/model/persona
- [x] #4 bun run test + check-types + ultracite clean (packages/chat-session + apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed c9654fd): AC1 — PersistedChat.input added (types.ts, with JSDoc rationale); provider.tsx initializes input from persisted.input and persists it in the shared-blob effect (+dep). AC2 — browser-verified BOTH directions: draft 'Draft survival check す' typed in the / rail survived / → /learn/lesson → /review (chrome-free route, no rail — expected) → /learn/lesson → / (screenshot shows the draft in the landing rail). AC3 — persistence.test.ts: input round-trip + empty-string (cleared stays cleared) + undefined (older blob) cases; 6 tests green. AC4 — turbo 9/9, chat-session 28 tests, tsc clean. DOX: packages/chat-session AGENTS persistence-model note records draft-rides-the-blob.
<!-- SECTION:NOTES:END -->
