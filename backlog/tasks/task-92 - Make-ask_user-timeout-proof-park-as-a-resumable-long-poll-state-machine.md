---
id: TASK-92
title: 'Make ask_user timeout-proof: park as a resumable long-poll state machine'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 12:44'
updated_date: '2026-09-21 13:36'
labels:
  - backend
  - chat
  - mcp
dependencies: []
priority: high
type: feature
ordinal: 743000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why (TASK-88 follow-up)

TASK-88 established that the agent-side MCP client's own default request timeout (60s in the reference SDK, not configurable from the sidecar) abandons a blocking ask_user tools/call long before our server deadlines (25/30 min) fire. Today that means: the learner's card stays up, but no agent call is left alive to receive the answer as a tool result; recovery relies on the answer being injected as plain text next turn.

The fix is to make the ask park a resumable long-poll (AWS-waiter style) instead of a one-shot blocking call. The agent whose client timed out re-calls ask_user with the same questions, and the host hands it the SAME live park (or, if the learner answered meanwhile, returns the answer instantly as the tool result). Blocking semantics (tool result in context) are preserved; the client timeout becomes a slice length, not a failure.

## Design notes

- Park identity: key parked asks by conversation + question-set hash (or an explicit host-minted ask id echoed in the tool description), so a re-call can attach to the live park instead of minting a duplicate requestId / duplicate card.
- Outcome cache: answered or expired parks keep a short-lived terminal result per ask so a late re-call returns it immediately instead of re-parking.
- Tool description must teach the retry: if the call fails/times out, call ask_user again; an answered question returns at once.
- onExpire/settlePending (TASK-86) keeps settling the row exactly once no matter how many callers attach.

references: apps/server/src/ask-tool.ts, packages/acp/src/session.ts (parkAsk), apps/server/AGENTS.md TASK-88 timeout-chain bullet
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC#1: A re-call of ask_user with identical questions while an ask is parked attaches to the same park (same requestId) and renders no duplicate card.
- [x] #2 AC#2: After the learner answers, an ask_user call with the same questions returns the answer text as the tool result without re-parking (terminal-result cache).
- [x] #3 AC#3: After an ask expires (settlePending 'error'), a late re-call returns an explicit expired text, never parks again, and never double-settles the row.
- [x] #4 AC#4: The ask_user tool description instructs the agent to re-call once on timeout.
- [x] #5 AC#5: Regression tests at the ask-tool seam cover attach-on-recall, answered-replay, and expired-replay; existing TASK-86/88 timeout tests stay green.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ask-tool.ts: compute a park key = sha256 of canonical JSON of the questions array; pass it through the ParkAsk callback. Add the retry instruction to ASK_USER_DESCRIPTION (AC#4).
2. session.ts parkAsk(handle, questions, key?): compose fullKey = sessionId + ':' + key. On re-call: live map hit -> return the SAME { promise, requestId } without emitting a second ask frame (AC#1). Terminal map hit -> return the settled promise (late caller replays the answer/expiry instantly, AC#2/3). Settle moves the entry live->terminal (bounded FIFO 64); dispose/cancel paths already funnel through the settle wrapper so no extra wiring. Fresh key -> parks as today.
3. One settle stays one settle: onExpire fires per tool call racing one park; settlePending(requestId) is naturally idempotent (answerAsk returns false once cleared), and the live map cannot double-park under one key.
4. Tests at the tool seam (ask-tool.test.ts): attach-on-recall (park called once, expirations once), answered-replay (late call returns answer text, isError false). Tests at the engine seam (session.test.ts): same-key re-call returns same requestId + no duplicate frame; terminal replay after engine expiry rejects without re-parking; different key parks separately. Park without key unchanged.
5. DOX: packages/acp parkAsk contract, apps/server ask bullet; ultracite + full bun test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: session.test.ts 'ask: keyed park is a resumable long-poll (TASK-92)' proves live attach (same requestId+promise, one ask frame), answered terminal replay, fresh park under a different key, and expired-replay without re-park (real fake-agent child). ask-tool.test.ts adds the sha256 key contract (stable across identical calls, changes with content) and the post-timeout answer reaching the re-call as a tool result with exactly one onExpire. Repo-wide bun test: 917 pass / 0 fail; check-types 13/13; ultracite clean. DOX: packages/acp parkAsk contract bullet, apps/server TASK-92 bullet.

Follow-up (not filed as a task): the terminal-replay cache is content-keyed with no TTL (FIFO-64 only), so a deliberately verbatim re-ask of the same question set within one session's cache life replays the stale outcome instead of re-asking. Accepted trade-off; if it ever bites, the fix is a small TTL on #terminalAsksByStableKey entries. Related filed work: TASK-94 (tool-side expiry must retire the engine park).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ask_user is now a resumable long-poll: parkAsk takes an optional content key (sha256 of the canonical questions JSON, computed in ask-tool.ts, threaded via context.ts); a re-call attaches to the live park or replays the terminal outcome from a FIFO-64 cache, keyed settles funnel through the ask.resolve/reject wrappers (cancel/dispose paths now rely on them). The tool description teaches the model to re-call once on timeout. An agent-side 60 s client abandonment is now survivable: the answer still reaches the next call as the tool result, and no path can duplicate the learner's card. Verified by new engine-seam and tool-seam regression tests plus the full suite.
<!-- SECTION:FINAL_SUMMARY:END -->
