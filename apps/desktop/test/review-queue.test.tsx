import { describe, expect, it } from "bun:test";
import type {
  DueOutput,
  GradeOutput,
} from "@manobu/api-contract/schemas/cards";
import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReviewQueue,
  __test__ as reviewQueueTest,
} from "@/features/mock/review-queue";
import { cardsDueQueryOptions, gradeCardMutationOptions } from "@/lib/cards";
import { type ReviewCard, reviewCardFromDueCard } from "@/lib/review";
import { makeDueCard } from "./helpers/due-card";

/*
 * The desk as it renders (TASK-155). `renderToStaticMarkup` is the desktop's
 * DOM-free render harness, same as worksheet.test.tsx: enough to pin which
 * card is in front of the learner and which surfaces gate on it, which no
 * pure-function test of `batchNext` can see.
 */

const card = (over: Partial<ReviewCard> & { cardId: number }): ReviewCard => ({
  dueAt: "2026-09-05",
  memory: null,
  vocabId: over.cardId,
  ...over,
});

/** A day-granular `due` N UTC days out, the shape `cards.due` stores. Computed
 * rather than fixed so the desk's own "today" cannot lag it at a month end. */
const dayFromNow = (offset: number): string => {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
};

/** The empty desk's promise, with the duration the due response now supplies. */
const NEXT_REVIEW_RE = /next review is in \d+d/;

/* The queue facts the desk is told about, beside the rows it renders. These
 * defaults reproduce "this page IS the queue", which is the case that says
 * nothing about TASK-165; the count tests pass the real numbers. */
const desk = (
  cards: readonly ReviewCard[],
  state: {
    deckCount?: number;
    dueCount?: number;
    gradeFailed?: boolean;
    nextDue?: string | null;
    pending?: boolean;
  } = {}
): string => {
  const {
    deckCount = cards.length,
    dueCount = cards.length,
    nextDue = null,
    ...rest
  } = state;
  return renderToStaticMarkup(
    <ReviewQueue
      cards={cards}
      deckCount={deckCount}
      dueCount={dueCount}
      nextDue={nextDue}
      {...rest}
    >
      <ReviewQueue.Header />
      <ReviewQueue.Card />
      <ReviewQueue.LastGraded />
      <ReviewQueue.Grades />
      <ReviewQueue.Empty />
    </ReviewQueue>
  );
};

const HEAD = [
  card({ cardId: 1, jp: "食べる", reading: "たべる" }),
  card({ cardId: 2, jp: "東", reading: "ひがし" }),
];

describe("ReviewQueue desk", () => {
  it("puts the first served card in front and grades that card", () => {
    const markup = desk(HEAD);
    expect(markup).toContain("食べる");
    expect(markup).not.toContain("東");
    expect(markup.match(/data-card="1"/g)).toHaveLength(4);
    expect(markup).not.toContain('data-card="2"');
  });

  it("never says the queue is empty while a card is in front of the learner", () => {
    expect(desk(HEAD)).not.toContain("review-empty");
    expect(desk([])).toContain("review-empty");
  });

  it("states an empty queue with nothing scheduled without a next-review time", () => {
    const markup = desk([]);
    expect(markup).toContain("great work");
    expect(markup).not.toContain("next review");
    expect(markup).not.toContain("{duration}");
    expect(markup).not.toContain("review-grades");
  });

  it("names the day the next review is scheduled for (TASK-165)", () => {
    // TASK-155 withheld this claim because the response carried no next-due
    // day to compute it from. It does now, so the empty desk says when.
    const markup = desk([], { nextDue: dayFromNow(3) });
    expect(markup).toContain("great work");
    expect(markup).toMatch(NEXT_REVIEW_RE);
    expect(markup).not.toContain("{duration}");
  });

  it("prints the queue's real size, not the page it happens to show (TASK-165)", () => {
    // Both header numbers used to be the same page length interpolated twice:
    // a learner with 24 due on a 20-row page was told "20 due · 20 total".
    const page = Array.from({ length: 20 }, (_, i) => card({ cardId: i + 1 }));
    const markup = desk(page, { deckCount: 140, dueCount: 24 });
    expect(markup).toContain("24 cards due");
    expect(markup).toContain("140 total");
    expect(markup).not.toContain("20 cards due");
    expect(markup).not.toContain("20 total");
  });

  it("previews whole days on a brand-new card, not NaN", () => {
    // A `new` row carries the schema's default D/S (5 / 0). Live run
    // 2026-09-28 rendered "Again NaNd" on every ungraded card until the
    // mapping stopped treating an unscheduled row as a memory state.
    const markup = desk([
      reviewCardFromDueCard(makeDueCard({ stability: 0, state: "new" })),
    ]);
    const shown = [...markup.matchAll(/data-interval="(\d+)"/g)].map((m) =>
      Number(m[1])
    );
    expect(shown).toHaveLength(4);
    for (const days of shown) {
      expect(days).toBeGreaterThan(0);
    }
  });

  it("gates every grade button while the write is in flight", () => {
    const busy = desk(HEAD, { pending: true });
    expect(busy).toContain('data-pending="true"');
    expect(busy.match(/disabled=""/g)).toHaveLength(4);
    expect(desk(HEAD)).not.toContain("disabled");
  });

  it("names a failed grade write instead of leaving it silent", () => {
    const failed = desk(HEAD, { gradeFailed: true });
    expect(failed).toContain("review-grade-failed");
    expect(failed.toLowerCase()).toContain("retry");
    expect(desk(HEAD)).not.toContain("review-grade-failed");
  });
});

describe("grade write cache contract", () => {
  it("invalidates the due queue the desk reads its session from", () => {
    const queryClient = new QueryClient();
    const served: DueOutput = {
      cards: [],
      deckCount: 0,
      dueCount: 0,
      nextDue: null,
    };
    queryClient.setQueryData(cardsDueQueryOptions.queryKey, served);

    const graded: GradeOutput = {
      card: {
        createdAt: "2026-09-01",
        difficulty: 5,
        due: "2026-09-17",
        id: 1,
        isLeech: false,
        jp: "食べる",
        lapses: 0,
        level: "n5",
        reading: "たべる",
        stability: 12,
        state: "review",
        vocabId: 10,
      },
    };
    gradeCardMutationOptions(queryClient).onSuccess?.(
      graded,
      { cardId: 1, desiredRetention: 0.9, grade: "good" },
      undefined,
      { client: queryClient, meta: undefined }
    );

    // The card's own new due date is the server's to report; the desk's job
    // is to ask again, which is what `isInvalidated` records.
    expect(
      queryClient.getQueryState(cardsDueQueryOptions.queryKey)?.isInvalidated
    ).toBe(true);
  });
});

const { confirmFor } = reviewQueueTest;

describe("confirmation strip lifecycle (TASK-161)", () => {
  const graded = { cardId: 1, grade: 3 as const, reading: "たべる" };

  it("confirms the card the learner just rated while it is still in front", () => {
    // TASK-36 AC4: clearing the strip must not go silent. The head has not
    // moved yet (the write is still settling), so the strip speaks.
    expect(confirmFor(graded, 1)).toEqual({ grade: 3, reading: "たべる" });
  });

  it("drops the confirmation before the next card's front shows", () => {
    // The bug: `lastGraded` was set once and never reset, so "✓ Good · たべる"
    // stood over 東. The strip may not describe a card other than the head.
    expect(confirmFor(graded, 2)).toBeNull();
  });

  it("stays gone for an empty queue and an untouched desk", () => {
    expect(confirmFor(graded, null)).toBeNull();
    expect(confirmFor(null, 1)).toBeNull();
  });
});
