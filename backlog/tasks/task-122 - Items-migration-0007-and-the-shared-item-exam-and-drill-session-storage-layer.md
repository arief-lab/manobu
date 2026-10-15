---
id: TASK-122
title: >-
  Items: migration 0007 and the shared item, exam and drill-session storage
  layer
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:06'
updated_date: '2026-09-24 16:01'
labels: []
dependencies:
  - TASK-113
references:
  - packages/db/src/migrations/0006_chat_conversations.sql
documentation:
  - >-
    backlog/docs/feature/doc-16 -
    JLPT-item-engine-shared-question-items-difficulty-grading-and-storage.md
  - >-
    backlog/docs/feature/doc-14 -
    JLPT-exam-generation-pipeline-request-assembler-validator-storage.md
priority: high
type: feature
ordinal: 864000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Both the drill set and the generated paper need one item store, because `doc-16` §1 exists to stop the two surfaces growing separate copies of the same question. `doc-16` §3 specifies five tables and places `items` at migration `0007`, after `0006_chat_conversations.sql`, which is the highest migration in `packages/db/src/migrations/`. The important design consequence is **composition, not copying**: a paper is `exam_items` rows pointing at item ids plus an order, so a missed exam item can be replayed as a drill item with the same id and "retry this exact question" is a lookup rather than a regeneration. Determinism is therefore per item, while `seed_part` lets a drill set render the same item at a different option order. `drill_sessions` is a row rather than a transcript: it is what the receipt names, what suspension reads, and what resume reads after a reload. `fsrs_vocab_id` exists only where a real card can exist, so grammar and listening-comprehension items have no card and must not fake one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A migration numbered after `0006_chat_conversations.sql` creates `items`, `exam_items`, `drill_sessions`, `drill_attempts` and `exams` with the columns doc-16 §3 specifies, and it is the highest migration.
- [x] #2 A paper references item ids through `exam_items`, and re-using a missed item in a drill set resolves to the same `items` row rather than a duplicate.
- [x] #3 A suspended drill session resumes from `drill_sessions`, and its asked/answered/remaining state is recoverable.
- [x] #4 `fsrs_vocab_id` is null for grammar and listening-comprehension items and set only where a real card can exist.
- [x] #5 A stored item rendered to a client carries no `answer_index`; the resolution payload does.
- [x] #6 The migration is reversible in the project's existing style, and `packages/db` tests pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add idempotent migration 0007 for items, exams, exam_items, drill_sessions and drill_attempts. 2. Add the Drizzle schema and createItemStore seam for composition, key-safe resolution, FSRS eligibility and resumable/idempotent attempts. 3. Prove migration recovery, same-row reuse, reload state, key containment, FSRS nulling and cascade teardown. 4. Run DB tests/build, root lint/typecheck and scoped Fallow.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review hardening: client renders hide listening scripts and pre-pick explanations; conflicting deterministic item ids throw; answer writes insert before the pending-row update to avoid a race; partial 0007 application is recoverable and tested.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added migration 0007 and the shared item/exam/drill storage seam with composition-only papers, resumable idempotent sessions, FSRS-safe item writes and explicit key containment. Verified by 7 focused item-store tests and 28 DB tests, DB build, 449-file Ultracite check, 13/13 root typecheck tasks, and scoped Fallow with 0 issues.
<!-- SECTION:FINAL_SUMMARY:END -->
