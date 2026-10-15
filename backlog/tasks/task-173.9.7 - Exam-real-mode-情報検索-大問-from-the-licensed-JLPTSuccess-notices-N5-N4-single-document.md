---
id: TASK-173.9.7
title: >-
  Exam (real mode): 情報検索 大問 from the licensed JLPTSuccess notices (N5/N4
  single-document)
status: Done
assignee:
  - '@arif-darma'
created_date: '2026-10-07 04:01'
updated_date: '2026-10-07 11:21'
labels: []
dependencies: []
parent_task_id: TASK-173.9
ordinal: 959000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The 情報検索 大問 (N5 大問6, 1 小問; N4 大問6, 2 小問) is a HOLE today because the block declares itemTypes: [] (packages/item-engine/src/paper.ts). doc-26 §4/§4-note has been read as '情報検索 needs MORE THAN ONE document per 小問', but the official shape says otherwise: N5/N4 情報検索 is ONE document (a notice/poster/timetable) with a lookup question, which is why it is distinct from 統合理解 (N2/N1 only, which IS multi-document). JLPTSuccess already ships exactly this material under a CC BY-SA 4.0 licence: N5/data/papers/dokkai/paper-7.json = 12 questions over 6 documents (こうえんの あんない, メニュー, バスの じこくひょう, びょういんの あんない, 学校の あんない, ポスター), each document + 2-3 Japanese options, verified clean (no HTML in stems, 4 options each, passage mapping complete). Because that store would be LICENSED + verbatim, it needs NO freeze-time model judge (unlike the composed 白書 stores), so this is the cheap half of the reading gap. The 統合理解 half (multiple documents compared) stays with TASK-173.9.2/173.9.3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decided item shape models a 情報検索 item: one document (notice/poster/timetable) + a Japanese lookup question + four Japanese options, either as a new ItemType or a documented reuse; the decision is recorded in doc-26 §4
- [x] #2 A licensed store vendored verbatim from JLPTSuccess N5/data/papers/dokkai/paper-7.json backs the jouhou-kensaku block at N5 and N4, provenance and CC BY-SA 4.0 recorded in data/LICENSE.md §11
- [x] #3 A real N5 paper fills 大問6 情報検索 (1 小問) and a real N4 paper fills its 2 小問; unfilledBlocks no longer names 情報検索 where the store exists, pinned in apps/server/test
- [x] #4 Options are vendored in upstream order (verbatim), not reordered, and check:reading-answers stays green
- [x] #5 The new item type carries weight 0 in every flat mix so only real mode asks it, and seams + docs (doc-26, item-engine/api-contract/server AGENTS.md) follow the 173.7/173.9.2 pattern
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Vendor n5-jouhou.json (12 rows verbatim from JLPTSuccess N5 paper-7.json; options upstream order, answerIndex=correctIndex, provenance licensed) + n4-jouhou.json (same licensed rows, level N4: upstream N4 paper-7 has ENGLISH options and is unvendorable, AC#2 says the N5 store backs both levels). 2. item-engine: new ItemType info-search (types.ts, stimuli.ts minPassages 1, validation.ts STIMULUS_ANSWER_TYPES + passage-missing, paper.ts jouhou-kensaku shape + weight-0 records). 3. api-contract EXAM_ITEM_TYPES. 4. server: infoSearchStoreFor in exam-corpus.ts; kensaku family + infoSearchSourceFor + presentation + READING_STORE_FOR + blockHasRealSource in exam-service.ts. 5. Tests: paper.test.ts ねらい row (N5 wording verbatim from n5_revised.pdf), new exam-info-search.test.ts, update exam-reading-holes.test.ts (N5/N4 no longer holes; N3/N2/N1 stay). 6. check-reading-answers READING_STORES += both files. 7. mutation seams mirroring medium-reading's four. 8. Docs: doc-26 §4 decision (single-document shape), LICENSE §11, AGENTS.md pass + check:dox.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: full server suite 371 tests 0 fail; item-engine 69 pass; packages/japanese 86 pass; check:reading-answers green over 10 stores incl both jouhou files; mutation gate --check resolves all 131 anchors and the 4 new info-search seams were all CAUGHT; root check-types 14/14; check:dox complete. Upstream repo moved: gauravaccentureproducts/JLPTSuccess 301s to gauravhq/JLPTSuccess (recorded in LICENSE 11). Side refactor: candidatePresentationFor grew past the cognitive-complexity cap with the 5th reading branch, so the star-ordering mask body was extracted to starOrderingMaskFor (behavior-identical, no mutation anchor in that branch, verified by --check + the 64 green exam reading tests).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
情報検索 now fills a real 大問 at N5 and N4 from licensed material. New ItemType info-search (item-engine: types/stimuli minPassages 1/validation STIMULUS_ANSWER_TYPES + passage-missing/paper block shape + weight-0 flat mixes), EXAM_ITEM_TYPES gained the type, and the server reads the vendored store packages/japanese/data/reading/{n5,n4}-jouhou.json (12 verbatim rows from JLPTSuccess N5 paper-7, CC BY-SA 4.0, options in upstream order; the N4 file is the same rows level-stamped N4 because upstream's N4 paper answers in English and anchor validation rejects cross-level serving). infoSearchSourceFor mirrors the 中文/短文 picker (level-scoped store read, seenAnchors skip, per-notice passage spend, sourcingCase undefined), the presentation branch keeps the store's own notice, and blockHasRealSource answers the store-absence arm from jouhouStoreFor. Verified: a real N5 paper lands exactly 1 情報検索 小問 and a real N4 paper exactly 2 (test/exam-info-search.test.ts, 11 tests), the receipt no longer names 大問6 at those levels while N3/N2/N1 keep naming it (exam-reading-holes.test.ts), check:reading-answers green (10 stores), 4 new mutation seams all caught, full server suite 371/0, item-engine 69/0, japanese 86/0, check-types 14/14, check:dox complete. Docs: doc-26 §4 row + corrected §4-note (N5/N4 情報検索 is single-document per the official ねらい; 統合理解 stays multi), LICENSE §11 (vendored paper-7, repo move to gauravhq, N4-file-is-N5-set rationale), AGENTS.md pass for packages/japanese, item-engine, api-contract, apps/server.
<!-- SECTION:FINAL_SUMMARY:END -->
