---
id: TASK-137
title: >-
  Exam: result and review honesty pass (placeholder explanation, one label per
  fact, a dispute label that is not a verdict)
status: Done
assignee: []
created_date: '2026-09-26 03:58'
updated_date: '2026-09-27 17:49'
labels:
  - exam
  - copy
  - ui
dependencies: []
priority: medium
type: task
ordinal: 902000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three honesty and legibility defects on the exam result and review surfaces, all found by the TASK-133 rendered-frames pass (2026-09-26) and grouped because one review pass over the same two components fixes all three.

1. THE DEBRIEF RENDERS A PLACEHOLDER AS GENERATED PROSE. Every review row shows a Generated-from-vocab line above the literal string "server-only explanation", which is the stub explanation apps/server/src/services/exam-service.ts puts on every candidate item. The provenance label is honest and the text is not.

2. THE SAME SECTION CARRIES TWO LABELS IN ONE SCREEN. The chat column summarises the first scoring section as "Vocabulary 120/120" while the result pane beside it says "Language Knowledge·Reading 120/120". They are the same 120-point section: doc-12 §2.6 folds reading into language knowledge at N4/N5. A learner sees the same fact named two ways side by side.

3. A COPY KEY READS AS A VERDICT. The key exam.review.dispute renders the words "This answer is wrong" on a button, including on rows the learner answered correctly (the row's own data-correct attribute is true). It is the Dispute action, and a learner reads the label as a statement about their answer.

The wording of 3 is a product call, not a mechanical fix: the deck needs a label that is unambiguously an action while staying inside the R-02 voice (no em dash, and the copy-snapshot guard owns the deck).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No rendered string on the result or review surface is a placeholder. Either the generated exam carries a real anchored explanation, or the row stops labelling the stub as generated; a learner must never read the server-only placeholder under a Generated-from label.
- [x] #2 The chat summary and the result pane name each scoring section identically, using the scoring names from doc-12 §2.6, so one fact has one label in one screen.
- [x] #3 The dispute action label is unambiguously an action on every row, including correct ones, and the choice is recorded in packages/ui/AGENTS.md with the reason. It stays inside the R-02 voice and the copy-snapshot guard still passes.
- [x] #4 doc-19 §7 and §8 are updated to the corrected strings, and the three §12.2 findings are marked resolved there rather than left standing as open observations.
- [x] #5 The apps/desktop and apps/server suites stay green, and the change is checked in a real browser pass, not only by unit test.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. DEFECT 1, THE PLACEHOLDER: kill it at the source. apps/server/src/services/exam-service.ts:401 writes explanation: "server-only explanation" on every composed item, and that string reaches TWO learner surfaces: the exam review row (exam.debrief -> apps/desktop/src/features/exam/exam-paper-pane.tsx:608) and the drill card on replay (drill-lifecycle.ts:875 -> drill-card-states.tsx:305). Set it to null; explanationGenerated (exam-service.ts:2070, derived !== null) then reports false and the review block stops rendering. Gate the drill card's "Generated from {anchor}" heading on a non-null explanation too, so an item with no explanation never claims one. Update apps/server/test/exam-pipeline.test.ts:185 (it pins the placeholder) to assert the stored item carries none, and add the exam-placeholder-explanation mutation seam.

2. DEFECT 2, ONE LABEL PER FACT: the name of a scoring column is not a function of its id alone. The id "language-knowledge" means "Language Knowledge" (cap 60, reading is its own column) at N1/N2 and "Language Knowledge·Reading" (cap 120, reading folded in, doc-12 §2.6) at N4/N5. That is why a plain id->string map cannot be the fix and why five private copies diverged. Add examScoringSectionLabel(level, id) plus a total Record over ExamSectionId to packages/api-contract/src/exam.ts, then replace all four copies: exam-service.ts:1584, packages/chat-session/src/chat-engine/folds/paper.ts:9, exam-paper-pane.tsx:46, apps/desktop/src/lib/paper-fallback.ts:18. api-contract and item-engine are both "allow": [] leaves (cannot import each other), so this follows the existing test/level-vocabulary.test.ts precedent: declare once on the contract side and pin equality against the blueprint in a server test (per-level scoring id set == paperBlueprintFor(level).scoringSections ids).

3. DEFECT 3, THE DISPUTE LABEL: exam.review.dispute becomes "Report a wrong answer" (verb-first action, true on a row the learner got right, R-02 clean). Pin the exact value in packages/ui/test/copy-snapshot.test.ts and record the choice and reason in packages/ui/AGENTS.md.

4. DOCS: doc-19 §7 and §8 to the corrected strings, and §12.2 findings 2-4 get the FIXED in TASK-137 clause used for finding 1. DOX pass over api-contract, ui, desktop, server and chat-session AGENTS.md (including the stale apps/desktop/AGENTS.md:48 sectionLabel row), then bun run check:dox.

5. VERIFY: server + desktop + packages suites, bun run check-types, bun x ultracite check, bun scripts/mutation-gate.ts --check, and a real browser pass on a submitted N5 (folded column name) and N1 (split columns) paper.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VALIDATION (2026-09-28): apps/server 206 pass / 1 skip, apps/desktop 471 pass / 3 skip, packages/chat-session 252 pass, packages/ui 168 pass. bun run check-types 14/14 tasks. bun x ultracite check: 527 files, no fixes. bun scripts/mutation-gate.ts --check: 20 anchors resolve; the three new seams each CAUGHT (exam-explanation-stub-restored, exam-review-explanation-gate, exam-scoring-label-level-blind). fallow dead-code --boundary-violations: 0. Browser pass on the vite :3001 harness + a live sidecar, two papers submitted over /rpc: N5 exam-473d659f rendered 'Language Knowledge·Reading 54/120 · Pass' + 'Listening 24/60 · Pass' in the pane and the SAME two strings in the chat paper card; N1 exam-6c83646a rendered 'Language Knowledge 18/60', 'Reading 12/60', 'Listening 12/60' in both columns. Zero rows carried 'server-only explanation' or a 'Generated from' heading; every one of the 50 dispute controls read 'Report a wrong answer', and one click flipped its row to a disabled 'Disputed'. SIDE EFFECTS LEFT IN THE DEV DB (not the repo): those two submitted papers, and one shared item marked disputed by the click (no un-dispute procedure exists).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three surfaces now say only what is true. (1) The stub: apps/server/src/services/exam-service.ts stores explanation: null on a composed item, so explanationGenerated derives false and neither the exam review row nor the replayed drill opens a 'Generated from {anchor}' heading over a placeholder; the pane's new shouldRenderExplanation seam checks the prose as well as the flag because the two debrief fields arrive independently, and packages/ui's DrillCard gates its why-answer panel on non-null prose. (2) The name: packages/api-contract/src/exam.ts owns EXAM_SECTION_LABELS, EXAM_SCORING_SECTION_LABELS, examSectionLabel(id) and examScoringSectionLabel({ id, level }), and the server receipt, the chat-session paper fold, the desktop result pane and the offline fallback all call it instead of keeping private maps; the id alone cannot pick the name, so the paper frame now carries scoring section IDS only (label removed, id tightened to the enum) and the level derives the name at render. apps/server/test/exam-section-labels.test.ts pins every blueprint's ids and official names in order per level. (3) The label: exam.review.dispute is 'Report a wrong answer', an action that is true on a correct row, pinned in copy-snapshot.test.ts and recorded with its reason in packages/ui/AGENTS.md. Verified by 1117 passing tests across four suites, a clean 14/14 typecheck, fallow boundaries at 0, three new mutation seams that each get caught, doc-17/doc-19 rewritten to the corrected strings with §12.2 findings 2-4 marked FIXED, a DOX pass over five AGENTS.md files, and a real browser pass on a submitted N5 and N1 paper.
<!-- SECTION:FINAL_SUMMARY:END -->
