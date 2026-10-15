---
id: TASK-173.5
title: >-
  Exam (real mode): 文脈規定 cloze item (in-sentence word-choice with Japanese
  options)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 10:45'
updated_date: '2026-09-30 04:42'
labels: []
dependencies:
  - TASK-173.1
  - TASK-173.4
documentation:
  - doc-26
parent_task_id: TASK-173
priority: medium
type: feature
ordinal: 943000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today `word-in-context` asks "Choose the meaning of X" and answers with an English JMdict gloss via `SURFACE_BY_FAMILY.gloss` (`apps/server/src/services/exam-service.ts:628`). The real 語彙 問題3 文脈規定 gives a Japanese sentence with a numbered blank and four words; the learner picks the word that fits. The corpus already ships `CorpusGrammarEntry.examples[].japanese` (`apps/server/src/services/exam-corpus.ts:41`) as real sentences, so the stimulus exists. This is a new item format for real mode, not the existing recognition quiz.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A real-mode cloze item renders the example sentence with the target replaced by a blank marker, Japanese sentence intact
- [x] #2 The four options are candidate words (same-part-of-speech pool), and the correct answer is the word the sentence originally held
- [x] #3 The existing validator rejections (stem-leak, duplicate-option, ambiguous) still apply, so a cloze that leaks or has two fitting words is refused, not shipped
- [x] #4 A mutation seam pins that the blank hides the answer and that a stem-leaking candidate is rejected
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
New item type context-cloze + source family cloze (non-gloss, keeps byte-exact single answer). Vocab entries carry no sentence, so the cloze stimulus is a grammar examples[].japanese sentence with one token blanked where that token is a same-level JLPT vocab word; options = that word + 3 same-POS vocab siblings. Blanked sentence travels as passage (stem null) so the real-mode render path is reused, no FE change. No DB migration (item_type is free text).

Decisions (user): ambiguity = accept + document (oracle is byte-equality, cannot reject a cross-lemma near-synonym like 始まる/始める; exclude the target's own synonymsOf from distractors, no LLM at assembly). Sequencing = measure first, then stop.

Slices: (1) register context-cloze/context-word in types.ts, api-contract EXAM_ITEM_TYPES, paper.ts emptyItemTypeWeights/emptyItemTypeCounts; leave bunmi-kitei DISABLED. (2) exam-mask.ts maskWord (mirror maskRealization, add occurrence-count guard, strategy context-word); item-store.ts MASK_STRATEGIES add context-word (runtime-only) + maskRecord verified-invariant accept context-word (else write throws). (3) family tables += cloze (SURFACE entry.word, POOL_FILTER POS>0), new clozeSourceFor (grammar example + blankable same-POS vocab token + <=3 distractors, dual spend-once vocab+grammar anchors, decline->null), candidatePresentationFor branch on itemType not section (bunmi-kitei is in the vocabulary section at N3-N5), appendItemTypeCandidates async three-way branch, candidatePromptFor case; satisfies unchanged. (3.5) THROWAWAY measurement: per level tokenize grammar examples, count sentences with a blankable same-level vocab word that has >=3 same-POS siblings + near-synonym rate; confirm vaporetto live. REPORT and STOP for user OK before enabling. (4, gated) paper.ts:291 bunmi-kitei itemTypes -> [context-cloze]. (5 optional, citation-gated) PAPER_BLOCK_INSTRUCTIONS row only from a verbatim sample-PDF transcription.

Tests: apps/server/test/exam-cloze.test.ts AC#1-4 incl store/decode round-trip guarding the two runtime-only mask pitfalls; paper.test.ts flat modes yield 0 cloze; mutation-gate Seam A (maskWord after.includes re-verify) + Seam B (occurrence-count guard). Verify: tsc item-engine/api-contract/server/db, suites, ultracite, fallow boundaries, check:dox, drive a real N5/N4 paper.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification (2026-09-30): bun run check-types clean (14/14). item-engine suite 64 pass. apps/server full suite 296 pass / 1 skip / 0 fail. scripts/mutation-gate.ts --check: all 85 anchors resolve; the three cloze seams (cloze-mask-skips-reverification, cloze-blank-ignores-occurrence-count, cloze-demand-excluded-from-grammar-pool) each ran and their mutation was CAUGHT. ultracite check clean on all changed files. fallow dead-code --boundary-violations: 0. check:dox complete (apps/server, item-engine, api-contract canonical docs updated).

Behavioral consequence of enabling bunmi-kitei (Slice 4): a real N5 vocabulary paper now walks the grammar pool for the first time (clozeSourceFor, apps/server/src/services/exam-service.ts:954), and N5 unseen grammar backing fills only about 5 of 文脈規定's 10 小問 even on a fresh level (probe confirmed), so sourced < required marks the family drained and the receipt reports contentExhausted: true. This is a genuine content hole that sits BESIDE the structural holes, which stay named in unfilledBlocks regardless. exam-real-mode-refusal.test.ts AC#5 therefore flipped contentExhausted from false to true. The read path paperBlocksForLandedItems was made shortfall-tolerant so a 大問 short of its plan keeps its heading at the count it reached, rather than nulling the whole section's grouping (which would have regressed the TASK-173.2 大問 headings for every short real paper).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-173.5 shipped the 文脈規定 cloze item for real mode. context-cloze added to the engine ItemType (item-engine/src/types.ts:5) and api-contract EXAM_ITEM_TYPES (api-contract/src/exam.ts:181); bunmi-kitei enabled to ask it (Slice 4, item-engine/src/paper.ts:293). clozeSourceFor (exam-service.ts:954) builds a cloze from a grammar example sentence with one same-POS vocab word blanked via the context-word mask (exam-mask.ts:187), four options, dual spend-once (usedGrammarIds + usedVocabWords), sourcingCase undefined so it never trips the real-mode refusal. paperGrammarDemand (exam-service.ts:1187) now counts the cloze slots so repeated real papers keep the shared grammar pool sized; the type stays weight 0 in the flat mix so shortened never asks it. paperBlocksForLandedItems made shortfall-tolerant so a short 大問 keeps its heading at the count reached. Verified: item-engine 64 pass, apps/server 296 pass / 1 skip / 0 fail, check-types clean, three cloze mutation seams each caught, ultracite clean, fallow 0 boundary violations, check:dox complete. Slice 5 (the 文脈規定 instruction sentence) intentionally NOT shipped: no verbatim sample-PDF source in this repo, so paperBlockInstruction prints none rather than inventing one.
<!-- SECTION:FINAL_SUMMARY:END -->
