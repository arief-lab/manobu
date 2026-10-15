---
id: TASK-80.10
title: 80.9.1 /ws chat.subscribe drain honors the client abort signal
status: Done
assignee:
  - '@arif'
created_date: '2026-09-18 05:43'
updated_date: '2026-09-18 10:39'
labels:
  - orpc
  - ai-chat
  - backend
dependencies:
  - TASK-80.8
documentation:
  - 'https://orpc.dev/docs/async-iterator-object'
parent_task_id: TASK-80
priority: high
type: bug
ordinal: 688000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-80.8's oRPC docs gap audit (2026-09-18, vs orpc.dev/docs/async-iterator-object 'Signal and Side-Effects') found the one genuine bug-grade gap: chat.subscribe's live drain (apps/server/src/chat-rpc.ts, the async generator with nextPulse/drainFrom) destructures { context, input, lastEventId } but NOT signal. The oRPC docs say 'When the client closes the connection oRPC aborts the provided signal. Use it to exit loops and avoid resource leaks. Put cleanup in a finally block.' Today a client that drops mid-turn leaves the server-side drain recursing (one listFramesAfter DB read per hub pulse) until the turn ends and the hub closes. The turn itself must keep running on socket drop (AC#4 of TASK-80.2 deliberately pins that: a socket drop alone does not cancel), so ONLY the drain loop should stop, not the turn. Fix: destructure signal in chat.subscribe, call signal.throwIfAborted() on each drain iteration (the recursion is the 'loop'), and wrap so an aborted drain exits cleanly (no error frame to a dead client) while runTurn/persistence are untouched. Note the drain recursion (drainFrom -> nextPulse -> drainRows/drainLane) is the shape a signal check must sit on; a finally-based cleanup per the doc is the recommended form. Validation: existing chat-e2e WS suite stays green; add an e2e case where the subscriber socket is closed mid-turn and the server-side drain stops polling (observeable via a no-more-listFramesAfter-rows assertion or a drain-stopped marker, NOT by cancelling the turn).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 chat.subscribe handler destructures the oRPC-provided abort signal alongside context/input/lastEventId
- [x] #2 An aborted (dropped) subscriber stops the drain loop: no further listFramesAfter DB reads occur after the client disconnects, while the underlying turn continues to completion (AC#4 behavior preserved)
- [x] #3 Cleanup is in a finally block per the doc; a dropped subscriber leaves no leaking drain
- [x] #4 chat-e2e stays green; a new e2e case proves drain-stop-on-disconnect without cancelling the turn; tsc + ultracite clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. chat-rpc.ts subscribe handler: destructure signal alongside { context, input, lastEventId }. 2. Make the drain loop observe signal.aborted (no further listFramesAfter/pulse waits after disconnect); keep the turn running (do NOT touch runTurn / hub closing). 3. finally block for cleanup per the doc. 4. e2e: a case that opens a subscribe, disconnects the socket mid-turn, and proves the drain stopped reading while the turn finished (e.g. via a stubbed listFramesAfter call counter, or frame-stop marker). 5. chat-e2e green + tsc + ultracite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VALIDATION 2026-09-18: chat-e2e 11/11 (incl. new 80.10 case: dropped subscriber stops the drain, turn settles via second socket), tsc -p tsconfig.typecheck.json clean, ultracite check 0 fixes, chat-session 103/103 regression. Guards: nextPulse pre-read signal?.throwIfAborted() + drainFrom post-pulse signal?.aborted, cleanup in finally per orpc.dev async-iterator-object docs.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
chat.subscribe's live drain now destructures oRPC's per-request signal and stops re-reading the persisted tail after a subscriber drops (no leaking drain), while the turn continues to completion. New e2e case proves drain-stop without turn cancel.
<!-- SECTION:FINAL_SUMMARY:END -->
