---
id: TASK-173
title: >-
  Exam: a real JLPT mock mode that prepares learners to sit N5..N1, not just
  daily practice
status: Done
assignee:
  - '@Buffy'
created_date: '2026-09-29 10:44'
updated_date: '2026-10-13 15:56'
labels: []
dependencies: []
references:
  - 'https://www.jlpt.jp/guideline/testsections.html'
documentation:
  - doc-26
priority: high
type: feature
ordinal: 938000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The generated paper is a good daily quiz but does not mimic the actual JLPT, so a learner who trains on it is not conditioned for exam day. The engine already carries the faithful skeleton: section timings, 180-point bands and pass marks are correct in `packages/item-engine/src/paper.ts:70-263`, and `EXAM_MODES = ["shortened","exam-conditions"]` already exists at `packages/api-contract/src/exam.ts:11`. What is missing is the authentic body: the paper is Japanese-only with fixed 大問 blocks and in-sentence formats, while ours uses English stems (`apps/server/src/services/exam-service.ts:491-510`) and bare-word/English-gloss items. This epic adds a distinct real-exam mode and keeps the existing behaviour as the daily quiz. The governing principle: the real mode REFUSES rather than fabricates, so it never degrades into the daily-quiz format to meet a slot count the way the practice path does at `exam-service.ts:1101` and `:1136`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new exam mode exists alongside the existing ones, selectable from /ai, and its behaviour differs from the daily quiz on every axis below
- [x] #2 Every string a learner sees in the real mode is Japanese (instruction headers, section names, question stems); no English word is rendered
- [x] #3 The paper is organised into named 大問 blocks in the official order and per-block counts for the requested level
- [x] #4 Items use in-sentence JLPT formats for the levels whose content exists, not bare-word English-gloss choices
- [x] #5 When authentic content for a block is unavailable, the paper does not go ready and the receipt names the missing block, rather than substituting a daily-quiz item
- [x] #6 The result is reported in the JLPT section-band format, labelled as an estimated score, never as the JLPT official scaled 得点
- [x] #7 The existing daily-quiz behaviour is unchanged and remains the default for a casual request
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Epic closeout 2026-10-13, after the last open children closed (TASK-173.9 umbrella Done with per-AC child evidence, TASK-173.14 Done with the shared-CLI verification + doc naming). All 14 children are now terminal. Per-AC evidence, re-verified against the shipped tree:

AC#1: EXAM_MODES = ["real","shortened","exam-conditions"] (packages/api-contract/src/exam.ts:11), mode is a request field (exam.ts:243) and every real-mode branch keys off it (exam-service.ts:3680, :4588; api-contract :120/:134 label + stem switches). Entry surfaces: the exam route offers the daily-vs-real pick (apps/desktop/src/routes/exam/index.tsx:19, real launch option :41-42) and /ai's start_exam path assembles the same request shape (routes/ai.tsx:581 exam.request + exam.assemble, the agent host tool and the learner share one paper).

AC#2: instruction headers and section names are Japanese in real mode (TASK-173.2/.3, both Done 4/4; EXAM_SECTION_LABELS_JA at exam.ts:120 returns the JA map only when mode === "real").

AC#3: PAPER_BLUEPRINTS/PAPER_BLOCKS model the official 大問 order and per-block counts for N5-N1 (packages/item-engine/src/paper.ts; TASK-173.4 Done), and the 2018 sample papers are pinned as the measurement source (doc-26).

AC#4: every 大問 family at N3/N2/N1 serves in-sentence JLPT formats from whole-row stores: 文脈規定（　）cloze, 文の組み立て star-ordering, 文章の文法, 表記, 語形成, 言い換え類義 (word + sentence forms), 用法, and the seven 読解 shapes, plus the five 聴解 blocks with the two measured new shapes (概要理解, 聴解統合理解). Final live probe: N3 102/102, N2 107/107, N1 108/108 items ready=true.

AC#5: the refuse-not-fabricate rule is TASK-173.1 (Done 9/9) and is pinned per family in the committed suite - a drained or missing store names the 大問 in the receipt (exam-kitei, exam-reading-holes, exam-listening and the other family files), and the honesty gate refuses unvalidated rows in real mode.

AC#6: the result pane renders the JLPT 科目/得点区分 bands with each floor and the estimate disclaimer exactly once, never on a raw-only paper (apps/desktop/test/exam-result-copy.test.ts, 10 tests green today; shipped component apps/desktop/src/features/exam/exam-paper-pane.tsx:888 exam-result-estimate). Caveat recorded honestly: TASK-173.10's own browser-pass AC#4 leg (live real-mode result on screen) was unreachable at its close because real papers did not assemble; they do now, and a live browser pass of the result pane remains unrun. The deterministic proof renders the mode:real fixture through the shipped component.

AC#7: the default mode is "shortened" (exam.ts:243), every daily-quiz pin stayed green through the whole real-mode program, and the exam route keeps daily as the entry default (routes/exam/index.tsx).

Verification at close: apps/server 711 pass/0 fail/1 skip, packages/item-engine 81/0, packages/japanese 586/0, apps/desktop exam-result-copy 10/0, fallow boundary violations 0, mutation-gate --check 216/216.

Symbol pin correction for the AC#1 note above: the orpc.exam.request call is at apps/desktop/src/routes/ai.tsx:582 and exam.assemble at :589 (the start_exam host-tool comment is :571), not :581.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The real-JLPT-mock epic is complete: all 14 children terminal, all seven ACs checked against the shipped tree.

The real mode exists as EXAM_MODES' "real" alongside the daily modes with the daily-quiz default untouched (api-contract exam.ts:11/:243); its paper is the official 大問 order with per-level counts, Japanese-only stems and headers, and in-sentence item formats served from whole-row content at every level N5-N1: the 語彙・文法 family (表記/語形成/文脈規定/言い換え類義/用法/文の文法1/文の組み立て/文章の文法), the seven 読解 shapes, and the five 聴解 blocks including the two shapes measured off the official samples (概要理解, 聴解統合理解), with audio landing through the shipped Supertonic ja voice behind the TTS-readiness gate. The refuse-not-fabricate rule holds at every seam: a drained or missing store names the 大問 in the receipt and unvalidated rows never reach a learner. Results render in the JLPT band format labelled an estimate.

Final receipts (2026-10-13): full real papers assemble ready=true at N3 102/102, N2 107/107, N1 108/108 items, shortfall 0, no refused sections; apps/server 711 pass/0 fail, item-engine 81/0, japanese 586/0, desktop result-copy 10/0; mutation-gate 216/216 anchors; boundary violations 0.

Stated caveats: (1) TASK-173.10's live browser pass of a real-mode RESULT pane was never run (unreachable when it closed; now reachable - the deterministic proof renders the mode:real fixture through the shipped component at exam-paper-pane.tsx:888); (2) TASK-138 (corpus-sourced catalog for the daily paper) is a separate In-Progress task and is not part of this epic's ACs; (3) authored-store content carries the stated correlated-judge risk (doc-27 §11, LICENSE §17).
<!-- SECTION:FINAL_SUMMARY:END -->
