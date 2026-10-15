---
id: TASK-86
title: >-
  Fix ask_user card rendering blank — feed questions payload to acp-ask-card and
  add post-resolution collapsed state
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 06:51'
updated_date: '2026-09-21 12:10'
labels:
  - ui
  - chat
  - bug
dependencies: []
modified_files:
  - packages/acp/src/session.ts
  - packages/acp/src/session-types.ts
  - packages/acp/test/session.test.ts
  - packages/acp/test/fake-agent.ts
  - apps/server/src/chat-rpc.ts
  - apps/server/src/chat-persistence.ts
  - apps/server/src/chat-store.ts
  - apps/server/src/ask-tool.ts
  - apps/server/src/context.ts
  - apps/server/test/chat-e2e.test.ts
  - apps/server/test/ask-tool.test.ts
  - apps/server/test/chat-wire-status.test.ts
  - packages/api-contract/src/schemas/chat-frames.ts
  - packages/chat-session/src/chat-engine/status.ts
  - packages/chat-session/src/chat-engine/folds/ask.ts
  - packages/chat-session/src/chat-engine/types.ts
  - packages/chat-session/src/chat-engine/index.ts
  - packages/chat-session/src/parts/acp-ask-part.tsx
  - packages/chat-session/src/chat-engine.test.ts
  - packages/chat-session/src/ask-user.test.tsx
  - packages/chat-session/src/goldens/chat-engine/second-turn.json
  - packages/ui/src/components/acp-ask-card.tsx
  - packages/ui/src/components/acp-cards.test.tsx
ordinal: 707000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug (live smoke 2026-09-21)

Sensei correctly called the host `ask_user` MCP tool (goal/level/format onboarding questions). The `ask` frame persisted to user.db WITH the full questions payload (3 questions x 3 options each), but the chat UI rendered the card as a BLANK rectangle: no question text, no tappable options, no free-text input. The learner could not answer, the MCP call timed out (-32001), and the model fell back to plain-text questions.

Second symptom: after resolution/timeout, the resolved `acp_tool_call` shell (rawInput with questions, content with the MCP error) lingers as an empty-looking card instead of collapsing to a compact answered/failed state.

## Root cause direction

- `acp-ask-card` (packages/ui, TASK-80.4 / 81.3 per-state split) is either not receiving the folded `questions` payload or reads the wrong field. Check the fold path: server `ask` frame -> client card type -> AcpAskCard props.
- The pending ask state (status pending) vs resolved tool-call state need distinct renders; verify the state machine in the card subcomponents.

## Acceptance criteria

1. AC#1: A live ask_user call renders the questions with tappable option chips + a free-text input the moment the ask frame arrives.
2. AC#2: Tapping an option (or submitting text) answers via the existing REST answer endpoint and the card collapses to a compact answered state.
3. AC#3: After timeout/failure, the card shows a compact failed state (no empty shell).
4. AC#4: Reload replays the resolved ask as compact (history rows already persist the payload).

## Labels
ui, chat, bug
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC#1: a live ask_user call renders tappable questions + free-text the moment the ask frame arrives
- [x] #2 AC#2: submitting collapses the card to a compact answered state (live, no reload)
- [x] #3 AC#3: after timeout/failure the card shows a compact failed state and Stop stays available, never an empty shell
- [x] #4 AC#4: reload replays a resolved ask as compact (row status carried on the wire)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AC#1: already satisfied by TASK-90 (ask in STRETCHED_TYPES); re-verified in :3001 harness with real row 160 payload. No code change; pin it with a regression note.
2. Server replay: toWireFrame carries the row status for parked ask frames (finish/error/pending) so reload knows the ask is resolved (AC#4).
3. Server timeout settle: parkAsk exposes its requestId (return {promise, requestId} or an onPark callback); the context.ts park wrapper settles the row to "error" when the park rejects/times out, so a dead ask stops replaying interactive (AC#3).
4. Client fold: foldAsk keeps status on the card (already reads frame.status); AcpAskPart derives settled=finish / failed=error from part.status and passes to the card.
5. UI card: AcpAskCard renders a COMPACT answered state (answer summary) and a COMPACT failed/expired state, interactive form only while pending; live submit flips straight to the compact answered state (AC#2).
6. Tests: toWireFrame status carry; timeout settle; fold status; card compact states (SSR pins). Harness: submit collapses (AC#2), timeout replays compact (AC#3), reload replays resolved compact (AC#4).
7. DOX (chat-session parts, ui card state table, server persistence) + finalize per ACs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research findings (2026-09-21)

AC#1 (blank card) is ALREADY FIXED by TASK-90 (commit c9a710f). The ask card is a Card-based family; the "blank rectangle" was the inline-size-containment collapse (w-full Card inside a w-fit bubble -> 0 width). Verified in the :3001 harness seeding the real local.db row 160 payload: card renders at 622px with all 3 questions (Level/Goal/Format), 9 tappable option checkboxes + 3 "Other" free-text inputs, Submit/Decline. Screenshot /tmp/t86-ask-render.png.

Remaining real work is the post-resolution collapsed state (AC#2/3/4). Root cause: ask resolution is EPHEMERAL.
- The receipt/failed state is local React useState (submitted/hasError) in acp-ask-card.tsx; nothing persists it.
- toWireFrame (apps/server/src/chat-persistence.ts:369) DROPS the row's `status` on replay, so a reload replays a resolved ask as a fresh interactive card (AC#4 gap). The wire envelope already carries an optional status enum, so the contract is fine; only the projection omits it.
- Timed-out asks are never settled: only chat.answerAsk calls settlePending (-> "finish"). Both DB ask rows (id 73, 160) are stuck status:"pending" even though the MCP call timed out (-32001). So even carrying status would replay them interactive (AC#3 gap).
- The current receipt state re-renders all questions disabled + a "Response sent" line; AC#2 wants a COMPACT answered state.
- parkAsk (packages/acp/src/session.ts:587) generates requestId internally and returns Promise<string> (rejects on its confirmationTimeoutMs timer). The ask-tool (apps/server/src/ask-tool.ts) races its own askTimeoutMs. Neither settles the DB row on timeout.

## Design decision (needs approval)
Two coupled changes: (1) server persists + replays the parked-card status (carry status in toWireFrame; settle the ask row to "error" on timeout via the context.ts park wrapper, which needs parkAsk to expose its requestId); (2) the ask card derives a compact answered/failed render from that status instead of only local state. This touches apps/server, packages/acp parkAsk signature, and packages/ui card state machine.

## Implementation + verification (2026-09-21)

All four ACs verified live in the browser via the fake-agent live-loop harness (PATH-shadowed opencode + sidecar :4317 + vite :3001, Playwright driver /tmp/t86-drive.cjs, final run "ALL STEPS PASSED"): turn1 ask renders tappable options; Submit collapses to compact "Response sent" card with answer summary (/tmp/t86-a34-reload-compacts.png); parked ask keeps Stop visible, Stop settles the row to error and the card shows the compact "This question expired without an answer." line; reload replays both settled rows as compact cards.

Three pre-existing engine/UI bugs found by the harness and fixed (each pinned by a failing-test-first repro):
1. packages/acp session.ts: a settled/failed turn never cleared handle.activeTurn -> every later prompt threw AIONUI_CONVERSATION_BUSY (only #teardown cleared it).
2. packages/chat-session status.ts: a parked ask derived "idle" -> Stop button disappeared while the agent was blocked on the answer. New rule: ask frame with status not finish/error derives "streaming" (golden second-turn.json regenerated).
3. chat-rpc acked its own turnId but the engine armed a different UUID -> chat.cancel guard never matched, so live Stop could not cancel ANY ACP turn. Fixed by threading PromptInput.turnId end-to-end.
Plus: ask-tool.ts onExpire never fired on park rejection (.catch was chained after an awaited race); fixed via then(onFulfilled, onRejected), so a dead park settles the DB row to error. parkAsk now returns {promise, requestId}.

Known remaining quirk (pre-existing, NOT fixed, worth a follow-up): clicking an option label text does not toggle the checkbox; clicking the checkbox itself works.

Gates: bun test ui 147 pass / acp 82 pass / chat-session 154 pass / server 79 pass 1 skip, 0 fail. bun x ultracite check clean on all changed files. bun run check-types: 13/13 tasks successful. DOX updated: packages/acp, packages/chat-session, packages/ui, apps/server AGENTS.md.

Follow-up (same day): the noted label-click quirk is FIXED. Root cause was NOT the whitespace id alone: base-ui Checkbox lands the passed `id` on its hidden native input and renders a visible span (not labelable), so the label `for` only activates the input and the toggle handler (on the span) never saw label clicks. Fix in acp-ask-card: whitespace-free option id (index-based) + the same stable onCheckboxClick handler and data-option-* attributes on the Label; span keeps its own. Verified in headless Chromium against the hydrated real component: label-text click checks, second label click moves the single-select, re-click untoggles, box click unchanged. SSR pin added (option labels carry the toggle dataset and resolve their for). ui 148 pass, chat-session 154 pass, ultracite clean, check-types 13/13. DOX: packages/ui/AGENTS.md notes the base-ui hidden-input id behavior.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ask cards now render live, collapse on resolve, and replay compact after reload. Server stamps `status` on ask wire rows and settles the row to error when the park expires/cancels (parkAsk returns {promise, requestId}; AskToolServer.onExpire wired in context.ts). The card gained compact terminal states (answered summary / declined / expired line, data-state driven by the `resolution` prop or its own live submit), and AcpAskPart derives the resolution from the replayed status. Three latent bugs fixed along the way: settled turns never released the engine busy guard (conversation stuck after turn 1), parked asks derived idle status (Stop vanished mid-ask), and the chat.send turnId never reached the armed turn (Stop could not cancel any turn). Verified in a live browser loop (fake-agent harness, all 4 ACs, screenshots) plus unit pins: ui 147, acp 82, chat-session 154, server 80 all green; ultracite + check-types clean.
<!-- SECTION:FINAL_SUMMARY:END -->
