import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorksheetCompound,
  __test__ as worksheetTest,
} from "@/features/lesson/worksheet";
import { clearKanaMastery, recordKanaOutcome } from "@/lib/kana-mastery";
import type { LessonDeck } from "@/lib/lesson-cards";
import { TtsProvider } from "@/lib/tts-voice";

const store = new Map<string, string>();
if (typeof localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    } satisfies Storage,
  });
}

const deck: LessonDeck = {
  cards: [{ en: "sun", jp: "ひ", rd: "ひ", romaji: "hi" }],
  soundFirst: false,
};

const renderCard = (card = deck.cards[0]) =>
  renderToStaticMarkup(
    <TtsProvider>
      <WorksheetCompound deck={{ ...deck, cards: [card] }} goalLabel="test">
        <WorksheetCompound.Card />
      </WorksheetCompound>
    </TtsProvider>
  );

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("worksheet romaji fade (TASK-130)", () => {
  it("keeps romaji for unseen, shaky, and corrupt-store cells", () => {
    expect(renderCard()).toContain('data-romaji-visible="true"');

    recordKanaOutcome("ひ", "gojuon", "h", true, "pick", 1);
    recordKanaOutcome("ひ", "gojuon", "h", true, "pick", 2);
    expect(renderCard()).toContain('data-romaji-visible="true"');

    clearKanaMastery();
    localStorage.setItem("manobu.kanaMastery", "not-json");
    expect(renderCard()).toContain('data-romaji-visible="true"');
  });

  it("fades only solid cells and keeps tap-reveal data", () => {
    clearKanaMastery();
    recordKanaOutcome("ひ", "gojuon", "h", true, "pick", 86_400_000);
    recordKanaOutcome("ひ", "gojuon", "h", true, "pick", 86_400_001);
    recordKanaOutcome("ひ", "gojuon", "h", true, "pick", 172_800_000);
    const markup = renderCard();
    expect(markup).toContain('data-romaji-visible="false"');
    expect(markup).toContain('data-romaji="hi"');
    expect(
      worksheetTest.romajiForChip(
        { en: "hi", jp: "ひ", rd: "ひ" },
        deck.cards[0]
      )
    ).toBe("hi");
    expect(
      worksheetTest.romajiForChip(
        { en: "this", jp: "これ", rd: "これ" },
        deck.cards[0]
      )
    ).toBe("ko re");
  });

  it("fades solid spans independently when a card mixes evidence states", () => {
    clearKanaMastery();
    recordKanaOutcome("あ", "gojuon", "a", true, "pick", 86_400_000);
    recordKanaOutcome("あ", "gojuon", "a", true, "pick", 86_400_001);
    recordKanaOutcome("あ", "gojuon", "a", true, "pick", 172_800_000);
    const markup = renderCard({
      en: "red",
      jp: "あか",
      rd: "あか",
      romaji: "aka",
    });
    expect(markup).toContain('data-cell="あ" data-romaji-visible="false"');
    expect(markup).toContain('data-cell="か" data-romaji-visible="true"');
    expect(worksheetTest.romajiPartsForReading("あか")).toHaveLength(2);
  });

  it("derives visibility from the canonical cell state machine", () => {
    expect(worksheetTest.romajiVisibleForCell("ひ")).toBe(true);
    recordKanaOutcome("ひ", "gojuon", "h", true, "pick", 1);
    expect(worksheetTest.romajiVisibleForCell("ひ")).toBe(true);
    recordKanaOutcome("ひ", "gojuon", "h", true, "pick", 2);
    recordKanaOutcome("ひ", "gojuon", "h", true, "pick", 86_400_000);
    expect(worksheetTest.romajiVisibleForCell("ひ")).toBe(false);
  });
});
