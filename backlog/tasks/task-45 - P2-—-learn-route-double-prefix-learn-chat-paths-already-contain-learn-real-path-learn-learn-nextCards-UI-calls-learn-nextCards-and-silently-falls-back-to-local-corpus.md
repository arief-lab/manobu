---
id: TASK-45
title: >-
  P2 — /learn route double prefix: learn-chat paths already contain /learn (real
  path /learn/learn/nextCards); UI calls /learn/nextCards and silently falls
  back to local corpus
status: Done
assignee: []
created_date: '2026-09-09 12:41'
updated_date: '2026-09-10 02:48'
labels:
  - bug
  - p2
  - sidecar
dependencies: []
priority: low
ordinal: 548000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered in TASK-43 E2E: learn-chat.ts defines app.get('/learn/nextCards') but index.ts mounts it at app.route('/learn', ...) → served at /learn/learn/nextCards. lib/next-cards.ts:87 fetches /learn/nextCards → 404 → offline fallback masks it (UI works, server route dead). Same class check: POST /learn/chat is called by UI at /ai? No — /ai is a separate wrapper; verify /learn/chat callers too.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /learn/nextCards?level=N5 returns nextCards from the server (mount prefix fixed: either strip /learn from learn-chat paths or mount at root)
- [x] #2 UI still works (it falls back either way); note in apps/server/AGENTS.md route map
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 1c516fe): AC1 — learn-chat.ts routes redefined as /chat + /nextCards (relative to the /learn mount in index.ts); live E2E: GET /learn/nextCards?level=N5 serves nextCards JSON; old /learn/learn/nextCards → 404. AC2 — UI unchanged (offline fallback intact); companion caller fix: conversation/$sessionId.tsx fetched the RELATIVE /learn/chat — on web dev that hit vite (no proxy) and silently failed (TASK-46-class silent degradation); now ${baseUrl}/learn/chat via @manobu/env/web. Verification: server 26/0, desktop 232/0, tsc + ultracite clean. DOX: apps/server AGENTS route map records the relative-path convention.
<!-- SECTION:NOTES:END -->
