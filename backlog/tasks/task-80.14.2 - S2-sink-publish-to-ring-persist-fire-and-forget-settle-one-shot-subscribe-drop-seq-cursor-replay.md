---
id: TASK-80.14.2
title: >-
  S2: sink publish-to-ring (persist fire-and-forget + settle) + one-shot
  subscribe, drop seq-cursor replay
status: Done
assignee: []
created_date: '2026-09-19 04:17'
updated_date: '2026-09-20 05:00'
labels:
  - orpc
  - ai-chat
  - backend
dependencies:
  - TASK-80.14.1
parent_task_id: TASK-80.14
ordinal: 694000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Apps/server chat-persistence.sinkFor + chat-rpc subscribe. sinkFor: build live wire frame from the event, publish to the ring first (in-memory order is the liveness source of truth), then DB write fire-and-forget (append/update in-place, durability layer unchanged), terminal-output still coalesces into the lane (never persisted), settle(hub) on finish/error. New toLiveFrame(event, turnId, msgId) mirrors toWireFrame. chat-rpc subscribe: one-shot generator: if hub.terminal → yield persisted history only (listHistory) and end; else yield in-memory frames (ring then lane) and wait the settled promise + client-abort race (80.10 preserved), then drain any late in-memory frames before the terminal one lands. Mid-turn reconnect (oRPC auto-resubscribe) = fresh call → the in-memory tail path. Drop parseEventId/wireEventId/drainRows + the lastEventId resubscribe-cursor semantics as the resume mechanism (oRPC still carries the param but it is ignored by the server; client stops relying on it).
<!-- SECTION:DESCRIPTION:END -->
