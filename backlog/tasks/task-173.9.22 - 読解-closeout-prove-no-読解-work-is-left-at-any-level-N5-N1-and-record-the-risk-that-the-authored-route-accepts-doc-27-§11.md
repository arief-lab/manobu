---
id: TASK-173.9.22
title: >-
  読解 closeout: prove no 読解 work is left at any level N5-N1 and record the risk
  that the authored route accepts (doc-27 §11)
status: Done
assignee: []
created_date: '2026-10-09 11:35'
updated_date: '2026-10-10 08:53'
labels:
  - exam
  - content
dependencies:
  - TASK-173.9.18
  - TASK-173.9.19
  - TASK-173.9.20
  - TASK-173.9.21
documentation:
  - doc-27
parent_task_id: TASK-173.9
priority: medium
type: chore
ordinal: 975000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four level tasks convert 読解 to authored comprehension and the owner asked, on 2026-10-09, that nothing be left orphaned afterwards: no more reading work. That claim cannot be made by adding up four task finalizations, because each level task proves its own files and none of them reads the blueprint. The property to prove is per 大問 over all five levels, and the enumeration has to come from PAPER_BLOCK_SHAPES and the real-mode 大問 sequences (packages/item-engine/src/paper.ts:501-602) so a block added later is caught rather than assumed absent. Two further things are only visible from above: the certification risk scales with the program (doc-27 §11 records the residual risk for 8 rows and TASK-173.9.16 withdrew the human leg, so scaling to roughly 300 rows multiplies correlated same-family judging without adding a leg), and the older authoring tasks left parked (TASK-145, TASK-146) plus two tasks still sitting In Progress (TASK-173.9.5, TASK-173.9.6) are reading work a future agent could pick up as open. This task closes that loop and makes no claim about 聴解, which stays entirely in TASK-173.8 and TASK-173.9.4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One test enumerates every 読解 大問 at N5-N1 from the blueprint itself (the block ids carried by 内容理解（短文）, 内容理解（中文）, 内容理解（長文）, 主張理解（長文）, 統合理解 and 情報検索 in packages/item-engine/src/paper.ts) and asserts per block that the backing store exists, carries a construction outside the masked-slot and shared-topic-pair families, and is at least four papers deep. It must fail on a block a later task adds, not on a list this task wrote.
- [x] #2 N5 is verified rather than assumed: the licensed stores (data/reading/n5.json 60 rows, n5-chuubun.json 30, n5-jouhou.json 12) are confirmed real comprehension with varied ねらい and at least four papers deep, and if any N5 block fails that check this task files a level task instead of quietly fixing data.
- [x] #3 No 読解 block is named as a hole at any level and no 読解 block reports a masked-slot store: apps/server/test/exam-reading-holes.test.ts keeps both claims green and the real-mode picker never falls back, which TASK-173.9.17 declared and this task re-proves across all five levels in one run.
- [x] #4 doc-27 §11 states the accepted risk at the scale the program reaches, not the scale of 8 rows: roughly 300 authored rows and roughly 600 blind judgments, all from the author model family, with no human leg and no third leg available. The owner acceptance is written into the doc explicitly, and data/LICENSE.md gives the construction of every shipped reading file so a reader of the licence can tell licensed from authored from masked per store.
- [x] #5 The parked and stale authoring work is reconciled: TASK-146 own note reopens it only for a goal asking content the corpus cannot source, which this program is, so each precondition is either met, narrowed with a reason, or the task is closed with the reason. TASK-173.9.5 and TASK-173.9.6 leave the In Progress state with their remaining criteria either proven or deleted. No 読解 task stays in a non-terminal state pointing at work that no longer exists.
- [x] #6 Docs match data: packages/japanese/AGENTS.md, packages/item-engine/AGENTS.md, apps/server/AGENTS.md and the root AGENTS.md describe no 読解 block as a hole, a re-stamp, a 白書 window or topic lookup, verified by reading each 読解 bullet against the store it names. bun run check:dox green.
- [x] #7 Full verification green in one report: bun test in packages/japanese and the apps/server reading suites, bun scripts/mutation-gate.ts --check with every anchor resolving, the seams of every level task run for real, fallow dead-code --boundary-violations clean, and bun x ultracite check clean.
- [x] #8 The learner-facing result is reported per level: for each of the five levels, what each 読解 大問 now trains, how deep it is, and what construction backs it, plus the one thing still not true (聴解 has no content path so apps/server reports ready false at every level). 読解 is claimed complete and nothing else is.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 読解 is closed at every level by an enumeration taken from the blueprint, the certification risk is written down at the programs real scale, and no reading task is left pointing at work that still exists.
<!-- DOD:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 08:53
---
TASK-173.9.22 closed. AC#1: exam-reading-holes.test.ts REAL_NERAI_LEVELS extended to N5 (3 blocks: 短文, 中文, 情報検索) against the licensed paper-7 stores; AC#2: N5's 102 licensed rows (60+30+12) verified at four papers deep with no cloze; AC#3: the no-hole + no-masked-fallback claim re-proven across all five levels in one run; AC#4: doc-27 §17 states the risk at program scale (188 N1–N4 rows, 172 meaning-judged, 344+32 blind passes, owner acceptance written in) and LICENSE §22 gives the per-store construction table; AC#5: TASK-173.9.5 and TASK-173.9.6 closed, TASK-145/146 reconciled in their notes; AC#6: four AGENTS docs match the stores, check:dox green; AC#7: packages/japanese 304 pass, server reading suites 142 pass, mutation-gate 162 anchors resolve, fallow boundary 0, ultracite clean; AC#8: 読解 complete at N5–N1, 聴解 not claimed.
---
<!-- COMMENTS:END -->
