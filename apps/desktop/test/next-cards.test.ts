import { describe, expect, it } from "bun:test";
import { nextCardsForGoal } from "@/lib/next-cards";
import { filterNextCardsByWeakPatterns } from "@/lib/queue";

const travelWeakPatterns = [{ pattern: "私" }, { pattern: "いただきます" }];

describe("nextCardsForGoal", () => {
  it("travel -> sources from phrases.json (pre-N5)", async () => {
    const { nextCards } = await nextCardsForGoal("N5", "travel");
    expect(nextCards).toHaveLength(3);
    expect(nextCards.every((c) => c.jp !== undefined)).toBe(true);
    expect(nextCards.every((c) => c.level === "N5")).toBe(true);
    // First 3 phrases from phrases.json are greetings (こ ん ち わ など);
    // verify they are not the n5 corpus by checking the level
    expect(nextCards[0].jp).not.toBe("食べる");
  });
  it("jlpt -> sources from corpus (loadLocalNextCards)", async () => {
    const { nextCards } = await nextCardsForGoal("N4", "jlpt");
    expect(nextCards).toHaveLength(3);
    expect(nextCards.every((c) => c.jp !== undefined)).toBe(true);
    expect(nextCards.every((c) => c.level === "N4")).toBe(true);
  });
  it("anime -> routes to jlpt", async () => {
    const { nextCards } = await nextCardsForGoal("N3", "anime");
    expect(nextCards).toHaveLength(3);
  });
  it("work -> sources from n4.json", async () => {
    const { nextCards } = await nextCardsForGoal("N5", "work");
    expect(nextCards).toHaveLength(3);
    expect(nextCards.every((c) => c.level === "N5")).toBe(true);
  });
});

describe("filterNextCardsByWeakPatterns", () => {
  it("filter retains only cards overlapping the weak pattern", async () => {
    const all = await (await nextCardsForGoal("N5", "travel")).nextCards;
    const weak = travelWeakPatterns;
    const filtered = filterNextCardsByWeakPatterns(all, weak);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    if (weak.length > 0 && all.length > 0) {
      expect(
        filtered.every((c) =>
          travelWeakPatterns.some((w) => c.jp.includes(w.pattern))
        )
      ).toBe(true);
    }
  });
});
