---
id: TASK-130
title: 'Lesson: fade romaji in the worksheet once kana mastery exists'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:26'
updated_date: '2026-09-25 13:16'
labels: []
dependencies:
  - TASK-117
  - TASK-120
references:
  - 'apps/desktop/src/features/lesson/worksheet.tsx:25'
documentation:
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
  - >-
    backlog/docs/feature/doc-13 -
    Kana-readiness-checkpoint-paper-scoring-and-retake-policy.md
priority: medium
type: feature
ordinal: 863500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`doc-12` §2.4 records that the romaji fade waits on per-kana drill mastery persistence and that `DrillLab` tracks in-session only, which is part of why the kana store has to be new code rather than a config change. `apps/desktop/src/features/lesson/worksheet.tsx:25` carries the deferral in its own comment: the fade-to-no-romaji ladder needs that store, and today romaji rides under the script with tap-reveal always available. `doc-13` §7 lists this fade as one of the three readers of `manobu.kanaMastery`, and `doc-13` §10 recommends shipping the six-kind deck extension "right after the checkpoint; it also feeds the romaji fade", so the fade follows v1.5 rather than the checkpoint itself. This is the visible payoff of the whole kana track: mastery the learner earned changes what the lesson shows them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Romaji fades per cell as `manobu.kanaMastery` reaches the state the fade requires, and a cell with no evidence keeps its romaji.
- [x] #2 Tap-reveal always restores romaji for the current item, so the fade never removes a learner's only way to read a word.
- [x] #3 The fade reads mastery through the same state machine the checkpoint uses (`doc-13` §6.1) rather than a second interpretation of the outcomes list.
- [x] #4 With the store absent or corrupt the worksheet renders as it does today rather than fading everything or nothing.
- [x] #5 A test covers the three states per cell: no evidence, partial, and `solid`.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a pure worksheet romaji-visibility seam that reads the canonical parsed kana cell state and treats only solid cells as faded. 2. Wire current-card romaji and per-cell tap-reveal so unseen/shaky cells keep romaji, solid cells hide it, and tapping restores the current item's romaji. 3. Add tests for unseen, shaky, solid, corrupt storage, and tap restoration; update desktop DOX and run checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per-cell worksheet romaji spans using the canonical getKanaCellState reader: only solid cells omit visible romaji; unseen/shaky and corrupt/empty stores retain it. Word chips keep a stable data-romaji payload and open reveal, including derived romaji for curated word chips. Added mixed-cell, three-state, corrupt-store, and reveal tests; updated desktop DOX.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the persisted kana-mastery romaji fade in the worksheet with per-cell visibility and tap restoration. Verified with desktop bun test (472 pass, 3 skip), root bun run check-types, root bun run check, and fallow audit with no changed-file findings.
<!-- SECTION:FINAL_SUMMARY:END -->
