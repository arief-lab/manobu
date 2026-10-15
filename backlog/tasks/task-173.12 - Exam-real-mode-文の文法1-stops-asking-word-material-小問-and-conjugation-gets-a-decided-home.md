---
id: TASK-173.12
title: >-
  Exam (real mode): 文の文法1 stops asking word-material 小問, and conjugation gets a
  decided home
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 17:21'
updated_date: '2026-10-03 04:04'
labels: []
dependencies:
  - TASK-173.2
parent_task_id: TASK-173
priority: high
type: bug
ordinal: 950000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-173.4 gave a real paper its 大問 shape, and 173.2 found the shape table lying: `PAPER_BLOCK_SHAPES["bun-no-bunpou-1"].itemTypes` is `["conjugation", "grammar-form", "particle"]` (`packages/item-engine/src/paper.ts:279-282`). 文の文法1（文法形式の判断） prints sentences with a （ ） and asks which form fits, which is what `grammar-form` and `particle` are. A `conjugation` item is word material instead: the prompt the engine gives it names the written form of one word (`candidatePromptFor`, `apps/server/src/services/exam-service.ts`), which is the 表記 direction the paper asks in a different 大問. So today a real 文の文法1 大問 prints two kinds of 小問 side by side, under one instruction sentence that is true of only the first. 173.2 could not fix the table without deciding where `conjugation` belongs, so it named the item type in the stem rule (`candidateStemFor`, `apps/server/src/services/exam-service.ts:517`) and pinned that as the intended shape in `apps/server/test/exam-real-mode-stems.test.ts`. doc-26 §4 lists 表記 as unfillable ("none: kana → kanji is the reverse direction"), which is why the misfiling happened: the only 大問 that could take a 表記-shaped item type was the grammar one. This task is the decision that workaround deferred, not a cosmetic move: real mode's whole claim is that the paper has the shape of the exam, and a 大問 that asks something the official block never asks breaks exactly that.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `PAPER_BLOCK_SHAPES` (`packages/item-engine/src/paper.ts:279`) lists, for every 大問 it fills, only item types whose material has the shape that 大問's official ねらい asks for, with the ねらい quoted from the level's レベル別 PDF pinned in `packages/item-engine/test/paper.test.ts`
- [x] #2 A `real` paper's 文の文法1 大問 carries 小問 of one material shape only, so the single instruction sentence printed above it is true of every 小問 under it
- [x] #3 `conjugation` has a decided home recorded on this task: either a 大問 the official paper asks word-material 小問 in, which `paperUnfillableBlocks` then no longer names, or a written statement that no `real` 大問 fits it today and a `real` paper therefore does not ask it
- [x] #4 The per-item-type carve-out in `candidateStemFor` (`apps/server/src/services/exam-service.ts:517`) and the 文の文法1 case in `apps/server/test/exam-real-mode-stems.test.ts` are rewritten or deleted so nothing pins the misfiling as intended behaviour
- [x] #5 doc-26 §4's block table and the TASK-173.4/173.2 bullets in `packages/item-engine/AGENTS.md` agree with the final table
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. paper.ts:288-291 bun-no-bunpou-1 itemTypes -> grammar-form, particle (drop conjugation). Leave conjugation grammar-reading flat weight unchanged so shortened still asks it and paperSectionForItemType stays consistent (block-only move to vocabulary 表記 would trigger mix-mismatch). 2. AC#1: add per-block ねloi pins to paper.test.ts for the four filled blocks (漢字読み / 文脈規定 / 文の文法1 / 文の文法2), quoting the official レベル別 PDF ねloi from doc-26 section 1 URLs (curl+pdftotext), asserting every listed itemType's material matches the ねloi. 3. AC#4: rewrite exam-real-mode-stems.test.ts 文の文法1 case to assert all landed 小問 are sentence material (stem null + passage); drop conjugation arm from candidateStemFor, keep kanji-reading. 4. AC#3: record that conjugation has no real 大問 home today (material matches neither 文の文法1 nor 表記 ねloi); a real paper does not ask it; 表記 stays in paperUnfillableBlocks. 5. AC#5: update doc-26 section 4 and item-engine + server AGENTS.md TASK-173.2/173.4 bullets. 6. Verify: bun test item-engine + apps/server, ultracite, mutation-gate --check + gate:mutation, fallow boundary-violations, check:dox, manual real-paper read.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#3 decision (option b, user-approved): conjugation has no real-mode 大問 home today. Its ねらい is 文法形式の判断 (judge which grammar form fits the （ ） in a sentence); a conjugation item is word material with no sentence/blank, and it is not a 表記 item either (表記 asks the kana→kanji spelling of one word, not an inflection choice). So it was removed from bun-no-bunpou-1's itemTypes (paper.ts:298) and its candidateStemFor arm dropped (exam-service.ts:554), leaving only kanji-reading. A real paper does not ask it; shortened still emits it via the untouched PAPER_ITEM_TYPE_WEIGHTS_V2 grammar-reading weight. Moving it into 表記 via the flat table was rejected: hyouki lives in the vocabulary section (paper.ts:517) but conjugation is flat-weighted in grammar-reading (paper.ts:1155), so paperSectionForItemType would disagree with the generating block and rejectMismatchedCandidates (paper.ts:2187) throws mix-mismatch and the paper never becomes ready. Full re-home to 表記 across all modes deferred behind a dedicated task (moves conjugation grammar→vocab in the shipped daily mix; N1 has no 表記 block). 表記 stays in paperUnfillableBlocks until a dedicated kana→kanji word-spelling type ships.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed conjugation from the real-mode 文の文法1 大問. Its material is word-level with no sentence/blank, matching neither 文法形式の判断 nor 表記's ねらい, so a real paper no longer asks it (its grammar-reading flat weight is untouched, so shortened still emits it). AC#1 pins each fillable 大問's official ねらい verbatim + guards conjugation out of every block; AC#4 rewrites the 文の文法1 server test to uniform sentence material and trims candidateStemFor to kanji-reading; AC#5 updates doc-26 §4 and the item-engine/server AGENTS.md bullets. Verified: paper + exam suites green, ultracite clean, mutation-gate --check (89 anchors) + stem/paper seams caught, fallow boundary 0, check:dox clean, manual real-paper read across N5-N1 (uniform 文の文法1, no mix-mismatch, 表記 still unfilled, conjugation never asked). Committed 291dff3, no push.
<!-- SECTION:FINAL_SUMMARY:END -->
