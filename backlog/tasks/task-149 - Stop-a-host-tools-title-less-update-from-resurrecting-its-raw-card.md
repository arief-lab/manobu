---
id: TASK-149
title: Stop a host tool's title-less update from resurrecting its raw card
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 03:16'
updated_date: '2026-09-28 03:49'
labels:
  - chat
  - acp
  - exam
dependencies: []
references:
  - doc-24
priority: medium
type: bug
ordinal: 914000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The ACP fold suppresses a host tool's generic card by title alone: `foldAcpToolCall` tests `isHostToolCallTitle(title)` at packages/chat-session/src/chat-engine/folds/tool-call.ts:100, and `isHostToolCallTitle` returns false when the title is empty (packages/acp/src/acp-events.ts:42, over the three names in HOST_TOOL_NAMES at :37). So a `tool_call_update` that arrives with a null title is not recognised as a host tool and falls through to the upsert, re-materialising the raw JSON card the earlier frame had removed. The browser QA pass caught it live: the stored row carried `"title": null` for a host tool call id, and the raw payload was on screen.

Why this was invisible until now: `ask_user` only ever received updates that still named the tool (packages/chat-session/src/history.test.ts pins title `manobu-host-tools_ask_user` on the update row), so the title-only guard held. `start_exam` is the first host tool whose updates can lose the title. The suppression has to be keyed on the `toolCallId` learned from the frame that did carry a host title, not on the payload shape: a shape match would suppress learner-visible cards for ordinary tools whose input happens to look similar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Folding a tool_call frame titled for a host tool followed by a tool_call_update with a null title leaves no tool card, for each of ask_user, next_drill_item and start_exam
- [x] #2 A non-host tool whose update carries the same null-title shape still renders its card, proving the id claim and not a payload fallback did the work
- [x] #3 A conversation reopened from storage folds through the same reducer and shows no raw host-tool card, extending packages/chat-session/src/history.test.ts
- [x] #4 The claimed-id memory is bounded and released with the turn, so a long-lived hub cannot accumulate ids without limit
- [x] #5 A mutation-gate seam reverts the claim and is caught by the tests above
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
EVIDENCE THAT CHANGES THE APPROACH: the leaking conversation 59ccee37-bf60-4520-9c37-fafd17119b30 in local.db has exactly ONE acp_tool_call row (id 19330, toolCallId call_function_h0r3lf1n4pil_1, title null, sessionUpdate tool_call_update). The titled frame was never stored because apps/server/src/chat-persistence.ts:155 already drops a host-titled event BEFORE publishFrame, so the client never sees the host title at all. A toolCallId memory inside the fold therefore cannot work: the first frame the client knows about IS the title-less update. The claim belongs at the sink, which does see the titled frame.

1. chat-persistence.ts sinkFor: keep a claimed-host-toolCallId set in the same per-hub closure that holds `accumulators` (:146, cleared the same way at :215 with resetAccumulators), so the claim is bounded by the hub and released with the turn. isSuppressedEvent returns true for an event whose toolCallId is already claimed, and claims on any host-titled tool_call. Effect: no raw host-tool frame is published or written after the title is known.
2. chat-engine/folds/tool-call.ts: never INVENT a card. A frame with sessionUpdate 'tool_call_update', no title and no existing card for that id returns prev. sessionUpdate is a required enum on the wire schema (packages/api-contract/src/schemas/chat-frames.ts:270) and survives the loose-object parse, so this is a typed check, not a shape guess. This is what closes the durable half for rows already in a database.
3. Tests: fold-level for all three host tools plus the non-host control (a titled update for an unknown id still builds a card, so the rule is about title-less invention, not about updates); history.test.ts reopened-conversation case with the stored row shape from 19330; a new server test asserting the hub ring stays empty AND no row is written for a title-less update that follows a host-titled frame, with a non-host control that must still persist both frames.
4. Mutation-gate seams: revert the sink claim, and revert the never-invent rule; each must be caught.
5. DOX: rewrite packages/chat-session/AGENTS.md:240 (it currently claims the fold is the only suppression point and that a reopened conversation cannot resurrect the card, which this finding disproves) and the apps/server/AGENTS.md persistence row.
6. Verify: bun test for chat-session, acp, server; bunx ultracite check; bun scripts/mutation-gate.ts --check then run the new seams.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented. Sink claim: apps/server/src/chat-persistence.ts isSuppressedEvent(event, claimedHostToolCallIds) now claims the toolCallId on any host-titled acp_tool_call and drops every later frame carrying a claimed id; the set lives in the sinkFor closure beside accumulators (per turn) and is cleared at the terminal frame beside resetAccumulators. Fold rule: packages/chat-session/src/chat-engine/folds/tool-call.ts refuses to INVENT a card when sessionUpdate === 'tool_call_update' && !title && !existing, which is what closes the durable half for rows already in a database (the leak's stored row was exactly that shape). The client cannot hold the claim: the titled frame is dropped before publishFrame, so the title-less update is the first frame the reducer ever sees for a host call. Tests: apps/server/test/host-tool-suppression.test.ts (7: both planes per host tool, the non-host control in the same turn keeping both frames and its collapsed row, the claim released with the turn across a resetHub reopen, the orphan-update boundary, and a fixture probe so a zero-row assert cannot pass on a missing parent); packages/chat-session/src/chat-engine.test.ts (+2: no card invented per host tool with the update-after-removal leg, and the control that an update still MUTATES an existing card); packages/chat-session/src/history.test.ts (+1: a reopened turn holding only the title-less host update folds to the ask card alone). One existing test restructured, not weakened: 'sanitizes oversized base64 inline images in rawOutput' folded a title-less update onto an empty transcript, which is precisely the behaviour TASK-149 removes; it now opens the call with its titled frame and asserts sanitization on BOTH legs. Seams: host-tool-claim-not-carried, host-tool-update-invents-a-card (both caught); host-ask-user-suppression widened to run the new server test because the sink's claim reads the same predicate (caught). DOX: rewrote the chat-session host-tool bullet (it claimed the fold was the only suppression point and that a reopen could not resurrect the card, which the finding disproved), added the TASK-149 persistence bullet to apps/server/AGENTS.md, and corrected the TASK-125 line that pointed at the title predicate alone. Verification: server suite 228 pass / 1 skip, chat-session 255 pass, acp 149 pass, desktop 454 pass, bun run check-types 14/14 tasks green, ultracite check clean on every touched file, fallow dead-code --boundary-violations 0, fallow audit --base main exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A host tool's raw JSON can no longer reach the transcript through its own follow-up frame. The suppression was title-shaped on both planes and ACP names the tool only on the frame that OPENS a call, so every later tool_call_update (title null) escaped it: live on the ring, and stored as a row a reopen replays. The sidecar's sink (apps/server/src/chat-persistence.ts) now claims the toolCallId when it drops a host-titled frame and drops every later frame carrying that id, with the claim living in the per-turn sinkFor closure and cleared at the terminal frame; the client fold (packages/chat-session/src/chat-engine/folds/tool-call.ts) additionally refuses to INVENT a card from a title-less tool_call_update that has no card to update, which is the half that closes rows already in a database and the only defence the reopen path has, since the titled frame never reaches the client to be remembered. Verification: apps/server/test/host-tool-suppression.test.ts (7 tests, both planes per host tool, the non-host control in the same turn, the claim released across a resetHub reopen, and the orphan-update boundary), packages/chat-session/src/chat-engine.test.ts (+2, including the control that an update still mutates a real tool's card), packages/chat-session/src/history.test.ts (+1 reopened turn). One pre-existing base64 test was restructured, not weakened: it folded a title-less update onto an empty transcript, the exact shape TASK-149 removes, and now drives both legs. Mutation seams host-tool-claim-not-carried and host-tool-update-invents-a-card are caught, and host-ask-user-suppression was widened to the new server test; all five host-tool seams caught. Full green: server 228 pass / 1 skip, chat-session 255, acp 149, desktop 454, bun run check-types 14/14, ultracite check clean, fallow boundaries 0 violations, fallow audit --base main exit 0. DOX: the chat-session host-tool bullet rewritten (it claimed the fold was the only suppression point and that a reopen could not resurrect the card, which this finding disproved) and a TASK-149 persistence bullet added to apps/server/AGENTS.md. Also fixed three pre-existing TypeScript errors in apps/server/test/exam-host-tool.test.ts (TASK-147) that were holding repo-wide check-types red.
<!-- SECTION:FINAL_SUMMARY:END -->
