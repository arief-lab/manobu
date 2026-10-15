---
id: TASK-173.9.8
title: >-
  Exam (real mode): widen the pinned 白書 page set so the N3/N2/N1 中文 stores are
  deeper than one paper
status: Done
assignee: []
created_date: '2026-10-07 04:02'
updated_date: '2026-10-07 07:11'
labels: []
dependencies: []
parent_task_id: TASK-173.9
ordinal: 960000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The composed 中文 stores are thin by MEASUREMENT, not by accident: over the 753 paragraphs of 22 pinned 令和6年版 環境白書 pages, only 308 fall in the 200-1200 rune band, and of those only 15 (N3, floor 0.8) / 39 (N2, floor 0.8) / 11 (N1, floor 0.9) clear their level's coverage floor. So n3-chuubun.json is 15 rows against a 6-小問 大問, n2 is 16 against 9, and n1 is 10 against 9. The fix named by TASK-173.9.3 is to WIDEN THE PINNED PAGE SET in fetch:hakusho.ts (or add another ministry 白書 that is PDL1.0-attribution-only and narrative rather than table-heavy), never to lower COVERAGE_FLOOR — lowering it would ship passages with a larger unknown-vocabulary fraction than the level tolerates. New rows must be re-probed by BOTH freeze-time blind judge families (opencode/big-pickle and space-bunny-free) with verdicts frozen as data, which is an external model step CI never runs; a widening that skips judging violates the documented row contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 fetch:hakusho.ts pins additional narrative 白書 pages (same PDL1.0 attribution, same decode scoring and prose filters), and a re-fetch raises the in-band (200-1200 rune) paragraph count above the current 308
- [x] #2 The per-level clearing counts measured with the shared COVERAGE_FLOOR rise above the current N3 15 / N2 39 / N1 11
- [x] #3 Regenerated n3/n2/n1-chuubun.json are re-run through both blind judge families with verdicts frozen in {level}-chuubun-rejected.json, and check:reading-chuubun is green at all three levels
- [x] #4 The N1 store holds more than one 9-小問 paper and the N3 store more than one 6-小問 paper, with margin, so a paper cannot exhaust a store mid-build
- [x] #5 data/LICENSE.md §13 records the widened page set and the new measured paragraph/clearing counts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-07: widened the pinned page set and regenerated the stores.

- `scripts/fetch-hakusho.ts` PAGES: 22 -> 171 pages. Added the rest of 令和6年版 (84 section pages total; 10 too-short pages excluded) and 令和5年版 (87 pages; ids `r05-…`; 8 short pages excluded). Each page now carries `year`; a short page (<=4 prose paragraphs, decode score <200) is excluded rather than shipped, because the 200-char guard exists to catch mojibake and these were genuinely sparse.
- The ORIGINAL 22 r06 pages are pinned FIRST, so the corpus order preserves every existing store row: the previously judge-passed rows are verified to remain a PREFIX of each regenerated store.
- Corpus: `data/reading/hakusho.jsonl` 753 -> 3768 paragraphs (r06 1913 + r05 1855); in-band (200-1200 runes) 308 -> 1330.
- Measured clearing counts at the shared COVERAGE_FLOOR: N3 15 -> 33, N2 39 -> 103, N1 11 -> 29.
- Regenerated stores (deterministic, byte-identical on re-run, gates green): `n3-chuubun.json` 15 -> 27 rows, `n2-chuubun.json` 16 -> 72, `n1-chuubun.json` 10 -> 23. Depth: N3 4.5 papers (6 小問), N2 8 papers, N1 2.5 papers — every store is now more than a couple of papers.
- Docs: `data/LICENSE.md` §13 (corpus provenance + the new measurement + the judge boundary), `packages/japanese/AGENTS.md`, doc-26 §4.

REMAINING on this task (AC#3, still OPEN): the APPENDED rows (N3 +12, N2 +56, N1 +13) are `check:reading-chuubun`-green but NOT yet blind-judged. The judge is a freeze-time external-model step (`opencode run --pure --model opencode/big-pickle` and `opencode/space-bunny-free`, key withheld, verdicts frozen in `{level}-chuubun-rejected.json`) that CI never runs; the judge must be run for those rows before this task is Done. `check:reading-answers` stays green (no constant key position).

2026-10-07: AC#3 judge pass COMPLETE. Both freeze-time blind judge families (opencode/big-pickle and opencode/space-bunny-free) re-probed every appended row; verdicts frozen in {level}-chuubun-rejected.json. Rejections: N1 1 row (n1c-r05-1-3-1-7, called ambiguous by family 1 and keyed differently by family 2), N2 1 row (n2c-1-3-1-10, family 2), N3 3 rows (n3c-2-6-1-4 + n3c-r05-1-3-1-47 by family 1, n3c-1-1-1-54 keyed-differently by family 2). Scope correction: n3-chuubun.json had shipped in 6f090c1 with NO judge record at all, so the N3 pass covered the whole 27-row store, not just the appended rows. Stores regenerated after rejection: N3 25 (one replacement row n3c-r05-2-6-1-5 judged by both families in a third pass; supply exhausted at 25 of the 27 asked), N2 71, N1 22. Verification: check:reading-chuubun green at all three levels (25/71/22 rows), check:reading-answers green, regeneration re-run byte-identical. Docs: LICENSE §13, packages/japanese/AGENTS.md, doc-26 §4 all updated to the final 25/71/22 numbers and the judge outcome.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Widened the pinned 白書 set 22 -> 171 pages (令和6年版 complete + 令和5年版), raising the corpus to 3768 paragraphs / 1330 in-band and the clearing counts to 33/103/29 (N3/N2/N1). Regenerated stores deepened to 27/72/23 rows, then the freeze-time blind-judge pass (both families over every appended row, and over the whole N3 store, which had shipped unjudged) rejected 5 rows; the final stores are 25 N3 / 71 N2 / 22 N1 rows with every row carrying both families' verdicts. Verified: check:reading-chuubun green at all three levels (25/25, 71/71, 22/22 pass), check:reading-answers green, regeneration byte-identical on re-run. Docs: LICENSE §13, packages/japanese/AGENTS.md, doc-26 §4 all updated to the final counts.
<!-- SECTION:FINAL_SUMMARY:END -->
