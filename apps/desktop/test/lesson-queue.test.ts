import { describe, expect, it } from "bun:test";

import { pickCards } from "@/lib/queue";

describe("pickCards (interleaved queue l8AjK)", () => {
  it("returns 1 leech + 2 new when a top leech exists", () => {
    const result = pickCards(
      [
        { cardId: 5, lapses: 6, ts: "2026-09-01" },
        { cardId: 7, lapses: 9, ts: "2026-09-02" },
      ],
      [10, 11, 12],
      3
    );
    expect(result).toHaveLength(3);
    const leech = result.find((q) => q.isLeech);
    expect(leech?.vocabId).toBe(7);
    expect(leech?.due).toBe("2026-09-02");
    const news = result.filter((q) => q.isNew);
    expect(news.map((q) => q.vocabId)).toEqual([10, 11]);
  });

  it("treats lapses <= 4 as not-a-leech", () => {
    const result = pickCards(
      [{ cardId: 5, lapses: 4, ts: "2026-09-01" }],
      [10, 11],
      3
    );
    expect(result.find((q) => q.isLeech)).toBeUndefined();
    expect(result.filter((q) => q.isNew)).toHaveLength(2);
  });

  it("returns only new cards when there is no leech", () => {
    const result = pickCards([], [10, 11, 12], 3);
    expect(result).toHaveLength(2);
    expect(result.every((q) => q.isNew)).toBe(true);
  });

  it("caps total at the supplied total minus the leech slot", () => {
    const result = pickCards(
      [{ cardId: 1, lapses: 5, ts: "2026-09-01" }],
      [10, 11, 12, 13],
      3
    );
    expect(result).toHaveLength(3);
    expect(result.filter((q) => q.isNew)).toHaveLength(2);
  });

  it("respects a smaller total", () => {
    const result = pickCards(
      [{ cardId: 1, lapses: 5, ts: "2026-09-01" }],
      [10, 11],
      2
    );
    expect(result).toHaveLength(2);
    expect(result.find((q) => q.isLeech)).toBeDefined();
    expect(result.filter((q) => q.isNew)).toHaveLength(1);
  });
});
