/*
 * Review queue (spec §SCR-12) — pure-TS queue slicing + interval previews.
 *
 *   - `batchNext(cards, { dueCount, batchSize })` — the visible batch, how many
 *     the queue holds back, and the queue's real size (TASK-165: the count
 *     comes from the server's read, never from this page's length).
 *   - `previewGradeIntervals(previous, desiredRetention, dueAt)` — wraps
 *     `@manobu/srs` `previewIntervals` so the UI can show the interval each
 *     grade will schedule BEFORE the user presses it. It is the same
 *     `nextStates` + `scheduleDays` the grade write runs, at the retention the
 *     request will carry and the elapsed days the row's `due` implies, so the
 *     button cannot promise a day the card will not get (TASK-166).
 *
 * The FSRS engine itself lives in `@manobu/srs` (Rust port) and is also
 * exposed to JS via `apps/desktop/src-tauri/src/fsrs.rs` for live state —
 * this lib only wraps the *pure* math for the settings preview slider.
 *
 * TASK-155: the queue is served by `GET /cards/due`, so the wire row →
 * `ReviewCard` mapping and the grade → wire-name translation are here too.
 * They are pure so the desk can be proven without a DOM (the desktop has no
 * DOM test env).
 */

import type { DueCard, GradeInput } from "@manobu/api-contract/schemas/cards";
import {
  daysElapsedSince,
  type Grade,
  type MemoryState,
  previewIntervals,
} from "@manobu/srs";

export interface ReviewCard {
  cardId: number;
  dueAt: string;
  /** TASK-40 AC6: vocab snapshot for display (undefined → "vocab {id}"). */
  jp?: string;
  memory: MemoryState | null;
  reading?: string;
  vocabId: number;
}

export interface ReviewBatch {
  cards: readonly ReviewCard[];
  /**
   * How many are due, as the server counted it (the response's `dueCount`), not
   * `cards.length`. The page is capped at 20 rows, so a slice could never
   * say "200 cards due", and "total" was the ambiguous word that let one page
   * length fill both numbers in the header (TASK-165).
   */
  dueCount: number;
  /** Due rows this session leaves out: the whole queue minus what is shown. */
  hidden: number;
}

export const batchNext = (
  cards: readonly ReviewCard[],
  queue: { batchSize?: number; dueCount: number }
): ReviewBatch => {
  const visible = cards.slice(0, queue.batchSize ?? 20);
  return {
    cards: visible,
    dueCount: queue.dueCount,
    hidden: Math.max(0, queue.dueCount - visible.length),
  };
};

/**
 * The desk's "next review is in {duration}" value: whole days from today to the
 * next day the queue holds a card for. Day arithmetic, not hour arithmetic,
 * because `cards.due` is day-granular: a card scheduled for tomorrow is a day
 * away even at 11pm, and a floor would print "0d", which is what a card due
 * today says. The floor of 1 also covers the client's UTC day rolling over after
 * the read, when the response's future day has become the client's today.
 */
export const nextReviewDuration = (
  nextDue: string,
  now = new Date()
): string => {
  const dayMs = 86_400_000;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const days = Math.ceil((Date.parse(`${nextDue}T00:00:00Z`) - today) / dayMs);
  return `${Math.max(1, days)}d`;
};

/**
 * The interval each grade button will print, in whole days.
 *
 * `dueAt` is not decoration: the same card previews a different interval when
 * it is late. `apps/server/src/services/grading.ts` grows stability by the
 * elapsed days it computes from this column, so a preview that assumed a
 * fresh card would print a longer interval than the write stores for every
 * overdue row (TASK-166 AC#2). One `daysElapsedSince` on both sides is what
 * keeps that honest.
 */
export const previewGradeIntervals = (
  previous: MemoryState | null,
  desiredRetention: number,
  dueAt: string,
  now = new Date()
): Record<Grade, number> =>
  previewIntervals(previous, desiredRetention, daysElapsedSince(dueAt, now));

export const gradeLabel = (
  grade: Grade
): "Again" | "Easy" | "Good" | "Hard" => {
  if (grade === 1) {
    return "Again";
  }
  if (grade === 2) {
    return "Hard";
  }
  if (grade === 3) {
    return "Good";
  }
  return "Easy";
};

/** `POST /cards/grade` names the grade the way the FSRS engine does. */
export const gradeRequestName = (grade: Grade): GradeInput["grade"] => {
  if (grade === 1) {
    return "again";
  }
  if (grade === 2) {
    return "hard";
  }
  if (grade === 3) {
    return "good";
  }
  return "easy";
};

/**
 * The whole grade request for one button press.
 *
 * The retention has to travel in it: it lives in this app's localStorage, the
 * write happens on the sidecar, and a server that cannot see it can only ever
 * schedule at its own constant. That made every setting but 0.9 print one day
 * on the button and store another (TASK-166 AC#1), so the value the desk
 * previews at and the value the request carries come from one call.
 */
export const gradeRequest = (
  card: ReviewCard,
  grade: Grade,
  desiredRetention: number
): GradeInput => ({
  cardId: card.cardId,
  desiredRetention,
  grade: gradeRequestName(grade),
});

/**
 * A `GET /cards/due` row → the desk's card. `jp`/`reading` are nullable on
 * the wire (a card whose vocab lookup missed) and optional here, so null
 * becomes absent and the card falls back to `vocab {id}` rather than
 * rendering "null".
 *
 * An ungraded row carries the schema's DEFAULT D/S (5 / 0), not a real
 * memory state: `previewIntervals` divides by stability, so passing it
 * through prints "Again NaNd" on every new card. `state === "new"` is the
 * engine's own test for this, and `apps/server/src/services/grading.ts:56`
 * grades such a row from `null`, so the desk previews the same thing it will
 * get written.
 */
export const reviewCardFromDueCard = (card: DueCard): ReviewCard => ({
  cardId: card.id,
  dueAt: card.due,
  jp: card.jp ?? undefined,
  memory:
    card.state === "new"
      ? null
      : { difficulty: card.difficulty, stability: card.stability },
  reading: card.reading ?? undefined,
  vocabId: card.vocabId,
});

export const __test__ = { gradeLabel };
