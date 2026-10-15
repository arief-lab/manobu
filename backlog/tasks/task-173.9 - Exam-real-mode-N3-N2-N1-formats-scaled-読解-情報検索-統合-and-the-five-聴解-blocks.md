---
id: TASK-173.9
title: 'Exam (real mode): N3/N2/N1 formats, scaled 読解 (情報検索/統合) and the five 聴解 blocks'
status: Done
assignee:
  - '@Buffy'
created_date: '2026-09-29 10:46'
updated_date: '2026-10-13 15:23'
labels: []
dependencies:
  - TASK-173.6
  - TASK-173.7
  - TASK-173.8
documentation:
  - doc-26
parent_task_id: TASK-173
priority: low
type: feature
ordinal: 947000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The hardest, highest-content work, and the last to be reachable because it needs the earlier formats and content stores in place. N3 adds 統語知識 and 文法予測; N2/N1 add the 中文読解, 統合理解 and 情報検索 (compare two documents) reading formats, and the full five listening blocks 課題理解 / ポイント理解 / 概要理解 / 即時応答 / 統合理解. Real N1/N2 reading reads like government 白書 prose, so sourcing authentic passages is the bulk of the effort. NOTE (audit): this is an umbrella, deliberately left un-split until Phase 1/2 prove the item-shapes; it is not one deliverable PR and must be split per level before any work starts. It is gated behind TASK-173.6/.7/.8 actually working.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 N3 real mode reaches full parity: 統語知識 and 文法予測 blocks fill from sourced content or the paper refuses
- [x] #2 N2 and N1 add 中文読解, 統合理解 and 情報検索 with real multi-document passages
- [x] #3 N2 and N1 listening fill all five 聴解 blocks with audio-backed items
- [x] #4 Any higher-level block without sourced content is refused with a named-block receipt, never fabricated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split by level (user-approved): umbrella ACs delegated to children TASK-173.9.1 (N3, AC#1, no audio dep, first slice), TASK-173.9.2 (N2 reading, AC#2), TASK-173.9.3 (N1 reading, AC#2, dep 173.9.2), TASK-173.9.4 (five 聴解 blocks, AC#3, BLOCKED behind TASK-173.8 audio path). AC#4 (named-block refusal) inherits into each child. 173.9 stays a tracking umbrella, not Done, while children remain.

Post-split research: the whole umbrella is CONTENT-GATED, not code-blocked. The repo vendors no source PDFs and its real-content model is a licensed per-level store JSON (only packages/japanese/data/reading/n5.json exists today). So 173.9.1 (N3 長文/情報検索/文章の文法), 173.9.2 (N2 中文/情報検索/主張) and 173.9.3 (N1 at 白書 length) each need an authentic licensed reading content store before any block can fill rather than refuse; per doc-26 §0 and the never-fabricate rule that content cannot be authored in-code. 173.9.4 (five 聴解 blocks) is separately blocked by the audio path (TASK-173.8->154->151). No agent-doable increment exists until content acquisition (N3/N2/N1 reading stores) or the audio path (listening) is unblocked by the user. 語形成 was confirmed N2/N1-only (doc-26 §3.3), not N3.

Umbrella closeout, per-AC evidence against shipped children and the committed suite (apps/server 711 pass/0 fail/1 skip, 2026-10-13, same tree as the final real-paper probe):

AC#1 (N3 full parity): the block names in this AC (統語知識/文法予測) were the old taxonomy's INVENTED names; doc-26 §correction (line 260) renamed them to the official headings 文の文法1/文の文法2/文章の文法. All N3 grammar 大問 now fill from shipped stores: 文の文法1 (TASK-173.12), 文の組み立て (TASK-173.6 + star-ordering banded into 言語知識 by TASK-173.9.29), 文脈規定 11/11 (TASK-173.9.29), 文章の文法 (TASK-173.9.24), plus 漢字読み/語彙 forms (.25-.28). The live N3 real paper lands 102/102 ready=true, refusedSections [] and unfilledBlocks []. 173.9.1 itself closed as superseded with its ACs redistributed to .16/.18/.23, all Done.

AC#2 (N2/N1 中文読解/統合理解/情報検索 with real multi-document passages): 中文 stores from 白書 + composed depth (.8/.10/.15), 情報検索 from PDL1.0 情報素材 two-document shape (173.9.13), 主張理解/統合理解 shipped and banded (.11-.13, .20/.21). Live: N2 107/107 ready=true with reading floor met (21 items), N1 108/108 with 26.

AC#3 (five 聴解 blocks at N2/N1): TASK-173.9.4 closed Done (5/5 ACs) with slices .4.1 N3 6/6/3/4/9, .4.2 N2 5/6/5/12/4, .4.3 N1 6/7/6/14/4, both new shapes (概要理解 monologue, 聴解統合理解 shared-dialogue pair) measured off the pinned official PDFs before rows were written; exam-listening.test.ts pins every level's real paper filling every 聴解 大問 to official 小問数 with drained-store holes and unjudged-row refusals. Audio-backed: the listening item carries the spoken script to the answer path (TASK-173.8) and plays through the shipped Supertonic 3 ja voice gated on TTS readiness (TASK-173.8.2, verified on a fresh AppImage install 2026-10-13).

AC#4 (named-block refusal, never fabricated): the TASK-173.1 no-fallback rule is pinned per family across the committed suite - drained/missing stores name the 大問 (kitei, iikae, goseikei, hyouki, usage, discourse-cloze, reading families), unvalidated rows never reach a learner, and the 2026-10-13 probe shows shortfall 0 with contentExhausted false at all three levels, i.e. nothing currently HAS to refuse.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The umbrella closes on its children: all 29 subtasks Done. AC#1's 統語知識/文法予測 were invented names (doc-26 line 260); the official N3 grammar 大問 all fill (173.12, 173.6, .24, .29), live N3 paper 102/102 ready=true. AC#2: 中文/統合/情報検索 shipped at real multi-document shape (.8/.10/.13/.15), N2 107/107 and N1 108/108 ready=true with reading floors met. AC#3: five 聴解 大問 per level fill to official 小問数 from blind-certified stores (.4.1-.3), audio lands through the Supertonic ja voice behind the TTS-readiness gate (173.8/173.8.2). AC#4: the no-fallback rule is pinned per family in the committed suite; drained stores name the 大問. Verification: apps/server 711 pass/0 fail/1 skip on the closed tree (includes exam-listening.test.ts 19 tests and exam-kitei.test.ts 22), all package suites green, mutation-gate --check 216/216.
<!-- SECTION:FINAL_SUMMARY:END -->
