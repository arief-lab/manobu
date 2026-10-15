---
id: TASK-140
title: 'Exam: honour focus as a selection prior, so re-practice lands where it hurt'
status: Done
assignee: []
created_date: '2026-09-26 12:57'
updated_date: '2026-09-27 02:08'
labels:
  - exam
  - api
dependencies: []
priority: medium
type: feature
ordinal: 905000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The targeting half of TASK-139, separated because it cannot be done before TASK-138 and would have been wasted effort after it.

TASK-139 fixed the round trip: the contract's `focus` field is persisted on `exams.focus` (migration 0014) and `requestForState` rebuilds the request the learner actually made instead of a lookalike with an empty focus. Two mutation-gate seams cover both links. What is NOT done is the part that makes the field mean anything: nothing reads it at selection time. `buildCandidateCatalog` / `appendItemTypeCandidates` in apps/server/src/services/exam-service.ts still pick purely by item type and allocated count, so a focused request produces exactly the same paper as an unfocused one. A caller sending focus gets a 200 and a paper that ignored it, which is the silence doc-21 §2 names as the defect shape.

Why this could not ride along with TASK-139. The picker's candidate source is `LOCAL_CATALOG` (exam-service.ts:144), sixteen hardcoded nouns. A prior over that list is not demonstrable: a grammar focus id matches nothing, and a vocabulary focus id has to match a synthetic `vocab:N5:<digest>` anchor. TASK-138 replaces the source with 11,311 real JLPT-classified anchors and a canonical anchor format shared through `@manobu/api-contract` (its AC#7), and a prior is only meaningful over real anchors. Implementing it first would mean writing throwaway code against sixteen words.

This is doc-21 §9 step 2 of the code/agent sequence: a code-picked anchor is blind to the learner, selecting by level, seed and catalog offset, so it produces correct-but-arbitrary rather than correct-and-targeted. `focus` is the personalisation layer, which is why TASK-139 was reclassified from a contract-hygiene fix to a real feature.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A focus-carrying request demonstrably changes which anchors the picker chooses, so the field is not decorative. The proof must be a real anchor from the TASK-138 catalog, not a synthetic digest. If focus is to stay decorative, the contract stops accepting it - a documented no-op is acceptable, silence is not.
- [x] #2 Focus is a PRIOR, not a filter: a two-id focus still yields a full paper at the level floor, and unknown or empty ids degrade to current behavior without throwing or producing a shortfall.
- [x] #3 A focus id that is a real corpus anchor lands in the paper, and the assertion is a distribution over an assembled paper rather than one hand-picked item (the TASK-135 lesson).
- [x] #4 A mutation-gate seam covers the prior, so a revert to selection-by-item-type-alone is caught. TASK-139 taught the lesson: a focused request and an unfocused one must not be able to produce the same paper without a red test.
- [x] #5 doc-14 §3 stops describing focus as the working re-practice mechanism until the picker honours it, or the description is confirmed accurate once it does.
- [x] #6 The prior is applied in a STABLE ORDER, so the focus anchors land in the caller order on every run, and the contract already caps focus at 100 ids. NOTE the correction: this AC originally said "the same request and seed always produce the same paper", and that property DOES NOT EXIST and never did - the exam id seeds the pool walk, so two requests with one seed differ outside the focus region by design. Replay comes from the stored items, not from re-deriving the request, which doc-21 §9 already says. The honest property is order stability, and that is what is tested.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE, 6/6. `focus` is now read at selection time, and it is a prior rather than a filter.

THE SHAPE, in `focusSourceFor`. For each slot the picker first offers the focus anchor at that position, when it is the right family for the item type and has not already been spent in this paper; otherwise it falls through to the seeded pool walk, UNCHANGED. That single shape gives all three of AC#1, AC#2 and AC#3: exhaustion falls back rather than filtering a pool to nothing, an unknown or wrong-family id is a no-op rather than a throw, and the order is the caller's because the request is persisted (TASK-139).

A focus anchor of the wrong family is SKIPPED rather than coerced. A grammar id cannot become a vocabulary item, and an item type that cannot express a grammar point should not be forced to. Grammar focus anchors are tracked in their own spent-set because they spend no word.

AC#4 is a distribution, not one item: every focus anchor lands AND the paper still fills to its budget, so "the focus lands" and "the prior is not a filter" are asserted together.

TWO THINGS THE TESTS CAUGHT.

An empty focus id is rejected by the contract's IdentifierSchema before it reaches the picker. That is the contract working, not a degradation case, so the test's junk list is two well-formed ids that name nothing.

AC#3 WAS WRONG AS I WROTE IT. It claimed "the same request and seed always produce the same paper", and that property does not exist and never did: the exam id seeds the pool walk, so two requests with one seed differ outside the focus region by design. Replay comes from the stored items, not from re-deriving the request - which doc-21 §9 states outright and which I then forgot while writing the AC. The honest property is ORDER stability, and that is what is now tested: the focus anchors land in the caller's order on every run, and a reordered request puts the same anchors in a different sequence. The AC text was corrected to say so rather than the test weakened to pass.

The test helper also filtered by the outer request instead of its parameter, so the "different order" half compared a list against itself. Caught immediately, fixed.

AC#5: the `exam-focus-prior-removed` seam replaces the prior with `null`, which is precisely the pre-TASK-140 behaviour - focus persisted, round-tripped and unread - and the suite catches it. Twelve anchors resolve.

AC#6: doc-14 §3 was corrected in TASK-139 to say focus was NOT yet the re-practice mechanism, precisely because the picker ignored it. That statement is now false in the other direction, so it is restored to describe the mechanism, with the prior named and its fallback behaviour stated. The correction and the reversal are both in the docs rather than one silently replacing the other.
<!-- SECTION:NOTES:END -->
