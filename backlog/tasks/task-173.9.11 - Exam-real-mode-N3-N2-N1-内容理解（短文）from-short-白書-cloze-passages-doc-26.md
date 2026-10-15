---
id: TASK-173.9.11
title: 'Exam (real mode): N3/N2/N1 内容理解（短文）from short 白書 cloze passages (doc-26)'
status: Done
assignee:
  - '@arif'
created_date: '2026-10-07 17:37'
updated_date: '2026-10-07 18:45'
labels: []
dependencies: []
parent_task_id: TASK-173.9
ordinal: 963000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
短文 is the last 読解 kind that has a question type, a server picker and a store loader at every level yet ships no file above N4: `shortReadingStoreFor` already loops N3/N2/N1 over `packages/japanese/data/reading/{level}.json`, so three real 大問 (N3 大問4, N2 大問10, N1 大問8) are named holes only because the files do not exist. doc-26 §0 forbids fabrication, so the fill must be sourced. The 中文 construction (a masked noun in an in-level 白書 paragraph, screens shared between generator and gate) is measured against ample short-document supply on 2026-10-08: in the 100-240 rune band at each level coverage floor the corpus clears 313 N3, 684 N2 and 449 N1 paragraphs holding 252/473/542 distinct answer nouns, and the sampled paragraphs are connected prose, not headings. So this closes three 大問 with a corpus slice and no engine or server change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A real N3 paper fills 大問4 with its 4 小問, N2 大問10 with its 5 and N1 大問8 with its 4 from sourced rows, or the 大問 is short and the receipt names it; no 短文 row is ever invented at assembly time
- [x] #2 Every shipped row reproduces EXACTLY ONE 白書 paragraph in `data/reading/hakusho.jsonl` byte for byte once its ＿＿ is restored, sits inside the 短文 band, and clears that level COVERAGE_FLOOR; `check:reading-tanbun` re-proves all of it deterministically with no LLM in CI, and the generator and the gate read the same screens module
- [x] #3 Every shipped row carries `provenance: "composed"`, `construction: "masked-slot"`, `validated: true` and the pipeline signer, and a row either blind-judge family calls AMBIGUOUS or UNANSWERABLE is frozen in `{level}-rejected.json` and replaced by a deeper regeneration rather than shipped
- [x] #4 exam-reading-holes.test.ts stops naming 短文 at N3/N2/N1 and still names every hole that remains (中文 at N4 大問5, 長文 at N3 大問6 and N1 大問10, 情報検索 at N2 大問14 and N1 大問13)
- [x] #5 Docs current: LICENSE section owning the three new stores, packages/japanese/AGENTS.md and doc-26 §4/§5 updated, bun run check:dox, bun x ultracite check, check:reading-answers and bun scripts/mutation-gate.ts --check all green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `scripts/reading-tanbun-corpus.ts`: the 短文 family constants (block `naiyou-rikai-tanbun`, signer `deterministic:gen-reading-tanbun`, `construction: "masked-slot"`, the fixed stem, the 100-240 rune band, a `{level}-rejected.json` reader) on top of the screens already in `reading-chuubun-corpus.ts` (`segmentText`, `coverageOf`, `slotsFor`, `buildFrameFillers`, `isFrameSolvable`, `chuubunDistractorPool`, `COVERAGE_FLOOR`), so one difficulty claim governs 中文 and 短文 and the generator and the gate read the same predicates.
2. `scripts/gen-reading-tanbun.ts` mirroring `gen-reading-chuubun.ts`: one row per answer word, one paragraph spend per batch, skip judge-rejected ids, seeded option draw, write `data/reading/{level}.json` and hand it to biome format.
3. Freeze the stores at N3/N2/N1, then blind-judge every row with both families (`opencode run --pure --model opencode/big-pickle` and `opencode/space-bunny-free`, `prompts/reading-validator.md`, key withheld). Rejects go into `{level}-rejected.json`; regenerate deeper so a reject is replaced, and judge the replacement before it ships.
4. `scripts/check-reading-tanbun.ts` (no LLM): byte-restoration to one corpus paragraph, band, floor, single BLANK, answer-once + in-level kanji noun, no distractor in source, pool membership, unique frame, judge record, `validateQuestionItem`, file-level id/passage/answer uniqueness and MIN_ITEMS. Test pair `test/{check,gen}-reading-tanbun.test.ts`; `package.json` scripts + the `test` file list; `check-reading-answers.ts` READING_STORES gains the three files; `measure-reading-supply.ts` gains the 短文 band.
5. Server tests, no server code: `exam-short-reading.test.ts` covers a real N3/N2/N1 paper landing store passages, `exam-reading-holes.test.ts` stops naming 短文 at those levels and still names 中文 at N4, 長文 at N3/N1 and 情報検索 at N2/N1.
6. Docs: LICENSE section owning the three stores and their judge record, `packages/japanese/AGENTS.md`, the 短文 block comment in `packages/item-engine/src/paper.ts`, doc-26 §4 row + §5 hole list, then check:dox, ultracite check, check:reading-answers, mutation-gate --check, fallow boundaries.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Stores shipped: data/reading/{n3,n2,n1}.json, 24 composed masked-slot rows per level (100-233 runes, one ＿＿ per passage, key never printed, one fixed stem per level), plus {n3,n2,n1}-rejected.json carrying both blind-judge families' verdicts. All 72 rows passed both families, so no replacement round was needed and each rejection record ships empty.

Gate + probe: check:reading-tanbun N3/N2/N1 all report 'all 24 rows pass'; check:reading-answers audits 16 stores with no constant key position (n3.json is 58% at index 2, reported not repaired: the draw measured uniform over 1386 seeds at 351/361/338/336, and re-seeding would rewrite judged rows). measure:reading-supply now prints the 短文 band too: 2649 in-band, clearing 132 N3 / 340 N2 / 190 N1, refillable rows 63 / 118 / 80.

The task description's creation-time supply estimate (313/684/449 clearing) is superseded by the committed probe, which is what LICENSE.md §16 cites (132/340/190). The probe is deterministic and re-runnable, so the doc figure is the auditable one.

Proof through the real seams, no server change: apps/server/test/exam-short-reading.test.ts (18 pass, 1453 expects) lands 4 小問 at N3, 5 at N2, 4 at N1, each byte-equal to a store row and inside the 240-rune cap; exam-reading-holes.test.ts (7 pass) now names only N4 大問5 中文, N3 大問6 長文, N2 大問14 情報検索, N1 大問10 長文 + 大問13 情報検索. 66 pass / 0 fail over the six reading suites; item-engine 73 pass; packages/japanese 142 pass.

Docs: LICENSE.md §16 (what the stores are, why 100-240 mirrors the server cap, the product stated plainly as the N4 cloze rather than the N5 comprehension item, the two spent-source exclusions and the N3→N2→N1 freeze order, N1's ministry/statute-name caveat, supply, answer-position doctrine); packages/japanese/AGENTS.md (gen/check scripts, measure bullet, bun test bullet, verification bullets, Child DOX Index); apps/server/AGENTS.md 短文 bullet retitled 'Licensed N5, composed N4-N1' with the drifted file:line refs corrected against source; packages/item-engine/src/paper.ts naiyou-rikai-tanbun block comment; doc-26 §4 row, §5 hole list and §6 via the backlog CLI.

Duplication found while verifying: this slice's two new test files carried a 59-line copy of the 中文 gate's vocab fixture (fallow dupes, changeset-introduced). Extracted to packages/japanese/test/reading-noun-vocab.ts, imported by check-reading-chuubun/check-reading-tanbun/gen-reading-tanbun tests; the clone group is gone and all suites still pass. What remains is the pre-existing gate-CLI and generator-tail family (check-reading-{chuubun,chuushou,tanbun,tougou,n4}.ts share the minItems block and the import.meta.main runner), which this slice joins as a fifth member rather than creates - recorded as follow-up work, not suppressed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Filled the last three 短文 holes with corpus supply only, no engine or server change. Three composed masked-slot stores ship (data/reading/{n3,n2,n1}.json, 24 rows each): one in-level noun of a 100-240 rune 白書 paragraph blanked to ＿＿, that paragraph's own word as key, three same-pool nouns the paragraph does not print as distractors, fixed stem 「この文章の＿＿に入る語として、最も適切なものを一つ選びなさい。」, drawn by the 中文 screens and the 中文 seeded option draw. The band mirrors the server's 240-rune short-reading cap (exam-service.ts:159) so no row is generated the engine cannot print, and two exclusions this family adds keep one paragraph from backing two 小問 of one paper or one passage from being shared across levels, which is why the freeze is ordered N3, N2, N1 and why the gate re-derives the exclusion from the shipped files.
Verification: bun run check:reading-tanbun N3/N2/N1 each report 'all 24 rows pass'; apps/server/test/exam-short-reading.test.ts (18 pass, 1453 expects) proves a real N3 paper lands 4 小問, N2 5 and N1 4, each byte-equal to a store row, with no Latin in any option and no passage repeated within a 大問 or across levels, and that filling 短文 does not make N3 ready (its 長文 大問 is still named); exam-reading-holes.test.ts now names only N4 大問5 中文, N3 大問6 長文, N2 大問14 情報検索, N1 大問10 長文 + 大問13 情報検索; 66 pass / 0 fail across the six reading suites, packages/japanese 142 pass, item-engine 73 pass, check:reading-answers 16 stores with no constant key position, mutation-gate --check resolves all 137 anchors, fallow boundaries clean, bun run check:dox clean, ultracite clean over all 13 touched TS files. Both blind-judge families passed all 72 rows, so the rejection records ship empty.
Docs: LICENSE.md §16 owns the three stores, including the honest product statement (this is the N4 cloze product, a frame-decided word lookup, not the N5 verbatim comprehension item the official 短文 ねらい asks), the supply figures from the committed probe (132/340/190 clearing, 63/118/80 refillable, which supersede the 313/684/449 estimate in the task description) and the N3 58% answer-position skew as measured-and-reported rather than repaired; packages/japanese/AGENTS.md, apps/server/AGENTS.md (短文 bullet now 'Licensed N5, composed N4-N1', drifted file:line refs corrected against source) and the naiyou-rikai-tanbun comment in item-engine/src/paper.ts updated; doc-26 §4 row, §5 hole list and §6 rewritten through the backlog CLI.
Also fixed while verifying: fallow dupes flagged the changeset-introduced 59-line vocab-fixture clone across the new 短文 tests; extracted to packages/japanese/test/reading-noun-vocab.ts and imported by the three suites (group gone, all suites green). The remaining gate-CLI/generator-tail duplication is the pre-existing five-file reading-gate family this slice joins, and is left as follow-up work rather than suppressed.
<!-- SECTION:FINAL_SUMMARY:END -->
