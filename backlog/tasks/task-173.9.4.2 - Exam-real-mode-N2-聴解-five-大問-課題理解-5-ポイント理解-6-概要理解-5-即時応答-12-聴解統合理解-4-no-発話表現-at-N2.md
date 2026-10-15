---
id: TASK-173.9.4.2
title: >-
  Exam (real mode): N2 聴解, five 大問 (課題理解 5 / ポイント理解 6 / 概要理解 5 / 即時応答 12 /
  聴解統合理解 4; no 発話表現 at N2)
status: Done
assignee: []
created_date: '2026-10-12 03:51'
updated_date: '2026-10-12 10:54'
labels: []
dependencies:
  - TASK-173.9.4.1
parent_task_id: TASK-173.9.4
priority: medium
type: feature
ordinal: 987000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second slice of TASK-173.9.4, builds on TASK-173.9.4.1 (N3 opens the 概要理解 shape this level reuses). N2 blueprint: packages/item-engine/src/paper.ts:745-749: 聴解大問1 課題理解 5, 大問2 ポイント理解 6, 大問3 概要理解 5, 大問4 即時応答 12, 大問5 choukai-tougou-rikai 聴解統合理解 4. Four-paper store floors: 20 / 24 / 20 / 48 / 16 rows. N2 prints NO 発話表現 (the absence matrix test/paper.test.ts:1221-1237 lists hatsuwa-hyougen absent at N2, and the block shapes say the same), so the N3 hatsuwa route stops at N3.

Two of the five blocks are the level's real design work. 即時応答 at 12 小問 per paper (48 rows of one-shot heard exchanges at N2 register) is the biggest single authored listening store attempted so far - N4/N5 shipped 32 and 24. And 大問5 聴解統合理解 is a NEW shape: PAPER_BLOCK_SHAPES["choukai-tougou-rikai"] (paper.ts:338-341, name 統合理解) carries itemTypes: [], and the official block asks SEVERAL 小問 on ONE long 対話 - which breaks the 173.8.1 one-scenario-per-小問 reuse screen (usedListeningScenarios, apps/server/src/services/exam-service.ts:1095/2537-2548) by construction: the same script must lawfully back up to 4 小問 of one paper. Decide and record before authoring: (a) the new ItemType, (b) the store granularity (one row = one script + one 小問 with a shared scriptId, vs one row bundling the 小問 set), (c) how the gate and picker spend scripts so two papers never re-air the same 統合理解 dialogue. The TASK-132 integrated-listening type (types.ts:25) is not a drop-in: its script is one of several stimuli and it is deliberately OUT of SPEAKING_ITEM_TYPES (packages/db/AGENTS.md TASK-141 note), which a listening-only 大問 cannot be.

Supply fact (established 2026-10-12): zero vendorable listening above N5 (JLPTSuccess ships none; .cache/jlptsuccess proves it), so every N2 row is AUTHORED under the full TASK-173.8.1 certification protocol (LICENSE §30, per-pass key-letter sidecars, burned-id ledgers).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The 聴解統合理解 shape is measured from the official N2 大問のねらい (quoted with its PDF page into doc-26 §4), the store granularity and script-spend rule are written down BEFORE any row is authored, and a new ItemType is registered in types.ts ITEM_TYPES + api-contract EXAM_ITEM_TYPES, declared under PAPER_BLOCK_SHAPES["choukai-tougou-rikai"] (paper.ts:338-341), flat-mix weight 0 everywhere.
- [x] #2 Five N2 聴解 stores ship at the floors: {n2-kadai,n2-point,n2-gaiyou,n2-sokuji,n2-choukai}.json at 20/24/20/48/16 rows, each stamped level: "N2" + its block id; 発話表現 is asked for nowhere at N2 and none is added.
- [x] #3 Gates: MIN_ROWS gains N2 in the four check-listening-{kadai,point,hatsuwa,sokuji}.ts entry points (hatsuwa excluded at N2 by the blueprint), check-listening-shared.ts:101-110 gains N2 rune bands, and 概要理解 + 統合理解 gates (opened by TASK-173.9.4.1 and this task) run N2; store-shipped-but-not-checked stays live.
- [x] #4 Every composed row cleared the two independent blind passes with per-pass key-letter joins (LICENSE §30 protocol); burns recorded in {stem}-rejected.json ledgers; the 48-row 即時応答 store is certified in recorded batches, and each batch run is named in the LICENSE section.
- [x] #5 Server serves N2: listening*StoreFor level loops (apps/server/src/services/exam-corpus.ts:897/920/944/968) gain "N2", the two new types get store fns + READING_STORE_FOR entries so drained 大問 name their holes, and both join SPEAKING_ITEM_TYPES (packages/db/src/item-store.ts) with the 統合理解 script-spend rule enforced in the picker.
- [x] #6 apps/server/test/exam-listening.test.ts STORE_LEVELS gains "N2" (per-block N2 counts 5/6/5/12/4 in its BLOCKS rows) and pins a real N2 paper filling all five 聴解 大問, including that one 統合理解 dialogue is heard once and its 小問 all land, with no script re-used across 大問 or papers.
- [x] #7 Mutation-gate seams cover the new 統合理解 anchor namespace, script-spend and speech projection on the five listening-* seam pattern (scripts/mutation-gate.ts:2186-2223), each CAUGHT; --check green.
- [x] #8 Docs: LICENSE section for the N2 聴解 stores, japanese/item-engine/apps-server AGENTS.md bullets, check:dox green, one commit, no push.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification pass (continuation session, 2026-10-12): fixed the last ultracite error (lint/suspicious/noShadow at apps/server/test/exam-listening.test.ts:683, inner find callback renamed to `candidate`), then re-ran the full battery AFTER the ultracite reformat: five N2 listening gates green at the exact floors 20/24/20/48/16; japanese 545 pass, server 650 pass + 1 skip (exam-listening alone 89 pass), item-engine 80, db 39; check-types 14/14; `bun scripts/mutation-gate.ts --check` resolves all 205 anchors; `bun run check:dox` green; `bun x ultracite check` clean over apps packages scripts. Ran `bun scripts/mutation-gate.ts listening-choukai` for real: all 5 choukai seams CAUGHT (store-never-consulted, anchor-namespace-not-trusted, script-spend-dropped, speech-projection-dropped, group-screen-dropped), proving AC#7 and the apps/server AGENTS claim. Docs audited: LICENSE section 32 names the five two-pass packets under .cache/judge/n2-listening/ (the 48-row sokuji batch called out as the largest listening batch certified), records the 2 burns (n2-gy-106, n2-sj-125) + replacements in the gaiyou/sokuji ledgers and states kadai/point/choukai burned none; doc-26 section 4 carries the measured nelrai quote (n2.pdf p.1) and the granularity law (N2L.pdf problem 5) recorded before authoring. Stale file:line citations fixed after the reformat: apps/server/AGENTS.md (picker 2658->2676, source-family 1180->1184, picker-map 2773->2779, declines 1265/1346->1262/1342, cursor 1109->1003+2686) and packages/japanese/AGENTS.md paper.ts ranges (N2 745-749->759-763, N4 804-807->818-821, N5 831-836->845-848). Also moved the dangling picker-design doc comment from above choukaiGroupsOrdered to above listeningChoukaiSourceFor (line-count neutral).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-173.9.4.2 done: N2 chokai ships as five authored stores at the exact four-paper floors (kadai 20, point 24, gaiyou 20, sokuji 48, choukai 16), served end to end by the new `listening-choukai` family. The level's design work, chokai-tougou-rikai, is the family's first group-shaped block: ONE long dialogue heard ONCE backs TWO mon-shou (measured from n2.pdf p.1 and N2L.pdf problem 5, recorded in doc-26 section 4 BEFORE authoring), the gate inverts the reuse screen (each script exactly twice) and the picker spends the PAIR via `listening-choukai:` anchors + `catalog.choukaiCursor`, so no paper re-airs a dialogue. 128 rows certified on two blind passes with per-pass key-letter joins (126 clear, 2 burned into the gaiyou/sokuji ledgers, replacements re-certified); LICENSE section 32 owns the record. All 8 ACs verified this session: 5 gates green, full battery green after the reformat, the 5 choukai mutation seams run and CAUGHT, docs audited and their drifted line citations corrected. One local commit, no push.
<!-- SECTION:FINAL_SUMMARY:END -->
