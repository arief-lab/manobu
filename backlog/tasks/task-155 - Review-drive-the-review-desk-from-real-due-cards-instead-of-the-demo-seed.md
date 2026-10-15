---
id: TASK-155
title: 'Review: drive the review desk from real due cards instead of the demo seed'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:03'
updated_date: '2026-09-28 09:34'
labels:
  - desktop
  - review
  - srs
dependencies: []
priority: medium
type: bug
ordinal: 920000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk of the running app (2026-09-28) found the dashboard and the review desk disagreeing about what exists. The dashboard counts real data: `useCardsDue()` at apps/desktop/src/features/dashboard/dashboard.tsx:155 feeding `dueCount` at :156, rendered at :365. It said "1 word ready to review". Clicking it opens /review, which is a demo: `SEED` at apps/desktop/src/routes/review.tsx:9 is three hardcoded cards (たべる / ひがし / のむ) served by `queryFn: () => Promise.resolve(SEED.slice(0, batch))` at :42, and :78 falls back to the seed even when the loader returns nothing, so `ReviewQueue.Empty` ("No cards due · great work!", apps/desktop/src/features/mock/review-queue.tsx:9) renders alongside a live card. Grading is local-only as well: `ReviewQueueProps` declares `onGrade` (apps/desktop/src/features/mock/review-queue.tsx:203) but the route never passes one, and the queue advances its own `useState(0)` index at :214, so a grade never reaches the FSRS store and a reload restarts the batch. The learner is told the wrong count, does the work, and keeps nothing.

The real seam already carries everything the desk needs. `DueCard` (packages/api-contract/src/schemas/cards.ts:7) has id, due, jp, reading, difficulty, stability and vocabId, which map onto `ReviewCard` (apps/desktop/src/lib/review.ts:17) directly, and `orpc.cards.grade()` is the write side (GradeInputSchema at packages/api-contract/src/schemas/cards.ts:35). So this is a wiring task, not a new capability.

Do not treat the desk as an unnoticed stub: apps/desktop/AGENTS.md:112 documents `src/features/mock/review-queue.tsx` + `src/routes/review.tsx` as the SCR-12 demo pair. Closing this task changes that contract, so the doc row moves with it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The review desk loads its queue from the real due cards (useCardsDue / orpc.cards.due), and SEED, the seed queryFn and the seed fallback at apps/desktop/src/routes/review.tsx:78 are removed
- [x] #2 The dashboard tile count and the review queue header count read the same query, so they cannot disagree on one screen
- [x] #3 Grading writes: the 1|2|3|4 grade maps to the contract grade names and calls orpc.cards.grade({cardId, grade}), then refreshes the due queue so a graded card leaves the queue instead of reappearing on reload
- [x] #4 A genuinely empty real queue shows the empty state with no card behind it, and a down or 5xx sidecar keeps the existing degradation path at apps/desktop/src/lib/cards.ts:22
- [x] #5 The DueCard to ReviewCard mapping and the grade-name translation live in a pure seam asserted by calling it. No source-text assertions (apps/desktop/AGENTS.md:46: the desktop has no DOM test env; TASK-134)
- [x] #6 apps/desktop/AGENTS.md:112 is updated in the same commit, since it documents this desk as the demo with the 1d/4d/12d/28d preview seed
- [x] #7 New user-visible strings contain no em dash (R-02, guarded by packages/ui/test/copy-snapshot.test.ts)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pure seam in apps/desktop/src/lib/review.ts: `dueCardToReviewCard(DueCard): ReviewCard` (id→cardId, due→dueAt, jp/reading through, difficulty+stability→memory) plus `gradeName(1|2|3|4): "again"|"hard"|"good"|"easy"`. Both asserted by calling them in apps/desktop/test/review.test.ts.
2. Route: delete `SEED` (review.tsx:9), the seed queryFn (:42) and the seed fallback (:78); load from the shared `useCardsDue()` query so the desk and the dashboard tile are one query key (["cards","due"]).
3. Grade write: a `useMutation` over `orpc.cards.grade({cardId, grade})` passed as the `onGrade` prop the compound already declares (review-queue.tsx:203), invalidating ["cards","due"].
4. DECISION A (open): who owns advancement. The queue holds a local `useState(0)` index (:221-234). If a grade also invalidates and refetches the list, both move and a card is skipped. Options: (a) server list is the queue, drop the local index, head = current card; (b) keep the index, refetch only when the batch is exhausted; (c) optimistic local advance, reconcile on batch end.
5. DECISION B (open): the batch selector offers 5/10/20/50 but the server hard-caps the queue at `.limit(20)` (apps/server/src/rpc.ts:108), so 50 is unreachable and "{total} total" in the header is the fetched size, not the queue size. Options: (a) cap the select at 5/10/20; (b) drop the selector; (c) change the contract for a true total (server work, likely a follow-up task).
6. DECISION C (open): the empty state hardcodes a fabricated number: `t("review.empty", { duration: "1d 4h" })` (review-queue.tsx:195) reads "Your next review is in 1d 4h". An empty queue carries no data from which a next-review time could be computed. Options: (a) duration-free empty copy now; (b) add the next due time to the contract (server work, follow-up).
7. Docs: update apps/desktop/AGENTS.md:112 (demo desk) and apps/desktop/src/features/AGENTS.md Tier-1 mock row ("card persistence not wired").
8. Verify: bun test + check-types in apps/desktop, ultracite check, mutation-gate --check, fallow audit --base main and dead-code --boundary-violations.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE (read path, AC#1/#2/#4-partial/#5): pure seam added in apps/desktop/src/lib/review.ts (`reviewCardFromDueCard`, `gradeRequestName`), 11 tests in apps/desktop/test/review.test.ts assert them by calling. SEED + seed queryFn + seed fallback removed from apps/desktop/src/routes/review.tsx; the desk now reads `cardsDueQueryOptions` (exported from lib/cards.ts) - the same query key the dashboard tile uses. `ReviewQueue` gained a `batchSize` prop so the compound slices the real queue instead of the route pre-slicing it, and `Empty` + `Grades` are now gated (they both rendered unconditionally, which is the actual mechanism behind the QA symptom).

LIVE VERIFIED (Vite + sidecar, headless Chromium): dashboard tile "1 word ready to review" -> click -> desk header "1 cards due · 1 total", card body "vocab 1" (the real row, whose jp is null). Zero 404s on either surface. Empty queue proven by stubbing /rpc/cards/due in the browser (dev DB untouched): card 0, grades 0, empty 1. 485 desktop tests pass, check-types clean, ultracite clean.

BLOCKED on three decisions presented to the user: (A) who owns queue advancement once a grade writes to the server; (B) the batch selector offers 50 but apps/server/src/rpc.ts:108 caps the queue at .limit(20), so "{total} total" is the fetched size, not the queue size; (C) the empty state hardcodes "Your next review is in 1d 4h" (review-queue.tsx:195) - now visible in a live run with a genuinely empty queue.

NEW FACT found while verifying, outside this task: the server due query has no `due <= now` predicate (apps/server/src/rpc.ts:101-109 selects the 20 earliest-due rows regardless of whether they are due), so "N cards due" on both surfaces really means "N cards, oldest first", and an empty desk is only reachable when the learner has no cards at all.

DECISIONS RESOLVED (implemented as recommended): (A) the fetched due-order IS the session - dropped the local useState(0) index in apps/desktop/src/features/mock/review-queue.tsx, the head of the batch is the current card, so a grade writes, invalidates ["cards","due"], and the next head is whatever the sidecar now says is earliest. (B) batch selector capped at 5/10/20 (BATCH_CHOICES) with zod .max(20) on the search param, because apps/server/src/rpc.ts:108 hard-caps the queue at .limit(20); a larger choice could only lie. (C) duration-free empty copy - the due response carries no next-review time (TASK-165 owns adding one), so the {duration} variant was removed rather than invented.

WRITE PATH: useGradeCard + gradeCardMutationOptions live in apps/desktop/src/lib/cards.ts next to the read, so the pair cannot drift. retry: 0 on purpose - an FSRS grade is not idempotent, re-sending one re-schedules the card from a state the learner never saw; pressing a grade again is the learner's retry, and the buttons re-enable when the write settles. Pending state disables all four buttons (data-pending) and a failed write renders the copy deck's review.save_toast.error with aria-live="assertive".

DEFECT FOUND AND FIXED BY LIVE DRIVING: brand-new cards rendered "Again NaNd". The schema DEFAULT for stability is 0 and packages/srs/src/index.ts:195-200 divides by stability in the review branch. reviewCardFromDueCard now maps state === "new" to memory: null, mirroring apps/server/src/services/grading.ts:56, which grades such a row from null - so the desk previews the same thing the write will store. Asserted twice: at the seam (test/review.test.ts) and at the render level (test/review-queue.test.tsx).

DEFECT FOUND, OUT OF SCOPE, FILED AS TASK-166: the write and the preview disagree about the day the card comes back - grading.ts:59 hardcodes retention 0.9 while the desk sends its stored retention; grading.ts:61-63 floors the interval and stores a date-only due, so a sub-day interval stores today and the same card is re-served; and the review branch has no 1-day floor ("Again / 0d").

LIVE EVIDENCE (Vite + sidecar + headless Chromium, write path): a page.route gate that holds the grade response open showed payload {"json":{"cardId":1,"grade":"good"}}, all four buttons disabled in-flight, and the head advancing vocab 1 -> 東 after the refetch. The trace showed every grade posts the on-screen card's id, the queue re-sorts after each write, and stability/difficulty climb monotonically (4.53 -> 5.94 -> 6.67 -> 7.8). Two 404s during the drive isolated to http://localhost:3001/favicon.ico, not the desk. The dev DB was restored to its exact pre-verification state afterwards (cards 2/3 and revlog ids >= 4 deleted, card 1 reset) and confirmed by POST /rpc/cards/due returning the original single row.

GATES: bun test test/ in apps/desktop -> 467 pass / 3 skip / 0 fail; bunx tsc --noEmit clean; bun x ultracite check apps/desktop packages/ui clean; bun run check:dox "DOX index complete"; bun scripts/mutation-gate.ts --check "all 29 seam anchor(s) resolve". Docs moved with the code: apps/desktop/AGENTS.md:112 (demo desk -> wired desk) and the Tier-1 mock rows in apps/desktop/src/features/AGENTS.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The review desk is a real SRS surface now, not the SCR-12 demo. apps/desktop/src/routes/review.tsx lost SEED, its seed queryFn and its seed fallback and reads cardsDueQueryOptions - the same query key the dashboard tile uses (apps/desktop/src/features/dashboard/dashboard.tsx:155), so the two counts cannot disagree. The DueCard -> ReviewCard mapping and the 1|2|3|4 -> again/hard/good/easy translation live in the pure seam apps/desktop/src/lib/review.ts. Grading writes through gradeCardMutationOptions in apps/desktop/src/lib/cards.ts (orpc.cards.grade, retry: 0 because an FSRS grade is not idempotent) and invalidates ["cards","due"]; the local useState(0) index is gone, so the fetched due-order IS the session and the head of the batch is the current card. The batch selector is capped at 5/10/20 to match apps/server/src/rpc.ts:108, and the empty state no longer fabricates a next-review time.

Verified by running it: 467 desktop tests pass (new test/review-queue.test.tsx renders the desk with react-dom/server, test/review.test.ts calls the seam), tsc --noEmit clean, ultracite clean, check:dox complete, mutation-gate --check resolves all 29 anchors, packages/ui copy guard 12 pass. Live in headless Chromium against the sidecar: the dashboard tile reaches the desk showing the real row, and a grade posts {"cardId":1,"grade":"good"}, disables all four buttons in-flight, and advances the head with stability climbing 4.53 -> 5.94 -> 6.67 -> 7.8. Driving it also caught "Again NaNd" on ungraded cards (the schema default stability is 0 and packages/srs/src/index.ts:195-200 divides by it), fixed by mapping state === "new" to memory: null the way apps/server/src/services/grading.ts:56 grades it. The server-side scheduling disagreement that live run exposed is filed as TASK-166; the dev database was restored to its exact pre-verification state.
<!-- SECTION:FINAL_SUMMARY:END -->
