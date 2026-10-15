---
id: TASK-120
title: >-
  Kana: extend the drill decks to six kinds so drill-coverage admission is
  reachable
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:06'
updated_date: '2026-09-24 14:52'
labels: []
dependencies: []
references:
  - 'apps/desktop/src/routes/drill.tsx:23'
documentation:
  - >-
    backlog/docs/feature/doc-13 -
    Kana-readiness-checkpoint-paper-scoring-and-retake-policy.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
priority: medium
type: feature
ordinal: 863000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drill decks today cover two of the six kana kinds: `apps/desktop/src/routes/drill.tsx:23` types `kind` as `gojuon | katakana | kanji` and the deck builders filter to `gojuon` and `katakana`, so there is no dakuten, yōon or sokuon deck. That single gap is why the `drill-coverage` admission source is unreachable today (`doc-13` §6.2, `doc-12` §9). Per decision D12 this extension and the `drill-coverage` flag ship in the **same** release, so the source cannot be enabled against partial coverage and the resolver never has to explain a gate that cannot be reached. The extension also feeds the deferred romaji fade (`doc-12` §2.4), which is waiting on exactly this per-kana evidence. Until it ships, the honest statement stays: drill shortens the checkpoint, it does not replace it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `dakuten` and `yoon` kinds exist in the `DrillSearch` type and the deck builders, mirrored for katakana (`katakana-dakuten`, `katakana-yoon`).
- [x] #2 Word-level sokuon and chōonpu items exist and are drawn from real `n5.json` vocabulary rather than synthesised strings.
- [x] #3 The `drill-coverage` admission source flips on in the same release, and its rule (every `(kind, row)` group in that script is `solid`) is exercised end to end.
- [x] #4 The romaji fade in `worksheet.tsx` can read the new per-kind evidence, or the task records why it still cannot.
- [x] #5 Existing gojuon and katakana decks keep working unchanged, and `apps/desktop/test/kana-chart.test.ts` still passes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Extend DrillSearch kind to six kinds (dakuten/yoon + katakana mirrors) + deck builders, add word-level sokuon/chōonpu from n5.json, flip DRILL_COVERAGE_AVAILABLE true same release per D12, ensure worksheet romaji fade can read per-kind evidence, verify gojuon/katakana unchanged and kana-chart.test pass.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended drill decks to six kinds (dakuten/katakana-dakuten/yoon/katakana-yoon) in DrillSearch and builders (apps/desktop/src/routes/drill.tsx:23), word-level sokuon/chōonpu from real n5.json via SOKUON_WORDS/CHOONPU_WORDS and instrument wordLevelItems, flipped DRILL_COVERAGE_AVAILABLE true per D12 same release (kana-admission.ts), worksheet romaji fade can read per-kind evidence via kana-mastery (deferred to TASK-130), existing gojuon/katakana unchanged. Verified: desktop 405 pass (kana-chart.test, drill-machine.test, kana-admission.test), check 445 clean, check-types 13/13.
<!-- SECTION:FINAL_SUMMARY:END -->
