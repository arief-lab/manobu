---
id: TASK-173.9.12
title: >-
  Exam (real mode): N1 内容理解（長文）from multi-paragraph 白書 windows at a 長文-specific
  floor (doc-27)
status: Done
assignee:
  - '@arif-darma'
created_date: '2026-10-08 03:15'
updated_date: '2026-10-08 05:26'
labels:
  - exam
  - content
dependencies: []
documentation:
  - doc-27
parent_task_id: TASK-173.9
priority: medium
type: feature
ordinal: 965000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
内容理解（長文） is the last 読解 block still backed by the canned LONG_READING_PASSAGE (apps/server/src/services/exam-service.ts:581) and it declares no question kind at all: packages/item-engine/src/paper.ts:329 sets naiyou-rikai-choubun to an empty itemTypes list. doc-27 measures which half of that is the real obstacle at N1, and it is not supply. Scored with the store's own coverageOf (packages/japanese/scripts/reading-chuubun-corpus.ts:273), the official 2018 N1 読解 texts (the pinned sample papers at https://www.jlpt.jp/samples/sample2018/pdf/N1R.pdf, extracted with pdftotext, nothing vendored) score 86.0% to 89.1%, so every one of them FAILS the declared COVERAGE_FLOOR.N1 = 0.9 (reading-chuubun-corpus.ts:83). Against the corpus already in the tree, an exhaustive search over every window of 2 to 5 consecutive unspent prose paragraphs (each at least 150 runes, all from one pinned 白書 page) inside the 900-1200 rune band yields 1826 windows, a 88.9% ceiling and 165 windows at 85% or better, and zero at 90%. N1 大問10 prints 4 小問 (packages/item-engine/src/paper.ts:485). So the block is closed by a 長文-specific floor plus a multi-paragraph generator, both justified by that official measurement. The standing constraint is doc-26's rule: a floor may not be loosened merely to route around an unfilled block, so the floor change must cite the official measurement as its derivation, and it must stay scoped to 長文 rather than touching the global COVERAGE_FLOOR that 中文, 短文, 主張理解 and 統合理解 are screened by. The shipped N1 stores (median 90.0% in n1.json, 90.2% in n1-chuubun.json, 91.6% in n1-chuushou.json) sit above anything the real exam prints, and that trade stays documented rather than being quietly reversed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/item-engine/src/paper.ts:329 declares naiyou-rikai-choubun with the long-reading item type, and a real-mode N1 paper fills 大問10 with its 4 小問 (paper.ts:485).
- [x] #2 packages/japanese/data/reading/n1-choubun.json ships 4 rows whose passage is 2 to 5 CONSECUTIVE prose paragraphs from one pinned 白書 page, each paragraph at least 150 runes, none already spent by another store, carrying the store convention's provenance, sourceIds, sourceUrl and sourceCredit.
- [x] #3 The 0.85 長文 floor is declared per block: COVERAGE_FLOOR (packages/japanese/scripts/reading-chuubun-corpus.ts:83) keeps 0.9 at N1 for 中文, 短文, 主張理解 and 統合理解, and the 長文 screens module states the official 86.0-89.1% sample-paper measurement as the derivation of its own constant.
- [x] #4 READING_STORE_FOR (apps/server/src/services/exam-service.ts:3306) and blockHasRealSource (same file, :3330) know the 長文 store, and apps/server/test/exam-reading-holes.test.ts asserts N1 大問10 is NOT a hole while N3 大問6 still is (that file, :151).
- [x] #5 candidatePresentationFor (apps/server/src/services/exam-service.ts:581) prints the store's own passage in real mode and never LONG_READING_PASSAGE, and scripts/mutation-gate.ts gains a long-reading-falls-back-to-canned-passage seam whose tests fail when the anchor is mutated.
- [x] #6 Flat and banded papers are untouched: long-reading keeps its weight 20 in the N1 and N3 flat mixes and still prints the canned passage there, asserted by a test, per the standing decision not to move flat weights.
- [x] #7 gen:reading-choubun and check:reading-choubun exist beside the other reading gates in packages/japanese/package.json, are deterministic, run no model, and the check gate re-measures the band and the 0.85 floor on every run.
- [x] #8 data/LICENSE.md stays accurate for the new rows, packages/japanese/AGENTS.md and apps/server/AGENTS.md name the new gate and store, and bun run check:dox, bun x ultracite check and the server suite are green.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Corpus band: new `scripts/reading-choubun-corpus.ts` owns the 長文 contract (CHOUBUN_MIN/MAX_PARAGRAPH_RUNES 150, 2-5 paragraphs, joined window 900-1200 runes, per-block floor 0.85 with the doc-27 §1 measurement as its derivation, one window per page and one window per row). It re-exports the 中文 screens, so coverage/slot/frame/distractor stay ONE contract.
   - measured on 2026-10-08 with the same adjacency rule the generator will use: 454 strict windows, 36 clear 0.85, 30 of them mutually disjoint (need 4).
2. Generator: `scripts/gen-reading-choubun.ts` composes masked-slot rows over a window: the blanked word is an in-level noun the window prints exactly once, its frame is filled by one noun corpus-wide, distractors are in-level nouns the window never prints. Signed `deterministic:gen-reading-choubun`; rejections read from `n1-choubun-rejected.json`.
3. Gate: `scripts/check-reading-choubun.ts` re-proves every screen plus the window contract (consecutive ids, all >=150 runes, 2-5 of them, one page, band, unspent by any shipped store incl. the other levels' 短文), and `packages/japanese/package.json` gains `gen:reading-choubun` / `check:reading-choubun`.
4. Data: freeze `data/reading/n1-choubun.json` (>=4 rows) + an empty `n1-choubun-rejected.json`; LICENSE.md entry for the multi-paragraph 白書 window construction.
5. Engine: `PAPER_BLOCK_SHAPES.naiyou-rikai-choubun` itemTypes = ["long-reading"] (paper.ts:329) with the doc-27 comment; flat weights untouched (AC#6).
6. Server: `choubunStoreFor` in exam-corpus.ts; family "choubun" in SOURCE_FAMILY_BY_ITEM_TYPE + SURFACE_BY_FAMILY; `usedChoubunPassages` in CandidateCatalogState; `choubunSourceFor`; the family dispatch branch; READING_STORE_FOR entry; candidatePresentationFor reads `source.passage ?? LONG_READING_PASSAGE` for long-reading (anchored, biome-ignore comment as the other seams).
7. Tests: flip N1 大問10 in exam-reading-holes.test.ts, keep N3 大問6 named; assert flat mixes keep long-reading 20.
8. Mutation seam `long-reading-falls-back-to-canned-passage` in scripts/mutation-gate.ts + `--check`.
9. DOX: packages/japanese/AGENTS.md, apps/server/AGENTS.md, item-engine AGENTS note; `bun run check:dox`, `bun x ultracite fix`, server suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- 2026-10-08: the 長文 picker is keyed on the item type plus the mode, not on a family, because `long-reading` has no 長文 family: `SOURCE_FAMILY_BY_ITEM_TYPE` still maps it to `"grammar"` (`apps/server/src/services/exam-service.ts:964`). The gate is `choubunWindowSourced(itemType, mode)` (`:1450`), reached by the walk at `:2626`, so real mode prints its own window and both flat mixes keep the canned sentence (AC#6).
- Ultracite charged `candidatePresentationFor` and the source walk over the cognitive-complexity cap of 20 once the 長文 branches were added. The fix reshaped the file without changing behavior: the four printed columns moved to `presentationFor` (`:566`), the final-else grammar-pool walker to `grammarPoolSourceFor`, and the five store-family branches collapsed into `STORE_SOURCE_PICKER_BY_FAMILY` (`:1741`) with `long-reading` deliberately absent since it needs the mode gate. One `biome-ignore` was deleted rather than repaired because it never applied.
- Two seams were re-anchored by that refactor and re-proved: `long-reading-falls-back-to-canned-passage` mutates `passage = source.passage ?? LONG_READING_PASSAGE;` (`:619`) to `passage = LONG_READING_PASSAGE;`, and `long-reading-store-ignores-mode` drops `&& mode === "real"` from `choubunWindowSourced` (`:1453`). `bun scripts/mutation-gate.ts long-reading` -> all 5 mutation(s) caught; `--check` -> all 142 seam anchor(s) resolve.
- DOX citation repair: every `exam-service.ts:NNNN` cite the docs attach to a resolvable symbol was repointed against the refactored file and verified line by line, in `apps/server/AGENTS.md` (35 rows; the 統合理解 bullet now names the `tougou` entry of `STORE_SOURCE_PICKER_BY_FAMILY` at `:1741`), `packages/japanese/data/LICENSE.md` §16-§17, and `packages/japanese/AGENTS.md` (`MAX_PASSAGE_LENGTH` at `:160`).
- Validation on the final tree: `check:reading-choubun` -> N1: all 8 rows pass; `check:reading-answers` -> 17 store(s) audited, no constant key position (n1-choubun.json n=8, mode 50%, reported only); the two 長文 package test files -> 41 pass; apps/server `bun test` -> 401 pass / 1 skip / 0 fail; root `bun run check-types` -> 14/14; `bun x ultracite check` on the 18 changed TS files -> no fixes; `fallow dead-code --boundary-violations` -> 0 issues; `fallow audit --base main` -> exit 0; `bun run check:dox` -> index complete.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
内容理解（長文） at N1 is now sourced, and the 大問 prints real 白書 text instead of the canned sentence. New `scripts/reading-choubun-corpus.ts` owns the 長文 contract (2-5 consecutive prose paragraphs from one pinned page, each at least 150 runes, joined window 900-1200 runes, per-block floor `CHOUBUN_COVERAGE_FLOOR = 0.85` derived from the official 2018 N1 読解 samples measuring 86.0-89.1%), and it re-exports the 中文 screens so coverage, slot, frame and distractor stay one contract. `gen-reading-choubun.ts` composes masked-slot rows from it and `check-reading-choubun.ts` re-proves every screen plus the window contract on each run; `data/reading/n1-choubun.json` froze 8 rows (4 小問 need 4), with an empty rejection file beside them. The global `COVERAGE_FLOOR` is untouched, so 中文, 短文, 主張理解 and 統合理解 are still screened at 0.9/0.8 (doc-26's rule: a floor moves only on evidence, and only for the block that evidence covers). On the server, `choubunSourceFor` draws a row and spends its window, `READING_STORE_FOR["long-reading"]` and `blockHasRealSource` know the store so N1 大問10 left the hole list while N3 大問6 stayed named, and the presentation branch prints `source.passage ?? LONG_READING_PASSAGE` (`apps/server/src/services/exam-service.ts:619`). Because `long-reading` has no 長文 family, the sourced path is gated on the mode by `choubunWindowSourced` (`:1450`), which is what keeps both flat mixes on the canned text and their weights at 20 (AC#6, the standing decision). N3 大問6 remains a named hole: doc-27 measures no 長文-register source for it, and that follow-up is TASK-173.9.14.

Verified: `check:reading-choubun` -> N1 all 8 rows pass; `check:reading-answers` -> 17 store(s) audited, no constant key position; 長文 package tests -> 41 pass; apps/server suite -> 401 pass / 1 skip / 0 fail; `bun run check-types` -> 14/14 tasks; `bun x ultracite check` on the changed TS files -> no fixes; `bun scripts/mutation-gate.ts long-reading` -> all 5 seams caught and `--check` -> all 142 anchors resolve; `fallow dead-code --boundary-violations` -> 0 issues and `fallow audit --base main` -> exit 0; `bun run check:dox` -> index complete after the citation repair across `apps/server/AGENTS.md`, `packages/japanese/AGENTS.md` and `data/LICENSE.md`.
<!-- SECTION:FINAL_SUMMARY:END -->
