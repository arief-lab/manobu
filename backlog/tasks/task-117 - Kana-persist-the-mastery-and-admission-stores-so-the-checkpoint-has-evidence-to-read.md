---
id: TASK-117
title: >-
  Kana: persist the mastery and admission stores so the checkpoint has evidence
  to read
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:05'
updated_date: '2026-09-24 14:22'
labels: []
dependencies:
  - TASK-113
references:
  - 'apps/desktop/src/lib/kanji-progress.ts:154'
  - 'apps/desktop/src/lib/kanji-progress.ts:31'
documentation:
  - >-
    backlog/docs/feature/doc-13 -
    Kana-readiness-checkpoint-paper-scoring-and-retake-policy.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
priority: high
type: feature
ordinal: 860000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There is no persisted kana signal anywhere today: `apps/desktop/AGENTS.md` (SCR-08 row) records that the romaji fade waits on per-kana drill mastery persistence and that `DrillLab` tracks in-session only. `doc-13` §7 defines **two** stores on purpose. `manobu.kanaMastery` is the moving measurement any drill session rewrites (`{ cell, kind, row, outcomes[], state }`); `manobu.kanaCheckpoint` is the auditable record of a specific gate event (`{ script, source, passedAt, attempts[] }`). Mixing them is how a gate becomes unexplainable, so mastery is never consulted for admission directly: it reaches the gate only through the state machine in `doc-13` §6.1. The precedent to follow is `apps/desktop/src/lib/kanji-progress.ts` (`markSeen :154`, `markLearned :159`, `cellState :31`): one localStorage key, a JSON blob, and corrupt reads that degrade to empty rather than throwing. Both stores are localStorage, not database, so this task needs no migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `manobu.kanaMastery` persists per-cell `{ cell, kind, row, outcomes: [{ correct, mode, at }], state }` and survives a reload.
- [x] #2 `manobu.kanaCheckpoint` persists `{ script: "hiragana" | "katakana", source, passedAt, attempts: [{ at, score, groupsFailed, itemIds }] }`, independently per script.
- [x] #3 `manobu.kanaMastery` is never read for admission directly; the only path from mastery to admission is the state machine in doc-13 §6.1.
- [x] #4 Corrupt or absent stores yield "no attempt yet" and never a fabricated pass, following the `parseSettings` precedent named in `doc-13` §9.
- [x] #5 Round-trip tests cover both stores, including the corrupt-blob and absent-key cases.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Two localStorage stores per doc-13 §7 following kanji-progress.ts:354 pattern: kanaMastery (per-cell outcomes/state) and kanaCheckpoint (per-script attempts), corrupt->empty, with AC#3 state machine gate and round-trip tests.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two localStorage stores per doc-13 §7 (kanji-progress precedent): kanaMastery per-cell {cell,kind,row,outcomes,state} with deriveState solid≥3 correct over ≥2 sessions last2 correct, and kanaCheckpoint per-script {source,passedAt,attempts} independent. Corrupt/absent -> empty, never fake pass. Never read mastery for admission directly (AC#3). Verified: kana-stores.test.ts 8 tests (round-trip, corrupt, absent, state machine, per-script independence, skip no passedAt), desktop 389 pass, check 441 clean, check-types 13/13.
<!-- SECTION:FINAL_SUMMARY:END -->
