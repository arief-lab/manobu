---
id: TASK-156
title: 'Exam: a paper size named in chat is dropped, and nothing tells the learner'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:27'
updated_date: '2026-09-28 10:24'
labels:
  - exam
  - chat
  - ux
dependencies: []
priority: medium
type: bug
ordinal: 921000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28: asking Sensei for a 10-question N3 paper produced the default-size paper and the reply never said the size was fixed. The field works over HTTP. `ExamRequestInputSchema` accepts it (packages/api-contract/src/exam.ts:155 `budget: ExamBudgetSchema.optional()`, schema declared at :134 over NonNegativeCountSchema at :131) and the generator sizes the paper from it (apps/server/src/services/exam-service.ts:173 `totalSlots` reduces `request.budget`).

The drop is one layer up. apps/server/src/context.ts:198 `startExam` forwards only conversationId, focus, level and mode, and apps/server/src/ask-tool.ts:149 `StartExamInputSchema` is `.strict()`, so the agent cannot express a count at all (call site apps/server/src/ask-tool.ts:503). That strictness is deliberate: the comment at ask-tool.ts:142-147 cites doc-21 9.2 ("the model never decides how many items a section has"), decided in TASK-143 and restated as the TASK-147 scope limit.

So this is a decision wearing a bug costume. Either the policy is revisited and a bounded count reaches examService.request, or Sensei states that the size is code-chosen. The current middle is the worst option: the stated scope is silently ignored. What this task must NOT do is put `budget` on the desktop composer seam: apps/desktop/AGENTS.md:48 forbids it and apps/desktop/src/lib/composer-routing.ts:23 documents the omission (`mode` and `budget` are deliberately absent).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The task records which layer changes and names the doc-21 9.2 decision it either upholds or revises
- [x] #2 If the count stays code-chosen, asking for a specific size gets a visible answer saying the size is fixed, so the learner is not silently redirected
- [x] #3 If a count is accepted, it is bounded and validated at the wire before examService.request, and the allocation stays deterministic for a given level
- [x] #4 A test proves the chosen behavior by calling the seam, not by reading source text (apps/desktop/AGENTS.md:46, TASK-134)
- [x] #5 The desktop composer seam still sends only conversationId, focus and level
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
RESEARCH (2026-09-28, re-read of the current system, not the at-creation proposal):
- The size IS visible to the learner already. emitPaperFrame (apps/server/src/services/exam-service.ts:1699-1722) publishes total_slots plus per-section totals, the fold carries it (packages/chat-session/src/chat-engine/folds/paper.ts:108) into PaperCard (packages/ui/src/components/paper-card.tsx), and the workspace header prints "{sections} sections · {items} items" (apps/desktop/src/features/exam/exam-paper-pane.tsx:210). So the learner sees 30; nothing tells them they asked for 10.
- The only thing that speaks to the learner about the ask is Sensei's reply, and START_EXAM_DESCRIPTION (apps/server/src/ask-tool.ts:163) currently caps it at "Say only that the paper is ready, with its level and sections" - it does not name the item count, so the substitution is silent by instruction rather than by accident.
- The tool RESULT already carries the number the model would need: context.ts startExam returns sections[].items and totalItems (apps/server/src/context.ts:205-216), and the handler returns JSON.stringify(paper) (apps/server/src/ask-tool.ts:517).
- doc-21 9.2 (backlog/docs/architecture/doc-21 ...md:179-185) decided 2026-09-26: "the model never decides how many items a section has ... The allocation and the floors ... must not become negotiable." TASK-147 shipped that as a tested property, not just prose: apps/server/test/exam-host-tool.test.ts:180 "the allocation is the level default, whatever the caller asked for", plus the .strict() refusal test at :150 and the advertised-surface test at :131.
- The floor consequence of a learner-named total: a 10-item N3 paper split across vocabulary / grammar-reading / listening lands under the banding minimum (paperScoringFloorStatus, packages/item-engine/src/paper.ts:390-452, minimumItems 10 for a 60-item cap), so "give me 10 questions" is structurally a raw-only paper. That is a real product tradeoff, not a wire detail.

PLAN (upholds doc-21 9.2; RESEARCH + recommendation recorded before implementation, pending user approval on the one fork):
1. Keep StartExamInputSchema exactly as it is: focus / level / mode, .strict(). No budget, no count. AC#1's answer is "no wire layer changes; the layer that changes is the host-tool contract text the agent reads".
2. Change the two sentences the host owns about what the agent says: START_EXAM_DESCRIPTION (apps/server/src/ask-tool.ts:163) tells the agent to name the allocated item count and that the size comes from the level, and to say so plainly when the learner asked for a different number.
3. Make the number the agent must speak a deterministic part of the tool RESULT rather than something it has to infer: the startExam result gains a short structured line (totalItems + "allocated by level") alongside the existing JSON, so the reply is grounded in what the tool returned. AC#2's visible answer.
4. Test it by calling the seam in apps/server/test/exam-host-tool.test.ts: listTools() for the advertised description (what the agent is actually told, a wire artifact - not a source-text read, so TASK-134 holds), and callTool() for the result body naming the count that matches PAPER_DEFAULT_BUDGETS[level]. Existing refusal/allocation tests stay green unchanged, which is the proof 9.2 was not reopened.
5. No desktop change: apps/desktop/src/lib/composer-routing.ts:23 keeps mode and budget absent, so AC#5 holds by not touching it.
6. Docs: record in this task which way the decision went; if the user wants learner-sized papers, that is a doc-21 9.2 revision filed as its own decision, with the banding-floor consequence stated, not smuggled into this bug.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 decided by research, recommended not yet implemented: doc-21 9.2 UPHELD. The bug is that the host instructs silence (START_EXAM_DESCRIPTION caps the reply at 'level and sections'), not that the count is unreachable.

IMPLEMENTED, doc-21 9.2 UPHELD. The layer that changed is the host-tool contract the agent reads, not the wire schema: StartExamInputSchema (apps/server/src/ask-tool.ts:156) is untouched, still focus/level/mode with .strict(), so `budget` stays uncallable; and apps/desktop/src/lib/composer-routing.ts:23 is untouched, still three keys (its own key-set assertion is green, 9 tests). The structural alternative is filed as TASK-167 rather than landed here.

Two host-owned seams changed. apps/server/src/context.ts:204 startExam now returns `sizeStatement`: "{N} items, sized by the host from the {level} default budget." And START_EXAM_DESCRIPTION (apps/server/src/ask-tool.ts:170) stops capping the reply at "level and sections": the agent must repeat `sizeStatement` so the learner hears the size the host gave, and when the learner named a different number it must answer that first, in their words.

HAZARD found while implementing, now recorded in apps/server/AGENTS.md: any prose added to the projection must not contain a fragment of a real item surface. The first wording, "allocated by the host", failed the existing content-free-projection proof because the N5 pool holds the two-character option "all", a substring of "allocated". The reworded sentence ("sized by the host") is what the proof accepts.

EVIDENCE: apps/server/test/exam-host-tool.test.ts is 10 tests (new: "the result says what size the host gave the paper, in the agent's hands", which asserts the count in `sizeStatement` is the count in `totalItems` is the level default from PAPER_DEFAULT_BUDGETS, and that the advertised description names `sizeStatement`). Full server suite 232 pass / 1 skip / 0 fail; desktop composer suite 9 pass; tsc --noEmit clean; ultracite clean over apps/server + scripts; check:dox complete. Two mutation seams added and both CAUGHT (gate now 31 anchors): exam-host-tool-size-not-stated (empty `sizeStatement`) and exam-host-tool-size-not-told (the description reverted to "Say only that the paper is ready, with its level and sections"). The second anchor spans both mentions of `sizeStatement` on purpose, so a half-removal cannot survive.

LIMIT, stated rather than glossed: the guarantee is prose-bounded. The size was never hidden (the transcript card prints validated/total per section, packages/ui/src/components/paper-card-states.tsx:110, and the workspace prints "{sections} sections · {items} items", apps/desktop/src/features/exam/exam-paper-pane.tsx:210); what changed is that the agent is now handed the sentence and told to say it. That Sensei's reply actually says it cannot be proven statically, and no ACP_* agent is configured in apps/server/.env here, so a live model turn could not be driven for this task. Removing that residual is TASK-167's job.

HOUSEKEEPING: bun test in apps/server exits at boot when port 4317 is taken, which my own sidecar from the TASK-155 live check was squatting; it and the leftover Vite dev server are stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
doc-21 §9.2 upheld, the silence fixed instead. No layer that sets the size changed: StartExamInputSchema (apps/server/src/ask-tool.ts:156) is still focus/level/mode with .strict(), and the desktop composer seam (apps/desktop/src/lib/composer-routing.ts:23) still sends three keys. What changed is what the host tells the agent: apps/server/src/context.ts:204 now returns `sizeStatement` ("{N} items, sized by the host from the {level} default budget.") and START_EXAM_DESCRIPTION makes the agent repeat it and answer a learner-named count first, so a request for ten questions on N3 no longer produces thirty in silence. Learner-sized papers are filed as TASK-167, the doc-21 decision that would have to be revised to allow them, with the banding-floor cost (packages/item-engine/src/paper.ts:445) stated there.

Verified by calling the seams: exam-host-tool.test.ts 10 tests, including the new one that pins the count in `sizeStatement` to the count in `totalItems` to PAPER_DEFAULT_BUDGETS and requires the advertised description to name `sizeStatement`; server suite 232 pass / 1 skip / 0 fail; desktop composer suite 9 pass; tsc and ultracite clean; check:dox complete. Two mutation seams added and both caught (31 anchors resolve): the empty statement, and the description reverted whole (the anchor spans both mentions so a half-removal cannot survive).

AC#3 is vacuous: no count was accepted, so its precondition never arose. AC#2's limit is recorded in the notes: the size was already visible on the card (paper-card-states.tsx:110) and in the workspace header (exam-paper-pane.tsx:210), and the host now hands the agent the sentence and instructs it, but whether the model says it is not statically provable, and no ACP agent is configured in this checkout to drive a live turn. One implementation hazard is now in apps/server/AGENTS.md: prose in the projection must not contain a fragment of a real item surface, which is how the first wording ("allocated by the host") failed, since the N5 pool holds the option "all".
<!-- SECTION:FINAL_SUMMARY:END -->
