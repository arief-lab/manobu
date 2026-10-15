---
id: TASK-166
title: >-
  Cards: the grade write and the desk preview disagree about what day the card
  comes back
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 09:27'
updated_date: '2026-09-28 16:06'
labels:
  - server
  - desktop
  - srs
dependencies: []
modified_files:
  - packages/srs/src/index.ts
  - packages/srs/test/fsrs-golden.test.ts
  - packages/srs/AGENTS.md
  - packages/api-contract/src/schemas/cards.ts
  - packages/api-contract/AGENTS.md
  - apps/server/src/services/grading.ts
  - apps/server/src/services/item-grading.ts
  - apps/server/src/routes/cards.ts
  - apps/server/src/rpc.ts
  - apps/server/test/grade-loop.test.ts
  - apps/server/AGENTS.md
  - apps/desktop/src/lib/review.ts
  - apps/desktop/src/lib/settings.ts
  - apps/desktop/src/routes/review.tsx
  - apps/desktop/src/features/mock/review-queue.tsx
  - apps/desktop/src/features/settings/settings.tsx
  - apps/desktop/test/review.test.ts
  - apps/desktop/test/ai-queue.test.ts
  - apps/desktop/test/review-queue.test.tsx
  - apps/desktop/test/settings.test.ts
  - apps/desktop/AGENTS.md
  - packages/agent/src/subagents/index.ts
  - packages/agent/AGENTS.md
  - scripts/mutation-gate.ts
priority: medium
type: bug
ordinal: 931000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live verification of the review desk (2026-09-28, TASK-155) found the queue cycling the same cards and the grade buttons printing "Again / 0d". Three facts, one story: the three places that answer "what day does this come back" do not agree.

1. The write schedules at a retention nobody chose. `apps/server/src/services/grading.ts:59` calls `nextStates(previous, 0.9, daysElapsed)` with 0.9 hardcoded, while the desk previews at the learner setting: `apps/desktop/src/lib/review.ts:52` passes `desiredRetention` (Settings owns 0.7 to 0.97). At any retention other than 0.9 the interval printed on the button is not the interval written. The same line also disagrees about elapsed time: the desk passes `daysElapsed = 0`, `apps/server/src/services/grading.ts:54` computes the real one, so the preview is systematically optimistic for an overdue card (the live row was 14 days past due).

2. The write cannot express less than a day. `apps/server/src/services/grading.ts:61` to `:63` compute `new Date(now + Math.floor(next.interval) * 86_400_000).toISOString().slice(0, 10)`: floor plus a date-only string stores today. Observed: card 2 graded `again` at stability 0.52 kept `due: "2026-09-28"` and came straight back as the head of the queue.

3. The preview prints 0 days. `packages/srs/src/index.ts:180` to `:186` (the new-card branch) floor each interval with `Math.max(1, ...)`, the review branch at `packages/srs/src/index.ts:195` to `:200` has no such floor, so a low-stability review card renders "Again / 0d / fail · D up S down".

Reads of the real API, not inference: `POST /rpc/cards/grade` with `{"json":{"cardId":2,"grade":"again"}}` returned the row with `lapses: 1`, `stability: 0.516`, `due: "2026-09-28"` unchanged, and `POST /rpc/cards/due` then served that card first again.

Related: TASK-164 (the due query has no `due <= now` predicate) and TASK-165 (the response cannot state its real size or a next-review time) read the same column. All three are one design question about what `due` means; whoever starts one should read the other two.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The retention the desk previews at is the retention the write schedules at, and a test pins the agreement by calling both sides (no source-text assertion).
- [x] #2 The days-elapsed the preview assumes is stated, and either matches the server or the preview stops implying a fresh card for an overdue one.
- [x] #3 No surface prints an interval below one day: the review branch of `previewIntervals` gets the floor the new-card branch has, covered in `packages/srs` tests with a low-stability review card.
- [x] #4 What an `again` means at date granularity is decided and recorded on this task before implementing: store time-of-day in `due`, or say "later today" instead of 0d. TASK-164 and TASK-165 read the same column, so the three land on one answer.
- [x] #5 No new user-visible string contains an em dash (R-02).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. One arithmetic in @manobu/srs, used by both sides: add `scheduleDays(interval) = Math.max(1, Math.floor(capInterval(interval)))`, and move `daysElapsedSince(due, now)` out of apps/server/src/services/grading.ts:45 into @manobu/srs so the desk and the write compute elapsed time identically (AC#2).
2. `previewIntervals` becomes the writer's math: drop the demo override at packages/srs/src/index.ts:190 (returns fixed 1/4/12/28 for stability~10 at R=0.9, which is why the desk says 12d while the write stores 13d) and the `fuzzInterval` drift at :196-:199. Both branches go through `scheduleDays`. Delete `fuzzInterval`: the write never fuzzed, so its only consumer was the drift being removed.
3. The retention reaches the write: `GradeInputSchema` gains `desiredRetention` (clamp 0.7..0.97, default 0.9) and exports RETENTION_MIN/RETENTION_MAX, which apps/desktop/src/lib/settings.ts then uses instead of its own copy of the bounds.
4. grading.ts schedules at that retention (`nextStates(previous, retention, daysElapsed)`, due = today + `scheduleDays`); the legacy route schema and rpc.ts pass it through; routes/review.tsx sends `settings.retention` (AC#1).
5. Desk preview: `previewGradeIntervals(previous, retention, dueAt, now)` passes the real days-elapsed. With the one-day floor the desk cannot print 0d, so no new user-visible string (AC#3, AC#5).
6. Tests: srs covers a low-stability review card (never below 1d) and retention monotonicity, replacing the demo vectors it pinned; a server test calls both sides over the wire (grade at 0.7 and 0.97, compare the written `due` with `previewIntervals` for the same state), no source-text assertion; desktop review tests updated for the new signature plus overdue-vs-fresh.
7. Gates and proof: bun run test, check-types, ultracite, boundaries, check:dox, mutation-gate --check, a new seam for "the write ignores the client retention", live walk on :3001, DOX pass for apps/server, apps/desktop and packages/srs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification (2026-09-28)

Gates, all green on the working tree:

- `bun run test` (root): 10/10 tasks. `apps/desktop` direct: 492 pass / 3 pre-existing conditional skips / 0 fail. `packages/srs`: 18 pass. `packages/agent`: 15 pass.
- `bun run check-types`: 14/14 (the server's real check is `tsc -p tsconfig.typecheck.json`).
- `bun x ultracite check`: clean over 544 files.
- `fallow dead-code --boundary-violations`: 0.
- `bun run check:dox`: complete.
- `bun scripts/mutation-gate.ts --check`: all 52 seam anchors resolve. Four new seams, each individually re-run and CAUGHT: `grade-write-ignores-client-retention`, `grade-write-ignores-elapsed-time`, `schedule-days-can-drop-below-one`, `desk-drops-retention-from-the-request`.

Live walk, the real app (Vite :3001 -> API :4317, headless chromium over CDP, screenshots `/tmp/t166-shot-desk-0.7.png`, `/tmp/t166-shot-after-grade.png`). Three cards were seeded into `local.db` for the walk (a fresh review card at stability 10, an overdue review card 14 days past due at stability 29, and a new card); the DB was restored afterwards and verified byte-for-byte equal to the pre-walk snapshot on the `cards` and `revlog` tables.

- Settings retention set to 0.7. Header read `Review · FSRS · Due at R ≤ 70% · 3 cards due · 3 total`, so the slider reaches the copy.
- The overdue card (靴, D=5.00 S=29.00) printed `Again / 25d`, `Hard / 160d`, `Good / 351d`, `Easy / 365d`. Pressing Good stored `due = 2027-09-14`, which is today + 351 days exactly. That is AC#1 and AC#2 in one observation: the retention travelled, and the 14 days it actually waited were used (a fresh reading of the same state previews 353, not 351; at 0.9 the desk would have printed 37d).
- The next card (食べる, S=10) printed 8/55/121/226 at 0.7 and, after Good, the desk advanced to the new card with 2 cards left in the queue. Pressing Again on it printed 8d and stored `due = 2026-10-06` (today + 8), `lapses: 1`, and the head moved on to the new card. AC#4 holds on the live surface: no grade returned the rated card to the head.
- No button printed `0d` anywhere, including the new card (`Again / 1d`). AC#3 and AC#5 hold as shipped.
- Legacy route twin over HTTP (`POST /api/cards/grade`): `good` at 0.9 on a new card stored today+2 (the preview's 2.3065 floored); an omitted `desiredRetention` produced the same day as an explicit 0.9; `desiredRetention: 0.5` returned 400; `easy` at 0.7 from the real prior state `{difficulty:4.8, stability:5.6178}` stored today+127 and `previewIntervals` for that same state prints 127. Route and RPC validate the identical schema.

## Findings recorded, not fixed

1. `apps/desktop/src-tauri/src/fsrs.rs:56` (`fsrs_preview`) still carries the same demo shortcut the TS engine lost: under `cfg!(debug_assertions)` it returns 1/4/12/28 for stability within 5 of 10 at retention ~0.9. Nothing calls it: no TS file in `apps/desktop/src` references `fsrs_preview`, so it cannot print a day the desk shows. It is a latent divergence in a dead path, in a Rust crate with its own fmt gate, so it is out of this task's blast radius. Worth deleting with the dead Tauri FSRS surface rather than patching in place.
2. The drill path (`apps/server/src/services/item-grading.ts`) still grades at `DEFAULT_RETENTION` from the contract. Deliberate: no drill surface previews an interval, so there is nothing to disagree with, and the value is now an explicit caller argument rather than a constant inside the writer. If the drill ever shows a next-review day, it must carry the learner's retention the same way the desk does.
3. `apps/desktop/src/lib/settings.ts` no longer re-exports the retention band (`lint/style/noExportedImports`): the two consumers (`features/settings/settings.tsx`, `test/settings.test.ts`) import `RETENTION_MIN`/`RETENTION_MAX` from `@manobu/api-contract/schemas/cards` directly, which is the stronger form of the same fix: there is one place the numbers live.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-28 15:27
---
AC#4 decision, recorded before implementing: `cards.due` stays day-granular, and no grade may schedule below one whole day.

Why not time-of-day: TASK-164 made the day-granular text column load-bearing. `selectDueQueue` compares it lexicographically against `isoDay(now)` (apps/server/src/services/due-queue.ts), so a `due` of "2026-09-28T03:00:00Z" sorts ABOVE "2026-09-28" and an again-card would silently stop being served today for a reason nobody chose. TASK-165's header reads the same column.

Why the real symptom is not the sub-day interval: the desk's session IS the fetched due order (apps/desktop/src/routes/review.tsx:68, TASK-155 decision A) and a grade invalidates ["cards","due"] (apps/desktop/src/lib/cards.ts:66), so a card left at due=today stays the head and the learner grades it twice. That is the cycling the live walk showed.

So the one-day floor goes into the writer, not only the preview. AC#3 read literally (floor the review branch of previewIntervals only) would manufacture the opposite lie: the button prints "1d" while the write stores today. Keeping AC#1 true is what pins AC#3.

Consequences, stated plainly:
- An `again` card comes back tomorrow, not in minutes. Day granularity cannot express a learning step; this is the cost, and it is the same answer TASK-165 gives for the header.
- No surface can then print "0d", so no new copy string is needed and AC#5 holds by construction.
- `hard` on a new card (1.29d) and `again` (0.21d) both schedule 1 day. Coarse, but both sides agree on it.
---

created: 2026-09-28 16:05
---
AC evidence, each criterion against the check that pins it:

#1 The retention the desk previews at is the retention the write schedules at. `packages/srs::previewIntervals` and `apps/server/src/services/grading.ts` now call the same `nextStates` + `scheduleDays`, and `desiredRetention` is a required argument of the writer, carried by `GradeInputSchema`. Pinned by `apps/server/test/grade-loop.test.ts` calling both sides over the wire (grade at 0.7 and at 0.97, compare the stored `due` with `previewIntervals` for the same state), never by reading source text. Live: the desk at R=0.7 printed Good/351d on the overdue card and the write stored today+351. Seams `grade-write-ignores-client-retention` and `desk-drops-retention-from-the-request` both CAUGHT.

#2 The days-elapsed assumption is stated and matches. `daysElapsedSince` moved into `@manobu/srs` and the desk passes the row's own `dueAt` (`previewGradeIntervals(previous, retention, dueAt, now)`), so the preview no longer assumes a fresh card. Pinned by the overdue test in `grade-loop.test.ts` (row pushed 14 days back at stability 29: the stored day must equal the waited-day preview and must differ from the fresh one) and by `apps/desktop/test/review.test.ts` (`late[3] < fresh[3]`). Seam `grade-write-ignores-elapsed-time` is CAUGHT only because of that overdue row; without it the mutation was a no-op and survived.

#3 No surface prints below one day. `scheduleDays` floors at `MIN_SCHEDULE_DAYS = 1` and both the writer and the preview go through it, so the floor cannot be a preview-only lie. Covered in `packages/srs/test/fsrs-golden.test.ts` with a low-stability review card (`{difficulty:5, stability:0.5}`) and in the desktop preview test. Seam `schedule-days-can-drop-below-one` CAUGHT. Live: the new card's Again button read `1d`, no `0d` anywhere.

#4 Decided and recorded before implementing (see the earlier comment on this task): `cards.due` stays day-granular and no grade may schedule below one whole day, with the reason (TASK-164's lexicographic day compare would stop serving a time-stamped again-card). Consequence stated there too: an `again` card comes back tomorrow, not in minutes. Live: grading `again` stored today+8 for a stability-10 card and the desk moved on to the next card; the AC#4 loop in `grade-loop.test.ts` asserts all four grades leave `due > today`.

#5 No new user-visible string, so nothing to add an em dash to: the fix removed `0d` rather than describing it. The only copy touched was none; `packages/ui/test/copy-snapshot.test.ts` remains green.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The three answers to "what day does this card come back" are now one answer. `@manobu/srs` owns the day arithmetic: `scheduleDays(interval) = max(MIN_SCHEDULE_DAYS, floor(capInterval(interval)))` plus `daysElapsedSince(due, now)`, and both the server writer (`apps/server/src/services/grading.ts`) and the desk preview (`apps/desktop/src/lib/review.ts` -> `previewIntervals`) call them, so the number on the button and the day in `cards.due` cannot be computed differently.

Two lies were deleted rather than patched. The demo override in `previewIntervals` (fixed 1/4/12/28 for stability near 10 at R=0.9) is gone: it fired only at exactly the default retention, which is why the desk said 12d while the write stored 13d and why the preview jumped discontinuously around 0.9. `fuzzInterval` is gone too: the write never fuzzed, so its only remaining consumer was the drift being removed.

The learner's retention now travels on the wire. `GradeInputSchema` gained a required-by-inference `desiredRetention` bounded by the exported band (0.7..0.97, default 0.9), `gradeCardById`/`applyGrade`/`fsrsTransition` take it as an argument with no constant inside the service, and the desk sends `settings.retention` with every grade. `apps/desktop/src/lib/settings.ts` imports the band from the contract instead of holding its own copy, and the legacy `POST /api/cards/grade` route validates the same schema object as the oRPC handler (its private `GradeSchema` duplicate is deleted), so neither the twin routes nor the two ends of the slider can drift again.

What an `again` means at day granularity is decided and recorded: `due` stays a `YYYY-MM-DD` text column and no grade schedules below one whole day, so an again-card comes back tomorrow instead of returning to the head of the queue minutes later. That is the cycling the live walk showed, and the floor lives in the writer, not only the preview, because a preview-only floor would have manufactured the opposite lie.

Side effects worth knowing: the drill path still grades at the contract default (no drill surface previews an interval, so there is nothing to disagree with, and the value is now an explicit argument); `packages/agent`'s illustrative `vocabSrsDueCards` number moved from the demo 12 to the real 13; and the Tauri `fsrs_preview` still carries the same demo shortcut in a path nothing calls, noted for the dead-surface cleanup rather than patched here.

Gates: root `bun run test` 10/10, `check-types` 14/14, `ultracite check` clean, boundaries 0, `check:dox` complete, mutation gate 52 anchors resolving with four new seams each verified CAUGHT. Verified live on the running app (Vite :3001 against the API on :4317, headless chromium over CDP) at retention 0.7 with a fresh card, an overdue card and a new card: printed days equalled stored days in every case, `0d` appeared nowhere, an `again` left the queue, and the out-of-band retention was rejected with 400. The live `local.db` was restored to its pre-walk snapshot and diffed.
<!-- SECTION:FINAL_SUMMARY:END -->
