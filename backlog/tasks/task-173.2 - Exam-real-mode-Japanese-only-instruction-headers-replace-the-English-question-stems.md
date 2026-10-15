---
id: TASK-173.2
title: >-
  Exam (real mode): Japanese-only instruction headers replace the English
  question stems
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:45'
updated_date: '2026-09-29 16:17'
labels: []
dependencies:
  - TASK-173.4
documentation:
  - doc-26
parent_task_id: TASK-173
priority: high
type: feature
ordinal: 940000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every exam item stem is hardcoded English in `candidatePromptFor` (`apps/server/src/services/exam-service.ts:491-510`): "Choose the meaning of", "Choose the correct reading of", "Choose the pattern that completes", "Choose the phrase heard in the recording". A real JLPT paper is Japanese-only even at N5. The real mode must render the official 大問 instruction wording instead of an English stem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The real-mode item model carries a Japanese instruction header, structured by 大問 rather than one string per item
- [x] #2 No English stem reaches the desktop exam view (`apps/desktop/src/features/exam/exam-question.tsx`) in real mode
- [x] #3 Japanese instruction strings are added through the copy deck and pass the R-02 em-dash guard (`packages/ui/test/copy-snapshot.test.ts`)
- [x] #4 A test pins that a real-mode paper renders zero Latin-script stems, and a mutation seam guards the stem source
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Decisions taken with @arif 2026-09-29: the official 大問 instruction sentences live in the item-engine block table (NOT the ui copy deck, which stays our own chrome copy), and a real item carries its Japanese 小問 line in a NEW nullable field rather than overwriting `prompt`, so the English stem survives for the debrief, the review row and the replayed drill.

Research done: the 2018 公式サンプル 問題用紙 (`https://www.jlpt.jp/samples/sample2018/pdf/N5V.pdf` etc., pinned in doc-26 §1) carry each 大問's instruction verbatim in Japanese with an English note; read with `curl` + `pdftotext -layout -enc UTF-8` (WebFetch is rate-limited until ≈2026-10-21). The item's cue is already Japanese (`exam-service.ts:816` `entry.word`/`entry.reading`, `:851` `stimulus.japanese`), so only the English wrapper is the problem.

1. item-engine: give each `PAPER_BLOCK_SHAPES` entry (`packages/item-engine/src/paper.ts:278`) an `instruction` carrying the official 大問 sentence VERBATIM from the sample paper, empty string where no official sentence has been read (never an invented one), and surface it on `PaperBlock` (`:310`) so `allocatePaperBlocks`/`paperBlocksForLandedItems` carry it through.
2. Contract: `ExamPaperBlockSchema` (`packages/api-contract/src/exam.ts:351`) gains `instruction`; `ExamComposedItemSchema` (`:324`) gains the nullable `stem`, the official 小問 line, key-free like everything else on that path.
3. Server: build the Japanese 小問 line at assembly for `real` only (the cue framed the way the paper frames it, e.g. `（ 下 ）` for 漢字読み, the example sentence with its （ ） for grammar), leave `candidatePromptFor` (`:500`) untouched for the daily modes, and print `blocks[].instruction` from the read path.
4. Desktop: render one 大問 header (name + instruction) above its 小問 and take the real-mode stem from the new field, so no English stem reaches `exam-question.tsx`.
5. Tests: pin each instruction against the named sample paper (order, name, instruction, never an invented sentence), pin that a real-mode paper's rendered stem set contains no Latin script, and add a mutation seam for the stem source plus one that the instruction is not dropped.
6. doc-26: record which sample PDF each instruction was quoted from, with the exact heading line, so the table is checkable offline.
7. Verification: item-engine, server, ui, chat-session, desktop suites, `check-types`, `ultracite check`, `mutation-gate --check` plus the new seams, `check:dox` and the DOX pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-29: `bun run check-types` 14/14 tasks; `bun x ultracite check` 654 files, no fixes; `bun run check:dox` index complete. Suites: item-engine 64 pass, db 39 pass, ui 172 pass, chat-session 272 pass, acp 149 pass, desktop 528 pass (incl. the 7 new AC#2 cases in `apps/desktop/test/exam-real-mode-stems.test.ts`), `apps/server bun test` with 0 failing test and the 5 new AC#1/#4 cases green. `bun scripts/mutation-gate.ts --check` resolves all 77 anchors, and the 5 new seams were RUN and CAUGHT: exam-real-question-falls-back-to-english-prompt, exam-real-stem-never-sourced-from-cue, exam-stem-dropped-on-write, exam-stem-dropped-on-read, paper-block-instruction-never-resolves. AC#3 mechanism: the strings are in the item-engine block table, not the ui copy deck (the decision recorded in the Implementation Plan), so the R-02 em-dash property is guarded by the check that can see them, `keeps every instruction the paper's own sentence: no Latin, no em dash` in `packages/item-engine/test/paper.test.ts:1577`; the deck guard itself is untouched and still green. doc-26 §7 now records the page each of the ten strings was quoted from, including that N2G/N1G are excerpt PDFs starting at 問題7/問題5 and that pdftotext drops the ＿＿＿/（ ） glyphs, so each page was read from a pdftoppm render. The server suite's `test/routes.smoke.test.ts` still cannot boot: an orphan sidecar (pid 86905) holds port 4317, unrelated to this task.

Anchor drift: the em-dash guard is at packages/item-engine/test/paper.test.ts:1581 (it moved when LATIN_SCRIPT_RE was hoisted to module scope for lint/performance/useTopLevelRegex).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-29 15:38
---
Research closeout, and the four decisions this task now builds on.

DECISION 1 - the per-item Japanese line is a stored column, not a read-path derivation. The cue it is made from exists only inside the English prompt at creation time (`exam-service.ts:438` `prompt: candidatePromptFor(itemType, source.cue)`; the cue itself comes from `vocabSourceFor` `:816` `family === "verb" ? entry.reading : entry.word` and `grammarSourceFor` `:851` `cue: isListening ? "" : stimulus.japanese`). `items` (`packages/db/src/schema/user.ts:121-142`) has no column that survives with it, and `exam_items` is a pure slot link (`:173-191`). Re-deriving it at render time would make a printed paper depend on the corpus row still resolving, so a missing stem would be invisible corruption. It goes in as `items.stem` via `0016_item_stem.sql`, registered in `MIGRATION_FILES` and `IDEMPOTENT_MIGRATION_FILES` in the same commit, following the `0015_item_mask.sql` precedent.

DECISION 2 - `stem` carries the 小問 material only where no other field already carries it. The paper's own division of labour is: the instruction sentence is printed once per 大問, and each 小問 is material (a sentence with the word underlined, or a sentence with （ ）). So a grammar item's stem is null: its material is the masked sentence, which already travels as `passage` (`exam-mask.ts:113` replaces the realization with the full-width blank `MASK_BLANK`, `:34`) and already renders (`exam-paper-pane.tsx:401`, `:609`). Only the word-material types need it: `kanji-reading` and `conjugation`.

DECISION 3 - the instruction sentences are per (level, block), quoted verbatim from the 2018 sample papers, and live in the item-engine block table (user's answer to the placement question), not the copy deck. Read off the samples: N5/N4 漢字読み `＿＿＿ の ことばは ひらがなで どう かきますか。 1・2・3・4から いちばん いい ものを ひとつ えらんで ください。` (N5V/N4V), N3 `＿＿＿ のことばの読み方として最もよいものを、1・2・3・4から一つ えらびなさい。` (N3V), N2/N1 `＿＿＿ の言葉の読み方として最もよいものを、1・2・3・4から一つ 選びなさい。` (N2V/N1V); 文の文法1 N5/N4 `（ ）に 何を 入れますか。1・2・3・4から いちばん いい ものを 一つ えらんで ください。` (N5G/N4G), N3 `つぎの文の（ ）に入れるのに最もよいものを、1・2・3・4から一つ えらびなさい。` (N3G), N2/N1 `次の文の（ ）に入れるのに最もよいものを、1・2・3・4から一つ 選びなさい。` (N2G 問題7 / N1G 問題5). The kana/kanji switch follows the level band, so it is a row fact, not a shape fact.

FINDING - `conjugation` does not match the 大問 it is filed under. `PAPER_BLOCK_SHAPES` puts it in 文の文法1 (`paper.ts:278-281`), whose printed instruction asks what fills （ ）, but a conjugation item is a 表記 question: `exam-service.ts:609` says in terms "a conjugation item is a RECOGNITION item (given the reading, choose the [written form])" and `:618` maps it to the `verb` family. Giving it a Japanese stem makes the mismatch visible rather than fixing it, and moving it to 表記 is a change to TASK-173.4's shape table, so it is out of scope here and reported to the user instead.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A `real` paper now asks in Japanese. item-engine owns the wording: `PAPER_BLOCK_INSTRUCTIONS` plus `paperBlockInstruction({ block, level })` (`packages/item-engine/src/paper.ts:329`) holds the ten sentences the 2018 sample papers print, one per fillable 大問 × level, transcribed from a render of the named page (N2G/N1G are excerpts starting at 問題7/問題5) and never paraphrased; a (level, 大問) with no PDF read returns null rather than an invented line. The contract carries both halves of a real paper's page: `ExamPaperBlock.instruction` (printed once per 大問) and `ExamItem.stem` (the 小問's own material line). The server sources the stem at assembly and only in `real` mode, as 「cue」 for `kanji-reading` and `conjugation`, and stores it: new nullable `items.stem` via `packages/db/src/migrations/0016_item_stem.sql` (`MIGRATION_FILES`, `IDEMPOTENT_MIGRATION_FILES`, `user_version` 16 → 17), because the cue survives only inside the generated English prompt, so a read-time derivation would make a printed paper depend on a corpus row still resolving years later. The desktop applies stem-or-nothing: `questionFromComposedItem(entry, mode)`, `activeQuestionFor(section, mode, index)` and `reviewQuestionLine(item, mode)` pick `stem` for `real` and `prompt` for every daily mode, with no `??` anywhere, so a real 小問 with no line prints nothing instead of falling back to English; `largeQuestionInstruction` prints the 大問 sentence above its 小問. `candidatePromptFor` is untouched, `prompt` still travels, and the debrief, review row and replayed drill keep the English stem. Verification: 10 rows in `packages/item-engine/test/paper.test.ts` pin each sentence to its PDF page (with the no-Latin / no-em-dash / names-１・２・３・４から guard at :1581); `apps/server/test/exam-real-mode-stems.test.ts` drives the real router client through request → assemble → get, so the stem crosses the store and comes back, and pins AC#4's zero-Latin property over two seeds; `apps/desktop/test/exam-real-mode-stems.test.ts` (7 cases over the pure seams plus rendered markup) pins AC#2 including the no-legend case; five mutation seams were run and CAUGHT (`exam-real-question-falls-back-to-english-prompt`, `exam-real-stem-never-sourced-from-cue`, `exam-stem-dropped-on-write`, `exam-stem-dropped-on-read`, `paper-block-instruction-never-resolves`). check-types 14/14, ultracite 654 files clean, check:dox complete; item-engine 64, db 39, ui 172, chat-session 272, acp 149, desktop 557 (0 fail), server 0 failing test. Two deviations are recorded rather than hidden: AC#3's strings live in the block table, not the copy deck (the approved placement decision), so the R-02 check that guards them is the item-engine one; and 文の文法1 fills with `conjugation` as well as `grammar-form`/`particle`, so one 大問 prints word material and blanked sentences side by side, which the test now pins per item type. doc-26 §7 records the page provenance for all ten strings.
<!-- SECTION:FINAL_SUMMARY:END -->
