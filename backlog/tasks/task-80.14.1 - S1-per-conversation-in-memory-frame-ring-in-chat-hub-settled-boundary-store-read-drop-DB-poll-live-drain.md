---
id: TASK-80.14.1
title: >-
  S1: per-conversation in-memory frame ring in chat-hub + settled-boundary store
  read (drop DB-poll live drain)
status: Done
assignee: []
created_date: '2026-09-19 04:17'
updated_date: '2026-09-20 05:00'
labels:
  - orpc
  - ai-chat
  - backend
dependencies:
  - TASK-80.14
parent_task_id: TASK-80.14
ordinal: 693000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wedge class dies here. FrameHub (apps/server/src/chat-hub.ts) gains: frames[] (in-memory published wire frames for the in-flight turn, terminal last), terminal (sticky, replaces closed), settle() one-shot, keep the gate/release/arm tail-wait mechanic (re-armed, so a pre-capture release never strands a waiter), keep terminalLane coalescing (stream-only terminal outputs, last-writer-wins by terminal_id, AC#6). beginTurn() replaces the hub fresh per turn (hubFor create-on-miss keeps serving settled hubs). chat-store: new listHistory(convo, {excludeTurnId?, limit?}) seq-asc full read (replaces listFramesAfter as the subscribe read; rowFor keeps a separate non-counting read); keep the drainReads counter ONLY on the subscribe path (80.10 re-pin). No more listFramesAfter polling inside the drain: the live tail is the ring.
<!-- SECTION:DESCRIPTION:END -->
