---
id: TASK-132
title: >-
  Exam: N1 exam-conditions with integrated reading, integrated listening and 110
  + 55 minutes (v5)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-24 12:26'
updated_date: '2026-09-25 18:06'
labels: []
dependencies:
  - TASK-131
documentation:
  - >-
    backlog/docs/feature/doc-14 -
    JLPT-exam-generation-pipeline-request-assembler-validator-storage.md
  - >-
    backlog/docs/feature/doc-12 -
    Chat-generated-JLPT-exams-N5..N1-a-kana-readiness-gate.md
priority: low
type: feature
ordinal: 869000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Phase **v5** of `doc-12` §6, and the last one. N1 differs structurally rather than cosmetically: its reading is integrated and thematic (several passages around one theme, with cross-passage questions) and its listening is integrated, so an item can depend on more than one passage, which the shared item engine's single-passage shape does not express today. Timing is 110 + 55 minutes. `doc-14` §9 puts this out of scope for now, so like `TASK-131` this task tracks rather than schedules: `low` priority, and it must not start before v4, because the integrated item shape is the largest change to `doc-16`'s item contract in the whole track and should be the last thing built on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An N1 `exam-conditions` paper builds with its two sections at 110 + 55 minutes and the N1 item-type mix from `doc-14` §2.2.
- [x] #2 Integrated reading items exist and can reference more than one passage, with the item contract in `doc-16` §2 extended or explicitly superseded to allow it.
- [x] #3 Integrated listening items exist, including the multi-source case.
- [x] #4 The N1 result view reports two 60-point scoring sections summing to 180, with the sectional pass mark of 19 each applied.
- [x] #5 The validator's reason enum covers the new failure modes the integrated shapes introduce, or the task records why no new reason was needed.
- [x] #6 No earlier level's paper changes, and their tests still pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Record the two contract corrections this task surfaced: AC#4 says 'two 60-point scoring sections summing to 180' (arithmetically impossible, and it contradicts doc-12 §2.6/D11, which TASK-131 already implemented as three 60-point columns with 19/60 marks), and doc-16 §2's singular passage?/script? is superseded by an ordered stimulus set. 2. Add the Stimulus contract to @manobu/item-engine (kind: passage | script, text) with single-stimulus normalization, plus migration 0013 (items.stimuli JSON) and the item-store read/write/compare seam. 3. Add N1-only integrated-reading (2+ passage stimuli) and integrated-listening (1+ script, multi-source allowed) item types, validator reasons stimuli-missing / stimuli-kind / stimuli-count, and N1 weights; N2..N5 weights and types untouched. 4. Extend the client contract and rendering: ExamItemSchema.stimuli with scripts never leaving the server, the item-engine client projection, the desktop passage renderer, and N1 server candidate generation. 5. Add item-engine, server, db and desktop tests (N1 exam-conditions at 110+55 with integrated items, three 60-point result columns at 19/60, the new rejection reasons, N2..N5 unchanged), update DOX and doc-16, then run full workspace verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Contract decisions (user-approved 2026-09-26): (1) AC#4 is internally impossible (2x60=120, not 180) and contradicts doc-12 §2.6/D11, so N1 keeps the three 60-point columns TASK-131 shipped — language-knowledge, reading, listening — each with the 19-point mark, total 180; verified end to end on a submitted N1 paper. (2) doc-16 §2's singular passage?/script? is SUPERSEDED by an ordered stimuli[] set ({kind, text}); the singular fields are its materialized first entry, and doc-16 was updated through the CLI (the rule: never hand-edit backlog docs). (3) N1 leads its own signature: language-knowledge-reading weights integrated-reading 25 / long-reading 20 / reading-info 15 over the unchanged language types, listening integrated-listening 60 / listening-detail 40; doc-14 §2.1 says the mix is an input, not a constant, so this ships as policy with a test.

AC#5 in both directions. Two reasons ship: stimuli-kind (the required kind is absent, e.g. integrated-reading carrying only a script) and stimuli-count (the kinds are there in too small a number, e.g. one passage where two are owed). The plan's third reason, stimuli-missing, was DROPPED before shipping: an empty stimulus set is always already a missing required kind, so it could never be returned — an unreachable enum member is dead code, and the item-engine treats a new rejection reason as needing a named test. A corrupt stored cell is a different failure and lives in the db, not the enum: items.stimuli that the engine cannot parse throws on read, like a bad anchors/options payload. The legacy types keep their own names (long-reading -> passage-missing, listening-detail -> script-missing), so no existing reason changed meaning.

Storage and wire decisions. Migration 0013 adds items.stimuli (JSON) and rides the idempotent ALTER applier, so a half-applied boot and a legacy fast-forward both recover (the user_version pin moves 13 -> 14). Only a DECLARED set is written, so a single-stimulus row is byte-identical to a pre-0013 row; the write materializes passage/script from the set's first entry, and itemMatchesInput compares that same materialization (an input declaring only stimuli must match the row its write produced). The wire carries passages only: ExamStimulusSchema pins kind to the literal 'passage', so a script cannot be expressed to a client even by accident, and both client projections (item-store toClientItem and the item-engine paper projection) drop scripts. ItemResolution and ItemForClient therefore no longer share a base: the resolution carries the full set, the client view does not.

Validation (2026-09-26). AC#1+AC#3: apps/server/test/exam-pipeline.test.ts 'builds N1 exam conditions with integrated items at 110 + 55 minutes (TASK-132)' asserts sections [language-knowledge-reading, listening], minutes [110, 55], timeLimitSeconds [6600, 3300], integrated-reading items present with 2+ client-visible passages, and — read through the item store, not the client — every integrated-listening row holding TWO stimuli with a non-null script while the client sees one passage and the serialized state contains neither '特別講演の録音' nor the 'script' key. AC#2: packages/item-engine/test/validation.test.ts pins a two-passage integrated item accepted, an integrated-reading with a single script rejected stimuli-kind, and one passage rejected stimuli-count; packages/db/test/item-store.test.ts 'persists a stimulus set...' asserts the round trip, the materialized first passage, idempotent re-store, and rejection of a changed set; doc-16 §2 documents stimuli[] as the canonical ordered set. AC#4: the N1 result test asserts [language-knowledge, reading, listening] each maxScore 60 and passMark 19 with overall.maxScore 180 and passed true. AC#5: the two reasons are pinned by their own named tests plus the parseStimuli narrowing test. AC#6: paper.test.ts asserts N2-N5 carry zero weight for both new types with listening-detail 100 in every other listening section, paperSectionForItemType returns null for integrated-reading at N2, and the N3/N2 papers keep their own shape assertions; full suites green. Workspace: server 155 pass/1 skip, desktop 449 pass/3 skip, @manobu/db 39 pass, @manobu/item-engine 39 pass, root turbo 10/10 tasks, 14/14 check-types, ultracite clean, fallow audit verdict pass (0 dead code, 0 introduced complexity, 0 introduced duplication), git diff --check clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave the item engine an ordered stimulus set (stimuli: {kind, text}) so an N1 item can depend on several passages, with passage/script demoted to the materialized first entry and doc-16 §2 updated to say so. Added the N1-only integrated-reading (2+ passages) and integrated-listening (1+ script, multi-source) types with the stimuli-kind/stimuli-count rejections, migration 0013 plus the item-store read/write/compare seam, a passages-only client contract and projection, and desktop rendering of every passage in order. N1 now builds exam conditions at 110 + 55 with the integrated mix and reports three 60-point columns at 19 marks each (the AC's 'two sections summing to 180' was impossible; the D11 three-column split stands). Verified with item-engine 39, server 155/1, desktop 449/3, db 39 tests, plus check-types, ultracite and a pass fallow audit.
<!-- SECTION:FINAL_SUMMARY:END -->
