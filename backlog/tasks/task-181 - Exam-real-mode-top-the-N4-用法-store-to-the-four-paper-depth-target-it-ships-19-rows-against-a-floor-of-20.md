---
id: TASK-181
title: >-
  Exam (real mode): top the N4 用法 store to the four-paper depth target -- it
  ships 19 rows against a floor of 20
status: To Do
assignee: []
created_date: '2026-10-14 19:23'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 1000000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-179 authored packages/japanese/data/reading/n4-usage.json and it passes its gate at 19 rows: `bun run check:usage` prints "N4: 19 用法 rows pass all screens". The depth standard is the 小問 this 大問 prints times four papers, and `packages/item-engine/src/paper.ts:829` declares N4 vocabulary 大問5 `{ bigQuestion: 5, block: "youhou", count: 5 }`, so the floor is 5 x 4 = 20. One row short means a fifth distinct N4 real paper cannot be printed: TASK-148 refuses a repeat rather than fabricating one, so the level drains after four. A full N4 paper still assembles today (measured 98/98 ready, unfilledBlocks=[] on the packaged binary), which is why this is depth work, not a hole.

The cause is licensed supply, not judgement. LICENSE.md §34 records the funnel for this store: 89 licensed patterns in the N4 grammar pool, 34 authorable, and 15 rejected as `ambiguous` by the two blind passes (`reading/n4-usage-rejected.json`). Re-judging the same 15 cannot produce a 20th row; the fix needs new N4 grammar licensed under a compatible term, the same route `packages/japanese/scripts/gen-usage.ts` `LEVEL_CONFIG` consumes (it already carries `{ level: "N4", rowsNeeded: 40 }`). Sibling precedent for the shape of this task: TASK-173.9.23.2 topped N1/N2/N3 to the same target.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 - n4-usage.json carries at least 20 rows that pass \`bun run check:usage\` (the N4 line in packages/item-engine/src/paper.ts:829 prints 5 小問, so the floor is 5 x 4).
- [ ] #2 - The added rows come from newly licensed grammar patterns, not from re-judging the 15 rows already frozen in packages/japanese/data/reading/n4-usage-rejected.json, and each goes through the two independent blind passes with the keys withheld and a per-pass option shuffle.
- [ ] #3 - LICENSE.md gains a section recording the new licensed source, the funnel numbers and the shipped count, and packages/japanese/AGENTS.md points at it from the 用法 row.
- [ ] #4 - A distinct N4 real paper count of 5 is reachable: assembling five N4 real papers with five different seeds against a clean database yields five ready receipts with no repeat refusal.
<!-- AC:END -->
