---
id: TASK-88
title: Tune ask_user timeout — card must reach the client before the MCP deadline
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 06:52'
updated_date: '2026-09-21 12:30'
labels:
  - backend
  - chat
  - investigation
dependencies: []
ordinal: 353500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Observation (live smoke 2026-09-21)

The ask_user MCP call timed out (-32001) suspiciously fast: the learner never saw the interactive card, and the model fell back to plain-text questions. The parked ask is wired through ask-tool.ts (Promise.race with askTimeoutMs) -> context.park -> controller.parkAsk. The card should be on the learner's screen well before any deadline.

## Acceptance criteria

1. AC#1: Verify/instrument the actual deadline: askTimeoutMs value, when the ask frame hits the wire, and when the MCP error returns. Identify why the timeout beat the UI (or whether the park itself failed).
2. AC#2: Set a sensible timeout (order of minutes, not seconds) and/or make it configurable via env.
3. AC#3: On timeout, the parked ask row settles (settlePending) so recovery does not re-project it, and the client shows the compact failed state (depends on TASK-86 AC#3).
4. AC#4: Regression test: a scripted ask turn where the answer never arrives — the tool result carries the timeout text and the parked row settles.

## Labels
backend, chat, investigation
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC#1: Document/instrument the deadline chain: askTimeoutMs value, when the ask frame hits the wire, and which timeout produced the live-smoke -32001.
- [x] #2 AC#2: Make the ask timeouts env-configurable with sane defaults (minutes, not seconds) and a safe ordering invariant.
- [x] #3 AC#3: On timeout the parked ask row settles via settlePending (TASK-86 onExpire) so replay shows the compact expired card, not an interactive one.
- [x] #4 AC#4: Regression tests: unanswered scripted ask settles the tool call with timeout text (tool level) and the engine-side park rejects on its timeout (session level).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AC#1 (research, done): deadline chain is ask frame SYNCHRONOUS at park time (parkAsk emitFrame -> currentSink -> sinkFor publishes live-first then persists), so the card hits the wire the moment tools/call starts. Server-side deadlines: AskToolServer.askTimeoutMs default 25 min (never configured) and SessionController confirmationTimeoutMs default 30 min (never configured). The live-smoke -32001 came fast because the AGENT-side MCP SDK client has a hard 60s default request timeout (DEFAULT_REQUEST_TIMEOUT_MSEC=60000, ErrorCode.RequestTimeout=-32001): it abandons the blocking tools/call after 60s regardless of our server deadlines. The card being invisible at that moment was TASK-86's blank-render bug, now fixed.
2. AC#2: add two optional numeric-ms fields to @manobu/env/server: ASK_TIMEOUT_MS (tool-side ask deadline, default 25 min) and CONFIRMATION_TIMEOUT_MS (engine deadline for parked asks + permission cards, default 30 min); wire both in apps/server/src/context.ts into AskToolServer / SessionController. Keep defaults; enforce nothing beyond documented ordering (tool < engine preferred).
3. AC#3: already shipped by TASK-86 (onExpire -> settlePending error); verify with existing tests and note it.
4. AC#4: regression coverage: ask-tool.test.ts tool-side-timeout test pins isError + onExpire(contract already at tool level); add a session-level test that parkAsk with a short confirmationTimeoutMs rejects the park and the requestId settles once, proving the engine backstop.
5. DOX pass (packages/env, apps/server AGENTS.md) + ultracite fix + tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: env smoke proved ASK_TIMEOUT_MS=90000 parses to number and 'abc' is rejected at boot (unset keeps 25/30-min defaults); new session.test.ts 'ask: engine timeout rejects a parked ask and clears the park' (real fake-agent child, confirmationTimeoutMs=120) proves the park rejects with 'ask timed out' and drains pendingAsks; ask-tool.test.ts pins the tool-side race (isError text + onExpire with the parked requestId -> settlePending error). bun test: 910 pass / 0 fail repo-wide; bun run check-types: 13/13; ultracite check clean. DOX updated: packages/env (new fields), apps/server (TASK-88 timeout-chain bullet), packages/acp (confirmationTimeoutMs option governs asks + permission cards).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause: the ask frame hits the wire synchronously at park time (parkAsk emitFrame -> sink -> live-first publish), so no server deadline ever beat the UI; the fast -32001 was the agent-side MCP SDK client's 60s default request timeout (not tunable from the sidecar), compounded by TASK-86's blank-card render bug. Shipped: ASK_TIMEOUT_MS and CONFIRMATION_TIMEOUT_MS env fields (packages/env, positive-int ms, optional) wired in apps/server/context.ts into AskToolServer and SessionController, defaults unchanged (25/30 min); engine-timeout regression test in packages/acp session.test.ts; settle-on-expiry verified via existing TASK-86 onExpire tests. Findings documented in apps/server/AGENTS.md timeout-chain bullet.
<!-- SECTION:FINAL_SUMMARY:END -->
