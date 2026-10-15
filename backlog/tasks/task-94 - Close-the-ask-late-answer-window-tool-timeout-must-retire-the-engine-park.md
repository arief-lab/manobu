---
id: TASK-94
title: 'Close the ask late-answer window: tool timeout must retire the engine park'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 13:36'
updated_date: '2026-09-21 14:21'
labels:
  - backend
  - chat
dependencies: []
priority: medium
type: bug
ordinal: 775000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why (found in TASK-92 review)

When AskToolServer's tool-side deadline fires, onExpire settles the persisted ask row to 'error' and the card replays compact/expired — but the ENGINE park stays alive until confirmationTimeoutMs (default 30 min). TASK-92's long-poll made the stale window exploitable: a learner can still answer the (visually expired) card, the answer resolves the park and reaches the agent as a tool result, while nothing upgrades the row. Result: transcript shows 'expired' for a question that was actually answered and acted on.

## Fix direction (decide, then implement)

Preferred: make the tool-side expiry authoritative — the expire path force-rejects (or adds an explicit retire) on the engine park keyed by requestId, so answerAsk returns false after expiry and the late answer is refused UI-side (card is already terminal). Alternative (worse): upgrade the row error->finish on late answer, which needs replay-frame surgery. A server restart before the expiry also leaves the park gone but the row 'pending' — same family as TASK-84, keep out of scope.

references: apps/server/src/ask-tool.ts (timeout branch), packages/acp/src/session.ts (parkAsk/#asks), TASK-92 final summary
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC#1: After the tool-side timeout settles the row to error, the engine park for that requestId is gone: answerAsk(requestId) returns false and pendingAsks no longer projects it.
- [x] #2 AC#2: A re-called ask_user after expiry replays the terminal expiry (TASK-92), never re-parks, and the learner's tap on the expired card is a no-op.
- [x] #3 AC#3: Regression tests at both seams pin refuse-after-expire; existing TASK-86/88/92 tests stay green.
- [x] #4 AC#4: A terminal-cache entry replays only within its TTL (5 min from settle): a re-call inside the window returns the settled outcome, a verbatim re-ask after the window parks fresh with a new requestId.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Scoped first slice (gap 2, from TASK-92 notes): TTL on the terminal-replay cache. Entries expire 5 min after settle; inside the window a re-call replays (long-poll recovery), after it a verbatim re-ask parks fresh. AC#1-3 (engine-park retire on tool expiry) remain a later slice.

Slice 2 (AC#1-3): SessionController.retireAsk(requestId) = reject through the park's own wrapper (clears timer, retires to terminal replay, releases the live index). AskToolServer gains a retire hook fired ONLY from the tool-side timeout branch (the park-reject branch means the engine already retired it). context.ts wires retire -> controller.retireAsk and keeps onExpire -> settlePending (row update is WHERE status='pending' only = naturally idempotent, so the extra expire a re-attacher's replay fires is a no-op). Test: new cross-seam integration test in apps/server (real fake-agent child + real controller + real HTTP tools/call) proving timeout settles the row path, answerAsk false after expiry, no re-park, single ask frame.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 1 (gap 2, TTL) implemented and verified: session.test.ts 'ask: terminal replay expires after its TTL (TASK-94)' proves in-window replay (same requestId) and post-window fresh park (new requestId, second ask frame) on a real fake-agent child. Repo-wide bun test: 918 pass / 0 fail; check-types 13/13; ultracite clean. DOX: packages/acp cache wording + apps/server TASK-92 bullet. AC#1-3 (tool-expiry retires the engine park, the late-answer window) remain open for a later slice; status stays In Progress.

Slice 2 (AC#1-3) implemented: SessionController.retireAsk() rejects a live park through its own wrapper (timer cleared, live index released, terminal replay armed); AskToolServer fires a retire hook ONLY from the tool-side timeout branch (park-reject already implies an engine-side retire); context.ts wires retire -> controller.retireAsk beside onExpire -> settlePending. AC#3 evidence: new apps/server/test/ask-tool-retire.test.ts runs the REAL stack (fake-agent child + SessionController + streamable-HTTP tools/call): timeout reply, retirements==[requestId], pendingAsks empty, late answerAsk false, re-call replays expiry with zero re-park and a single distinct requestId; apps/server 168 tests + packages/acp all green, repo-wide 919 pass / 0 fail, check-types 13/13, ultracite clean. DOX: acp retireAsk contract, server TASK-94 authoritative-timeout bullet.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two slices. (1) Terminal ask replays expire 5 min after settle (lazy purge on read, sweep on write, test-seam override), so a deliberate verbatim re-ask parks fresh instead of replaying a stale answer. (2) The tool-side deadline is now authoritative: on timeout the host retires the engine park via controller.retireAsk, so a late learner tap is refused and a re-call replays the expiry rather than resurrecting an answered-expired question; repeated expires carry one requestId and settlePending's WHERE-pending guard makes them no-ops. Verified by task-94 TTL and cross-seam retire tests plus the full repo suite.
<!-- SECTION:FINAL_SUMMARY:END -->
