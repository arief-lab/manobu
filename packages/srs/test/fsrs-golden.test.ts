import { describe, expect, it } from "bun:test";

import {
  applyLoadBalancer,
  capInterval,
  currentRetrievability,
  daysElapsedSince,
  MIN_SCHEDULE_DAYS,
  nextStates,
  previewIntervals,
  scheduleDays,
  shouldMarkLeech,
} from "@manobu/srs";

describe("FSRS golden vectors", () => {
  it("new card → preview with default desiredRetention=0.9 gives 4 increasing intervals", () => {
    const out = previewIntervals(null, 0.9, 0);
    // All 4 grades produce sensible positive intervals in ascending order.
    expect(out[1]).toBeGreaterThanOrEqual(1);
    expect(out[2]).toBeGreaterThanOrEqual(1);
    expect(out[3]).toBeGreaterThanOrEqual(1);
    expect(out[4]).toBeGreaterThanOrEqual(1);
    // Easier grades → longer intervals.
    expect(out[4]).toBeGreaterThan(out[3]);
    expect(out[3]).toBeGreaterThanOrEqual(out[2]);
    expect(out[2]).toBeGreaterThanOrEqual(out[1]);
  });

  it("a review card previews the interval the write will schedule, not a demo number", () => {
    // {d:5, s:10} at R=0.9 used to return a spec-demo 1/4/12/28 straight out
    // of a branch, while the server stored the real 1/6/13/24. Every number
    // here is `scheduleDays` over the same `nextStates` the grade write runs
    // (TASK-166).
    const previous = { difficulty: 5, stability: 10 };
    const states = nextStates(previous, 0.9, 0);
    expect(previewIntervals(previous, 0.9, 0)).toEqual({
      1: scheduleDays(states.again.interval),
      2: scheduleDays(states.hard.interval),
      3: scheduleDays(states.good.interval),
      4: scheduleDays(states.easy.interval),
    });
  });

  it("a low-stability review card never previews below one day (TASK-166 AC#3)", () => {
    // again/hard/good all land under a day at stability 0.5, and the review
    // branch had no floor: the desk printed "Again 0d" on every one of them.
    const out = previewIntervals({ difficulty: 5, stability: 0.5 }, 0.9, 0);
    for (const grade of [1, 2, 3, 4] as const) {
      expect(out[grade]).toBeGreaterThanOrEqual(MIN_SCHEDULE_DAYS);
      expect(Number.isInteger(out[grade])).toBe(true);
    }
  });

  it("higher desiredRetention floor means shorter intervals (FSRS convention)", () => {
    const low = previewIntervals({ difficulty: 5, stability: 10 }, 0.7, 0);
    const high = previewIntervals({ difficulty: 5, stability: 10 }, 0.97, 0);
    // R=0.97 floor means "review keep R above 0.97" → schedule sooner →
    // shorter Good interval than R=0.7 (review when R drops below 0.7).
    expect(high[3]).toBeLessThanOrEqual(low[3]);
    // The demo branch returned the same 1/4/12/28 for both, so it could not
    // even show the retention the learner set.
    expect(high[3]).toBeLessThan(low[3]);
  });

  it("nextStates contract — all4 grades produce positive interval + monotonic again<easy", () => {
    const states = nextStates({ difficulty: 5, stability: 10 }, 0.9, 5);
    expect(states.again.interval).toBeGreaterThan(0);
    expect(states.hard.interval).toBeGreaterThan(0);
    expect(states.good.interval).toBeGreaterThan(0);
    expect(states.easy.interval).toBeGreaterThan(0);
    expect(states.again.interval).toBeLessThanOrEqual(states.easy.interval);
  });
});

describe("scheduleDays (the one arithmetic both surfaces share)", () => {
  it("floors, so a 2.9-day interval schedules day 2", () => {
    expect(scheduleDays(2.9)).toBe(2);
    expect(scheduleDays(2.1)).toBe(2);
  });
  it("never returns less than a day, which is what the due queue can express", () => {
    expect(scheduleDays(0.212)).toBe(MIN_SCHEDULE_DAYS);
    expect(scheduleDays(0)).toBe(MIN_SCHEDULE_DAYS);
  });
  it("applies the 365-day cap", () => {
    expect(scheduleDays(400)).toBe(365);
  });
});

describe("daysElapsedSince (shared by the write and the preview)", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  it("counts whole days a card is late", () => {
    expect(daysElapsedSince("2026-09-14", now)).toBe(14);
  });
  it("is zero for a card due later today, and for one due tomorrow", () => {
    expect(daysElapsedSince("2026-09-28", now)).toBe(0);
    expect(daysElapsedSince("2026-09-29", now)).toBe(0);
  });
  it("never goes negative for an early-served card", () => {
    expect(daysElapsedSince("2026-10-05", now)).toBe(0);
  });
});

describe("capInterval", () => {
  it("clamps at 365 by default", () => {
    expect(capInterval(1000)).toBe(365);
    expect(capInterval(100)).toBe(100);
    expect(capInterval(366)).toBe(365);
  });
});

describe("shouldMarkLeech (lapses > 4)", () => {
  it("returns false at lapses 4", () => {
    expect(shouldMarkLeech(4)).toBe(false);
  });
  it("returns true at lapses 5", () => {
    expect(shouldMarkLeech(5)).toBe(true);
  });
});

describe("applyLoadBalancer (prevent spikes)", () => {
  it("no-op when date has ≤20 cards", () => {
    const map = new Map([["2026-09-05", 15]]);
    expect(applyLoadBalancer(7, map, "2026-09-05")).toBe(7);
  });
  it("pushes +1 day when date has >20 cards", () => {
    const map = new Map([["2026-09-05", 25]]);
    expect(applyLoadBalancer(7, map, "2026-09-05")).toBe(8);
  });
});

describe("currentRetrievability decay", () => {
  it("R=1 at day=0", () => {
    expect(
      currentRetrievability({ difficulty: 5, stability: 10 }, 0)
    ).toBeCloseTo(1, 5);
  });
  it("R decays over time", () => {
    const r0 = currentRetrievability({ difficulty: 5, stability: 10 }, 0);
    const r30 = currentRetrievability({ difficulty: 5, stability: 10 }, 30);
    expect(r30).toBeLessThan(r0);
    expect(r30).toBeGreaterThan(0);
  });
});
