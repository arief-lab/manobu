---
id: TASK-124
title: >-
  Drill: session lifecycle with prefetch, runway and batch so a card never waits
  on a model turn
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:07'
updated_date: '2026-09-24 19:30'
labels: []
dependencies:
  - TASK-123
references:
  - 'packages/db/src/migrations/0008_drill_pool_lifecycle.sql:1'
  - 'packages/db/src/item-store.ts:666'
  - 'apps/server/src/services/drill-lifecycle.ts:235'
  - 'apps/server/test/drill-lifecycle.test.ts:147'
documentation:
  - >-
    backlog/docs/feature/doc-16 -
    JLPT-item-engine-shared-question-items-difficulty-grading-and-storage.md
  - >-
    backlog/docs/feature/doc-15 -
    Chat-learning-loop-casual-chat-drill-sets-exam-handoff.md
priority: high
type: feature
ordinal: 866000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`doc-15` §4.1 and `doc-16` §5.1 exist because a drill card that blocks on a model turn would kill tier 2 in practice: the loop only works if the next item is already in hand when the learner answers. The shape is pool first and generate second: draw from validated items, refill at runway 3, and draw a batch of 5 rather than one item at a time. A set does not open until its first batch exists. `doc-15` §4.2 adds suspension: a mid-set question pauses the drill, the header shows the paused count, a detour such as a paper runs, and a reload restores asked, answered and remaining. Unasked items must never count as misses, which is the failure that makes a suspended set feel punitive. Supersession drops unasked items and is capped at 2, and a batch-drawn item is re-validated at draw time because the corpus can change under a stored batch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A set does not open below its first batch, the refill fires at runway 3, and a refill in flight never blocks a pick.
- [x] #2 With the runway emptied and a refill in flight, the card shows `drill.pending` rather than blocking or repeating an item.
- [x] #3 The verdict never waits for a model turn.
- [x] #4 A suspended session shows the paused count in the header, survives a reload with asked/answered/remaining intact, and unasked items never count as misses.
- [x] #5 A supersession drops unasked items, is capped at 2, and does not fabricate a replacement item.
- [x] #6 A batch-drawn item is re-validated when drawn, and an item that no longer validates is dropped rather than served.
- [x] #7 Cost shape: the session's mix keeps cheap kana-cell items from dominating a session that also draws reading items.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add migration 0008 with persisted drill_pool_items plus drill_session_lifecycle generation/supersession state; extend schema, migration list, and @manobu/db exports. 2. Extend packages/db/src/item-store.ts with pool append/inspect/claim/drop/supersede operations that share the existing session/attempt state and enforce an asked-item gate for lifecycle draws. 3. Add apps/server/src/services/drill-lifecycle.ts as the deep lifecycle seam: first batch min(5,count) before open, session-wide per-type budget, single-flight background refill at runway <=3, pending/unavailable result, pause/resume/end controls, and generation-checked commits. 4. Inject batch production and draw-time revalidation so lifecycle never calls a model or trusts stale stored items; answer delegates to services/item-grading.ts submitItemAnswer for local verdict and exactly-once FSRS. 5. Add server lifecycle tests with deferred batch promises and temporary libSQL: open gate, nonblocking refill/pending, pause-reload counts, cap-2 supersession without replacement, draw invalidation, type-cap cost shape, and local verdict. 6. Update DB/server DOX, migration recovery assertions, and run DB/server typecheck, tests, lint, build, and Fallow gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: apps/server 123 pass + 1 skip (8 lifecycle tests); packages/db 29 pass; packages/item-engine 14 pass; root check 462 files clean; root typecheck 14/14; DB/server builds pass; Fallow audit passes with 0 introduced dead-code, complexity or duplication findings.

Architecture: migration 0008 persists the ready/asked/dropped/superseded runway plus generation and two-round cap; lifecycle claims are BEGIN IMMEDIATE, late refills are generation-checked, and untrusted batch output is parsed with Zod before semantic revalidation. Refills and verdicts never await a model.

Regression coverage includes malformed provider output, over-cap cheap items, draw-time invalidation, pause/reload counts, empty-runway drill.pending, nonblocking local settlement, cap-2 supersession, and stale refill rejection.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added durable drill runway/lifecycle storage in migration 0008 and a server lifecycle module with first-batch gating, single-flight refills, pending state, pause/resume/end, capped supersession, type budgets, Zod boundary parsing, draw-time validation and local FSRS settlement. Verified with 8 lifecycle tests, full server/DB/item-engine suites, production builds, root lint/typecheck and Fallow.
<!-- SECTION:FINAL_SUMMARY:END -->
