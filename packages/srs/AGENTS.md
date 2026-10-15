# packages/srs

## Purpose

- FSRS (Free Spaced Repetition Scheduler) math: 21-parameter FSRS-6 algorithm — next-states computation, stability/difficulty/retrievability, interval preview, leech gate, snooze, vacation pause.

## Ownership

- Project contributors (original port: TASK-1.3).

## Local Contracts

- `nextStates(previous: MemoryState | null, desiredRetention, daysElapsed)` → `{again, hard, good, easy}` intervals.
- `previewIntervals(previous, desiredRetention, daysElapsed)` — the four grades' scheduled DAYS, through the same `scheduleDays` the server write uses (TASK-166). No fuzz and no demo shortcut: both were deleted because each printed a day the write could not store (the demo branch fired only at exactly `desiredRetention = 0.9`, so the preview jumped discontinuously around it).
- `currentRetrievability(state, daysElapsed)` — forgetting curve value `R`.
- `scheduleDays(interval)` — `max(MIN_SCHEDULE_DAYS, floor(capInterval(interval)))`. The one day arithmetic for both sides of the wire: `due` is day-granular, and the desk sessions cards from `due <= today`, so a sub-day schedule puts the rated card straight back at the head.
- `daysElapsedSince(due, now)` — whole days a card has waited, clamped at 0. Lives here because the preview and the write must agree on it (TASK-166 AC#2).
- `capInterval(interval, maxDays=365)` — interval cap.
- `applyLoadBalancer(interval, dueCountMap, dueDateStr)` — push +1d if a date has >20 cards.
- `shouldMarkLeech(lapses)` — true when `lapses > 4`.
- `snoozeDueDate(currentDue, days)` / `vacationPause(days)` — date helpers.
- Public constants: `DEFAULT_PARAMETERS` (21-element readonly tuple), `FSRS6_DECAY = 0.1542`, `MIN_SCHEDULE_DAYS = 1`.
- Consumers: `apps/desktop/src/lib/review.ts` (TASK-1.15), `apps/desktop/src/lib/kanji.ts` indirectly via `apps/desktop/src/lib/queue.ts`. Rust port in `apps/desktop/src-tauri/src/fsrs.rs` exposes `fsrs_default_parameters`, `fsrs_preview`, `fsrs_next_states`, `fsrs_optimize`, `fsrs_snooze`, `fsrs_vacation`, `fsrs_should_leech`, `fsrs_compute_optimal`, `fsrs_reschedule`.

## Work Guidance

- Treat `DEFAULT_PARAMETERS` as immutable; the 21 numbers are FSRS-6 defaults and changing them reshapes every review schedule.
- Any change to `scheduleDays` moves the day the server stores AND the day the desk previews — they call the same function on purpose. Never re-introduce a second rounding path (fuzz, a demo override, `Math.round`) on one side only; that divergence is TASK-166.

## Verification

- `bun --filter @manobu/srs test`.
- `cargo test` in `crates/jlpt-mcp` exercises the Rust parity golden; the TS port here stays in sync with the JSON schema in `packages/japanese/data/`.

## Child DOX Index

_None._