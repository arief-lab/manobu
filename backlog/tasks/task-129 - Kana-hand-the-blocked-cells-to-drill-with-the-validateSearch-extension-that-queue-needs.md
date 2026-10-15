---
id: TASK-129
title: >-
  Kana: hand the blocked cells to /drill, with the validateSearch extension that
  queue needs
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:26'
updated_date: '2026-09-25 12:58'
labels: []
dependencies:
  - TASK-118
  - TASK-120
references:
  - 'apps/desktop/src/routes/drill.tsx:23'
  - 'apps/desktop/src/features/mock/jlpt-mock.tsx:461'
documentation:
  - >-
    backlog/docs/feature/doc-13 -
    Kana-readiness-checkpoint-paper-scoring-and-retake-policy.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
priority: high
type: feature
ordinal: 864100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A checkpoint failure has to lead somewhere, and `doc-13` §8 names the destination: the result shows per-script pass/fail, the blocked `(kind, row)` groups with the exact cells missed, and a **kana queue** action (`kana.checkpoint.queue`, "Drill these cells"). `doc-12` §3.5 adds why the result cannot reuse the mock's path: a checkpoint item carries no `grammarId`, so `deriveWeakPatterns` (`apps/desktop/src/lib/mock.ts:145`) resolves nothing and `Plan` (`apps/desktop/src/features/mock/jlpt-mock.tsx:461`) would scaffold a seven-day *grammar* plan for a kana failure, which is why the checkpoint result must be gated by `source: "checkpoint"` and must not show CEFR, sectional bands, an overall pass mark or a plan. The queue also needs a schema extension: `validateSearch` in `apps/desktop/src/routes/drill.tsx:23` accepts `chart` and `kind` only, so a cell or group selection has no way in. Note the overlap with `TASK-62` (the mock's "Drill this now" bridge): it needs the same extension for its kana-confusion case, so build one extension rather than two. `TASK-62` also still deep-links to `/learn/conjugate`, `/learn/drill` and `/learn/listen`, and `/learn` was retired in the 2026-09-14 router audit, so its links need updating before it can consume this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The checkpoint result shows per-script pass/fail and the blocked `(kind, row)` groups with the exact cells missed, and shows no CEFR, no sectional bands, no overall pass mark and no grammar plan.
- [x] #2 The result is gated by `source: "checkpoint"`, and a checkpoint result never reaches the mock's weak-pattern, plan or CEFR code path.
- [x] #3 `kana.checkpoint.queue` ("Drill these cells") deep-links into `/drill` with the blocked cells or groups preselected, and the counts shown equal the blocked groups the result lists.
- [x] #4 `validateSearch` in `apps/desktop/src/routes/drill.tsx:23` accepts the cell or group selection alongside the existing `chart` and `kind`, and an unknown value degrades to the default instead of throwing.
- [x] #5 One schema extension serves both this queue and the mock's weak-pattern bridge, rather than two parallel shapes.
- [x] #6 The result renders only after submit and is the only place in this surface where the answer key may appear.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a shared drill-search selection schema and URL/search builder for comma-separated cell and group selections, then use it in /drill with safe defaults and filtered kana decks.
2. Extend kana-instrument evaluation with per-group counts, failed item ids, and post-submit review rows while preserving the existing pass/fail API.
3. Add a source-gated KanaCheckpointResult subcomponent to the mock feature: per-script pass/fail, exact blocked cells, queue deep link, and no CEFR/section/plan output.
4. Add focused tests for search degradation, checkpoint source gating, group/cell counts, and the /drill handoff; run desktop checks and update DOX notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented TASK-129 with the shared drill search schema/builder, safe cell/group filtering across six kana kinds and word-level queue items, post-submit checkpoint review/group projections, source-gated result rendering, and a mock adapter that never enters the grammar/CEFR path. Added focused search, instrument, source-gate, per-script, blocked-group, and queue-handoff tests; updated desktop DOX.

Final focused run after the route-validator and per-script assertions: desktop bun test 468 pass, 3 skip, 0 fail; desktop check-types and Ultracite remain clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the kana checkpoint queue and result surface. Verified with desktop bun test (468 pass, 3 skip), root bun run test, root bun run check-types, root bun run check, and fallow audit with no changed-file findings.
<!-- SECTION:FINAL_SUMMARY:END -->
