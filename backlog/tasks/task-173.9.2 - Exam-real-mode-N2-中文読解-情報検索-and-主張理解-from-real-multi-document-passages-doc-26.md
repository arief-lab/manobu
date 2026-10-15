---
id: TASK-173.9.2
title: >-
  Exam (real mode): N2 中文読解, 情報検索 and 主張理解 from real multi-document passages
  (doc-26)
status: Done
assignee:
  - '@arif'
created_date: '2026-10-03 11:27'
updated_date: '2026-10-07 11:58'
labels: []
dependencies: []
parent_task_id: TASK-173.9
priority: low
ordinal: 953000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second level slice of the TASK-173.9 umbrella. N2 reading adds the 中文読解 (内容理解 中文), the two-document 情報検索 compare, and 主張理解, sourced from authentic multi-document 白書-style passages. The 情報検索 two-document compare and 主張理解 have no ItemType yet; the existing long-reading/integrated-reading are hardcoded and 'not real' (doc-26 §format table). Content sourcing is the bulk of the effort and doc-26 §0 forbids fabrication. Reading only, no audio dependency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 N2 real mode adds 中文読解, 情報検索 and 主張理解 backed by real multi-document passages, or the block refuses with a named receipt
- [x] #2 Any N2 reading block without sourced content is refused, never fabricated (inherits umbrella AC#4)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SLICE 1 (this session): source-backed N2 内容理解（中文） end to end.
1. Corpus: packages/japanese/scripts/fetch-hakusho.ts ingests 令和6年版 環境白書 HTML (公共データ利用規約 1.0, attribution-only) -> data/reading/hakusho.jsonl {id,url,title,text}; cached downloads; LICENSE.md provenance.
2. Generator: scripts/gen-reading-chuubun.ts builds deterministic masked-slot cloze rows (white-paper passage <=1200 runes, one content word blanked, key = the word the source prints) at cumulative N5..N2 / N5..N1 vocab; emits data/reading/n2-chuubun.json (+ n1).
3. Gate: scripts/check-reading-chuubun.ts re-proves every frozen row (single blank, restore == source, answer single, in-level, distractor screens, judge record); npm script check:reading-chuubun.
4. Server: add item type medium-reading (ITEM_TYPES, weights/counts maps, SOURCE_FAMILY_BY_ITEM_TYPE), block naiyou-rikai-chuubun -> [medium-reading], mediumReadingStoreFor + mediumReadingSourceFor reading {level}-chuubun.json, stimuli/prompt/stem/presentation, maxPassageLength 1200.
5. Judge loop: blind reading-validator over the batch, verdicts appended to data/reading/{level}-chuubun-rejected.json; gate refuses rejected rows.
6. Tests: gen + gate unit tests (incl. an ambiguous fixture rejected), server test that real N2 fills 中文 from the store and refuses without it.
7. Mutation seams for each new gate clause; docs (LICENSE.md, packages/japanese/AGENTS.md, apps/server/AGENTS.md); verify check-types, tests, ultracite, check:dox, boundaries, mutation-gate --check.
SLICE 2+ (follow-up, same task): 情報検索 (multi-document), 統合理解, 主張理解; N1 store; blocks flip from empty itemTypes as each lands.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
OPEN-CORPUS FEASIBILITY MEASURED (2026-10-06, per arif request to find a better corpus than jawiki): probed 5 candidates against shipped N1+N2+N3 vocab (paragraph 400-1000 runes, >=0.8 coverage bar, same method as the jawiki probe). RESULTS: Aozora PD prose (羅生門/こころ) 0/81 paragraphs at >=0.8, best 0.55 - pre-war literary register measured dead. jawiki 0/27 (prior). ja.wikinews CC BY 2.5 structurally too small (stubs). ja.wikivoyage too thin. VIABLE LEAD: 政府標準利用規約 (v2.0 / 公共データ利用規約, attribution-only reuse, license verified via digital.go.jp) covers ALL ministry sites including 白書 - exactly the N1 白書-length register this task needs. Blocked only on URL discovery (guessed 白書 paths 404; 白書ナビ portal is the index) then ingest + coverage probe at scale; the N4 masked-slot pipeline carries over if coverage holds. PR TIMES ruled out (proprietary terms).

GO: 白書 CORPUS MEASURED VIABLE (2026-10-06, arif request). Ingested 10 HTML pages of 令和6年版 環境・循環型社会・生物多様性白書 (env.go.jp, 公共データ利用規約 1.0 = attribution-only, verified on env.go.jp/mail.html): 41 paragraphs in the 400-1000-rune band, 31 (76%) at >=0.8 coverage against CUMULATIVE N5-N1 vocab with greedy longest-match segmentation, best 0.91. License compatible with the N4 pipeline's provenance model. Soumu 情報通信白書 r05 HTML pages are table-heavy (0 qualifying paragraphs) - env 白書 is the source. NEXT: extend the masked-slot pipeline to an N2/N1 gen (vocab index = n1+n2 cumulative, passage band, attribution '出典：環境省ホームページ （当該ページのURL）'), then the usual judge loop.

SLICE 1 SHIPPED (2026-10-06): source-backed N2/N1 内容理解（中文） end to end, on a new `medium-reading` item type. Verified: `gen:reading-chuubun --level N2 --count 16` -> 16 rows, `--level N1 --count 11` -> 10 rows; `check:reading-chuubun` green on both (N2 16, N1 10, MIN_ITEMS 9); `bun test` 58 pass in packages/japanese and 345 pass in apps/server; `bun run check-types` 14/14 tasks; `ultracite check` clean; `fallow dead-code --boundary-violations` 0; `check:dox` complete; `mutation-gate --check` all 113 anchors resolve and the 10 new seams (4 medium-reading + 6 chuubun) are all CAUGHT, as is the repaired `short-reading-falls-back-to-canned-passage` anchor.

CORPUS: `fetch:hakusho` ingests 22 pinned narrative pages of 令和6年版 環境白書 (PDL1.0, attribution-only) -> `data/reading/hakusho.jsonl`, 753 paragraphs (runes min 20 / median 167 / max 1496). The ministry tree MIXES Shift-JIS and UTF-8; scoring a decode by kanji count picks mojibake (UTF-8 read as Shift-JIS is kanji-dense and scores HIGHER), so the fetch scores by recovered kana minus 20x U+FFFD plus the declared meta charset. See LICENSE §13.

MEASURED, and the honest limits:
- 308 of 753 paragraphs are in the 200-1200 rune band. Coverage against the cumulative N5..N1 vocabulary (greedy longest-match) is 39/308 at the N2 floor 0.8 and only 11/308 at the N1 floor 0.9. So N1's supply is EXHAUSTED at 11 candidate rows and one was judge-rejected: N1 ships 10 rows against a 9-小問 大問. Widening N1 means widening the pinned page set, not lowering the floor.
- A whole-SENTENCE collocation frame measured DEAD (unique corpus-wide; 99.96% of slots passed it). A 3-token window is the unit that bites: it admits 650/660 candidate slots at N2 and 294/296 at N1.
- Two-model blind judge (prompts/reading-validator.md, key withheld; opencode/big-pickle + opencode/space-bunny-free). Both families flagged the SAME two N2 rows UNANSWERABLE, and both independently picked option 2 against the shipped key 3 on n1c-1-1-2-49 (so that key is wrong, not one model's slip). Verdicts accumulate in data/reading/{n2,n1}-chuubun-rejected.json; the generator skips rejected ids by walking deeper into the corpus and the gate refuses them. RESULT: every shipped row agreed with its key under BOTH families (N2 16/16, N1 10/10).

AC#1 is met through its two arms: 中文読解 is ADDED and fills N2 大問11 / N1 大問9 from the sourced store, and 統合理解 / 主張理解（長文） / 情報検索 each REFUSE with a named receipt — a real N2 request large enough to reach those 大問 reports unfilledBlocks 12 統合理解, 13 主張理解（長文）, 14 情報検索 (pinned by test/exam-medium-reading.test.ts), which is exactly what context.ts startExam reads to tell the learner which parts of the official paper cannot be asked.

SLICE 2 (not started, same task): 情報検索 (multi-document compare), 統合理解 and 主張理解 need their own item types, their own refreshed 大問 ids, and the same refuse-not-fabricate contract. 統合理解 and 情報検索 need MORE THAN ONE document per 小問, which medium-reading does not model today (it is one passage per 小問), so that is a new item shape, not a store swap. The page set is also the N1 bottleneck above.

SLICE 2 (2026-10-06): 主張理解（長文） end to end on a new `claim-understanding` item type, sourced from the SAME 白書 corpus. Item type: claim-understanding in packages/item-engine types.ts + EXAM_ITEM_TYPES (api-contract), block shuchou-rikai-choubun -> [claim-understanding] in paper.ts (instruction entry deliberately NOT transcribed - no PDF read for it yet), STIMULUS_ANSWER_TYPES in validation.ts (key term is sourced from the passage, so stem-only leak check), stimuli requires 1 passage. Pipeline: packages/japanese/scripts/{reading-chuushou-corpus,gen-reading-chuushou,check-reading-chuushou}.ts + tests, mirroring the 中文 trio. Construction is authored-key, NOT masked-slot: whole 白書 paragraph (200-1200 runes, same COVERAGE_FLOOR), fixed stem この文章で筆者が最も主張していることはどれか, 4 options = authored claim + 3 authored distractors drawn by seeded permutation. The claims file data/reading/{level}-chuushou-claims.json is a required freeze-time INPUT (gen exits 1 when missing): each claim is a sentence verbatim from its target paragraph, distractors are plausible claims the passage does not state. Screens: length band, coverage floor, >=3 distinct distractors, claim-not-in-source, distractor-occurs-in-source, byte-equality to one source paragraph, judge record. Stores FROZEN: N2 9 rows (gen --count 9), N1 10 rows (gen --count 10), both gates green, regeneration byte-identical (md5 verified). Judge loop: BOTH independent families blind-passed every row with the key withheld (opencode/big-pickle 19/19, opencode/space-bunny-free 19/19, prompts/reading-validator.md via opencode run --pure with the YAML frontmatter stripped - it parses as a CLI flag), zero rejections; verdicts frozen in data/reading/{level}-chuushou-rejected.json. Server: claimUnderstandingStoreFor (exam-corpus) + claimUnderstandingSourceFor (exam-service, level-scoped, spends usedClaimUnderstandingPassages, sourcingCase undefined) + family chuushou walk branch + presentation branch never LONG_READING_PASSAGE + MEDIUM_READING_MAX_PASSAGE_LENGTH cap + stem/prompt grouped with the reading types. Tests: new apps/server/test/exam-claim-understanding.test.ts (7 tests: store shape, honest N3 absence, picker round-trip/spend/dry, presentation, real N1 paper fills 大問12 with store passages + key not leaked into prompt/stem + receipt still names 統合理解); exam-medium-reading.test.ts receipt test UPDATED - 大問13 now fills 3 小問 instead of landing zero, with a fabrication guard that every landed passage IS a store passage. Mutation seams: 10 new (6 gate + 4 server/paper), all 123 anchors resolve, all 10 CAUGHT. Docs: LICENSE.md new §14, packages/japanese/AGENTS.md (data bullet, scripts, verification, child index), apps/server/AGENTS.md (slice-2 bullet, refusal list corrected), doc-26 §4 table row + status paragraph.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
N2/N1 中文読解 (slice 1) and 主張理解 (slice 2) shipped end to end on sourced stores, and the N5 licensed 中文 store landed under 173.9.3's slice. Both ACs verified by test/exam-medium-reading.test.ts + exam-claim-understanding.test.ts + exam-reading-holes.test.ts and the full server suite. The remaining multi-document work (統合理解 and the N2/N1 multi-material 情報検索 shape) is the open scope of TASK-173.9.3, which this task gates.
<!-- SECTION:FINAL_SUMMARY:END -->
