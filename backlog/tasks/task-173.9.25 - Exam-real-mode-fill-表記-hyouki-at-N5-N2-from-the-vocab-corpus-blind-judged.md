---
id: TASK-173.9.25
title: >-
  Exam (real mode): fill 表記 (hyouki) at N5-N2 from the vocab corpus,
  blind-judged
status: Done
assignee:
  - '@arif'
created_date: '2026-10-10 20:56'
updated_date: '2026-10-10 23:33'
labels: []
dependencies: []
parent_task_id: TASK-173.9
priority: medium
type: feature
ordinal: 980000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
表記 is the 語彙 大問 besides 語形成/言い換え類義 still declared empty: PAPER_BLOCK_SHAPES['hyouki'] has itemTypes: [] (packages/item-engine/src/paper.ts:328) and the 大問 prints at N5 大問2 8 小問 (paper.ts:633), N4 大問2 6 (:610), N3 大問2 6 (:585), N2 大問2 5 (:560); N1 does not ask it (doc-26).

OFFICIAL FORMAT, measured from the four 2018 語彙 sample PDFs (https://www.jlpt.jp/samples/sample2018/pdf/N5V.pdf, N4V.pdf, N3V.pdf, N2V.pdf): a sentence prints one word in kana and the four options offer spellings, exactly one correct. The wrong options are NOT same-reading homophones (the first draft of this task assumed that and was falsified by the samples): they are (a) real words whose reading differs from the printed kana (N3V: なみ → 池/湖/港, only 波 reads なみ; たかい → 高い/安い/古い/新い), (b) fabricated component-mangled spellings (N3V: まんぞく → 満続/万続/万足; ゆしゅつ → 諭出/輪出/論出; ねむって → 寝って/宿って/眼って), and (c) at N5 katakana mora-shuffle variants (N5V: ワイシャツ → ウイシャソ/ウイシャツ). This makes 表記 an AUTHORED store (the composed lineage of TASK-173.9.24, not a derived one like 用法), and it stays mechanically checkable: the key must be a word+reading pair attested in the licensed vocab corpus (packages/japanese/data/n5.json..n2.json, CC-BY/CC BY-SA, data/LICENSE.md §1-2); a real-word distractor must carry a corpus reading DIFFERENT from the printed kana; a mangled distractor must appear in NO vocab band's word list at all. The sentence is authored, prints the kana word, and must NOT contain the key's kanji form (the validator's leak rule).

SUPPLY, measured before enabling per the TASK-173.6 slice-4 precedent (packages/japanese/scripts/measure-hyouki-supply.ts, anchor model: kanji-spelled band words attested in the sentence corpus): N5 491 / N4 478 / N3 1531 / N2 1211 against the depth floors 小問数 x 4 papers = 32/24/24/20 -> SHIPS at all four levels; no level declines.

SERVING follows the bunshou precedent end to end: per-level stores packages/japanese/data/reading/{n5,n4,n3,n2}-hyouki.json with the composed+validated+authored+authored:agent-blind-judged cert trio, a hyoukiSourceFor picker, the "hyouki:" anchor namespace trusted in resolveAnchor's attestation (apps/server/src/services/exam-service.ts:3332-3337), and sourcingCase left undefined for the non-gloss family (exam-service.ts:1276-1278, the 漢字読み contract) so a served 表記 can never trip the TASK-173.1 real-mode refusal. The two blind passes (doc-27 §11) screen what the corpus cannot falsify: context fit, i.e. exactly one defensible spelling given the authored sentence. A drained or missing store names the 大問 in unfilledBlocks (TASK-173.4) and never invents.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 A 表記 item type is registered once in both lists (packages/api-contract/src/exam.ts EXAM_ITEM_TYPES, packages/item-engine/src/types.ts ITEM_TYPES) and PAPER_BLOCK_SHAPES['hyouki'].itemTypes (paper.ts:328) declares it; the validator's leak rules pin the printed-kana contract: the authored sentence contains the key's kana reading as written AND does not contain the key's kanji form, and exactly one option spells that kana.
- [x] #2 #2 The server serves 表記 from the authored store at all four measured levels (N5/N4/N3/N2): the key is a vocab-corpus-attested word+reading pair, real-word distractors carry a corpus reading different from the printed kana, mangled distractors are attested in NO vocab band, sourcingCase stays undefined (exam-service.ts:1276-1278) so TASK-173.1 real mode never refuses a served item and the seam exam-host-tool-failure-drops-reason stays honest.
- [x] #3 #3 Supply is MEASURED before enabling (TASK-173.6 slice-4 precedent; DONE: measure-hyouki-supply.ts anchor model reports N5 491 / N4 478 / N3 1531 / N2 1211 sentence-attested kanji anchors vs floors 32/24/24/20 -> all four levels SHIPS, none declines).
- [x] #4 #4 Every slot the corpus cannot falsify (a context in which a wrong spelling is also defensible = the two-answer defect) is screened by the two independent blind passes per doc-27 §11, keys withheld, per-pass independent option shuffle (TASK-173.9.23.2 strengthening); verdicts frozen to {level}-hyouki-rejected.json with burned ids permanent.
- [x] #5 #5 The 大問 instruction sentence is quoted verbatim from each level's own sample PDF (N5V/N4V/N3V/N2V.pdf, 問題 文字語彙 表記 block) into PAPER_BLOCK_INSTRUCTIONS (TASK-173.2 precedent) or the block prints nothing rather than a paraphrase.
- [x] #6 #6 An offline deterministic gate (packages/japanese/scripts/check-hyouki.ts + test, mirroring check-bunshou.ts structure) re-proves per shipped row: cert trio + not-rejected, key attested as a word+reading pair in the vocab bands, sentence carries the kana and leaks no kanji form, distractor classes mechanically falsified, 4 distinct options with answerIndex/key discipline, length bands, official stem, and no anchor or option reused across the four levels; bun run check:hyouki exits 0 over shipped stores and 1 over a mutated fixture.
- [x] #7 #7 Depth proof: apps/server/test/exam-hyouki.test.ts pins a real paper at each shipped level filling its 表記 大問 to the blueprint 小問数 with no item repeated across levels, and a drained store names the block instead of fabricating (TASK-173.1/173.4 receipt semantics: contentExhausted vs refusedSections vs unfilledBlocks stay in their three fields).
- [x] #8 #8 Mutation-gate seams per the bunshou precedent (an unvalidated row served, the store never consulted, the hyouki: anchor namespace not trusted, gate misses its kanji-leak screen - each CAUGHT).
- [x] #9 #9 Docs: a LICENSE section owning the 表記 derivation (vocab + sentence corpus attribution, authored rows), store bullets in the packages/japanese, apps/server and packages/item-engine AGENTS.md, check:dox green.
- [x] #10 #10 Full verification in one report: check-types 14/14, japanese+item-engine+server suites green, check:hyouki and check:bunshou exit 0, mutation-gate --check resolves every anchor, ultracite clean, check:dox green. Single commit on approval, no push.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#10 full sweep exposed two stale daily-mode pins updated to the new truth: exam-real-mode-refusal (N5 holes are 大問4 alone after 表記 closed) and exam-real-mode-stems (N5 real paper now carries TWO 大問 headings, 漢字読み + 表記). The sweep also exposed two pre-existing bugs, fixed in separate commits: bun runs all test files in one process so thinking-collapse's globalThis.localStorage stub leaked into transcript-suggestions (7b86895), and scripts/voice-sweep.ts counted gitignored .cache authoring scratch, tripping the R-02 guard locally only (35cc530).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
表記 (word-spelling) now fills the real 大問 at N5/N4/N3/N2 from authored blind-judged stores (42/29/30/27 rows), served through the same servableReadingRow line as 読解 with trusted hyouki: anchors, and re-proved offline by bun run check:hyouki. Verification: full turbo test 11/11 green, check-types 14/14, all 5 hyouki mutation seams caught, mutation-gate --check 175/175 anchors resolve, check:dox green, ultracite clean. Shipped as 1f429ea (39 files) plus fixes 7b86895 and 35cc530; not pushed.
<!-- SECTION:FINAL_SUMMARY:END -->
