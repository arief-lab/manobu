---
id: TASK-147
title: >-
  Exam: start a paper from the /ai conversation so asking for an exam gives you
  one
status: Done
assignee:
  - '@arif'
created_date: '2026-09-27 16:42'
updated_date: '2026-10-13 02:48'
labels:
  - exam
  - chat
  - acp
dependencies: []
priority: high
type: feature
ordinal: 912000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The learner model is "tell the teacher I want an exam, get an exam". Today that request silently becomes chat: apps/desktop/src/routes/ai.tsx handleSubmit branches only on intent.tier === "drill", so an exam intent falls through to actions.onSubmit and the agent just talks about exams. Everything UNDER the trigger is already built and working, which is why this is small: the contract takes conversationId (packages/api-contract/src/exam.ts:103-114), emitPaperFrame binds it (apps/server/src/services/exam-service.ts:1717), the paper fold + PaperCard + onOpenPaper navigation exist, and the split chat-left / paper-right view already ships at apps/desktop/src/routes/exam/\$examId.tsx. TASK-139 (round-trip) and TASK-140 (focus as a selection prior) are both Done, so level, mode, budget and focus are real inputs rather than decorative ones.

The missing legs are a trigger and an authoring-free decision point. The decision is the agent, not a regex, because intent.ts:48-49 matches only literal "quiz|drill|questions|test me" and "mock|exam|paper", so "can you set me a practice paper?" does not reach the exam tier at all. That means a third host tool next to ask_user and next_drill_item (apps/server/src/ask-tool.ts:84-85), whose handler calls the same in-process request/assemble path.

SCOPE LIMIT, deliberate: the agent chooses PARAMETERS only. Item counts stay code-chosen from PAPER_DEFAULT_BUDGETS (packages/item-engine/src/paper.ts:294), so doc-21 9.2 ("the model never decides how many items a section has") remains true on this path even though it is a host-tool trigger. That decision rejected host-tool AUTHORING, where the model would compose items; a tool that starts a deterministic paper is not the case it ruled out. This task also does not touch item content, so the parked TASK-145 preconditions do not apply to it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A learner asking for an exam in /ai gets a paper card in the transcript bound to THAT conversation id, not the exam:<id> fallback, and an exam request whose wording the current two regexes miss still produces one.
- [x] #2 The agent can choose level, mode and focus; a call that supplies per-section item counts is rejected, and the paper it builds uses the code default budget for that level. A test asserts the allocation is unchanged by the caller.
- [x] #3 start_exam resolves as soon as the paper is built and never waits for the learner to finish it, so the agent turn closes; the tool must not inherit next_drill_item 25-minute blocking behaviour (ask-tool.ts:221). Pinned by a test that resolves the tool while the exam is still in_progress.
- [x] #4 The tool result carries the paper shape (sections and counts) so the agent can describe it, and the tool guidance forbids reading item content aloud, since the paper is on screen.
- [x] #5 Debrief narration happens on a later turn, not inside the spawn turn, and the conversation is not left busy while the paper is running.
- [x] #6 An exam request still produces a paper when the sidecar is unreachable, so agent availability is not an exam dependency (doc-21 5 keeps the model-free path authoritative).
- [x] #7 A mutation-gate seam covers the trigger: reverting the exam branch to chat fall-through turns a test red (the pattern TASK-140 followed).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server trigger: register a third host tool `start_exam` in `apps/server/src/ask-tool.ts` beside `next_drill_item` (:325). Input is a STRICT zod object `{focus?, level, mode?}`, so `budget` / `sections` / `conversationId` are rejected at the boundary (AC#2) and budgets stay code-chosen from `PAPER_DEFAULT_BUDGETS` (packages/item-engine/src/paper.ts:294). The handler calls an injected `startExam` closure and RETURNS: no park, no `Promise.race`, nothing inherited from `#drillTimeoutMs` (:221) (AC#3). Tool result text carries the paper shape only (sections + counts); the description forbids reading item content aloud and forbids debrief narration this turn (AC#4, AC#5).
2. Server wiring: `apps/server/src/context.ts` builds the service lazily with `createExamService` (exam-service.ts:2150) and `startExam` = `service.request({conversationId, focus, level, mode})` then `service.assemble(examId, chatContext)`. `conversationId` comes from the token map (`#conversationByToken`), never from the agent. Move the process-wide `createChatContext()` from `index.ts:164` into `context.ts` and export it so `emitPaperFrame` (:1719) publishes on the LIVE hub of that conversation instead of only writing the row (AC#1).
3. Suppression: add `"start_exam"` to `HOST_TOOL_NAMES` (packages/acp/src/acp-events.ts:31) so the raw tool card stays hidden behind the paper card, same as ask_user / next_drill_item.
4. Model-free trigger (AC#6): a PURE SUBMIT-ROUTING seam in apps/desktop (the `reviewRowActions` pattern from apps/desktop/AGENTS.md: a factory over injected `{sendChat, startDrill, startPaper}` so a bun test can invoke it; the desktop has no DOM env) that decides from `resolveIntent` which effect runs. `handleSubmit` (routes/ai.tsx:551) becomes a thin adapter over it. `/exam ...` (intent L0, tier "exam") starts a paper through `orpc.exam.request` + `orpc.exam.assemble` with the learner's conversationId, no model involved, so an exam request still produces a paper when no agent is reachable.
5. Server tests: new `apps/server/test/exam-host-tool.test.ts` driving `handleRequest` over the real stateless transport against an isolated db. Pin: the paper frame's `conversation_id` is the token's conversation and not `exam:<id>`; a call carrying per-section counts is refused and the allocation equals the level default regardless of the caller; the tool promise resolves while the exam has not been started yet (nothing waits for the learner) and the conversation is not left busy; the result text contains sections + counts and no item stem; `isHostToolCallTitle("start_exam")` is true.
6. Desktop tests: the exam case routes to `startPaper` with the level parsed from the text and NO budget key; drill and chat cases keep their existing routes; an `/exam` request whose wording the two tier regexes miss still reaches the agent as chat (the host-tool leg owns it).
7. Mutation gate (AC#7): a seam on the desktop exam case that reverts it to chat fall-through, and one on the tool input strictness that re-admits per-section counts. Anchors must not collide with existing seams (`host-ask-user-suppression` already owns the `HOST_TOOL_NAMES.some(` line, and two seams cannot share one anchor).
8. Verify + docs: ultracite, `bun run check-types`, exam suites, `bun scripts/mutation-gate.ts --check` then the new seams, `fallow dead-code --boundary-violations`, `bun run check:dox`; TASK-147 bullets in apps/server/AGENTS.md and apps/desktop/AGENTS.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-28 implementation notes.

Server leg: `start_exam` registered as the third host MCP tool (apps/server/src/ask-tool.ts:490) with a `.strict()` `{focus?, level, mode?}` input (apps/server/src/ask-tool.ts:149), so `budget`/`sections`/`conversationId` are refused at the boundary and the budgets stay `PAPER_DEFAULT_BUDGETS`. The handler calls the injected `startExam` closure (apps/server/src/context.ts:198) and RETURNS: no park, no `Promise.race`, nothing inherited from `#drillTimeoutMs`. `createChatContext()` moved from index.ts into context.ts and exported so the paper publishes on the calling conversation's live hub. The result projection carries sections and counts only, never a stem, and the description (apps/server/src/ask-tool.ts:164) forbids reading item content aloud and forbids narrating a debrief this turn (AC#4, AC#5).

Delivery gap found while proving AC#1 and fixed: a paper built BETWEEN turns lands on a hub the previous turn already settled, and `chat.subscribe` closes rather than goes live on a settled hub with terminal history (apps/server/src/chat-rpc.ts:317), so the row sat in the database with no card in front of the learner. `emitPaperFrame` now calls `resetHub(hub)` guarded on `hub.terminal` (apps/server/src/services/exam-service.ts:1726), the invariant `publishDirectDrillEvent` already keeps.

Desktop leg: the submit decision is a pure seam, `routeComposerSubmit` in apps/desktop/src/lib/composer-routing.ts returning a `kind`-discriminated `ComposerRoute`; `handleSubmit` (apps/desktop/src/routes/ai.tsx:575) is a thin switch with an exhaustive `never` default arm. The `paper` arm runs `orpc.exam.request` + `orpc.exam.assemble` then invalidates `messageHistoryQueryOptions(conversationId)` (history is `staleTime 60s`), so the card appears with no live socket. `IntentResult` gained an optional `level` (apps/desktop/src/lib/intent.ts:26) so the branch reads the level the layer already resolved instead of re-parsing the text.

Suppression: `start_exam` added to `HOST_TOOL_NAMES` (packages/acp/src/acp-events.ts:37).

Tests: apps/server/test/exam-host-tool.test.ts 9 tests / 201 assertions (advertised shape, refusal of a count-bearing call, conversation binding over the `exam:<id>` fallback, the level default, the content-free projection, resolving while a paper runs, the between-turns hub reopen, an unconfigured host refusing, the model-free path through the same request); apps/desktop/test/composer-routing.test.ts 9 tests driven through the REAL `resolveIntent`.

Gates: full apps/server suite 222 pass / 1 skip / 0 fail; packages/acp 149 pass; packages/chat-session 252 pass; desktop 454 pass / 3 skip; `fallow dead-code --boundary-violations` 0 issues; `bun run check:dox` complete; `bun x ultracite check` clean across the 12 touched files; `bun scripts/mutation-gate.ts --check` resolves all 26 anchors and each new seam caught its mutation (`exam-composer-branch-reverted`, `exam-host-tool-budget-admitted`, `exam-host-tool-conversation-ignored`, `exam-paper-publish-on-settled-hub`).

DOX: TASK-147 bullets in apps/server/AGENTS.md and apps/desktop/AGENTS.md; new `src/lib/` index rows for `composer-routing.ts` and for `intent.ts` (it was never indexed); a verification-list row for the desktop test; packages/acp/AGENTS.md suppression line now names the third tool.

Status: all seven ACs have code and a test behind them, but they are left UNCHECKED pending review, and the work is uncommitted on `re-design` pending the user's go-ahead.

Finalization re-check 2026-10-13 against committed code (7af5814, branch re-design): apps/server exam-host-tool.test.ts now 13 pass / 223 assertions / 0 fail (suite grew since the 9-test implementation note), apps/desktop composer-routing.test.ts 9 pass / 0 fail. AC#1 conversation binding + between-turns hub reopen tests; AC#2 strict-input refusal + level-default allocation tests; AC#3 resolves-while-paper-runs test; AC#4 content-free projection test + description guard; AC#5 debrief deferred by tool description, no busy conversation left (same test); AC#6 model-free /exam route through routeComposerSubmit (desktop tests run the REAL resolveIntent); AC#7 seams exam-composer-branch-reverted / exam-host-tool-budget-admitted / exam-host-tool-conversation-ignored / exam-paper-publish-on-settled-hub are in MUTATIONS and mutation-gate --check resolved all 207 anchors on the TASK-153 commit.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ask-and-get-a-paper shipped in commit 7af5814: start_exam host tool (strict {focus?, level, mode?}, code-chosen budgets, non-blocking, content-free result, debrief deferred) for wording the intent regexes miss, plus the model-free composer /exam branch so agent availability is never an exam dependency; a between-turns paper reopens the settled hub so the card actually reaches the learner. All 7 ACs verified by exam-host-tool.test.ts (13 tests) and composer-routing.test.ts (9 tests) re-run green on HEAD, with four mutation-gate seams pinning the trigger.
<!-- SECTION:FINAL_SUMMARY:END -->
