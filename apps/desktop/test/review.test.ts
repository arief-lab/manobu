import { describe, expect, it } from "bun:test";
import {
  batchNext,
  gradeLabel,
  gradeRequest,
  gradeRequestName,
  nextReviewDuration,
  previewGradeIntervals,
  type ReviewCard,
  reviewCardFromDueCard,
} from "@/lib/review";
import { makeDueCard } from "./helpers/due-card";

const makeCard = (vocabId: number): ReviewCard => ({
  cardId: vocabId,
  dueAt: "2026-09-05",
  memory: null,
  vocabId,
});

describe("batchNext", () => {
  it("slices the session and counts what the queue holds back", () => {
    const cards = Array.from({ length: 200 }, (_, i) => makeCard(i + 1));
    const result = batchNext(cards, { batchSize: 20, dueCount: 200 });
    expect(result.cards).toHaveLength(20);
    expect(result.hidden).toBe(180);
    expect(result.dueCount).toBe(200);
  });

  it("does not let the page decide how many are due (TASK-165)", () => {
    // The header printed `cards.length` twice, once as "due" and once as
    // "total". Three served rows out of a queue of 24 still means 24 due.
    const cards = [makeCard(1), makeCard(2), makeCard(3)];
    const result = batchNext(cards, { batchSize: 3, dueCount: 24 });
    expect(result.cards).toHaveLength(3);
    expect(result.dueCount).toBe(24);
    expect(result.hidden).toBe(21);
  });

  it("returns all when fewer than batchSize", () => {
    const cards = [makeCard(1), makeCard(2), makeCard(3)];
    const result = batchNext(cards, { batchSize: 20, dueCount: 3 });
    expect(result.cards).toHaveLength(3);
    expect(result.hidden).toBe(0);
    expect(result.dueCount).toBe(3);
  });

  it("returns empty when no cards", () => {
    const result = batchNext([], { batchSize: 20, dueCount: 0 });
    expect(result.cards).toHaveLength(0);
    expect(result.hidden).toBe(0);
    expect(result.dueCount).toBe(0);
  });
});

describe("nextReviewDuration", () => {
  const NOW = new Date("2026-09-29T21:30:00Z");

  it("counts whole days to the next scheduled day", () => {
    expect(nextReviewDuration("2026-10-02", NOW)).toBe("3d");
  });

  it("says 1d for tomorrow, not the hours that are left tonight", () => {
    // `cards.due` is day-granular. Hour arithmetic would print "0d" here, and
    // 0d is the claim a card due TODAY makes.
    expect(nextReviewDuration("2026-09-30", NOW)).toBe("1d");
  });

  it("never claims the next review is already due", () => {
    // The client's UTC day can roll over between the read and the render, which
    // makes the response's future day today's date locally.
    expect(nextReviewDuration("2026-09-29", NOW)).toBe("1d");
  });
});

describe("previewGradeIntervals", () => {
  const NOW = new Date("2026-09-28T12:00:00Z");

  it("forwards the learner's retention and the row's own due date", () => {
    // Both used to be fixed: the desk previewed at whatever `previewIntervals`
    // returned for a demo memory state, at 0 days elapsed, while the server
    // scheduled at the real elapsed time (TASK-166 AC#1 and AC#2).
    const previous = { difficulty: 5, stability: 10 };
    const fresh = previewGradeIntervals(previous, 0.9, "2026-09-28", NOW);
    const late = previewGradeIntervals(previous, 0.9, "2026-09-14", NOW);
    // An overdue card has lost retrievability, so the same grade grows its
    // stability less and comes back sooner than the fresh-card number says.
    expect(late[3]).toBeLessThan(fresh[3]);
    const loose = previewGradeIntervals(previous, 0.7, "2026-09-28", NOW);
    expect(loose[3]).toBeGreaterThan(fresh[3]);
  });

  it("never previews below one day", () => {
    const out = previewGradeIntervals(
      { difficulty: 5, stability: 0.5 },
      0.9,
      "2026-09-28",
      NOW
    );
    for (const grade of [1, 2, 3, 4] as const) {
      expect(out[grade]).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns sensible intervals for new cards (memory=null)", () => {
    const intervals = previewGradeIntervals(null, 0.9, "2026-09-28", NOW);
    expect(intervals[1]).toBeGreaterThanOrEqual(1);
    expect(intervals[4]).toBeGreaterThan(intervals[1]);
  });
});

describe("gradeLabel", () => {
  it("maps grade codes to names", () => {
    expect(gradeLabel(1)).toBe("Again");
    expect(gradeLabel(2)).toBe("Hard");
    expect(gradeLabel(3)).toBe("Good");
    expect(gradeLabel(4)).toBe("Easy");
  });
});

describe("gradeRequestName", () => {
  it("maps desk grade codes onto the names the wire accepts", () => {
    expect(gradeRequestName(1)).toBe("again");
    expect(gradeRequestName(2)).toBe("hard");
    expect(gradeRequestName(3)).toBe("good");
    expect(gradeRequestName(4)).toBe("easy");
  });

  it("stays aligned with gradeLabel, which the desk shows instead", () => {
    expect(gradeLabel(1).toLowerCase()).toBe(gradeRequestName(1));
    expect(gradeLabel(2).toLowerCase()).toBe(gradeRequestName(2));
    expect(gradeLabel(3).toLowerCase()).toBe(gradeRequestName(3));
    expect(gradeLabel(4).toLowerCase()).toBe(gradeRequestName(4));
  });
});

describe("gradeRequest", () => {
  it("carries the retention the desk previews at", () => {
    // The setting lives in this app, the write happens on the sidecar, and
    // the request used to say nothing about it: the server scheduled at its
    // own constant while the button showed another number (TASK-166 AC#1).
    // A required schema field proves the key exists; this proves its value.
    const card = makeCard(1);
    expect(gradeRequest(card, 1, 0.75)).toEqual({
      cardId: 1,
      desiredRetention: 0.75,
      grade: "again",
    });
    expect(gradeRequest(card, 4, 0.97).desiredRetention).toBe(0.97);
  });
});

describe("reviewCardFromDueCard", () => {
  it("maps a served row onto the desk card", () => {
    const card = reviewCardFromDueCard(makeDueCard());
    expect(card.cardId).toBe(12);
    expect(card.dueAt).toBe("2026-09-05");
    expect(card.jp).toBe("食べる");
    expect(card.reading).toBe("たべる");
    expect(card.vocabId).toBe(10);
  });

  it("carries the row's D/S as memory, so previews are real, not new-card guesses", () => {
    const card = reviewCardFromDueCard(
      makeDueCard({ difficulty: 6.5, stability: 3.25 })
    );
    expect(card.memory?.difficulty).toBe(6.5);
    expect(card.memory?.stability).toBe(3.25);
  });

  it("turns a nullable vocab snapshot into an absent one", () => {
    const card = reviewCardFromDueCard(
      makeDueCard({ jp: null, reading: null })
    );
    expect(card.jp).toBeUndefined();
    expect(card.reading).toBeUndefined();
  });

  it("carries no memory for an ungraded row, which is what the write will see", () => {
    // A `new` row's D/S are the schema defaults (5 / 0), not a memory state.
    // Passing stability 0 to the preview divides by zero: the desk printed
    // "Again NaNd" on every new card until this was mapped the way
    // apps/server/src/services/grading.ts:56 grades it.
    const card = reviewCardFromDueCard(
      makeDueCard({ stability: 0, state: "new" })
    );
    expect(card.memory).toBeNull();
    const intervals = previewGradeIntervals(
      card.memory,
      0.9,
      card.dueAt,
      new Date("2026-09-28T12:00:00Z")
    );
    for (const grade of [1, 2, 3, 4] as const) {
      expect(Number.isInteger(intervals[grade])).toBe(true);
      expect(intervals[grade]).toBeGreaterThan(0);
    }
  });
});
