---
id: TASK-173.9.4.3
title: >-
  Exam (real mode): N1 聴解, five 大問 (課題理解 6 / ポイント理解 7 / 概要理解 6 / 即時応答 14 /
  聴解統合理解 4; no 発話表現 at N1)
status: Done
assignee:
  - '@Buffy'
created_date: '2026-10-12 03:52'
updated_date: '2026-10-12 11:47'
labels: []
dependencies:
  - TASK-173.9.4.2
parent_task_id: TASK-173.9.4
priority: medium
type: feature
ordinal: 988000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Last slice of TASK-173.9.4 and the top of 聴解. N1 blueprint: packages/item-engine/src/paper.ts:715-719: 聴解大問1 課題理解 6, 大問2 ポイント理解 7, 大問3 概要理解 6, 大問4 即時応答 14, 大問5 choukai-tougou-rikai 聴解統合理解 4. Four-paper floors: 24 / 28 / 24 / 56 / 16 = 148 rows, the deepest single task in the 聴解 line. Like N2, N1 prints NO 発話表現 (absence matrix packages/item-engine/test/paper.test.ts:1221-1237).

By the time this task runs, every SHAPE already exists: the four listening-* types (types.ts:26-29) from TASK-173.8.1, 概要理解 from TASK-173.9.4.1 and 聴解統合理解 from TASK-173.9.4.2. This slice is therefore supply at N1 register plus N1 lines in every level-keyed table, not new engine design: rune bands (scripts/check-listening-shared.ts:101-110 grows N3 and N2 before it), MIN_ROWS in all five check-listening-* entry points, the level loops of the listening*StoreFor loaders (apps/server/src/services/exam-corpus.ts:897/920/944/968 + the two new store fns), STORE_LEVELS in apps/server/test/exam-listening.test.ts, and the per-block N1 counts in its BLOCKS rows.

The N1 volume is the risk to name up front: 56 rows at 即時応答 alone (N4 shipped 32, N5 24) and 14 小問 in one paperの 大問4. N1 register is denser kanji and faster pace than anything shipped here, and the certified-but-unshipped surplus habit from LICENSE §30 (exact floor ships, spare rows stay out) applies unchanged. Certification is the same protocol as every row above: mechanical gate + two independent blind agent passes, keys withheld, per-pass key-letter sidecar join (LICENSE §30), burned ids ledged, stated limit (correlated model error, no human leg) restated in the LICENSE section. Zero vendorable listening supply exists at N1 (JLPTSuccess ships none above N5), so everything here is composed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All five N1 聴解 stores ship at the floors: {n1-kadai,n1-point,n1-gaiyou,n1-sokuji,n1-choukai}.json at 24/28/24/56/16 rows, stamped level: "N1" plus block id, no scenario or answer reused against any shipped N3/N4/N5 row (the cross-level pooling of listeningReuseClashes).
- [x] #2 No new item types: N1 rides the types TASK-173.8.1 / .4.1 / .4.2 registered; if implementation finds the N1 概要理解 or 統合理解 demands differ from the N2 measured shape, that is a doc-26 amendment and an explicit decision, not a silent store difference.
- [x] #3 Every level-keyed table gains an N1 line: check-listening-shared.ts bands and KNOWN_LEVELS, MIN_ROWS in all five gates, the exam-corpus.ts store loaders, READING_STORE_FOR in exam-service.ts, and the server test BLOCKS/STORE_LEVELS; the store-shipped-but-not-checked guard stays live at N1.
- [x] #4 Certification per the LICENSE §30 protocol on all 148 shipped rows (plus burned replacements), in recorded batches, with the verdict files authoritative over any judge prose, as the sokuji repl round proved at N4.
- [x] #5 apps/server/test/exam-listening.test.ts pins a real N1 paper filling all five 聴解 大問 to 6/7/6/14/4 with no script re-used, the one-heard 統合理解 dialogue landing all its 小問, drained 大問 named at N1, and unjudged rows refused at N1.
- [x] #6 Full battery green before the commit: packages/japanese + apps/server + item-engine + db suites, the five check:listening-* gates at every shipped level, check-types, mutation-gate --check (new seams caught on the listening-* pattern), check:dox, ultracite.
- [x] #7 Docs: LICENSE section owning the N1 聴解 stores; japanese/item-engine/apps-server AGENTS.md bullets updated so no 聴解 hole remains at any level; doc-26 §4 capability row flipped; check:dox green; one commit, no push. Close TASK-173.9.4 only when every level N5-N1 fills its real 聴解 大問 without a named hole.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend check-listening-shared.ts (SCENARIO_BANDS/OPTION_BANDS/KNOWN_LEVELS gain N1) and MIN_ROWS in the five check-listening-* gates. 2. Author N1 candidates per block (kadai 28 / point 32 / gaiyou 28 / sokuji 62 / choukai 20 incl. surplus past the 24/28/24/56/16 floors), run the mechanical gates, replace reuse/band failures. 3. Certify every shipped row on two independent blind passes with per-pass key-letter joins (LICENSE 30 protocol), burn into {n1-*}-rejected.json, trim to the exact floors. 4. Wire apps/server: N1 joins the five listening*StoreFor loops; STORE_LEVELS + per-block N1 counts 6/7/6/14/4 in exam-listening.test.ts. 5. Seams: prove the listening-* + choukai seams still catch at N1 (new seam if a level-gated table is unpinned). 6. Full battery, LICENSE N1 section, three AGENTS bullets, doc-26 capability row, closeout, one commit no push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: five check:listening gates read N1: 24/28/24/56/16 pass all screens; exam-listening 110 pass / 0 fail; full server 671/0, japanese 545/0, item-engine 80/0, db 39/0; check-types green; mutation-gate --check 207 anchors resolve; new seams listening-n1-kadai-store-not-loaded + listening-n1-choukai-store-not-loaded both CAUGHT (bun scripts/mutation-gate.ts listening-n1); check:dox green. Certification: 170 candidates, two blind passes per block with per-pass key-letter sidecars, 162 cleared, 8 burned (n1-kd-123, n1-pt-124, six n1-sj rows) ledged in {n1-kadai,n1-point,n1-sokuji}-rejected.json; surplus absorbed all burns, no replacement packets. Committed locally as 5fbcdb5, not pushed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
N1 聴解 ships: five AUTHORED-only stores data/reading/n1-{kadai,point,gaiyou,sokuji,choukai}.json at the exact floors 24/28/24/56/16 (LICENSE §33), the five listening*StoreFor loader loops gained N1 (exam-corpus.ts:929/:952/:1000/:1025/:1049), N1 bands added to all five gates one step above N2 by decision, exam-listening.test.ts pins a real N1 paper filling 6+7+6+14+4 = 37 小問, and two loader-level-list seams caught. Certified by the mechanical gate plus two independent blind passes per block (170 judged, 162 cleared, 8 burned and ledged). Docs: LICENSE §33, japanese/item-engine/apps-server AGENTS bullets, doc-26 §4 rows flipped to shipped at N1. Commit 5fbcdb5 (no push). The 聴解 line is complete at every level; TASK-173.8.2 (audio) is the only 聴解 step left.
<!-- SECTION:FINAL_SUMMARY:END -->
