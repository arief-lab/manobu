---
id: TASK-173.9.28
title: >-
  Exam (real mode): fill 言い換え類義 sentence-paraphrase form at N4/N5 with authored
  sentence pairs, blind-certified
status: Done
assignee:
  - '@arif'
created_date: '2026-10-11 05:50'
updated_date: '2026-10-11 12:48'
labels: []
dependencies:
  - TASK-173.9.27
parent_task_id: TASK-173.9
priority: medium
type: feature
ordinal: 983000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The 2018 samples falsified the single-form premise recorded in TASK-173.9.27's notes (2026-10-11): 言い換え類義 at N4 and N5 is NOT word-level. N4V.pdf p.7 and N5V.pdf p.7 (もんだい4, 小問26-30, 5 each) print the WHOLE SENTENCE underlined and ALL FOUR OPTIONS ARE COMPLETE SENTENCES ("もんだい4 ＿＿の ぶんと だいたい おなじ いみの ぶんが あります。1・2・3・4から いちばん いい ものをひとつ えらんで ください。"), e.g. N5 にねんまえに きょうとへ 行きました → おととし きょうとへ 行きました; N4 アルバイトを しています → はたらいて います. No corpus in this repo holds Japanese paraphrase sentence pairs, so the JMdict-gloss candidate route that serves the N1-N3 word form is USELESS here: this is the authored pattern-driven family (doc-27 §11, the 用法/文章の文法/表記/語形成 precedent), where the two blind passes do the actual one-answer certification on the synonymy question "does this option sentence mean about the same as the underlined one". Depth standard: 5 小問 x 4 papers = 20 rows per level; a level under the floor keeps its named hole (TASK-173.4), inventing is not allowed. Depends on TASK-173.9.27 because that task registers the 言い換え類義 item-type split in PAPER_BLOCK_SHAPES['iikae-ruiji'] (paper.ts:359) and the per-level form routing this store plugs into.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 The sentence-paraphrase item type is registered once in both lists (packages/api-contract/src/exam.ts EXAM_ITEM_TYPES, packages/item-engine/src/types.ts ITEM_TYPES) and the per-level form routing from TASK-173.9.27 sends N4/N5 大問4 to it (N4 paper.ts:662, N5 :685, both count 5); its flat-mix weight is 0 at every level and section, so only real asks it.
- [x] #2 #2 The もんだい4 instruction is quoted verbatim from each level's own sample PDF (N4V.pdf p.7, N5V.pdf p.7; the two-line heading transcribed in TASK-173.9.27's 2026-10-11 notes) into PAPER_BLOCK_INSTRUCTIONS (TASK-173.2 precedent) or prints nothing.
- [x] #3 #3 Each level ships >= 20 AUTHORED rows: one underlined source sentence plus four complete-sentence options, exactly one preserving the source's meaning (だいたい おなじ いみ), distractors shifting meaning in N4/N5-visible ways (time word, action, polarity, place); provenance composed/authored, two independent blind passes with keys withheld and per-pass independent option shuffle, verdicts frozen to {n4,n5}-iikae-rejected.json with burned ids permanent (the 語形成 cert-record precedent).
- [x] #4 #4 An offline deterministic gate (packages/japanese/scripts/check-iikae-sentence.ts + test, mirroring check-goseikei.ts) re-proves per shipped row: four distinct full-sentence options, source sentence present, bands, official stem line, no Latin/halfwidth, cert trio + ledger honoured; bun run check:iikae-sentence exits 0 over shipped rows and 1 over a mutated fixture.
- [x] #5 #5 The server serves each enabled level via loader + picker on the goseikei/hyouki precedent (exam-corpus.ts store fn, exam-service.ts picker, one trusted anchor namespace, spend-by-item catalog usedSet, seenAnchors honoured TASK-148, READING_STORE_FOR extended so a drained store names the hole); a served row can never trip the TASK-173.1 real-mode refusal.
- [x] #6 #6 apps/server tests pin a real N4 paper and a real N5 paper filling 大問4 to 5 小問 with no source sentence re-used, and the drained-store path naming the block with contentExhausted/refusedSections/unfilledBlocks in their three separate fields.
- [x] #7 #7 Mutation-gate seams per the goseikei precedent (unvalidated row served, store never consulted, anchor namespace not trusted, gate misses a screen - each CAUGHT).
- [x] #8 #8 Docs: LICENSE section owning the authored sentence pairs, the three AGENTS.md bullets updated, check:dox green; full verification (check-types, the suites, both gates, mutation-gate --check, ultracite clean) and single commit on approval, no push.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Register `sentence-paraphrase` once in both lists (packages/api-contract/src/exam.ts, packages/item-engine/src/types.ts) and add it to PAPER_BLOCK_SHAPES["iikae-ruiji"] beside `synonym-paraphrase`; the two exhaustive per-ItemType records (emptyItemTypeWeights paper.ts:1270, emptyItemTypeCounts :1400) force the compile-time update. 2. Route the forms per level through the level-and-section-aware real weights (PAPER_ITEM_TYPE_WEIGHTS_V2 paper.ts:1316): the N4 and N5 `vocabulary` weights gain `sentence-paraphrase` only, so allocateWithinBlock (:1503) sends all 5 小問 to it while `synonym-paraphrase` keeps weight 0 there, and N1/N2/N3 keep both at 0 so their single-fill word form is untouched. Guard by test that no level mixes the two forms. 3. Quoted instruction: N4V.pdf p.7 / N5V.pdf p.7 もんだい4 「＿＿の ぶんと だいたい おなじ いみの ぶんが あります。1・2・3・4から いちばん いい ものをひとつ えらんで ください。」 into PAPER_BLOCK_INSTRUCTIONS["iikae-ruiji"] for N4/N5 (the N1-N3 rows from TASK-173.9.27 stay). 4. Author >= 20 rows per level in packages/japanese/data/reading/{n4,n5}-iikae-sentence.json: the underlined source sentence as 「　」-marked content + four complete-sentence options keyed at options[0]/answerIndex 0, exactly one preserving the meaning, three shifting it in N4/N5-visible ways (time word, action, polarity, place); construction authored + provenance composed; the level-appropriateness route decided by research (the reading-store coverage-floor precedent or the check-hyouki/goseikei sentence treatment). 5. Two independent blind passes per row (packages/japanese/prompts/iikae-sentence-validator.md, keys withheld, per-pass independent option shuffle); rejections frozen to {n4,n5}-iikae-sentence-rejected.json with burned ids permanent. 6. Offline gate packages/japanese/scripts/check-iikae-sentence.ts + test/check-iikae-sentence.test.ts (mirroring check-iikae.ts): cert trio + ledger honoured, source sentence present, four distinct complete-sentence options, no option verbatim-equal to the source, official stem, orthography, level-wide and store-wide reuse screens, MIN_ROWS 20 per level. 7. Serving line on the TASK-173.9.27 precedent: loader in exam-corpus.ts, picker + dispatch in exam-service.ts, one trusted anchor namespace, spend-by-item usedSet + seenAnchors (TASK-148), STORE_PASSAGE_TYPES, READING_STORE_FOR entry so a drained level names the hole; both vocab tables keep declining the iikae family so sourcingCase stays undefined and the TASK-173.1 refusal stays unreachable. 8. apps/server/test/exam-iikae-sentence.test.ts: real N4 and N5 papers fill 大問4 to 5 小問 with no source sentence re-used, drained-store path keeps contentExhausted/refusedSections/unfilledBlocks separate, and the TASK-173.9.27 tests' N4/N5 hole pins move to filled. 9. Mutation-gate seams (unvalidated row served, store never consulted, anchor namespace not trusted, gate misses a screen) each CAUGHT, plus bun scripts/mutation-gate.ts --check. 10. Docs: LICENSE section owning the authored sentence pairs, the three AGENTS.md bullets (packages/japanese, packages/item-engine, apps/server), check:dox green. 11. Full verification (check-types, the three suites, check:iikae + check:iikae-sentence, mutation-gate --check, ultracite clean, fallow boundaries) and single commit on approval, no push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation (2026-10-11): check-types 14/14; full suites 561 pass / 0 fail (server 562 incl. 1 skip, japanese, item-engine all green); check:iikae (N1 30 / N2 26 / N3 26) and check:iikae-sentence (N4 20 / N5 20) both exit 0; mutation-gate --check all 191 anchors resolve and the five iikae-sentence seams all CAUGHT; ultracite clean; check:dox green; fallow boundary violations 0. Two stale tests from TASK-173.9.27 inverted: exam-real-mode-refusal.test.ts (N5 vocabulary unfilledBlocks now [], structuralHole 0) and exam-iikae.test.ts (N4/N5 大問4 fills whole from the sentence store with zero word-form items). Committed 6330051 on re-design, no push.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the sentence-paraphrase ItemType (second form under iikae-ruiji, weight 0 in flat mixes, routed per blueprint row so N4/N5 大問4 ask the whole-sentence shape), shipped 20/20 authored rows per level in reading/{n4,n5}-iikae-sentence.json through two blind passes (four burns frozen to the -rejected ledgers), the deterministic check:iikae-sentence gate (swap algebra FRAME_MIN/FOCUS_MAX, span-level answer-swap leak screen, official stem, cert trio), the server line (iikaeSentenceStoreFor loader, iikaeSentenceSourceFor picker, iikae-sentence: anchor namespace, usedIikaeSentenceSentences spend, READING_STORE_FOR entry naming the hole), the verbatim N4/N5 instruction line, LICENSE §28 and the three AGENTS.md bullets. Verified: check-types, all suites (561 pass / 0 fail), both iikae gates, five mutation seams CAUGHT, mutation-gate --check (191 anchors), ultracite, check:dox, fallow boundaries. Committed 6330051, no push. 語彙 closes at every level N5-N1; the only remaining real-mode gap is TASK-173.8 聴解 audio.
<!-- SECTION:FINAL_SUMMARY:END -->
