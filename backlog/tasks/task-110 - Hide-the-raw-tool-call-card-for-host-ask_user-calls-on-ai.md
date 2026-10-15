---
id: TASK-110
title: Hide the raw tool-call card for host ask_user calls on /ai
status: Done
assignee: []
created_date: '2026-09-24 04:36'
updated_date: '2026-09-26 02:46'
labels: []
dependencies: []
ordinal: 866000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the agent calls the host ask_user tool, the transcript renders BOTH the generic tool-call card (streaming raw JSON input, "In progress" badge, Tool Call ID footer) AND the ask questionnaire card below it. The JSON duplicates the questionnaire and buries it; the ask card is the real UI for this tool family (TASK-79.4/80.4). Reproduced live 2026-09-24: tool name arrives MCP-prefixed as `manobu-host-tools_ask_user` while the host tool is `ASK_TOOL_NAME = "ask_user"` (apps/server/src/ask-tool.ts:68); the tool card is `AcpToolCallPart` (packages/chat-session/src/parts/acp-tool-call-part.tsx) dispatched from chat-card-switch.tsx, the ask card from folds/ask.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A tool-call frame whose name/title identifies the host ask_user tool (bare `ask_user` and the MCP-prefixed form `manobu-host-tools_ask_user`) renders no tool-call card in the /ai transcript; the ask card is its only representation
- [x] #2 Tool-call cards for every other tool render unchanged
- [x] #3 Opening a SAVED conversation containing ask_user tool rows plus ask rows shows no raw JSON card either (cardsFromRows path)
- [x] #4 Unit tests pin the suppression predicate (bare name, prefixed name, non-match passthrough) and packages/chat-session/AGENTS.md records the fold
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify the reported behavior against the shipped code before changing anything: the suppression predicate, the transcript fold, the persistence filter and the reopen path. 2. Pin the predicate itself where it is owned (packages/acp): the three title shapes a host tool arrives under, the near-miss passthrough, and the missing-title case. 3. Pin the reported SEQUENCE in the fold (a generic card streams first, the host name arrives and must delete it, the ask card survives) plus a non-host tool that still renders. 4. Pin the reopen path through cardsFromRows, with a non-host control row so the test cannot pass by silently skipping a malformed frame. 5. Record the fold and the predicate's ownership in both AGENTS.md files, then run workspace verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The fix itself was already shipped with TASK-125's shared host-title predicate; this task closed the missing evidence, not a missing behavior. Shape: isHostToolCallTitle (packages/acp/src/acp-events.ts:33) claims ask_user/next_drill_item in the bare, MCP-prefixed and dash-prefixed forms, foldAcpToolCall (packages/chat-session/src/chat-engine/folds/tool-call.ts:100) DELETES the card when it matches (so the generic card that streamed first disappears when the real name lands), the sidecar never persists those rows (apps/server/src/chat-persistence.ts:98), and cardsFromRows re-folds stored rows through the same reducer so a reopen cannot resurrect the card.

AC#1+AC#2: packages/chat-session/src/chat-engine.test.ts 'keeps the ask card as the only representation of a host ask_user call (TASK-110)' replays the exact reported sequence and asserts the card list is [acp_tool_call, ask] before the semantic title and [ask] after it, for BOTH the bare ask_user and the manobu-host-tools_ask_user form; the sibling test asserts read_file, lookup_vocab and the near-miss ask_user_helper still render a card. AC#3: packages/chat-session/src/history.test.ts 'a saved ask_user turn shows the ask card only, never a raw JSON card (TASK-110)' folds a stored generic tool row, the host-named update and the ask row, and asserts the result is [ask, acp_tool_call] with a RAW-TOOL-CARD-MARKER absent from the serialized cards. The control row is load-bearing: an earlier draft of that test passed VACUOUSLY because the fixture wrapped the payload as {data, type} instead of storing the frame data directly, so every tool row failed ChatFrameSchema and was skipped - the surviving non-host control row proves the suppression is what removed the host rows. AC#4: packages/acp/test/acp-events.test.ts (new) pins the predicate where it is owned - three claimed shapes for both host tools, the near-miss passthrough (ask_user_helper, not_ask_user_at_all, next_drill_item_extra), and null/undefined/empty - plus both AGENTS.md records (packages/chat-session Local Contracts + Verification, packages/acp Local Contracts + suite list). One correction to the AC's assumption: the predicate is prefix-shaped, not exact, so ANY <server>_<host tool> is claimed by design (my first test wrongly asserted my_ask_user passes through; the code is right and the test was wrong). That is now documented as the deliberate trade, since a false positive is only visible as a missing card.

Validation (2026-09-26): packages/acp 149 pass, packages/chat-session 253 pass, root turbo 10/10 tasks, 14/14 check-types, ultracite clean, fallow audit verdict pass (0 dead code, 0 introduced complexity, 0 introduced duplication), git diff --check clean. No production code changed - the diff is three test files plus two AGENTS.md files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed TASK-110 as evidence-only: the host ask_user tool-card suppression already shipped with TASK-125, so this pass added the missing proof rather than a fix. New packages/acp/test/acp-events.test.ts pins the title predicate (bare, MCP-prefixed, dash-prefixed, near-miss passthrough, missing title); the chat-session fold test now replays the reported sequence and asserts the ask card is the only representation in both title shapes; and the history test pins that a reopened conversation cannot resurrect the raw JSON card, using a non-host control row so it cannot pass by skipping a malformed frame. Recorded the fold in both AGENTS.md files, including the deliberate prefix-shaped trade (any <server>_<host tool> is claimed, so a false positive only shows as a missing card). Verified with acp 149, chat-session 253, root 10/10, check-types, ultracite and a pass fallow audit; no production code changed.
<!-- SECTION:FINAL_SUMMARY:END -->
