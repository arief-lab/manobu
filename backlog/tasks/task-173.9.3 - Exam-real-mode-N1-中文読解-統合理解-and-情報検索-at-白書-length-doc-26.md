---
id: TASK-173.9.3
title: 'Exam (real mode): N1 中文読解, 統合理解 and 情報検索 at 白書 length (doc-26)'
status: Done
assignee:
  - '@arif-darma'
created_date: '2026-10-03 11:27'
updated_date: '2026-10-07 17:00'
labels: []
dependencies:
  - TASK-173.9.2
parent_task_id: TASK-173.9
priority: low
ordinal: 954000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Third level slice of the TASK-173.9 umbrella. Same reading formats as TASK-173.9.2 at N1's kanji-dense 白書 length (doc-26: N1/N2 print the dense wording band). Depends on 173.9.2 defining the multi-document and 主張理解 item shapes first. Reading only, no audio.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 N1 real mode fills 中文読解, 統合理解 and 情報検索 from real 白書-length passages, or refuses with a named receipt
- [x] #2 Any N1 reading block without sourced content is refused, never fabricated (inherits umbrella AC#4)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Slice 3 of the 173.9.2 line: fill 統合理解 (N2 大問12 = 2 小問, N1 大問11 = 3) from sourced multi-document pairs, and settle the N2/N1 情報検索 question against the pinned ねらい.

RESEARCH (done, 2026-10-07)
- Re-read the pinned レベル別 大問のねらい PDFs (n1_revised.pdf, n2.pdf, n3.pdf). 統合理解: 「複数のテキスト（合計600字程度）を読み比べて、比較・統合しながら理解できるかを問う」(N2 adds 比較的平易な内容の). 情報検索 at N2 大問14 / N1 大問13: 「広告、パンフレット、情報誌、ビジネス文書などの情報素材（700字程度）の中から必要な情報を探し出すことができるかを問う」, and at N3 大問7 「書き下ろした情報素材（600字程度）」. So the official wording names ONE 情報素材 at N3/N2/N1 too, which contradicts doc-26 §4's claim that the N2/N1 block shares 統合理解's multi-document need: its obstacle is GENRE supply (広告/パンフレット/ビジネス文書, which neither the licensed JLPTSuccess set nor the 白書 corpus provides), not shape. N3 has no 統合理解 大問 at all.
- Pair supply MEASURED against the shipped corpus (5663 paragraphs, 2035 in-band) with the existing shared screens: clearing paragraphs 149 (N2) / 41 (N1). A pair is usable only when both sides clear COVERAGE_FLOOR, sit on different pages, total 400-800 runes, share a KEY noun printed by both and by exactly those two paragraphs corpus-wide, and offers 3 distractors each printed by exactly ONE side. Usable pairs: 33 (N2) / 49 (N1); DISJOINT pairs (paragraph spent once = 小問 the store can serve): 18 at N2, 10 at N1. So the store can be ~9 papers deep at N2 and ~3 at N1, the same depth class as the 中文 stores.

PLAN
1. packages/japanese: scripts/reading-tougou-corpus.ts (TOUGOU_BLOCK=統合理解, fixed JP stem, band, signer, rejection reader), gen-reading-tougou.ts (deterministic walker writing data/reading/{n2,n1}-tougou.json, rows carry passages:[a,b] + sourceIds both + seeded option draw), check-reading-tougou.ts (the gate re-proves every screen from the frozen file), the supply probe as a committed script, package.json entries, LICENSE section (PDL1.0 credits per document).
2. packages/item-engine: one new real-only ItemType weighted 0 in every flat mix (the short/medium/claim/info-search precedent), STIMULUS_REQUIREMENTS minPassages 2, STIMULUS_ANSWER_TYPES, paperSectionForItemType, PAPER_BLOCK_SHAPES.tougou-rikai.itemTypes.
3. packages/api-contract: add the type to EXAM_ITEM_TYPES (the two-passage wire shape already exists as ExamItem.stimuli).
4. apps/server: CorpusTougouReadingEntry + tougouStoreFor in exam-corpus.ts, a source family that bypasses the focus prior, usedTougouPairs spend, presentation branch that prints the pair VERBATIM and can never fall back to the canned INTEGRATED_READING_PASSAGES, READING_STORE_FOR so the receipt names the hole at an unsourced level, tests + mutation seams.
5. Docs: doc-26 §4 統合理解 row + the 情報検索 ねらい correction + the stale 3768/1330 corpus figures, the four AGENTS.md files.
6. Verify: package suites, check:reading-answers, check-types, check:dox, ultracite, mutation-gate --check plus the new seams run.

OPEN DECISION (presented to the user before implementing): the deterministic shared-topic oracle vs an authored relation-claim oracle, and whether N2/N1 情報検索 stays a named hole.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Same corpus measurement as TASK-173.9.2: the N1 白書-length register has ONE viable open source, 政府標準利用規約 white papers (attribution-only reuse). Aozora PD prose measured 0/81 paragraphs at >=0.8 N1+N2+N3 coverage (best 0.55, register mismatch), jawiki 0/27; Wikimedia news/voyage too small or too thin. Next step is URL discovery + ingest, not a new search.

GO: same measurement as 173.9.2 - 令和6年版 環境白書 HTML (公共データ利用規約 1.0, attribution-only) yields 31/41 paragraphs at >=0.8 coverage vs cumulative N5-N1 vocab (best 0.91) in the 400-1000 band. This IS the 白書-length N1 register TASK-173.9.3 names. Pipeline extension is the next step.

N1 内容理解（中文） STORE HAS LANDED (2026-10-06, built under TASK-173.9.2 slice 1, not under this task): `data/reading/n1-chuubun.json` ships 10 masked-slot rows and `check:reading-chuubun --level N1` is green; the N1 中文 大問 (大問9) now fills through the shared `medium-reading` item type. N1's supply is MEASURED EXHAUSTED at this corpus size: only 11 of 308 in-band 白書 paragraphs clear the 0.9 coverage floor and one was rejected by the judge, so 10 rows is the whole corpus, one row above the 9-小問 minimum. Widening N1 means widening the pinned page set in `fetch:hakusho.ts`, not lowering COVERAGE_FLOOR. STILL OPEN on this task: 統合理解 and 情報検索 at N1 — both need MORE THAN ONE document per 小問, a new item shape `medium-reading` does not model.

2026-10-07 N3/N5 中文 slice + LICENSE §11 provenance fix (unplanned follow-up from re-checking the JLPTSuccess download record):

- N3 内容理解（中文） now ships. COVERAGE_FLOOR gains `N3: 0.8`; gen:reading-chuubun/check:reading-chuubun accept N3; `data/reading/n3-chuubun.json` = 15 rows (all 15 of the 308 in-band paragraphs that clear 0.8), gate green, byte-identical on regeneration. MIN_ITEMS_BY_LEVEL (N1 9 / N2 9 / N3 6) since N3 大問5 asks 6 小問 (doc-26 §3.3). N3's 0.8 is STRICTER than N2's because coverage is measured up to the item's level (every N2 word is out of level at N3), so no difficulty inversion. A real N3 paper now FILLS 大問5 instead of naming it unfilled (apps/server/test/exam-reading-holes.test.ts).
- N5 内容理解（中文） now ships LICENSED: `data/reading/n5-chuubun.json` = 30 rows over 10 distinct passages, vendored VERBATIM from `gauravaccentureproducts/JLPTSuccess` `N5/data/papers/dokkai/paper-{5,6}.json` (`provenance: "licensed"`). N4's 中文 大問 is now the only empty one at any level.
- Provenance correction in `packages/japanese/data/LICENSE.md` §11: the N5 store's licence is **CC BY-SA 4.0 (share-alike)**, NOT CC BY 4.0. Upstream states code MIT / content CC BY-SA 4.0 (N5 `index.html`, `llms.txt`); its own `CONTENT-LICENSE.md` §8 (content governed by the repo MIT `LICENSE`) conflicts, so the share-alike reading is recorded as the more restrictive one. §11 also now records that upstream calls these its contributors' OWN practice items, not JLPT past-paper text, and pins the canonical fetch path `N5/data/papers/dokkai/paper-{1..4}.json`.
- STILL OPEN on this task: 統合理解 and 情報検索 at N1 (and every level) need MORE THAN ONE document per 小問, a new item shape `medium-reading` does not model. JLPTSuccess paper 7 is 情報検索-style material and is NOT vendored for the same reason.

The JLPTSuccess re-check itself: NO N3/N2/N1 読解 papers exist. Upstream is N5-live only; N4 data exists but is machine filler (garbled passages + English choices, already discarded); N3/N2/N1 are empty placeholder dirs (`README`/`llms.txt`: "N4..N1: planned (work paused)").

2026-10-07 統合理解 SLICE LANDED (this task's remaining block) + the 情報検索 decision:

- 統合理解 now fills a real paper at N2 and N1 through a NEW real-only item type `text-comparison` (weight 0 in every flat mix, so `shortened`/`banded` never emit it; the TASK-132 canned `integrated-reading` type is untouched and still fills no 大問). Stores: `packages/japanese/data/reading/n2-tougou.json` 16 rows and `n1-tougou.json` 7 rows, each row TWO 白書 paragraphs on different pages (400-800 runes total), `construction: "shared-topic-pair"`, signed `deterministic:gen-reading-tougou`, fixed stem 「二つの文章の両方に挙げられているものはどれか。」. The deterministic oracle: the key is an in-level noun printed by BOTH documents and by no third clearing document; each distractor is printed by EXACTLY ONE side. `bun run check:reading-tougou --level N2|N1` re-proves all eight screens from the frozen file incl. the corpus-wide pair-specificity pass; both green. A real N2 paper lands 大問12's 2 小問 and a real N1 paper lands 大問11's 3 (`apps/server/test/exam-tougou.test.ts`), and neither is named in `unfilledBlocks` (`apps/server/test/exam-reading-holes.test.ts`).
- Both-family blind judge ran at freeze time; verdicts are DATA in `{n2,n1}-tougou-rejected.json`. Residual to state plainly: the oracle proves the shared-topic reading, not the official 「比較・統合」 relation between the two texts (doc-26 §4, LICENSE §15).
- 情報検索 at N2 大問14 / N1 大問13 stays a NAMED hole, for a reason the pinned PDFs establish: the ねらい names ONE 情報素材 (700字程度 at N2/N1) of the 広告・パンフレット・情報誌・ビジネス文書 genre, which neither the licensed JLPTSuccess set nor the 白書 corpus supplies. The single-document `info-search` shape from TASK-173.9.7 is already right for those 大問; they wait on source material, not on a type. doc-26 §4's earlier claim that N2/N1 情報検索 shares 統合理解's multi-document need is corrected.
- N3 情報検索 FILLS: the 12 licensed notices are stamped down as `data/reading/n3-jouhou.json`. This is below-level material (N5-band tables served at N3), and the caveat is recorded next to the rows in LICENSE §11; a real N3 paper now fills 大問7 with its 2 小問.
- Store depth: N1's 統合理解 store is ~2 papers deep (7 rows / 3 小問) and N2's ~8; the admissible-PAIR supply, not the paragraph supply, is the ceiling (25 N2 / 29 N1 admissible, disjoint rows 16 / 7).
- Two bugs found and fixed during the verification pass: (1) the tree carried an UNRESTORED mutation-gate edit (`packages/db/src/item-store.ts` `focus: JSON.stringify([])`), left by an interrupted run; restored, so TASK-139's focus persistence is intact and all 137 seam anchors resolve. (2) `apps/server/test/exam-info-search.test.ts` still narrowed two helpers to `"N4" | "N5"` after the N3 stamp, so `bun run check-types` failed on the N3 rows; widened to include N3. The complexity that the pair-presentation branch added to `candidatePresentationFor` was extracted into `textComparisonPresentationFor` to stay under biome's cognitive-complexity ceiling, and the `tougou-falls-back-to-canned-passage` seam anchor followed it (verified: the relocated mutation is still caught).
- Docs: doc-26 §4 (統合理解 row, the 情報検索 ねらい correction, the 250-page/5663-paragraph figures, the N5 seven-buildable-blocks count, the per-level hole list) plus §6/§7 refs; `apps/server/AGENTS.md`, `packages/item-engine/AGENTS.md`, `packages/api-contract/AGENTS.md`, `packages/japanese/AGENTS.md` and LICENSE §15. Every file:line citation re-derived from source after the refactor.
- Verification green: `packages/japanese` 117 tests, `packages/item-engine` 73, `apps/server` exam suite, `check:reading-tougou` N2+N1, `check:reading-answers` (13 stores, no constant key position), `check-types` 14/14 tasks, `check:dox`, `bun x ultracite check` repo-wide (0 errors), `fallow dead-code --boundary-violations` (0).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
N1 (and N2) real mode now reads 統合理解 from sourced material, and the 情報検索 question is answered against the pinned ねらい instead of assumed.

統合理解: a new real-only item type `text-comparison` prints TWO 白書 documents as `stimuli` under the fixed stem 「二つの文章の両方に挙げられているものはどれか。」, with the deterministic shared-topic oracle (key printed by both documents and by no third clearing document, each distractor by exactly one side, no distractor the other document paraphrases). Stores `data/reading/n2-tougou.json` (16 rows) and `n1-tougou.json` (7 rows), generated by `gen:reading-tougou`, blind-judged by two independent families at freeze time with verdicts frozen as `{level}-tougou-rejected.json`. Weight 0 in every flat mix, so only `real` asks it; the TASK-132 canned `integrated-reading` type is untouched.

情報検索: the pinned N2/N1 ねらい names ONE 700字程度 情報素材 of the 広告・パンフレット・情報誌・ビジネス文書 genre, so this is a genre-supply hole, not the multi-document shape doc-26 claimed. N2 大問14 / N1 大問13 stay named in `unfilledBlocks` and are not fabricated; the same 12 licensed notices are stamped down to N3 (`n3-jouhou.json`), which fills N3 大問7 as below-level material with the caveat recorded in LICENSE §11. doc-26 §4's contrary claim is corrected there.

Verification: `check:reading-tougou --level N2` (16 rows) and `--level N1` (7 rows) both green, which re-proves every screen including the corpus-wide pair-specificity pass; `packages/japanese` 117 tests, `packages/item-engine` 73, `apps/server` 384 pass / 0 fail (48 files), incl. `exam-tougou.test.ts` (a real N2 paper lands 大問12's 2 小問, a real N1 paper 大問11's 3) and `exam-reading-holes.test.ts` (N2 大問12 / N1 大問11 no longer named; N2 大問14 / N1 大問13 still are); `check:reading-answers` 13 stores with no constant key position; `check-types` 14/14; `check:dox`; `bun x ultracite check` clean repo-wide; `fallow dead-code --boundary-violations` 0; mutation gate `--check` 137 anchors and `tougou-falls-back-to-canned-passage` caught.

Two bugs found and fixed on the way: an unrestored mutation-gate edit still sitting in `packages/db/src/item-store.ts` (TASK-139 focus persistence would have been silently dropped), and `exam-info-search.test.ts` narrowing two helpers to `"N4" | "N5"` after the N3 stamp, which `check-types` caught. Docs updated through the CLI: doc-26 §4/§6/§7 plus the four AGENTS.md files and LICENSE §15, with every file:line citation re-derived from source.
<!-- SECTION:FINAL_SUMMARY:END -->
