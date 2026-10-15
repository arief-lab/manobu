---
id: TASK-167
title: >-
  Exam: let a learner name the paper size, or keep it level-only (a doc-21 9.2
  revision)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 10:10'
updated_date: '2026-09-28 16:44'
labels:
  - exam
  - chat
  - ux
dependencies: []
documentation:
  - >-
    backlog/docs/architecture/doc-21 -
    The-exam-content-pipeline-corpus-supply-the-model-free-path-and-sense-selection.md
priority: medium
type: task
ordinal: 932000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28 (TASK-156): asking Sensei for a 10-question N3 paper produced the 30-item level default. TASK-156 closes the *silence* only, because the stronger fix is a policy decision this repo settled two days ago and should not reopen inside a bug report.

doc-21 §9.2 (backlog/docs/architecture/doc-21 - The-exam-content-pipeline-corpus-supply-the-model-free-path-and-sense-selection.md:179, decided 2026-09-26) says the paper stays the sidecar's and "the model never decides how many items a section has", and that "the allocation and the floors ... must not become negotiable". TASK-147 shipped that as tested behavior, not prose: StartExamInputSchema is .strict() (apps/server/src/ask-tool.ts:149-155) so a count cannot be expressed at all, and apps/server/test/exam-host-tool.test.ts:130, :147 and :183 assert the advertised surface, the refusal, and "the allocation is the level default, whatever the caller asked for".

The structural alternative this task weighs: accept ONE bounded integer (a total) on the host tool and let code split it. That keeps the letter of §9.2, because the model still never picks a section's count: per-section budgets already exist as a caller override (ExamBudgetSchema, packages/api-contract/src/exam.ts:134; the request reduces them at apps/server/src/services/exam-service.ts:173; defaultPaperBudgetFor at packages/item-engine/src/paper.ts:359 over PAPER_DEFAULT_BUDGETS at :294), so a total-to-sections split is a new pure function next to code that is already pure. It honors what the learner actually said.

The cost is not cosmetic and is why this needs a decision first: the banding floors are what make a scaled score meaningful, and paperScoringFloorStatus (packages/item-engine/src/paper.ts:390) requires minimumItems 10, or 20 for a 120-item cap (:445). A 10-item N3 paper split across vocabulary, grammar-reading and listening lands under every one of them, so "give me 10 questions" is structurally a raw-only paper. The learner who asks for a short paper is asking for a score that cannot be banded, and EXAM_MODE_LABELS ("shortened-paper-banded" / "shortened-paper-raw-only", packages/api-contract/src/exam.ts:105-109) already has to say so honestly. A bounded minimum that cannot go below the floor is the other answer, and it means a learner asking for 10 on N3 cannot be served 10.

Scope note: this must NOT put budget on the desktop composer seam. apps/desktop/AGENTS.md:48 forbids it and apps/desktop/src/lib/composer-routing.ts:23 documents the deliberate omission, so the learner's own composer path stays count-free either way; only the agent-relayed ask is in question.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 doc-21 §9.2 carries a recorded answer with a date: either the invariant is restated with a learner-named total explicitly refused, or it is revised to "the model may relay one bounded total; code allocates it". TASK-156 is referenced as the prose-level fix either way.
- [x] #2 If the invariant stands unchanged, this task closes with the decision recorded and no code, and names what a learner who wants a short paper is told instead.
- [ ] #3 If a total is accepted, it is one bounded integer validated at the wire before examService.request, and a call that names a per-section count is still refused.
- [ ] #4 If a total is accepted, the split for a given (level, total) is a pure function that lands exactly on the total, proven by calling the allocator and by calling start_exam through the host-tool seam, not by reading source text (TASK-134).
- [ ] #5 If a total is accepted, a paper whose sections fall under the banding minimum reports the raw-only label and the surface says so; the floor consequence is stated in the doc, not left implicit.
- [x] #6 The three TASK-147 assertions at apps/server/test/exam-host-tool.test.ts:130, :147 and :183 are updated to the revised property or removed with a stated reason, never left contradicting the shipped behavior.
- [x] #7 The desktop composer seam still sends only conversationId, focus and level (apps/desktop/src/lib/composer-routing.ts:23).
- [x] #8 New user-visible strings contain no em dash (R-02, guarded by packages/ui/test/copy-snapshot.test.ts).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Decide from the shipped floor machinery, not from prose. Call `paperScoringFloorStatus` for the totals a learner would name (done, 2026-09-28): at N3/N4/N5 the level default (10/10/10) sits EXACTLY on `minimumItems: 10`, so a named total of 10 or 20 split across the three sections is `raw-only`, 30 is `band`, 45 is `band`. A single-section paper at 10 items is `band`, so "shorter" is reachable today by narrowing scope, never by shrinking a section. At N1/N2 one section feeds TWO scoring columns (40 `language-knowledge-reading` items project to `language-knowledge` 23 + `reading` 10), so a total-to-sections splitter has to know the scoring projection, not the section list, or it silently ships raw-only papers.
2. Recommendation, to be recorded: the invariant stands. A bounded total buys a new allocator plus a new failure mode (an unbandable paper) to serve exactly the requests the drill already serves, and it cannot go below the floor anyway, which means "10 on N3" still gets refused. doc-21 §9.2 gains the dated answer, the floor evidence, and the sentence a learner is told instead.
3. Bug found while reading the seam, fixed directly: `START_EXAM_DESCRIPTION` (apps/server/src/ask-tool.ts:171) advertises `mode` as "shortened for a quick paper". `mode` never changes an item count: `paperSectionSeconds` (packages/item-engine/src/paper.ts:303-324) scales only the seconds, and exam-conditions additionally rejects unmet floors (:1113). So the agent-facing text invites Sensei to answer "10 questions" with "here is a short one" and deliver 30 items, which is the exact symptom TASK-167 was filed for. Rewrite the mode clause to say what mode changes (the clock and the floor requirement, not the size) and what a learner who wants fewer questions actually gets.
4. Prove it by calling the seam: read the advertised tool listing from the running host-tool server (`listTools` in apps/server/test/exam-host-tool.test.ts) and assert the description states that every mode carries the level's item count; keep the three TASK-147 assertions (the invariant stands, so they stay, and the new assertion is the one that would have caught this).
5. No wire change: `StartExamInputSchema` stays `.strict()` with focus/level/mode, no budget and no sections, and the desktop composer seam is untouched (AC#7).
6. Gates: root `bun run test`, `check-types`, `ultracite check`, `fallow dead-code --boundary-violations`, `check:dox`, `bun scripts/mutation-gate.ts --check`, plus a live check that a learner asking Sensei for a 10-question N3 paper hears the size and the reason.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECISION: the invariant stands, no learner-named total on start_exam. Recorded in doc-21 9.2 (revised 2026-09-28) with the measured floor evidence: calling paperScoringFloorStatus with a total split across N3's three sections gives raw-only at 10 and 20, band at 30 and 45, so a bounded total cannot serve the request that started this; at N1/N2 one section feeds two scoring columns, so a total-to-sections splitter must know the scoring projection or it ships unbandable papers. AC#3/#4/#5 are conditional on accepting a total and are therefore void, not deferred.

BUG FIXED (authorized by 'if you found bug, fix it directly'): START_EXAM_DESCRIPTION (apps/server/src/ask-tool.ts:180) advertised mode as "shortened for a quick paper". mode never sizes anything: paperSectionTimeLimitSeconds (packages/item-engine/src/paper.ts:302-326) uses the budget only to scale the seconds, so both modes carry the level's item count. That sentence was the mechanism behind the symptom this task was filed for: it invited Sensei to answer "10 questions" with a shorter-paper promise and deliver 30. Rewritten to state what mode changes (the clock, and the floor requirement for exam-conditions) and what focus cannot (a smaller count). Also corrected "the learner answers it in their own time": a section's clock runs while active and the server advances it at zero (exam-service.ts:2321 reconcileTimedOutSection), pauses excluded (exam-service.ts:280 sectionTiming).

PINNED: new test "mode moves the clock, never the count, and the listing says so" in apps/server/test/exam-host-tool.test.ts calls start_exam once per mode and asserts identical sections/counts, strictly greater timeLimitSeconds per section under exam-conditions, and reads the description off tools/list to assert it says both modes carry the same number of items and that no mode makes the paper smaller. New mutation seam exam-host-tool-mode-sells-size rewrites the clause back into the lie; the gate reports it CAUGHT. The three TASK-147 assertions are unchanged and still pass (AC#6: the invariant stands, so they stay).

LIVE (headless Chromium on the dev server, :3001 -> :4317, real agent turn): the same ask "Give me a 10-question N3 paper please" produced only "Your N3 paper is ready: 30 items, 3 sections." BEFORE the wording change, and AFTER it "You asked for 10 questions; the paper is 30 items, not 10. The size comes from the N3 level's default budget, and I can't build a smaller paper than that" plus the per-section breakdown and the paper card. That second sentence is AC#2's answer observed rather than asserted. The two verification conversations and their exam rows were deleted from local.db afterwards (18 messages, 2 exams, 0 orphans left).

GATES: root bun run test 10/10 tasks (server 250 pass, 1 pre-existing skip); bun run check-types 14/14; bun x ultracite check clean on the three code files; fallow dead-code --boundary-violations 0; bun run check:dox complete; bun scripts/mutation-gate.ts --check 53 anchors resolve (the stale exam-host-tool-size-not-told anchor was updated to the new wording, which is the gate working as designed); bun scripts/mutation-gate.ts exam-host-tool caught all 5 seams. DOX: apps/server/AGENTS.md TASK-147 row rewritten (decision, the prose bug, the new test, the new seam), doc-21 9.2 carries the dated revision.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @arif
created: 2026-09-28 16:44
---
AC#2 says the invariant standing closes the task 'with the decision recorded and no code'. The wire is untouched (no allocator, no schema change, composer seam unchanged), but the task did ship a code change: the START_EXAM_DESCRIPTION bug found while reading the seam, fixed under the standing 'if you found bug, fix it directly' instruction, plus its test and mutation seam. Flagging it so the AC reads as interpreted rather than literally satisfied.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
DECISION, not a feature: the doc-21 9.2 invariant stands. start_exam keeps focus/level/mode only, and a learner-named total is explicitly refused. The answer and its evidence are recorded in doc-21 9.2 (revised 2026-09-28): the N3/N4/N5 level default already sits on the banding floor (paperScoringFloorStatus: a total split across three sections is raw-only at 10 and 20, band at 30 and 45), so a bounded total cannot serve "10 questions on N3" anyway; at N1/N2 one section feeds two scoring columns, so the hoped-for pure splitter is really a scoring-projection-aware allocator with a new silent failure mode; and the request a learner actually makes (a handful of questions now) is the drill. AC#3/#4/#5 are void, not deferred: their premise was declined.

BUG FIXED under the standing authorization: START_EXAM_DESCRIPTION (apps/server/src/ask-tool.ts:180) sold `mode` as "shortened for a quick paper". It is not a size knob: paperSectionTimeLimitSeconds (packages/item-engine/src/paper.ts:302-326) reads the budget only to scale the seconds, so both modes carry the level's item count. That sentence was the mechanism behind this task's own symptom, so it is gone: the description now states that both modes carry the same number of items, that no mode makes the paper smaller, what the clock does change, and that a section's timer runs while the learner works and stops on pause (exam-service.ts:280, :2321), which replaces the equally untrue "answers it in their own time". The closing instruction now requires BOTH numbers in the reply, which is what AC#2's "told instead" looks like in practice.

VERIFIED: new test "mode moves the clock, never the count, and the listing says so" (apps/server/test/exam-host-tool.test.ts) starts one paper per mode through the real host-tool seam and asserts identical sections and counts, strictly greater stored timeLimitSeconds under exam-conditions, and the mode-independence sentences read off the advertised tools/list. Mutation seam exam-host-tool-mode-sells-size rewrites the clause back into the lie and is CAUGHT; the three TASK-147 assertions are untouched and still pass (AC#6), the desktop composer seam is untouched (AC#7), and no new em dash ships (AC#8). Live, in the real app: the same ask produced "Your N3 paper is ready: 30 items, 3 sections." before the change and "You asked for 10 questions; the paper is 30 items, not 10. The size comes from the N3 level's default budget, and I can't build a smaller paper than that" after it. Gates: root bun run test 10/10 tasks, check-types 14/14, ultracite clean, boundaries 0, check:dox complete, mutation-gate --check 53 anchors resolve.

Modified files: apps/server/src/ask-tool.ts, apps/server/test/exam-host-tool.test.ts, scripts/mutation-gate.ts, apps/server/AGENTS.md, doc-21
<!-- SECTION:FINAL_SUMMARY:END -->
