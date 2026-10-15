import { describe, expect, it } from "bun:test";

import {
  CARDINALS,
  FLAT,
  formatPrice,
  formatTime,
  I1_TO_10,
  PEOPLE,
} from "@/lib/numbers";

describe("numbers module (MaYa9)", () => {
  it("cardinals cover 0-10", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(CARDINALS[n]).toBeDefined();
    }
  });

  it("generic counters 一つ cover 1-10 with hitotsu/futattsu/...", () => {
    expect(I1_TO_10[1]).toBe("一つ (ひとつ)");
    expect(I1_TO_10[2]).toBe("二つ (ふたつ)");
    expect(I1_TO_10[3]).toBe("三つ (みっつ)");
    expect(I1_TO_10[10]).toBe("十 (とお)");
  });

  it("people counters 二人 cover 1-10", () => {
    expect(PEOPLE[1]).toBe("一人 (ひとり)");
    expect(PEOPLE[2]).toBe("二人 (ふたり)");
    expect(PEOPLE[3]).toBe("三人 (さんにん)");
  });

  it("flat counters 三枚 cover 1-10", () => {
    expect(FLAT[1]).toBe("一枚 (いちまい)");
    expect(FLAT[2]).toBe("二枚 (にまい)");
    expect(FLAT[3]).toBe("三枚 (さんまい)");
  });

  it("formatPrice uses ja-JP grouping", () => {
    expect(formatPrice(250)).toBe("250円");
    expect(formatPrice(1234)).toBe("1,234円");
  });

  it("formatTime keeps minute=0 minimal and shows minutes otherwise", () => {
    expect(formatTime(14, 30)).toBe("14時30分");
    expect(formatTime(14, 0)).toBe("14時");
  });
});
