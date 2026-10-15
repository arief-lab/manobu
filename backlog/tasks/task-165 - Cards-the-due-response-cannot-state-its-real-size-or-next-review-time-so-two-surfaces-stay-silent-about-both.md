---
id: TASK-165
title: >-
  Cards: the due response cannot state its real size or next review time, so two
  surfaces stay silent about both
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 09:04'
updated_date: '2026-09-28 18:05'
labels:
  - server
  - cards
  - desktop
  - srs
dependencies: []
priority: medium
ordinal: 930000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The due response is `z.object({ cards: z.array(DueCardSchema) })` (DueOutputSchema, packages/api-contract/src/schemas/cards.ts:51) over a query capped at `.limit(20)` (apps/server/src/rpc.ts:108). It carries a page and nothing about the collection, so two honest statements are impossible and both surfaces currently improvise.

1. Queue size. The review desk header renders "{due} cards due · {total} total" (review.header, packages/ui/src/lib/copy.ts:335) where `total` comes from `batchNext(cards).total`, which is the fetched length. With more than 20 cards in the table the number is wrong and no client-side fix exists. TASK-155 chose to cap its batch selector at the reachable sizes rather than ship a control whose 50 option can never be satisfied.

2. Next review time. The empty state copy is "No cards due · great work! Your next review is in {duration}" (review.empty, packages/api-contract... packages/ui/src/lib/copy.ts:324). Nothing in the response says when the next card is due, so the value interpolated at the call site cannot be computed from data. TASK-155 removed the invented literal and left the claim out; this task is what makes it possible to put it back.

Both need the same shape of change: the handler reports what it knows about the whole queue alongside the page it returns (a count of cards, and the earliest future due time). That is a contract addition, so it touches packages/api-contract, apps/server/src/rpc.ts and the desktop consumers together.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DueOutputSchema carries the true queue size and the next due timestamp, and the contract is the single source for both
- [x] #2 The desk header total is the real queue size, not the fetched page length
- [x] #3 The empty state can name a real next-review time, so TASK-155 can restore the sentence it had to drop
- [x] #4 A test proves the count survives the page limit: more than 20 rows in, page of 20 out, full count reported
- [x] #5 The desk header's two numbers stop being the same number interpolated twice: over a deck whose cards are all future-dated it cannot render "0 total", so it either names a real deck total or drops the second figure
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
DECISION FIRST (AC#5): keep BOTH header numbers and make the second one true. `review.header` already says "{total} total", so the field the header was missing is a real deck count, not a new sentence. `DueOutputSchema` therefore gains three facts beside `cards`: `dueCount` (rows matching the due predicate across the whole queue, not just the page), `deckCount` (every card the learner owns), and `nextDue` (earliest day after today that any card is scheduled, null when nothing waits). No copy string changes: the header's existing `{due}`/`{total}` vars get fed true numbers, and `review.empty`'s withheld `{duration}` finally has something to compute from (AC#3).

ORDER
1. `packages/api-contract/src/schemas/cards.ts` — extend `DueOutputSchema` with the three fields (int, nonnegative; `nextDue` nullable string, day-granular like `cards.due`). `dueCards = oc.output(DueOutputSchema)` is already the single source; both handlers type-check against it.
2. `apps/server/src/services/due-queue.ts` — `selectDueQueue` returns the whole `DueOutput`, not the page: the existing page read plus `count(*) where due <= today`, `count(*)` over the table, and the first row with `due > today` ordered ascending (an aggregate-free "earliest future day"). One function, so `rpc.ts:101` and the Hono twin `routes/cards.ts:78` cannot drift (they become `return selectDueQueue(db)`).
3. `apps/desktop/src/lib/cards.ts` — the read-failure degradation must answer the new shape (`{ cards: [], dueCount: 0, deckCount: 0, nextDue: null }`); TypeScript forces it.
4. `apps/desktop/src/lib/review.ts` — `batchNext(cards, { batchSize, dueCount })`; `ReviewBatch.total` RENAMED to `queueSize` because "total" is the ambiguous word that let one number fill both slots. `hidden` = dueCount - page length. Add `nextReviewDuration(nextDue, today)` (whole days, ceil, so a card due tomorrow says 1d).
5. `features/mock/review-queue.tsx` + `routes/review.tsx` — the compound takes required `dueCount`/`deckCount`/`nextDue` (no default may reproduce the lie); header `{due}` from `batch.queueSize`, `{total}` from `deckCount`; `Empty` uses `review.empty` with the real duration when `nextDue` is non-null, `review.empty.first_run` otherwise.
6. `features/dashboard/dashboard.tsx:156` — `dueCount = data?.dueCount ?? 0`, which also un-caps the tile's count and `deriveToday`'s minutes estimate.

PROOF
- AC#4: `apps/server/test/due-queue.test.ts` seeds >20 due rows over real tables and asserts `cards` is capped at 20 while `dueCount` names all of them, on BOTH the oRPC client and the legacy route (the twin is where a second count would go stale).
- Desk render (`review-queue.test.tsx`): 24 due with a 20-row page prints "24 cards due", and an empty queue with `nextDue` prints the duration; with `nextDue: null` it stays duration-free.
- Mutation seams: `cards-due-count-reads-the-page` (server: dueCount := rows.length) and `review-header-counts-the-page` (desk: `{due}` back to `batch.cards.length`).

DOX: `apps/server/AGENTS.md` cards row (the "the number a consumer shows is this page's length" sentence is now false), `apps/desktop/AGENTS.md` review-desk + dashboard-tile rows, including deletion of the stale "until TASK-164 lands" note.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-164 landed (0f07726) and changed this task's premise in one way and exposed a second problem the ACs do not yet cover.

Premise change: the page this task counts is now a TRUE due page. `selectDueQueue` (apps/server/src/services/due-queue.ts) filters `due <= isoDay(today)` before the `.limit(20)`, so the cap truncates a count of cards that are actually due rather than "the oldest 20 rows whatever their date". The count work here is unchanged in shape, but the number it must report is now a different quantity than the one /cards/due used to return.

NOT YET COVERED: the desk header's second number became a denial of ownership. `batchNext(cards).total` is `cards.length` (apps/desktop/src/lib/review.ts:43) and review.header renders "{due} cards due . {total} total" (packages/ui/src/lib/copy.ts:342), so both numbers interpolate the same page length. Before TASK-164 that read "1 card due . 1 total" over a deck of one and looked like a coincidence; after it, the live app over the real local.db (one card, due 2026-10-01) renders "0 cards due . 0 total" while `select count(*) from cards` is 1. A learner who owns cards is told there are none.

AC#2 as written (total = the real queue size) does not fix that: it would still print the same number twice, and "0 total" over a non-empty deck would still ship. Either the header names a deck total the response can carry (a second count alongside the due count), or the second number goes away and the header says one true thing.

VERIFIED LIVE (chromium CDP over the user's Vite :3001, shots in /tmp/t165-shots). Empty desk over the real one-card deck: 'Review . FSRS . Due at R <= 90% . 0 cards due . 1 total' plus 'No cards due . great work\! Your next review is in 3d' (nextDue 2026-10-01, UTC today 2026-09-28, so the ceiled day count is 3). Queue larger than the page: 24 cards inserted through POST /api/cards, header reads '24 cards due . 25 total' with '4 hidden . Finish batch to see more'; ?batch=5 keeps '24 cards due . 25 total' and moves to '19 hidden', so the queue size no longer tracks the session's page. Dashboard tile over the same data: big 24, 'words ready to review', 'first review day . ~4 min' (the estimate scales with dueCount, not the 20-row page). Throwaway rows deleted by vocabId >= 900000; cards back to 1, revlog untouched (0 rows for the inserted ids).

GATES: bun run test -> 10/10 tasks, server 252 pass / 1 skip / 0 fail (the 2 new TASK-165 due-queue tests included; the dev sidecar was stopped by PID for the run and restarted on 4317 after). bun run check-types -> 14/14. bun x ultracite check on the 13 touched files -> clean after one formatter fix in scripts/mutation-gate.ts. fallow dead-code --boundary-violations -> 0. bun run check:dox -> complete. bun scripts/mutation-gate.ts --check -> all 58 seam anchors resolve; the 4 seams this task added (cards-due-count-reads-the-page, review-header-counts-the-page, review-header-total-stands-in-for-the-deck, review-empty-forgets-its-next-day) and the refreshed due-queue-serves-the-whole-table anchor each report CAUGHT. DOX: apps/server/AGENTS.md /cards/* row now states the read returns the whole DueOutput; apps/desktop/AGENTS.md desk, dashboard-tile, cards.ts and review.ts rows updated and the stale 'until TASK-164 lands' sentence deleted; apps/desktop/src/features/AGENTS.md Tier-1 row carries the new degradation shape.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The due response now describes the queue, not only the page it serves. DueOutputSchema (packages/api-contract/src/schemas/cards.ts) gained dueCount, deckCount and nextDue, and one service read (apps/server/src/services/due-queue.ts::selectDueQueue) computes all four facts so the oRPC handler and the legacy Hono route cannot disagree about what is due. The desktop's batchNext takes the size as an argument instead of inferring it from the rows, ReviewBatch.total is renamed dueCount (the ambiguous word that let one page length fill both header numbers is gone), and the compound takes dueCount/deckCount/nextDue as required props so no default can reproduce the lie. The desk header's second number is now the deck (AC#5's '0 total' over a deck of one is fixed by telling the truth, not by dropping the figure), and TASK-155's withheld sentence is back: 'Your next review is in {duration}' computed by nextReviewDuration from the real nextDue, with the first-run string reserved for a learner who owns nothing scheduled. Verified by 2 new server tests (25 due rows -> page of 20, dueCount 25; twin route parsed through the schema and equal), 8 new desk/lib tests, 4 new mutation seams, and a live chromium pass over the real app on both surfaces. bun run test 10/10 tasks green, check-types 14/14, ultracite clean, 0 boundary violations, 58/58 gate anchors resolve.
<!-- SECTION:FINAL_SUMMARY:END -->
