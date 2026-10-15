---
id: TASK-104
title: 'Chat: a retryable agent error ends the turn with no recovery attempt'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-22 05:27'
updated_date: '2026-09-23 09:53'
labels: []
dependencies: []
priority: low
type: feature
ordinal: 787000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Any upstream hiccup finishes the turn and leaves the learner to re-ask. The engine sets status error and stops (packages/chat-session/src/use-chat-engine.ts:350) and the only retry is a manual regenerate, which re-sends the last user text as a brand-new turn (:380). A rate-limit, a timeout, or an empty response mid-turn therefore costs the whole turn: whatever the agent had already produced is gone and the retry restarts from scratch. AionCore classifies the agent error code into retry-once versus a recovery signal that needs compaction or a session resume, and continues a turn that ended while system responses were still pending, so a transient 429 costs the user nothing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A retryable upstream error (rate limit, timeout, empty response) is re-driven automatically once before the turn is reported as failed
- [x] #2 The user can tell a turn that was auto-recovered from one that failed for good
- [x] #3 A non-retryable failure still ends the turn immediately with its real reason, without retry loops
- [x] #4 Partial assistant output already produced in the turn is not discarded by the retry
- [x] #5 Tests cover the retry-once boundary in both directions: one automatic recovery, and no second attempt after that
- [x] #6 packages/chat-session/AGENTS.md records the retry policy and which error classes it applies to
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Client-side retry-once in packages/chat-session (the hook layer the description cites); the server keeps classifying nothing new.

1. Pure policy module `chat-engine/retry-policy.ts`: `terminalErrorInfo(frame)` extracts {code?, message} from a terminal error frame (wire `error` data.text, or `finish` stopReason:"error" with data.error — chat-frames.ts:110-113,276-285); a message-less error finish counts as the "empty response" class. `classifyRetryable(info)`: code AUTH_REQUIRED / CONFIG_SWITCH_FAILED (acp-events.ts:122) -> terminal (AC#3); message matching rate limit / 429 / timeout / overloaded / transient network / empty response -> retryable with a short reason label; anything else -> terminal with its real reason (no loops). Unit tests both directions.
2. Client-only `retry_notice` card (TMessage union + guard + renderer): id `retry:{conversation_id}` singleton, state "retrying" | "recovered". transformFrame rules: a clean `finish` while a retrying notice exists flips it to "recovered" (AC#2); folding a terminal error card drops a stale retrying notice (the err card tells the final story). Partial cards untouched (AC#4).
3. `createRetryGate` DI factory in use-chat-engine.ts (headless-testable like createFrameHandler): send() records the prompt text; handleFrame consults the gate BEFORE folding; on a retryable terminal error not yet retried this turn: suppress the error frame (prevents the status.ts rule-1 error lock), inject the retrying notice, re-drive chat.send with the same text, adopt the ack's turn_id (stale-turn guard then ignores old-turn frames), reset() clears the once-flag. Second error or non-retryable: fold the real error card, no re-drive.
4. Renderer row in chat-card-switch.tsx (bare, muted centered line; R-02: no em dash).
5. Tests: policy matrix; gate with a fake ChatWsClient asserting exactly one re-drive on 429-class error and none on the second failure, none on AUTH_REQUIRED; notice flip on clean finish; error-card fold drops retrying notice; goldens unaffected. `bun x ultracite check` + package tests.
6. packages/chat-session/AGENTS.md records the policy + applied error classes (AC#6); DOX closeout; known artifacts documented: retried turn persists a second user row (regenerate precedent; notice explains it live, reload shows both bubbles), retry_notice is live-only (never persisted).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete + verified. Unit/render: bun test packages/chat-session -> 218 pass / 0 fail (512 expects), goldens unaffected; retry-policy.test.ts (15) classifies all transient classes + non-retryable codes; createRetryOrchestrator suite pins retry-once BOTH directions (one auto recovery, no second attempt after) and history-replay never re-drives. Types: tsc --noEmit clean for packages/chat-session and apps/desktop; ultracite check clean (71 files). Live full-stack drill (temp script over the real sidecar WS, deleted after): failed turn (429 message) -> exactly ONE re-drive, retry_notice card settles recovered, no error card folded, retried answer persisted (row content {text:'recovered answer...'}) and folded, status idle; AUTH_REQUIRED scenario -> zero re-drives, real error card folded, status error; server CONVERSATION_BUSY gate did not block the re-drive. Known artifacts confirmed in the drill: re-drive persists a second user_created row (regenerate precedent); retry_notice is live-only.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Retry-once lives client-side in packages/chat-session: pure classifier chat-engine/retry-policy.ts (rate limit/429, timeout, empty response, connection reset retryable; AUTH_REQUIRED/CONFIG_SWITCH_FAILED and anything unclassified stay final), createRetryOrchestrator in use-chat-engine.ts consumes the retryable terminal frame BEFORE the fold (so the status rule-1 error lock never fires), injects the live-only retry_notice card, and re-drives chat.send with the same text once per send (budget starts at 0, so replayed history never re-drives); the retried turn's clean finish settles the notice to recovered, a second failure drops it and folds the real error card. Renderer row in chat-card-switch.tsx. Verified: 218 chat-session tests pass (new retry-policy + orchestrator + card-switch suites cover both retry-once directions), typechecks + ultracite clean, and a live sidecar-WS drill proved one auto re-drive with the retried answer persisted and folded, plus zero re-drives on AUTH_REQUIRED. AGENTS.md records the policy, classes, and the duplicate-user-row artifact (regenerate precedent).
<!-- SECTION:FINAL_SUMMARY:END -->
