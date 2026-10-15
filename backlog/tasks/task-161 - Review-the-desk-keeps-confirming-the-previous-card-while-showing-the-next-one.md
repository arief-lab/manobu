---
id: TASK-161
title: 'Review: the desk keeps confirming the previous card while showing the next one'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:28'
updated_date: '2026-09-28 13:19'
labels:
  - desktop
  - review
dependencies:
  - TASK-155
priority: low
type: bug
ordinal: 926000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28: after grading a card, the confirmation strip stays on screen while the next card is already showing, so the desk reports "✓ Good · たべる" over a card that is not たべる.

Cause is a missing reset. `grade()` calls `setLastGraded({...})` and then `setIndex((i) => i + 1)` in the same handler (apps/desktop/src/features/mock/review-queue.tsx:226 and the advance that follows it), and `lastGraded` is initialised once at :221 and never set back to null. `LastGraded` (:254) renders `{copy} · {lastGraded.reading}` for any non-null value (:266), so the confirmation outlives the card it described.

This matters against the documented rule the component header cites (TASK-36 AC4): the queue must confirm what you just rated. Confirming the wrong card is worse than not confirming at all.

Sequencing: TASK-155 rewires this same desk onto real due cards and touches the grade path, so this task depends on it rather than racing it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The confirmation is visible for the card it describes and gone before the next card front is shown
- [x] #2 Clearing the confirmation does not reintroduce silent grading (TASK-36: every graded surface still shows the result immediately)
- [x] #3 A test pins the lifecycle of the confirmation against the index advance
- [x] #4 The change lands after TASK-155 so the two do not collide in the same file
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Root cause (updated for the post-TASK-155 desk): there is no local index anymore, so the bug is not a missing setIndex reset. grade() calls setLastGraded({grade, reading}) and the head moves when useGradeCard invalidates ["cards","due"], but lastGraded is never cleared, so LastGraded renders "✓ Good · たべる" over the next card that took the front. Fix: stamp the rated card id into lastGraded and gate the strip on the head. 1. ReviewState.lastGraded gains cardId; grade() records current.cardId. 2. New pure confirmFor(lastGraded, currentCardId) returns the record only when it describes the card now in front; LastGraded renders through it. 3. __test__-export confirmFor (desk has no DOM env to mount a transition). 4. Tests in review-queue.test.tsx pin the lifecycle: same id confirms, different id is gone, null head/untouched desk are gone. 5. Mutation seam review-confirm-outranks-its-card negates the cardId guard, caught by those tests. 6. Update apps/desktop/AGENTS.md .LastGraded line.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified live, not only by unit: ran the sidecar on :4317 plus vite on :3001, seeded two overdue cards, and drove /review in headless Chromium over CDP. With the gate reverted the desk reproduced the reported defect exactly ("vocab 1" rated good, the front became 食べる while the strip kept reading "✓ Good ·"); with the fix in place the same run showed the strip gone as soon as eating took the front, and a grade that leaves the card in front (again/hard on the same head) still shows "✗ Again · たべる" over that card, so AC2 no-silent-grading holds. Note for whoever re-drives this: the due queue has no due<=now predicate (rpc.ts:108 selects the 20 earliest-due rows), so grading a card only moves the head when another row sorts behind it - a same-day queue never advances on its own. Dev rows created for the check were deleted and the one pre-existing card row was restored to its original due/stability.

Correction to the note above: "as soon as eating took the front" should read "as soon as 食べる (card 4) took the front".
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The review desk confirmed the wrong card because the confirmation strip was never tied to the card it described. After TASK-155 there is no local index, so the bug was not a missing setIndex reset: grade() stamps lastGraded and the head moves when the ["cards","due"] invalidation refetches, but lastGraded outlived the card it named. grade() now records the rated card id, a pure confirmFor(lastGraded, currentCardId) gate drops the strip the moment a different card takes the front, and LastGraded renders through it; TASK-36 AC4 holds because the strip still shows the result while the rated card is in front. Pinned by the confirmFor lifecycle tests in test/review-queue.test.tsx (called, not source-read) plus the review-confirm-outranks-its-card mutation seam (CAUGHT), and reproduced then fixed live in headless Chromium on the real /review route. apps/desktop/AGENTS.md .LastGraded line updated.
<!-- SECTION:FINAL_SUMMARY:END -->
