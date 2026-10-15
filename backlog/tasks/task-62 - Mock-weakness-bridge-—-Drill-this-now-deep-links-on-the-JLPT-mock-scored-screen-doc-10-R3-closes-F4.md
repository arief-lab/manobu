---
id: TASK-62
title: >-
  Mock weakness bridge - SUPERSEDED: the bridge ships on the generated paper
  (doc-10 R3, closes F4)
status: Done
assignee: []
created_date: '2026-09-10 07:17'
updated_date: '2026-09-28 11:15'
labels:
  - ui
  - frontend
  - ux
dependencies: []
priority: medium
ordinal: 879000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-10 R3 (F4): the mock produces weak patterns + a plan scaffold, then the loop truncates — P3 re-derives his own study plan outside the app. Make the plan an executor: one deep-link per weak pattern into the matching practice surface. Pure wiring — the patterns, surfaces, and routes all exist (see jlpt-mock.tsx Plan compound + weak-pattern queue).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each weak pattern on the mock scored screen gets a 'Drill this now' action deep-linking to the matching surface: conjugation pattern → /learn/conjugate, kana confusion → /learn/drill?kind=..., listening → /learn/listen
- [ ] #2 Unmapped patterns fall back to an honest 'no drill surface yet — added to review queue' link into /review
- [ ] #3 bun run test + check-types + ultracite clean; browser pass: score a mock with wrong answers and follow a bridge link end-to-end
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed by TASK-158 as superseded, not implemented. The premise ("the loop truncates after the mock's plan") is true of the mock, but the bridge itself already exists on the surface a learner actually reaches: `sendToDesk` (apps/desktop/src/features/exam/exam-paper-scope.tsx:403) reads the submitted paper's own misses (`debrief.items.filter((item) => item.correct === false)` at :405), dedupes their anchors (:406) and drives `chat.startDrill` with them (:413). The button is live in the review section (apps/desktop/src/features/exam/exam-paper-pane.tsx:713-722, label `exam.review.sendToDesk`, disabled while in flight, rendered only when there is a wrong answer).

Why not re-target this task there: the anchor-driven desk drill already does the job from REAL misses, while this task's per-pattern links (/learn/conjugate, /learn/drill?kind=, /learn/listen) would derive from 9 hand-typed seed questions on an unlinked internal route (decision recorded in apps/desktop/AGENTS.md).

Acceptance criteria are left UNCHECKED on purpose: they were never implemented as written, and this task closes because the user value arrived by another route. If someone wants per-pattern deep links on the submitted paper's review, that is new work and should be filed as such.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Superseded, verified by reading the shipped code rather than by implementing: the weakness bridge exists at apps/desktop/src/features/exam/exam-paper-scope.tsx:403 (debrief misses -> anchors -> chat.startDrill) and its control at exam-paper-pane.tsx:713. Closed under TASK-158, which decided /jlpt-mock is internal-only, so no planned work may sit on it.
<!-- SECTION:FINAL_SUMMARY:END -->
