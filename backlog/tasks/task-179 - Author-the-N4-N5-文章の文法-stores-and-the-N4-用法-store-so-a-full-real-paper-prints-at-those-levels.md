---
id: TASK-179
title: >-
  Author the N4/N5 文章の文法 stores and the N4 用法 store so a full real paper prints
  at those levels
status: In Progress
assignee: []
created_date: '2026-10-14 16:07'
updated_date: '2026-10-14 19:27'
labels: []
dependencies:
  - TASK-181
priority: medium
type: feature
ordinal: 998000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while measuring TASK-178. With the complete data tree (so the bundle omission is not the cause), a full-budget real paper is still short at the two lowest levels: N5 lands 85/91 with grammar-reading#3 文章の文法 unfilled, and N4 lands 88/98 with vocabulary#5 用法 and grammar-reading#3 文章の文法 unfilled, both reporting contentExhausted. The stores those 大問 read do not exist at those levels: 文章の文法 is filled by discourse-cloze from packages/japanese/data/reading/{level}-bunshou.json (packages/item-engine/src/paper.ts:347-358 states "N4 and N5 print the 大問 and decline it") and 用法 from {level}-usage.json, and neither file is authored below N3. TASK-178 ships what exists; it cannot fill these, because widening asks the pool for a superset of the same items and the pool has none. This is authoring work on the same route the other composed stores take (scripts/gen-reading-*.ts plus the check-reading-* certification gates), and the owner requires 読解 to be finished at every level N5-N1 before recommending anything else.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 data/reading/n5-bunshou.json, n4-bunshou.json and n4-usage.json exist, each with at least indicativeCount x 4 rows, and each passes its check-reading-* gate
- [x] #2 A full-budget real paper at N5 and at N4 reports ready with an empty unfilledBlocks list over the shipped data tree
- [x] #3 The block comments in packages/item-engine/src/paper.ts that decline 文章の文法 at N4 and N5 are replaced by the level each store actually covers, and packages/japanese/AGENTS.md records the provenance and validation route of the new stores
- [x] #4 apps/server/test/exam-reading-holes.test.ts proves the new depth from the blueprint rather than from a number typed in the task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Result of the authoring run, measured not recalled. Stores installed: n5-bunshou.json 23 rows, n4-bunshou.json 21 rows, n4-usage.json 19 rows. Gates green on the tree as it stands: `bun run check:bunshou` prints N5 23 / N4 21 / N3 29 / N2 27 / N1 28 rows passing all screens, and `bun run check:usage` prints N4 19 / N3 22 / N2 20 / N1 24. Certification followed the standing protocol (two independent blind passes, keys withheld, per-pass option shuffle); the deterministic band burns are frozen as rejected files alongside each store (`n5-bunshou-rejected.json` 5, `n4-bunshou-rejected.json` 4, `n4-usage-rejected.json` 15).

AC#2 is proven on the packaged binary, not just the repo tree: with `resources/vaporetto` staged (TASK-180) the same `usr/bin/server` assembles N5 real 91/91 ready, N4 real 98/98 ready and N3 102/102 ready, each with shortfall=0, contentExhausted=false and unfilledBlocks=[]. Server-side tests: apps/server exam-reading-holes.test.ts + exam-bunshou.test.ts + exam-youhou.test.ts = 58 pass / 0 fail / 3308 expects.

AC#1 is met for the two 文章の文法 stores (23 and 21 against a 5 x 4 = 20 floor) and missed by one row for n4-usage.json: 19 against the same floor, because `packages/item-engine/src/paper.ts:829` prints 用法 as 大問5 count 5. The shortfall is licensed supply, not judgement (LICENSE.md §34 records the funnel: 89 licensed N4 grammar patterns, 34 authorable, 15 rejected ambiguous), so it cannot be closed by re-judging. Split out as TASK-181, which owns the 20th row and the five-distinct-papers check. Until that lands, N4 supports four distinct real papers rather than five; every individual paper is complete.
<!-- SECTION:NOTES:END -->
