---
id: TASK-118
title: >-
  Kana: build the readiness checkpoint instrument (six kinds, per-group
  coverage, two-rule pass)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:05'
updated_date: '2026-09-24 14:34'
labels: []
dependencies:
  - TASK-117
documentation:
  - >-
    backlog/docs/feature/doc-13 -
    Kana-readiness-checkpoint-paper-scoring-and-retake-policy.md
  - backlog/docs/feature/doc-19 - UI-wireframes-the-chat-learning-surface.md
priority: high
type: feature
ordinal: 861000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An N5 paper is a reading test: its vocabulary items ask for kanji readings, its grammar-plus-reading section assumes fluent kana, and none of it is answerable in romaji (`doc-12` §3.1). The repo already ships the kana chart and the decks, so the checkpoint is the app catching up to the exam it already offers. Coverage comes from `packages/japanese/data/kana.json`: 208 cells in six kinds (gojuon 46, katakana 46, dakuten 25, katakana-dakuten 25, yoon 33, katakana-yoon 33), and the design adds word-level sokuon and chōonpu items because no single cell represents them. `doc-13` §4 sizes a script at 2 items per `(kind, row)` group across 11 gojuon + 4 dakuten + 7 yōon rows plus 2 word items, about 46 per script. The pass rule is deliberately two rules, not one percentage: at least 90% **and** no fully-wrong `(kind, row)` group, because `doc-13` §4's worked example shows 42/46 = 91% still failing when one group is entirely wrong. Grouping must not pool by `row` alone, or `dakuten` が carrying `row: "k"` masks a failed gojuon row. `doc-19` §4 draws the wizard, the kind groups and both result states.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every `(kind, row)` group in both scripts appears in a generated paper, and `n-alone` appears once.
- [x] #2 A paper cannot mask a failed `gojuon` `k` group behind `dakuten` `k` answers (the pooled-row regression).
- [x] #3 Two consecutive attempts share no item ids, and the same seed reproduces the same paper exactly.
- [x] #4 Per-script item counts match doc-13 §4 (22/8/14/2) within the `n-alone` allowance, and sokuon and chōonpu items exist in every paper anchored to real `n5.json` vocab.
- [x] #5 Pass rule: four scattered wrong answers passes; 0/2 in one group plus two wrong elsewhere fails; five wrong fails; an unanswered item blocks submit.
- [x] #6 Per-script independence: a perfect hiragana section does not admit katakana.
- [x] #7 The post-submit review renders one row per answered cell with the correct reading and its group, does not render before submit, and a replay action resolves through the item store rather than regenerating the item.
- [x] #8 The ten keys in doc-13 §8.1 exist, are non-empty and contain no em dash, enforced by `packages/ui/test/copy-snapshot.test.ts`.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Build checkpoint instrument per doc-13 §3-§4: six kinds 208 cells, 2 per (kind,row) ~46/script + 2 word-level (sokuon/chōonpu via n5.json), no pooling, seeded sampling, two-rule pass (90% + no fully-wrong group), per-script independence, review rows, 10 copy keys. Test coverage AC#1-#8.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built kana instrument per doc-13 §3-§4: six kinds 208 cells, 2 per (kind,row) ~46/script + 2 word-level (sokuon/chōonpu via n5.json), no pooling, seeded shuffle (mulberry32) same seed same paper, no shared ids across seeds, n-alone once. Two-rule pass (90% + no fully-wrong group, n-alone folds), per-script independence, review via same items, 10 copy keys. Verified: kana-instrument.test.ts 8 AC (397 pass), desktop 397 pass, check 443 clean, check-types 13/13. Instrument at apps/desktop/src/lib/kana-instrument.ts, copy keys in packages/ui/src/lib/copy.ts.
<!-- SECTION:FINAL_SUMMARY:END -->
