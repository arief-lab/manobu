---
id: TASK-173.4
title: >-
  Exam (real mode): model the official 大問 block order and per-block counts per
  level
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:45'
updated_date: '2026-09-29 15:02'
labels: []
dependencies:
  - TASK-173.1
documentation:
  - doc-26
parent_task_id: TASK-173
priority: high
type: feature
ordinal: 942000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The blueprint in `packages/item-engine/src/paper.ts:70-263` declares sections and timings but no 大問 sub-blocks, and `allocatePaperItemTypes` (`packages/item-engine/src/paper.ts:864`) spreads a section budget over raw item types. The real paper is a fixed sequence of named blocks (N5 語彙: 漢字の読み / カナ表記の意味 / 文脈規定; 文法・読解: 文の組み立て / 文的な文法 / 短文読解; 聴解: 課題理解 / ポイント理解), each with a set count and order. Without this structure the real mode cannot render the exam-day layout the headers (TASK-173.2) name.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A per-level 大問 table exists defining block order, block name, per-block item count, and the item types that fill it
- [x] #2 `allocatePaperItemTypes` (or a real-mode sibling) fills blocks in that order and count rather than a flat per-type spread
- [x] #3 A test pins the N5 and N4 block sequences against the official composition page
- [x] #4 The paper frame exposes block grouping so the desktop view can render one heading per 大問
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Decisions taken with @arif 2026-09-29: the blueprint encodes the 2009 小問数 as an INDICATIVE count with its source named in code, never as a current official figure; the real mode stays reachable while it can only refuse, because the refusal receipt is the honest status.

1. item-engine: add PaperBlock + PAPER_BLOCKS (per level, ordered, with 大問 number, official JP name, its blueprint section, indicativeCount, itemTypes) from doc-26 §3, and a real-mode sibling allocator that walks blocks in order and fills each up to its count within the section budget, reporting which blocks have no itemTypes at all.
2. Wire the allocator into assembly for real mode only; shortened and exam-conditions keep the flat spread so no existing paper changes shape.
3. Tests: pin the N5 (14 blocks) and N4 (15) sequences against the composition page's presence matrix; pin that a real allocation fills blocks in order and that unfillable blocks are named rather than skipped.
4. Expose the block on the assembled item and carry it through the exam read path so the desktop can print one heading per 大問.
5. Verification: item-engine, server, ui, chat-session, desktop suites, check-types, ultracite fix, mutation-gate --check plus a new seam for the block-order allocator, check:dox and the DOX pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Research done (doc-26 rewritten, sections 1-6). The current official sources settle order, numbering, names and section times for all five levels, and they contradict the earlier DRAFT: N5 and N4 each run 14 and 15 大問, not 10, and both include 内容理解（中文）, 情報検索 and a four-block 聴解 with 発話表現 and 即時応答. N5 has no 用法, N1 has no 表記 and no 語形成, 語形成 exists at N2 only.

The counts are a different story. The composition page the ACs name publishes only a per-level presence matrix (no 小問数 anywhere), and the five レベル別大問のねらい PDFs publish no counts either. The only per-block count table the Foundation has online is the 2009 問題構成例 sheet (https://www.jlpt.jp/samples/pdf/sample_kousei.pdf, image-only, read via pdftoppm), whose own footnote calls the numbers 目安 and whose section times disagree with the current paper for N5 (25/50/30 then, 20/40/30 now), N4 (30/60/35 then, 25/55/35 now) and N1 聴解 (60 then, 55 now). N2 and N3 times are unchanged, so those two columns are still close.

So AC#1's per-block count cannot be quoted as current official: that number is not published. AC#3's pin against the composition page can pin order, names and presence, not counts.

SHIPPED:

- AC#1 `PAPER_BLOCKS` (`packages/item-engine/src/paper.ts:351`) is the per-level 大問 table: order, official Japanese name, its blueprint 科目, `indicativeCount` and the item types that fill it (`PaperBlock`, `packages/item-engine/src/paper.ts:310`). 14 blocks at N5, 15 at N4, 17 at N3, 19 at N2, 18 at N1. Provenance is written into the table's own doc comment: order, numbering and names come from the current レベル別大問のねらい PDFs and the counts from the 2009 問題構成例 sheet, so a reader cannot mistake an indicative count for a current official one.
- AC#2 `allocatePaperMix` (`packages/item-engine/src/paper.ts:1342`) is now the single source of truth for the mix: `real` walks the blocks in order up to each `indicativeCount`, every other mode keeps the flat largest-remainder spread of `allocatePaperItemTypes`, so no existing paper changed shape. `allocatePaperBlocks` (`:1293`) reports each block's requested and filled counts; `paperUnfillableBlocks` (`:1381`) names the blocks the official shape asks for that have no question kind. Only 2 of the 21 entries in `PAPER_BLOCK_SHAPES` (`:278`) have item types today (`kanji-yomi` 漢字読み, `bun-no-bunpou-1` 文の文法1), so a real N5 paper asks 大問 1 of 語彙 and 大問 1 of 文法・読解 and nothing else.
- The real budget IS the official shape: `paperBudgetDefaultsFor` (`:821`, used at `:859`) takes each section default from `paperSectionIndicativeCount` (`:494`) and an over-large ask is clamped at parse time (`:870` `Math.min(asked, paperSectionIndicativeCount({ level, section }))`). That makes the receipt's `shortfall` the size of the real gap rather than of a wish.
- AC#3 `packages/item-engine/test/paper.test.ts` pins N5's 14 and N4's 15 sequences (order, names, 科目, filling types) against the composition page's presence matrix, plus the in-order walk, the named holes and the clamp. No count is asserted as official, per the decision above.
- AC#4 the grouping is re-derived, not stored: `paperBlocksForLandedItems` (`:1943`) returns null when the landed rows do not match the plan, so `ExamSectionState.blocks` (`packages/api-contract/src/exam.ts:390`) and `ExamComposedItem.bigQuestion` (`:365`) are only ever printed when the server can stand behind them. No DB migration was needed for that reason. The desktop renders one heading per 大問 from `largeQuestionHeading` (`apps/desktop/src/features/exam/exam-paper-pane.tsx:108`), a pure seam under the `Q n/total` line exported through `__test__`, because the desktop has no DOM environment to click a heading in. The chat `paper` frame still carries section-level counts only; the block grouping lives on the running-paper read path.
- The receipt gained a third shortage fact: `ExamUnfilledPaperBlockSchema` (`packages/api-contract/src/exam.ts:221`) as `unfilledBlocks` on the receipt (`:260`), built for real mode only at `apps/server/src/services/exam-service.ts:1869` inside `receiptFromState` (`:1860`). The three diagnoses stay separate on purpose: `contentExhausted` is a claim about the learner's history, `refusedSections` is the mode declining to invent, `unfilledBlocks` is a hole in the plan that no content fills. `startExam` checks the structural hole before both (`apps/server/src/context.ts:227`) and its refusal names each missing 大問 and offers a practice paper, which is what keeps the mode reachable honestly. The learner-facing sentence is the new deck key `paper.build.unfilled` (`packages/ui/src/lib/copy.ts:318`), chosen by the same arm precedence in `apps/desktop/src/lib/paper-notice.ts:59`.

FINDING, the 173.1 refusal is dormant as of this task. The 大問 walk asks only 漢字読み and 文の文法1, and only the `gloss` family ever gets a `sourcingCase` (`apps/server/src/services/exam-service.ts:762`), while both of those types are reading and grammar items, so nothing a real paper assembles can be refused. `refusedSections` is empty on every real paper and the paper comes up short for a structural reason instead. The two mutation seams that mutated that guard (`exam-real-mode-refusal-disabled`, `exam-real-refusal-booked-as-exhaustion`) were DELETED, not weakened: both survived the rewrite, mutating unreachable code is a no-op, and a surviving seam reports coverage that does not exist. What is live and pinned is AC#3's other half, `exam-refusal-moved-onto-daily-papers`: the refusal must not follow the daily papers. Re-add a guard seam when a sibling format task gives a real-mode 大問 a gloss-family item type.

FINDING, two carried-in claims were wrong and were corrected against source during closeout, per the house rule. `apps/server/src/tools/ask-tool.ts:533` defaults `mode ?? "shortened"`, so nothing hardcodes `real` there; the frame carries `mode: receipt.mode` (`apps/server/src/services/exam-service.ts:2006`). And TASK-173.3 is the Japanese section-names task, not the task that hands the remaining 大問 their item types; those are TASK-173.5 文脈規定, TASK-173.6 文の組み立て, TASK-173.7 読解 and TASK-173.8 聴解. The stale reference was fixed in `scripts/mutation-gate.ts`, `apps/server/test/exam-real-mode-refusal.test.ts` and the three AGENTS.md docs.

VERIFICATION: item-engine 52 pass / 0 fail; apps/server 256 / 0 across 36 files; ui 172 / 0; chat-session 272 / 0; db 39 / 0; desktop 547 / 0 with 3 pre-existing skips. `bun run check-types` clean across 14 tasks, `bun x ultracite check` clean over 552 files, `bun run check:dox` clean. Mutation gate: all 72 seam anchors resolve under `--check`, and each of the six seams added here was run individually and CAUGHT (`exam-receipt-drops-unfilled-blocks`, `paper-real-mix-not-block-driven`, `paper-unfillable-blocks-count-buildable-ones`, `paper-real-budget-uncapped`, `desktop-large-question-heading-dropped`, `exam-refusal-moved-onto-daily-papers`). One suite stays excluded: `apps/server/test/routes.smoke.test.ts` aborts at boot because an orphan `bun run --hot src/index.ts` process holds port 4317, which is an environment problem, not a green test.

EVIDENCE LIMIT on AC#4: the heading is pinned at the pure seam and by the notice and type tests, not by a render. The desktop has no DOM environment, so the pane's JSX use of `largeQuestionHeading` is not itself asserted (the same limit recorded for `reviewRowActions` in TASK-159). The mutation seam `desktop-large-question-heading-dropped` is what stands in for the render assertion.

FOLLOW-UPS (not created, pending approval): re-add a refusal seam when the gloss family enters a real-mode 大問; give the remaining 19 block shapes their question kinds (TASK-173.5 to 173.8); decide whether the chat `paper` frame should carry block grouping if the stream card ever needs to print 大問 headings; free port 4317 so `routes.smoke.test.ts` runs in the sweep.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-29 15:02
---
Correction to the notes above, on re-reading source: the mode default lives at `apps/server/src/ask-tool.ts:533` (`mode ?? "shortened"`), not `apps/server/src/tools/ask-tool.ts`. The claim itself holds; the path in my note was wrong.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-173.4 done: the `real` paper is shaped 大問 by 大問 and says which parts it cannot ask.

item-engine owns the shape. `PAPER_BLOCKS` (`packages/item-engine/src/paper.ts:351`) is the per-level 大問 table (order, official Japanese name, 科目, indicative 小問数, filling item types); `allocatePaperMix` (`:1342`) became the single source of truth, walking the blocks in order for `real` and leaving the flat largest-remainder spread to `shortened` and `exam-conditions`; `allocatePaperBlocks` (`:1293`) reports requested and filled counts and `paperUnfillableBlocks` (`:1381`) names the blocks nothing can fill. The real section budget is the official shape, defaulted from `paperSectionIndicativeCount` (`:494`) and clamped at parse time (`:870`), so `shortfall` is now a real gap.

Server and client carry the facts. The receipt gained `unfilledBlocks` (`packages/api-contract/src/exam.ts:221` and `:260`, built at `apps/server/src/services/exam-service.ts:1869`) as a third shortage diagnosis beside TASK-148 `contentExhausted` and TASK-173.1 `refusedSections`; `startExam` (`apps/server/src/context.ts:227`) checks it first and its refusal names each missing 大問. The 大問 grouping is re-derived on read by `paperBlocksForLandedItems` (`paper.ts:1943`), which returns null when the stored rows do not match the plan, so `ExamSectionState.blocks` needs no migration and no client prints a heading the server cannot back. The desktop prints one heading per 大問 from `largeQuestionHeading` (`apps/desktop/src/features/exam/exam-paper-pane.tsx:108`) and the new deck key `paper.build.unfilled` (`packages/ui/src/lib/copy.ts:318`) is chosen by `paper-notice.ts:59`, where a structural hole outranks exhaustion.

Verified: item-engine 52/0, apps/server 256/0 (36 files), ui 172/0, chat-session 272/0, db 39/0, desktop 547/0 with 3 pre-existing skips; `check-types` clean over 14 tasks; `ultracite check` clean over 552 files; `check:dox` clean after the four AGENTS.md updates. Mutation gate: 72 anchors resolve and the six seams added here each ran individually and were caught. Two 173.1 seams were deleted rather than left in because the block-driven real mix makes that guard unreachable (`exam-service.ts:762` gives a `sourcingCase` to the gloss family only), which is recorded in the notes with the condition to re-add it. `routes.smoke.test.ts` stayed excluded: an orphan dev server holds port 4317.
<!-- SECTION:FINAL_SUMMARY:END -->
