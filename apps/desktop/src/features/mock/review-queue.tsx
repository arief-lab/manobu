/*
 * Review Queue (SCR-12) compound component.
 *
 * Per spec §SCR-12:
 *   - Queue due at R ≤ Desired Retention, batch 20 (144+ hidden).
 *   - Card shows D/S/R behind Advanced (Settings → FSRS Advanced).
 *   - Grades show intervals BEFORE press:
 *     Again 1d / Hard 4d / Good 12d / Easy 28d (Good default).
 *   - Empty state: "No cards due · great work!" plus the day the next card is
 *     scheduled for, which the due response now carries (TASK-165).
 *
 * Composition (Vercel pattern):
 *   <ReviewQueue>            provider
 *     <ReviewQueue.Header      Review · FSRS
 *     <ReviewQueue.Batch       visible 20 + {hidden} hidden
 *     <ReviewQueue.Card        current card front
 *     <ReviewQueue.Grades      Again/Hard/Good/Easy with previews
 *     <ReviewQueue.Empty       empty state
 *   </ReviewQueue>
 */

import { type CopyKey, t } from "@manobu/ui/lib/copy";
import { cn } from "@manobu/ui/lib/utils";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import {
  batchNext,
  gradeLabel,
  nextReviewDuration,
  previewGradeIntervals,
  type ReviewBatch,
  type ReviewCard,
} from "@/lib/review";

interface ReviewState {
  batch: ReviewBatch;
  current: ReviewCard | null;
  /** Every card the learner owns, from the server's count (TASK-165). The
   *  header's second number: it used to be the same page length as the first. */
  deckCount: number;
  /** The R the queue is tuned to (Settings → retention). Drives the header
   *  "Due at R ≤ {pct}%" so the desk states the target the grades use. */
  desiredRetention: number;
  grade: (g: 1 | 2 | 3 | 4) => void;
  /** The last grade write failed, so the desk says so instead of letting
   *  the next front silently stand in for an answer that was not saved. */
  gradeFailed: boolean;
  intervals: Record<1 | 2 | 3 | 4, number>;
  /** TASK-36 AC4: the just-graded card · the queue must confirm what you
      rated (reading + interval), not silently flash to the next front.
      TASK-161: it also must confirm the card it is standing under, so the
      record carries the `cardId` it describes and the strip renders only
      while that card is still the head. */
  lastGraded: { cardId: number; grade: 1 | 2 | 3 | 4; reading: string } | null;
  /** The next day the queue holds a card for, or null when nothing is
   *  scheduled. What the empty state's duration is computed from (TASK-165). */
  nextDue: string | null;
  /** A grade write is in flight: the served list has not moved yet, so the
   *  same head card is still on screen and must not be gradeable twice. */
  pending: boolean;
  showAdvanced: boolean;
}

const Scope = createContext<ReviewState | null>(null);

const useReview = (): ReviewState => {
  const ctx = useContext(Scope);
  if (!ctx) {
    throw new Error("useReview must be used within ReviewQueue");
  }
  return ctx;
};

const Header = () => {
  const { batch, deckCount, desiredRetention } = useReview();
  // The header states the SAME R the grade previews are computed against
  // (2026-09-14 state audit: it was hardcoded to 90 while Settings could
  // hold any retention · the desk lied about its own target).
  const pct = Math.round(desiredRetention * 100);
  return (
    <header
      className="rounded-card border-2 border-border p-3"
      data-testid="review-header"
    >
      <h1 className="font-semibold text-lg">
        {t("review.header", {
          due: batch.dueCount,
          pct,
          total: deckCount,
        })}
      </h1>
      <p className="text-muted-foreground text-xs" data-testid="review-badge">
        {t("review.badge")}
      </p>
    </header>
  );
};

const Batch = () => {
  const { batch } = useReview();
  if (batch.hidden === 0) {
    return null;
  }
  return (
    <p
      aria-live="polite"
      className="rounded-card border-2 border-border p-2 text-sm"
      data-hidden={batch.hidden}
      data-testid="review-batch"
    >
      {t("review.batch", { hidden: batch.hidden })}
    </p>
  );
};

const Card = () => {
  const { current, showAdvanced } = useReview();
  if (!current) {
    return null;
  }
  return (
    <article
      aria-label="Review card"
      className="rounded-card border-2 border-border p-3"
      data-testid="review-card"
    >
      <p className="font-mono text-lg">
        {current.jp ?? `vocab ${current.vocabId}`}
      </p>
      {showAdvanced ? (
        <output
          aria-label="Memory state"
          className="block text-muted-foreground text-xs"
          data-testid="review-card-memory"
        >
          D={current.memory?.difficulty?.toFixed(2) ?? "–"} · S=
          {current.memory?.stability?.toFixed(2) ?? "–"}
        </output>
      ) : null}
    </article>
  );
};

const Grades = () => {
  const { current, grade, gradeFailed, intervals, pending } = useReview();
  if (!current) {
    return null;
  }
  const grades: readonly (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
  const gradeCopyKey = (g: 1 | 2 | 3 | 4): CopyKey => {
    if (g === 1) {
      return "grade.again";
    }
    if (g === 2) {
      return "grade.hard";
    }
    if (g === 3) {
      return "grade.good";
    }
    return "grade.easy";
  };
  return (
    <>
      <fieldset
        aria-label="Grade buttons"
        className="flex flex-wrap gap-2"
        data-pending={pending}
        data-testid="review-grades"
      >
        {grades.map((g) => {
          const interval = intervals[g];
          const onClick = () => {
            grade(g);
          };
          return (
            <button
              aria-pressed={g === 3}
              /* Each grade is a material, not a traffic light: rust (decay)
               * → kerria gold (effort) → pine (healthy) → ai (the work). */
              className={cn(
                "rounded-card border-2 border-border px-3 py-1 text-sm",
                g === 1 && "text-destructive",
                g === 2 && "text-warning",
                g === 3 && "text-success",
                g === 4 && "text-primary"
              )}
              data-card={current.cardId}
              data-default={g === 3}
              data-grade={g}
              data-interval={interval}
              data-label={gradeLabel(g)}
              data-testid="review-grade"
              disabled={pending}
              key={g}
              onClick={onClick}
              type="button"
            >
              {t(gradeCopyKey(g), { interval })}
            </button>
          );
        })}
      </fieldset>
      {/* The desk's own write failing is the state the copy deck names
       * `review.save_toast.error` for. Pressing a grade again is the retry:
       * the buttons re-enable when the write settles. */}
      {gradeFailed ? (
        <p
          aria-live="assertive"
          className="text-destructive text-xs"
          data-testid="review-grade-failed"
        >
          {t("review.save_toast.error")}
        </p>
      ) : null}
    </>
  );
};

/* TASK-155: this rendered unconditionally, so a desk with a live card in front
 * of the learner also said "No cards due". It speaks only when the queue really
 * is empty. TASK-165 gave the due response a `nextDue`, so the duration the
 * longer `review.empty` variant promises is now computed from the day the
 * server actually scheduled rather than invented; with no card waiting there is
 * no time to name and the duration-free string is the honest one. */
const Empty = () => {
  const { batch, nextDue } = useReview();
  if (batch.cards.length > 0) {
    return null;
  }
  return (
    <p
      aria-live="polite"
      className="rounded-card border-2 border-border p-3 text-sm"
      data-testid="review-empty"
    >
      {nextDue === null
        ? t("review.empty.first_run")
        : t("review.empty", { duration: nextReviewDuration(nextDue) })}
    </p>
  );
};

interface ReviewQueueProps {
  /** TASK-155: how many of the fetched queue this session shows. The desk
   *  owns the choice as a URL param; the compound only slices. */
  batchSize?: number;
  cards: readonly ReviewCard[];
  children: ReactNode;
  /** TASK-165: the two numbers the header prints come from the due response,
   *  not from `cards`. There is no default for either, because the default that
   *  stood in was this session's page length, which is how a learner holding a
   *  card was told "0 cards due · 0 total". */
  deckCount: number;
  desiredRetention?: number;
  dueCount: number;
  /** The last `onGrade` write failed. The compound cannot know this itself:
   *  the caller owns the request. */
  gradeFailed?: boolean;
  /** The next day the queue holds a card for, or null when nothing waits. */
  nextDue: string | null;
  onGrade?: (g: 1 | 2 | 3 | 4, card: ReviewCard) => void;
  /** True while the `onGrade` write is in flight, which gates the buttons. */
  pending?: boolean;
  showAdvanced?: boolean;
}

const ReviewQueueRoot = ({
  batchSize = 20,
  cards,
  children,
  deckCount,
  desiredRetention = 0.9,
  dueCount,
  gradeFailed = false,
  nextDue,
  onGrade,
  pending = false,
  showAdvanced = false,
}: ReviewQueueProps) => {
  const batch = useMemo(
    () => batchNext(cards, { batchSize, dueCount }),
    [batchSize, cards, dueCount]
  );
  /* TASK-155 decision A: the fetched due-order IS the session, so the head
   * is the current card and there is no local index to keep in step with the
   * server. A grade writes, invalidates ["cards","due"], and the next head is
   * whatever the sidecar now says is earliest. */
  const current = batch.cards[0] ?? null;
  /* TASK-166: the preview is the write's arithmetic, so it needs the row's own
   * `due`. An overdue card grows less than a fresh one, and assuming 0 days
   * elapsed printed an interval the write would never store. With no card the
   * Empty branch renders, so the fallback date is only there to be accepted by
   * the math, never to be shown. */
  const intervals = useMemo(
    () =>
      previewGradeIntervals(
        current?.memory ?? null,
        desiredRetention,
        current?.dueAt ?? new Date().toISOString().slice(0, 10)
      ),
    [current, desiredRetention]
  );
  const [lastGraded, setLastGraded] = useState<ReviewState["lastGraded"]>(null);
  const grade = useCallback(
    (g: 1 | 2 | 3 | 4) => {
      if (!current) {
        return;
      }
      onGrade?.(g, current);
      setLastGraded({
        cardId: current.cardId,
        grade: g,
        reading: current.reading ?? "",
      });
    },
    [current, onGrade]
  );
  const ctx: ReviewState = {
    batch,
    current,
    deckCount,
    desiredRetention,
    grade,
    gradeFailed,
    intervals,
    lastGraded,
    nextDue,
    pending,
    showAdvanced,
  };
  return <Scope.Provider value={ctx}>{children}</Scope.Provider>;
};

const GRADE_CONFIRM: Record<1 | 2 | 3 | 4, string> = {
  1: "✗ Again",
  2: "→ Hard",
  3: "✓ Good",
  4: "✓✓ Easy",
};

/** The confirmation strip's lifecycle rule (TASK-161): the just-graded card is
 * the ONLY card it may speak over. Under TASK-155 there is no local index; the
 * head is whatever the server now returns earliest, so a grade leaves the strip
 * set while the rated card is still on screen and this gate drops it the moment
 * a different card takes the front. Without it the strip outranks the card:
 * "✓ Good · たべる" over 東. A seam because the desk has no DOM env to mount a
 * state transition; `confirmFor` is the whole decision. */
const confirmFor = (
  lastGraded: ReviewState["lastGraded"],
  currentCardId: number | null
): { grade: 1 | 2 | 3 | 4; reading: string } | null => {
  if (lastGraded === null || currentCardId === null) {
    return null;
  }
  if (lastGraded.cardId !== currentCardId) {
    return null;
  }
  return { grade: lastGraded.grade, reading: lastGraded.reading };
};

const LastGraded = () => {
  const { current, lastGraded } = useReview();
  const confirmed = confirmFor(lastGraded, current?.cardId ?? null);
  if (!confirmed) {
    return null;
  }
  const copy = GRADE_CONFIRM[confirmed.grade];
  return (
    <p
      aria-live="polite"
      className="text-muted-foreground text-xs"
      data-testid="review-last-graded"
    >
      {copy} · {confirmed.reading}
    </p>
  );
};

/** Exported for the no-DOM test that pins the confirmation lifecycle; same
 * reason as `confirmFor`. Not part of the rendered compound. */
export const __test__ = { confirmFor };

export const ReviewQueue = Object.assign(ReviewQueueRoot, {
  Batch,
  Card,
  Empty,
  Grades,
  Header,
  LastGraded,
});
