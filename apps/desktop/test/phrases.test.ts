import { describe, expect, it } from "bun:test";

import phrasesRaw from "@manobu/japanese/data/phrases.json";

interface PhraseEntry {
  category: string;
  context: string;
  en: string;
  id: string;
  jp: string;
  level: string;
  reading: string;
  romaji: string;
  themes: string[];
}

const phrases = phrasesRaw as unknown as PhraseEntry[];

describe("survival phrases dataset (TASK-23.3)", () => {
  it("ships exactly 20 entries", () => {
    expect(phrases.length).toBe(20);
  });

  it("has 5 entries per category (greetings / ordering / directions / shopping)", () => {
    const categories: Record<string, number> = {};
    for (const p of phrases) {
      categories[p.category] = (categories[p.category] ?? 0) + 1;
    }
    expect(categories.greeting).toBe(5);
    expect(categories.ordering).toBe(5);
    expect(categories.direction).toBe(5);
    expect(categories.shopping).toBe(5);
  });

  it("every entry is level=pre-N5", () => {
    for (const p of phrases) {
      expect(p.level).toBe("pre-N5");
    }
  });

  it("every entry has jp, en, reading, romaji, themes, context", () => {
    for (const p of phrases) {
      expect(p.jp.length).toBeGreaterThan(0);
      expect(p.en.length).toBeGreaterThan(0);
      expect(p.reading.length).toBeGreaterThan(0);
      expect(p.romaji.length).toBeGreaterThan(0);
      expect(p.context.length).toBeGreaterThan(0);
      expect(Array.isArray(p.themes)).toBe(true);
      expect(p.themes.length).toBeGreaterThan(0);
    }
  });

  it("id is unique per entry", () => {
    const seen = new Set<string>();
    for (const p of phrases) {
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
    }
  });

  it("every entry has at least one of Travel/Daily/Shopping theme", () => {
    for (const p of phrases) {
      const ok = p.themes.some((t) =>
        ["Travel", "Daily", "Shopping"].includes(t)
      );
      expect(ok).toBe(true);
    }
  });

  it("greeting entries cover the canonical politeness spectrum", () => {
    // Lock the 5 greeting phrase ids so the Travel goal queue
    // (filtered by category=greeting in TASK-23.3 commit 2) can rely
    // on the list.
    const greetings = phrases.filter((p) => p.category === "greeting");
    const ids = greetings.map((g) => g.id).sort();
    expect(ids).toEqual([
      "greeting-1",
      "greeting-2",
      "greeting-3",
      "greeting-4",
      "greeting-5",
    ]);
  });
});
