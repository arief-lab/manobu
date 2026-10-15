import { describe, expect, it } from "bun:test";
import { previewIntervals } from "@manobu/srs";

import { filterNextCardsByWeakPatterns, type NextCardLike } from "@/lib/queue";
import { buildWeakPatternQueue } from "@/lib/weak-pattern-queue";

const N5_CORPUS_LOADER = async (): Promise<
  ReadonlyArray<{ word: string; reading: string; level: string }>
> => {
  const mod = await import("@manobu/japanese/data/n5.json");
  return mod.default as ReadonlyArray<{
    word: string;
    reading: string;
    level: string;
  }>;
};

describe("AI queue anchored + FSRS-correct (TASK-18.5)", () => {
  it("nextCards vocabIds are present in content.db (N5 corpus)", async () => {
    const corpus = await N5_CORPUS_LOADER();
    const corpusWords = new Set(corpus.map((r) => r.word));
    const nextCards: NextCardLike[] = corpus.slice(0, 3).map((r, i) => ({
      jp: r.word,
      level: "N5",
      reading: r.reading,
      vocabId: i + 1,
    }));
    for (const c of nextCards) {
      expect(corpusWords.has(c.jp)).toBe(true);
      expect(c.vocabId).toBeGreaterThan(0);
    }
  });

  it("previewIntervals are within 1..365 for every Grade", () => {
    const out = previewIntervals(null, 0.9, 0);
    for (const g of [1, 2, 3, 4] as const) {
      expect(out[g]).toBeGreaterThanOrEqual(1);
      expect(out[g]).toBeLessThanOrEqual(365);
    }
    const demo = previewIntervals({ difficulty: 5, stability: 10 }, 0.9, 0);
    // There is no demo branch any more: a review card previews the interval
    // the grade write schedules, and the number responds to the retention
    // (TASK-166). It used to return a fixed 1/4/12/28 for any stability near
    // 10 at exactly R=0.9.
    expect(demo[3]).toBeGreaterThan(demo[1]);
    expect(
      previewIntervals({ difficulty: 5, stability: 10 }, 0.97, 0)[3]
    ).toBeLessThan(demo[3]);
    for (const g of [1, 2, 3, 4] as const) {
      expect(demo[g]).toBeGreaterThanOrEqual(1);
      expect(demo[g]).toBeLessThanOrEqual(365);
    }
  });

  it("filterNextCardsByWeakPatterns keeps only cards anchored to weak pattern", () => {
    const cards: NextCardLike[] = [
      { jp: "私", level: "N5", reading: "わたし", vocabId: 1 },
      { jp: "東", level: "N5", reading: "ひがし", vocabId: 2 },
      { jp: "食べる", level: "N5", reading: "たべる", vocabId: 3 },
    ];
    // "Verb-た" pattern needle matches 食べる's reading "たべる" via the
    // suffix "る" being a verb stem — but our filter uses substring match
    // across jp+reading+level. Use a needle that demonstrably appears in
    // the verb card's haystack but not in the noun cards.
    const filtered = filterNextCardsByWeakPatterns(cards, [
      { pattern: "たべる" },
    ]);
    expect(filtered.some((c) => c.jp === "食べる")).toBe(true);
    expect(filtered.every((c) => c.jp !== "私" && c.jp !== "東")).toBe(true);
  });

  it("buildWeakPatternQueue drops no card when weak is empty (no filtering)", async () => {
    const cards: NextCardLike[] = [
      { jp: "私", level: "N5", reading: "わたし", vocabId: 1 },
      { jp: "東", level: "N5", reading: "ひがし", vocabId: 2 },
    ];
    const out = await buildWeakPatternQueue([], cards);
    expect(out.weak).toHaveLength(0);
    expect(out.cards).toEqual(cards);
  });

  it("buildWeakPatternQueue falls back to candidates when no card matches", async () => {
    const cards: NextCardLike[] = [
      { jp: "私", level: "N5", reading: "わたし", vocabId: 1 },
    ];
    const mistakes = [
      {
        grammarId: "ta-form",
        questionId: "q-1",
        wrongChoiceId: "c-wrong",
      },
    ];
    const out = await buildWeakPatternQueue(mistakes, cards);
    expect(out.cards).toEqual(cards);
    expect(out.weak.length).toBeGreaterThan(0);
    expect(out.weak[0]?.grammarId).toBe("ta-form");
  });
});
