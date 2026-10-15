---
id: TASK-164
title: >-
  Cards: GET /cards/due has no due-at-or-before filter, so "N cards due" counts
  the oldest cards instead
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 09:04'
updated_date: '2026-09-28 15:07'
labels:
  - server
  - cards
  - srs
dependencies: []
priority: medium
type: bug
ordinal: 929000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while verifying TASK-155 against the running app. The handler selects the earliest-due rows and stops: `const rows = await db.select().from(cards).orderBy(asc(cards.due)).limit(20)` (apps/server/src/rpc.ts:101-109). There is no `where due <= now`, so the response is "up to 20 cards, oldest first" whether or not any of them is due.

Every consumer reads it as a due count. The dashboard tile: `const dueCount = data?.cards.length ?? 0` (apps/desktop/src/features/dashboard/dashboard.tsx:156), rendered as the number in `plan.dueCount` (:365). The review desk header says "{due} cards due" over the same array. A learner who did a lesson five minutes ago and has nothing scheduled until Thursday is told they have cards due today, and the desk will hand them that card.

Two consequences that make this more than a label problem:
- The empty state is unreachable for anyone who owns at least one card, because the query never returns an empty array for a non-empty table. TASK-155 had to stub the wire in the browser to see it.
- The server comment at apps/server/src/rpc.ts:105 describes this as "FSRS queue semantics - earliest due first", which is true of the ordering and silent about the missing predicate.

Decide what the route means before fixing the wording anywhere: either it is the due queue (add the predicate, and a card whose due is in the future stops appearing) or it is a card browser (rename what it returns and stop calling the count "due"). The desktop consumers follow from that choice, they do not lead it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The task records which meaning GET /cards/due has, and the handler matches it
- [x] #2 If it is the due queue: a card with a future due date is not returned, and a test proves it with a real row rather than a mock
- [ ] #3 If it is a card browser: the consumers stop calling the result a due count, including the dashboard tile and the desk header
- [x] #4 The empty state becomes reachable through the real API, so TASK-155 no longer needs a wire stub to show it
- [x] #5 apps/server/src/rpc.ts:105 comment is corrected to describe what the query actually does
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
DECISION (AC#1): GET /cards/due is the DUE QUEUE, not a card browser.

Why:
- Both consumers already treat the result as a count of due items: apps/desktop/src/features/dashboard/dashboard.tsx:156 (dueCount -> plan.dueCount) and apps/desktop/src/features/mock/review-queue.tsx (t("review.header", {due: batch.cards.length})). Neither is a browser UI, so the browser reading would force both to rename their labels and would leave "N cards due" with no honest source.
- AC#4 is only true under the queue reading: an all-future table must return cards: [] for the desk empty state to be reachable through the real API.
- The route is named "due". Serving non-due rows from it is the bug, not a second meaning.

Shape of the fix: one predicate in one place. New apps/server/src/services/due-queue.ts exports selectDueQueue(db) (lte(cards.due, isoDay(now)) + asc + limit 20) and isoDay(now). Both the Hono route (src/routes/cards.ts) and the oRPC handler (src/rpc.ts) read through it, so the two surfaces cannot disagree about what is due - that divergence was TASK-144-class risk.

Why a day-granular text compare is correct here (not a truncation bug): both writers store YYYY-MM-DD - the insert in routes/cards.ts + rpc.ts and the FSRS transition in services/grading.ts (toISOString().slice(0,10)). So lexicographic lte IS a chronological day compare. isoDay() is exported from the service so the writers and the reader share one expression.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
EVIDENCE

AC#1 (meaning recorded, handler matches): the plan above records the due-queue reading. Both surfaces now answer through one function: apps/server/src/services/due-queue.ts::selectDueQueue (lte(cards.due, isoDay(today)) + asc + limit 20), called by apps/server/src/routes/cards.ts:77 (GET /cards/due) and apps/server/src/rpc.ts:101 (os.cards.due). isoDay() also replaced the two hand-rolled insert-date expressions (routes/cards.ts:47, rpc.ts:72), so the writer and the reader share one day expression.

AC#2 (future card not returned, proven with a real row): apps/server/test/due-queue.test.ts. Cards are inserted through the real POST path and moved with a real UPDATE on the cards table; nothing is mocked. "excludes a card whose due day has not arrived" pins a +3-day card out of a queue that still contains a card due today (so the exclusion cannot be an empty-table artifact); "serves the overdue cards oldest first, and stops at today" pins -10, -1, today in and +2 out. Repeatable proof: the new `due-queue-serves-the-whole-table` seam deletes the predicate and is CAUGHT (bun run gate:mutation due-queue -> all 1 mutation(s) caught).

AC#3: NOT APPLICABLE. It is conditional on the card-browser reading, which AC#1 rejected. The consumers keep their "due" wording because the wording is now true.

AC#4 (empty state reachable through the real API): "returns an empty queue when nothing is due (TASK-155 empty state, real API)" asserts cards: [] over the RPC and the legacy route for an all-future table. Live: with the real local.db (one card, due 2026-10-01) GET /api/cards/due answers {"cards":[]}, /review renders "Review . FSRS . Due at R <= 90% . 0 cards due . 0 total" plus data-testid="review-empty" ("No cards due . great work!"), no wire stub. Shifting that card to today (restored afterwards, verified back at 2026-10-01) flipped both surfaces to "1 card due . 1 total" with the card served and the dashboard Due tile reading 1. Screenshots: /tmp/t164-shots/164-{a-dashboard,b-review}{,-1due}.png.

AC#5 (comment corrected): apps/server/src/rpc.ts:103-104 now says the handler serves the due queue, only rows whose day has arrived, pointing at services/due-queue.ts. The old "FSRS queue semantics - earliest due first" note is gone, and the route carries the same comment.

TESTS REWRITTEN, NOT JUST PATCHED: apps/server/test/grade-loop.test.ts used /cards/due as a card browser (before[0], before[1], before[2]), so the predicate broke two of its tests for the wrong reason - positional handles into a queue whose membership changes as the tests grade. Each test now seeds the card it grades through POST /cards and reads the outcome off that row (the /cards/grade response body, or a direct select), and the queue is asserted only for what the queue owns: a card graded `good` has left it, a card graded `again` is still in it. The old "due queue is ordered by due date ascending" case is gone from this file: every seeded card shared today's date, so it compared equal strings and passed vacuously; the ordering is pinned with real distinct dates in due-queue.test.ts instead.

FOUND WHILE HERE (both fixed or filed, neither in the ACs):
- grade-loop's preview-parity case compared the server's day-rounded schedule against an UNROUNDED interval (Date.now() + states.good.interval * 86_400_000) while services/grading.ts floors the interval. A latent off-by-a-day flake for any run inside the fraction's window (a new card's `good` is 2.30 days, so the window is ~7 h wide). The expectation now floors too, matching the writer.
- KNOWN IMPRECISION, NOT FIXED: dueCount is the length of a limit(20) page, so a learner with 40 cards due is told 20. It is strictly better than before (the 20 were at least genuinely due) and it is a different contract question (a count vs a page), so it is left as a finding for the user to schedule rather than folded into this fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
GET /cards/due is now the due queue it always claimed to be. One predicate, one place: apps/server/src/services/due-queue.ts exports selectDueQueue(db) (due <= today, oldest first, page of 20) and isoDay(now), and both surfaces call it: the legacy route (routes/cards.ts:77) and the oRPC handler the desktop actually reads (rpc.ts:101). The duplicated day expressions in the two insert paths now go through isoDay() too, so the writer and the reader cannot drift apart by format.

Why the queue and not a browser (AC#1): both consumers already treat the result as a count of due items (dashboard.tsx:156 -> plan.dueCount, review-queue.tsx's review.header), AC#4's empty state is only reachable under the queue reading, and the route is named "due". Under the browser reading the labels would have had to lie in the other direction.

Proof:
- apps/server/test/due-queue.test.ts (new): real rows through the real POST path, moved by a real UPDATE. A +3-day card is absent while a card due today is present; an all-future table answers cards: [] over BOTH surfaces; the queue is oldest-first and stops at today; the oRPC and the legacy route return byte-identical rows for the same table state.
- The `due-queue-serves-the-whole-table` seam deletes the predicate and is CAUGHT, so the property is pinned rather than merely covered.
- grade-loop.test.ts was rewritten rather than patched: it had been using /cards/due as a card browser (before[0]/[1]/[2]) and the predicate broke two of its cases for the wrong reason. Each test now owns the card it grades and reads the outcome off that row; the queue is asserted only for what it owns (graded `good` -> left the queue, graded `again` -> still in it). Its vacuous ordering case is gone (every seeded card shared today's date); ordering is pinned with distinct dates in the new suite.
- Full gates: bun run test 10/10 tasks (server 244 pass / 1 skip), bun run check-types 14/14, fallow dead-code --boundary-violations 0, bun run check:dox clean, ultracite clean, mutation gate 48/48 anchors resolve and the new seam caught.
- Live, in headless Chromium against the running sidecar (:4317) and vite (:3001) on the real local.db, whose one card is due 2026-10-01: /api/cards/due answers {"cards":[]}, /review reads "0 cards due . 0 total" and renders data-testid="review-empty" ("No cards due . great work!") with no wire stub. Shifting that card to today and back (verified restored: id 1, due 2026-10-01) flipped the desk to "1 card due . 1 total" serving the card and the dashboard Due tile to 1.

Docs: apps/server/AGENTS.md records the queue semantics, the shared service, the date-granular-compare invariant and the new test/seam; apps/desktop/AGENTS.md's stale "`/cards/due` has no `due <= now` filter, re-add the preview on a real endpoint" note is corrected (the filter exists now, and the preview still needs its own endpoint because the queue answers only rows whose day has arrived).

Left as findings, not folded in:
- dueCount is the length of a limit(20) page, so 40 cards due reads as 20. Genuinely-due-but-truncated is a contract question (count vs page), separate from this fix.
- grade-loop's preview-parity case compared the server's day-rounded schedule to an unrounded interval, a latent off-by-a-day flake with a ~7 h window for a new card's `good` (2.30 days). It floors now, matching services/grading.ts.
<!-- SECTION:FINAL_SUMMARY:END -->
