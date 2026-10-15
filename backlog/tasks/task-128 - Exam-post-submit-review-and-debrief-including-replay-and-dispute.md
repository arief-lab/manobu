---
id: TASK-128
title: 'Exam: post-submit review and debrief, including replay and dispute'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:07'
updated_date: '2026-09-25 15:41'
labels: []
dependencies:
  - TASK-127
documentation:
  - >-
    backlog/docs/feature/doc-17 -
    Exam-workspace-chat-on-the-left-the-running-paper-on-the-right.md
  - >-
    backlog/docs/feature/doc-14 -
    JLPT-exam-generation-pipeline-request-assembler-validator-storage.md
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
priority: medium
type: feature
ordinal: 870500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`doc-12` v7 recorded the post-paper review as a gap: the review pass is where a paper actually teaches, and it had been unspecified while the exam itself was not. `doc-17` §7.1 specifies it and `doc-19` §8 draws the rows. Two rules shape the work. Review renders **only** after submit and never before, which is the same containment rule that keeps the key out of the transcript (D8), so review is a separate surface with its own gate rather than a restyle of the running paper. And the explanation is marked as generated, because a model-written rationale must not read as an official answer key. Replay resolves through the item store to the same item id rather than regenerating the question, which is the payoff of `doc-16` §3's composition-not-copying decision; a dispute marks the item for review without altering this paper's own record, since the local record is what the learner's result was computed from.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Review renders only after submit, with one row per item showing the learner's pick and the correct option.
- [x] #2 The explanation is marked as generated rather than presented as an official key.
- [x] #3 A replay resolves to the same item id through the item store, not to a regenerated item.
- [x] #4 A dispute marks the item without altering this paper's stored result, and the mark survives a reload.
- [x] #5 The result shows both gates where the paper clears the viability floor: total against `overallPassMark` and each scoring section against its mark, so a paper can fail overall while every section passes and the reverse.
- [x] #6 Below the viability floor, raw counts render with no band points and no pass claim, and the paper is named a shortened paper result rather than an official score.
- [x] #7 The seven review keys (`exam.review.*`) in doc-17 §7.2 exist and contain no em dash, enforced by `packages/ui/test/copy-snapshot.test.ts`.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend the submitted-only exam contract and durable item store with review facts, generated-explanation metadata, idempotent disputes, and exact stored-item replay identifiers. 2. Wire server exam/dispute/replay services and RPC/chat drill bridge without exposing keys before submit or mutating stored results on dispute. 3. Add the desktop Result/Review surface, queries, replay/dispute actions, and independent total/section gate rendering. 4. Add focused persistence, contract, server, drill, and desktop tests; update DOX and run workspace checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reduced the introduced desktop complexity findings by extracting exam result presentation and paper-section helpers; root typecheck and focused desktop review/query tests pass, and Fallow now reports no introduced complexity findings.

Approved antislop finding 1 fixed: runSubscribeLoop now parks clean closes on a wake gate; accepted sends and retry acks wake the subscription, with a bounded 1s fallback for turns started elsewhere. Added idle-close regression coverage and re-verified the submitted exam route in the browser with a clean console.

Post-fix browser recheck also confirmed exact replay still opens the same-item drill card after the idle fallback, with no console errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented TASK-128 post-submit review, generated explanations, exact stored-item replay, durable idempotent disputes, independent total/section gates, and honest raw-only results. Fixed the approved idle-subscription recursion found during the antislop audit. Verified with the full workspace test suite, root typecheck/lint/Fallow, and a live browser click-through.
<!-- SECTION:FINAL_SUMMARY:END -->
