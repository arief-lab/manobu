---
id: TASK-173.9.4.1
title: >-
  Exam (real mode): N3 聴解, five 大問 (課題理解 6 / ポイント理解 6 / 概要理解 3 / 発話表現 4 / 即時応答
  9)
status: Done
assignee:
  - '@Buffy'
created_date: '2026-10-12 03:50'
updated_date: '2026-10-12 07:45'
labels: []
dependencies: []
parent_task_id: TASK-173.9.4
priority: medium
type: feature
ordinal: 986000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First slice of TASK-173.9.4 and the cheaper one: four of N3's five 聴解 大問 reuse the item types TASK-173.8.1 already registered (listening-kadai :26, listening-point :27, listening-hatsuwa :28, listening-sokuji :29 in packages/item-engine/src/types.ts), so only ONE new type is needed for N3 大問3 概要理解, which paper.ts:342 still carries as an empty shape (itemTypes: []). The N3 blueprint is paper.ts:775-779 (聴解 大問1 課題理解 6, 大問2 ポイント理解 6, 大問3 概要理解 3, 大問4 発話表現 4, 大問5 即時応答 9), so a four-paper store floor is 小問数 × 4 = 24 / 24 / 12 / 16 / 36 rows.

Supply: no licensed route exists. JLPTSuccess ships listening material at N5 only (packages/japanese/.cache/jlptsuccess holds nothing else, and LICENSE §29's upstream file is N5/data/listening.json), so every N3 row is AUTHORED, the TASK-173.8.1 N4 route (LICENSE §30): this repo writes the scenarios, the printed question and the four options, and a row serves only with the cert trio (provenance: "composed", construction: "authored", validated: true, validatedBy: "authored:agent-blind-judged") plus two independent blind agent passes with the keys withheld and the four options re-shuffled per pass, each pass joined to ITS OWN per-packet key-letter sidecar. The owner reads no Japanese, so there is no human leg and the correlated-error limit in LICENSE §29 carries over verbatim.

概要理解 is the one shape decision, and it is a real one: the block is a longer monologue or 対話 asked WITHOUT a printed 小問 and without four options, so it is not the four-option mold the other four blocks use. Before writing any row, read the official レベル別 大問のねらい PDF for N3 聴解 大問3 (doc-26 §1 pins the PDF set) and record in doc-26 §4 what the block actually asks and how one 小問 is scored, then decide the item shape in the engine. The existing TASK-132 integrated-listening type (types.ts:25, stimuli.ts:34 minPassages: 0 minScripts: 1, excluded from SPEAKING_ITEM_TYPES because its script is one of several stimuli) is a DIFFERENT construction and is not a drop-in for it; if 概要理解 is a stimulus-only judgement with no options, that is a new shape with no options at all and it must be argued explicitly rather than faked into four choices.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Five N3 聴解 stores exist and hold the four-paper floor: data/reading/{n3-kadai,n3-point,n3-gaiyou,n3-hatsuwa,n3-sokuji}.json at 24/24/12/16/36 rows, each stamped level: "N3" and its own block id, and no scenario or answer shared with the shipped N4/N5 stores (listeningReuseClashes pools every level of one file stem).
- [x] #2 概要理解 is decided from the official N3 大問のねらい text, quoted with its PDF page into doc-26 §4, and registered as a new ItemType in packages/item-engine/src/types.ts ITEM_TYPES plus packages/api-contract/src/exam.ts EXAM_ITEM_TYPES, declared under PAPER_BLOCK_SHAPES["gaiyou-rikai"] (paper.ts:342, empty today), flat-mix weight 0 at every level so only real asks it. If the block has no four-option shape, the store does not fake one.
- [x] #3 The four existing listening gates grow N3 lines in MIN_ROWS (scripts/check-listening-{kadai,point,hatsuwa,sokuji}.ts) and N3 rune bands in scripts/check-listening-shared.ts:101-110; 概要理解 gets its own offline check:listening-gaiyou gate re-proving the shape AC#2 decided.
- [x] #4 Every composed row cleared two independent blind agent passes with keys withheld and options re-shuffled per pass, each pick joined to ITS OWN per-packet key-letter sidecar (the LICENSE §30 protocol); rejected ids and judge reasons are recorded in data/reading/{stem}-rejected.json, and bun run check:listening-* exits 0 over shipped rows and 1 over a mutated fixture.
- [x] #5 The server serves N3: the four listening*StoreFor loaders (apps/server/src/services/exam-corpus.ts:897/920/944/968) add "N3" to the level loop they walk, a 概要理解 store fn is added beside them, READING_STORE_FOR (apps/server/src/services/exam-service.ts:4458-4461) carries the new type so a drained 大問 NAMES its hole, and the new type joins SPEAKING_ITEM_TYPES (packages/db/src/item-store.ts) so its scenario projects as speech with passage null.
- [x] #6 apps/server/test/exam-listening.test.ts grows STORE_LEVELS (:91, today ["N4","N5"]) to include "N3" and pins a real N3 paper filling all five 聴解 大問 to the official counts with no scenario re-used, plus the drained-store and unjudged-row paths at N3.
- [x] #7 Mutation-gate seams cover the new shape on the TASK-173.8.1 pattern (scripts/mutation-gate.ts:2186-2223), each CAUGHT, and bun scripts/mutation-gate.ts --check stays green.
- [x] #8 Docs: a LICENSE.md section owns the N3 聴解 stores, the japanese / item-engine / apps-server AGENTS.md bullets carry N3, bun run check:dox green, one commit, no push.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created 2026-10-12 after TASK-173.8.1 shipped N4/N5, from the real blueprint counts in paper.ts rather than from doc-26's stale 2009 column.

Closeout 2026-10-12: all five stores ship at the exact blueprint floors (24/24/12/16/36). The two blind judge passes burned 13 first-round rows (n3-kd-122 walk/bus undecided; n3-pt-117 duplicate-meaning options; n3-pt-124 question asked the unstated speaker's wake-up; n3-hw-109 two natural congrats; eight sokuji yes/no-pole pairs + n3-sj-123 guest-leaving register); ids and reasons are in the four n3-*-rejected.json ledgers, and the 13 replacements (n3-kd-125, n3-pt-125/126, n3-hw-117, n3-sj-137-145) cleared both passes 13/13 under the same protocol. Server wiring needed the service-local LISTENING_ITEM_TYPES set too: dropping listening-gaiyou there makes presentationFor print the monologue as a passage and minScripts 1 refuses every candidate, a silent shortfall (seam listening-gaiyou-speech-projection-dropped). Also restored an UNRESTORED exam-focus-not-persisted mutation found in packages/db/src/item-store.ts:2512 from an interrupted gate run (same incident doc TASK-173.9.3 recorded). Validation: check:listening-{kadai,point,gaiyou,hatsuwa,sokuji} all green at N3/N4/N5; check-types 14/14; ultracite clean; check:dox green; apps/server 627 pass/0 fail (exam-listening 65, incl. a real N3 paper filling 6+6+3+4+9=28 小問 with 28 distinct scenarios); packages/japanese 542/0 (check-listening 37 incl. the monologue band fixtures); item-engine 80/0; db 39/0; bun scripts/mutation-gate.ts --check: all 200 anchors resolve; listening- seam family 9/9 CAUGHT.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped N3 聴解 at exam-real fidelity: all five 大問 (課題理解 6 / ポイント理解 6 / 概要理解 3 / 発話表現 4 / 即時応答 9) now fill a real N3 paper from blind-certified authored stores. 概要理解 is a new listening-gaiyou item type whose monologue shape was measured off the official n3.pdf ねらい (話者の意図や主張, recorded in doc-26 4), gated by check:listening-gaiyou, served through its own loader/picker with the drained-store hole named and the scenario projecting as speech. 13 judged-burned rows were replaced and ledgered per the LICENSE 30 protocol. Verified with the five listening gates, a 65-test exam-listening suite (real N3 paper 28/28 小問, drained + unjudged paths), 9/9 CAUGHT mutation seams, check-types, ultracite and check:dox.
<!-- SECTION:FINAL_SUMMARY:END -->
