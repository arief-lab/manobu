---
id: TASK-80.14.3
title: >-
  S3: client + contract: stream-close = settled, drop lastEventId
  resubscribe-cursor; docs + smoke drain
status: Done
assignee: []
created_date: '2026-09-19 04:17'
updated_date: '2026-09-20 05:00'
labels:
  - orpc
  - ai-chat
  - backend
dependencies:
  - TASK-80.14.2
parent_task_id: TASK-80.14
ordinal: 695000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/chat-session use-chat-engine: the resubscribe path no longer carries lastEventIdRef as the resume mechanism (a fresh chat.subscribe now replays persisted history on the server side, so the client just re-subscribes on socket drop; the ref may stay only if it is not load-bearing — verify). api-contract chat.subscribe doc + packages/chat-session AGENTS + apps/server AGENTS: record the settled-stream contract and that TASK-80.7 AC#3 (persist-every-frame + drain-own-cursor) and TASK-80.12 STAY (oRPC Publisher eval) are superseded by the live/durable split. apps/server/scripts/mcp-smoke.mjs drain(): drop the lastEventId carry-over (fresh subscribe after a drop is enough).
<!-- SECTION:DESCRIPTION:END -->
