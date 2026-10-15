import { describe, expect, it } from "bun:test";

import { __test__, deriveToday } from "@/lib/today";

const { estReviewMinutes, momentumCopy, plural } = __test__;

const base = {
  dueCount: 0,
  goal: "travel" as const,
  level: "N5" as const,
  practicedDays: 0,
};

const FAKE_LESSON = /Lesson [2-9]/;
const ANY_DIGIT = /\d/;

describe("deriveToday stage ladder", () => {
  it("new: no practice days and nothing due", () => {
    expect(deriveToday(base).stage).toBe("new");
  });

  it("first-review: due cards but under two practice days", () => {
    expect(deriveToday({ ...base, dueCount: 5 }).stage).toBe("first-review");
    expect(deriveToday({ ...base, dueCount: 5, practicedDays: 1 }).stage).toBe(
      "first-review"
    );
  });

  it("mid: due cards with established rhythm", () => {
    expect(deriveToday({ ...base, dueCount: 12, practicedDays: 3 }).stage).toBe(
      "mid"
    );
  });

  it("ahead: nothing due, some practice history", () => {
    expect(deriveToday({ ...base, practicedDays: 2 }).stage).toBe("ahead");
  });

  it("never offers a numbered lesson beyond Lesson 1 (no fake Lesson 4)", () => {
    for (const input of [
      base,
      { ...base, dueCount: 1 },
      { ...base, dueCount: 40, practicedDays: 6 },
      { ...base, practicedDays: 7 },
    ]) {
      const { greeting, hero } = deriveToday(input);
      expect(greeting).not.toMatch(FAKE_LESSON);
      expect(hero.cta).not.toMatch(FAKE_LESSON);
    }
  });

  it("new stage: hero is the single loud start, due tile is prose", () => {
    const plan = deriveToday(base);
    expect(plan.hero).toEqual({
      cta: "Start Lesson 1 · 10 min →",
      to: "/lesson",
    });
    expect(plan.due.big).toBe(false);
    expect(plan.due.line).toContain("tomorrow");
    expect(plan.nudge).toBeNull();
  });

  it("due stages route the hero to review and echo dueCount", () => {
    const first = deriveToday({ ...base, dueCount: 3 });
    expect(first.hero.to).toBe("/review");
    expect(first.dueCount).toBe(3);
    const mid = deriveToday({ ...base, dueCount: 12, practicedDays: 4 });
    expect(mid.hero.to).toBe("/review");
    expect(mid.due.big).toBe(true);
  });

  it("ahead stage carries the kana nudge copy", () => {
    const plan = deriveToday({ ...base, practicedDays: 3 });
    expect(plan.hero.to).toBe("/lesson");
    expect(plan.nudge).toContain("kana");
  });

  it("goal names appear in greetings once picked", () => {
    expect(deriveToday(base).greeting).toContain("Travel");
    expect(deriveToday({ ...base, goal: "jlpt" }).greeting).toContain("JLPT");
    expect(deriveToday({ ...base, goal: null }).greeting).toContain(
      "Welcome back"
    );
  });

  it("pluralization is honest at one", () => {
    const one = deriveToday({ ...base, dueCount: 1 });
    const many = deriveToday({ ...base, dueCount: 12, practicedDays: 3 });
    // The count lives ONLY in the Due tile — rail and hero never repeat it.
    expect(one.due.line).toBe("word ready to review");
    expect(many.due.line).toBe("words ready to review");
    expect(one.hero.cta).not.toMatch(ANY_DIGIT);
    expect(one.greeting).not.toMatch(ANY_DIGIT);
    expect(many.greeting).toContain("3 days this week");
  });
});

describe("copy helpers", () => {
  it("momentum names zero honestly", () => {
    expect(momentumCopy(0).line).toContain("today can be the first");
    expect(momentumCopy(3).line).toBe("3 of last 7 days");
  });

  it("review estimate is ~10s per card, never zero", () => {
    expect(estReviewMinutes(0)).toBe(1);
    expect(estReviewMinutes(12)).toBe(2);
    expect(estReviewMinutes(60)).toBe(10);
  });

  it("plural counts", () => {
    expect(plural(1, "card")).toBe("1 card");
    expect(plural(2, "card")).toBe("2 cards");
  });
});
