import { describe, expect, it } from "bun:test";

import {
  cardStage,
  deckForGoal,
  doneCopy,
  jlptDeckFromVocab,
  segmentReading,
} from "@/lib/lesson-cards";

/** Travel faces are kana-only — no kanji wall for a non-reader. */
const KANA_FACE = /^[ぁ-ん\s]+$/;

describe("segmentReading (tap-reveal data)", () => {
  it("maps kana to romaji one morpheme at a time", () => {
    expect(segmentReading("ください")).toEqual([
      { romaji: "ku", text: "く" },
      { romaji: "da", text: "だ" },
      { romaji: "sa", text: "さ" },
      { romaji: "i", text: "い" },
    ]);
  });

  it("longest-matches yōon — きゃ never splits into き・ゃ", () => {
    expect(segmentReading("きゃ")).toEqual([{ romaji: "kya", text: "きゃ" }]);
  });
  it("kanji and spaces pass through with empty romaji (un-tappable)", () => {
    const parts = segmentReading("水を ください");
    expect(parts.find((p) => p.text === "水")?.romaji).toBe("");
    expect(parts.find((p) => p.text === " ")?.romaji).toBe("");
    expect(
      parts
        .filter((p) => p.romaji !== "")
        .map((p) => p.romaji)
        .join(" ")
    ).toBe("wo ku da sa i");
  });
});

describe("deckForGoal (the goal picks the face)", () => {
  it("travel is sound-first: the script waits for the audio", () => {
    const deck = deckForGoal("travel");
    expect(deck?.soundFirst).toBe(true);
    expect(deck?.cards.length).toBe(5);
    // Every travel card is kana-only on the face — no kanji wall.
    for (const card of deck?.cards ?? []) {
      expect(card.jp).toMatch(KANA_FACE);
    }
  });

  it("work is read-first (the learner can act on text at day one)", () => {
    expect(deckForGoal("work")?.soundFirst).toBe(false);
  });

  it("jlpt has no curated deck — the vocab query builds it", () => {
    expect(deckForGoal("jlpt")).toBeNull();
  });

  it("fun rides the travel deck (same mapping as setup Begin)", () => {
    expect(deckForGoal("fun")).toEqual(deckForGoal("travel"));
  });

  it("curated cards carry the data the ladder needs", () => {
    for (const goal of ["travel", "anime", "work"] as const) {
      for (const card of deckForGoal(goal)?.cards ?? []) {
        expect(card.en.length).toBeGreaterThan(0);
        expect(card.rd.length).toBeGreaterThan(0);
        expect(card.romaji.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("cardStage (the listen→read flip)", () => {
  const deck = deckForGoal("travel");
  it("soundFirst decks hide the script until heard", () => {
    if (!deck) {
      throw new Error("travel deck must exist");
    }
    expect(cardStage(deck, false)).toBe("listen");
    expect(cardStage(deck, true)).toBe("read");
  });
  it("read-first decks show the script immediately", () => {
    const work = deckForGoal("work");
    if (!work) {
      throw new Error("work deck must exist");
    }
    expect(cardStage(work, false)).toBe("read");
  });
});

describe("jlptDeckFromVocab (word-first face from the corpus)", () => {
  const deck = jlptDeckFromVocab([
    {
      gloss: "east",
      level: "N5",
      reading: "ひがし",
      word: "東",
    },
    { level: "N5", reading: "わたし", word: "私" },
  ]);
  it("keeps the kanji face and the first gloss", () => {
    expect(deck.soundFirst).toBe(false);
    expect(deck.cards[0]?.jp).toBe("東");
    expect(deck.cards[0]?.en).toBe("east");
  });
  it("derives romaji from the kana reading (no crutch invented)", () => {
    expect(deck.cards[0]?.romaji).toBe("hi ga shi");
    // Missing meaning → honest placeholder, never a fake gloss.
    expect(deck.cards[1]?.en).toBe("(no gloss)");
  });
});

describe("doneCopy (the honest close)", () => {
  it("names zero saves without guilt", () => {
    expect(doneCopy(0)).toContain("Nothing saved");
  });
  it("counts saves and points at the real FSRS default", () => {
    expect(doneCopy(3)).toContain("3 saved");
    expect(doneCopy(1)).toContain("first review: tomorrow");
  });
});
