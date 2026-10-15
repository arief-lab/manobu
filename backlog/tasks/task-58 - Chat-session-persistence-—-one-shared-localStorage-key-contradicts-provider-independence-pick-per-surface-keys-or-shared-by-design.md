---
id: TASK-58
title: >-
  Chat-session persistence — one shared localStorage key contradicts provider
  independence (pick: per-surface keys or shared-by-design)
status: Done
assignee: []
created_date: '2026-09-10 04:00'
updated_date: '2026-09-10 04:12'
labels:
  - bug
  - frontend
  - design
dependencies: []
priority: medium
ordinal: 535000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in the TASK-57 post-fix sweep (2026-09-10). persistence.ts:9 uses a single key manobu:chat:v1; every ChatSessionProvider instance (ai.tsx, app-shell rail, ask-sensei widget, dev.chat-history) loads it on mount and overwrites it on every state change (provider.tsx:126 persist effect). In-memory the providers are independent (multi-mount.test.tsx pins that), but persistence makes the last writer's state the one every surface loads — drafts, persona, model, and history cross-contaminate between surfaces. Visible since the TASK-35 rail shipped: /ai history appears in the /learn rail. The read-only /dev/chat-history also mounts a writing provider (idempotent today, fragile tomorrow). Neither broken nor crashing — an unmade product decision half-implemented both ways; the fix is choosing one model and making code + tests agree.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Decision recorded in packages/chat-session AGENTS (or provider.tsx JSDoc): one shared conversation across surfaces OR independent per-surface state — with the contradiction against multi-mount.test.tsx resolved
- [x] #2 (n/a — shared-by-design chosen; AC listed for the fork) If per-surface: persistence.ts keys namespaced per surface (e.g. manobu:chat:v1:<surface>) and mount API accepts a surface id; drafts/persona/model no longer leak between /ai, the AppShell rail, the widget, and /dev/chat-history
- [x] #3 If shared-by-design: multi-mount.test.tsx extended to pin the persistence-sharing contract (independent in-memory, shared persisted blob — last writer wins documented), and /dev/chat-history mounts read-only (no persist write on mount)
- [x] #4 bun run test + check-types + ultracite clean (packages/chat-session + apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 4829a21): Decision = shared-by-design (AC3 path). Rationale: teacher conversation is ONE thread — per-surface keys would fragment continuity between the rail/widget and /ai, which is the product intent (doc-2 Teacher AI). Implemented: provider.tsx readOnly prop (skips persist effect); dev.chat-history.tsx mounts readOnly (was writing the shared blob); multi-mount in-memory independence untouched; persistence.test.ts (new, 5 tests) pins single-key + write-through + last-writer-wins + corrupt/missing fallbacks. Browser-verified: widget-sent message appears in /learn rail transcript (continuity), chat-history renders without writing, /ai unaffected. Suites 9/9, package 28 tests, ultracite + tsc clean. DOX: packages/chat-session AGENTS 'Persistence model' contract paragraph.
<!-- SECTION:NOTES:END -->
