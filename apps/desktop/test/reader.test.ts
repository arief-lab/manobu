import { describe, expect, it } from "bun:test";

import phrasesRaw from "@manobu/japanese/data/phrases.json";
import {
  N5_DEFAULT,
  PRE_N5_DEFAULT,
  PRE_N5_ICONS,
  type Sentence,
  segmentSentence,
  storyForKey,
} from "@/lib/reader-stories";
import { tokenCapabilities } from "@/shared/token-text";

interface PhraseEntry {
  en: string;
  id: string;
  jp: string;
}

const phrases = phrasesRaw as unknown as PhraseEntry[];

describe("Reader pre-N5 story (TASK-23.3)", () => {
  it("ships an 8-sentence pre-N5 story", () => {
    expect(PRE_N5_DEFAULT.sentences.length).toBe(8);
  });

  it("every sentence has at least one tap-able word", () => {
    for (const s of PRE_N5_DEFAULT.sentences) {
      expect(s.words.length).toBeGreaterThan(0);
    }
  });

  it("sentence jps are unique (no duplicate-key DOM issues)", () => {
    const jps = PRE_N5_DEFAULT.sentences.map((s) => s.jp);
    expect(new Set(jps).size).toBe(jps.length);
  });

  it("every tap-word jps is unique across the story", () => {
    const allJps = PRE_N5_DEFAULT.sentences.flatMap((s) =>
      s.words.map((w) => w.jp)
    );
    expect(new Set(allJps).size).toBe(allJps.length);
  });

  it("8 sentence icons are present and unique", () => {
    expect(PRE_N5_ICONS.length).toBe(8);
    expect(new Set(PRE_N5_ICONS).size).toBe(8);
  });

  it("storyForKey routes 'preN5' to PRE_N5_DEFAULT and 'konbini'/'n5' to N5_DEFAULT", () => {
    expect(storyForKey("preN5")).toBe(PRE_N5_DEFAULT);
    expect(storyForKey("konbini")).toBe(N5_DEFAULT);
    expect(storyForKey("n5")).toBe(N5_DEFAULT);
  });

  it("draws vocabulary from the survival phrases dataset (illustrated story uses the 20 phrases)", () => {
    // Loose semantic check: at least 3 of the pre-N5 tap words
    // appear verbatim in phrases.json (since the pre-N5 story was
    // authored against the phrases dataset). We strip trailing
    // punctuation from sentence jps before comparing because the
    // story includes "。" / "!" while phrases.json doesn't.
    const phraseJps = new Set(phrases.map((p) => p.jp));
    const tapJps = PRE_N5_DEFAULT.sentences.flatMap((s) =>
      s.words.map((w) => w.jp)
    );
    const matches = tapJps.filter((jp) => phraseJps.has(jp)).length;
    expect(matches).toBeGreaterThanOrEqual(3);
  });
});

describe("segmentSentence (coverage ladder, TASK-72 improve pass)", () => {
  it("renders the sentence ONCE with words inline, round-tripping exactly", () => {
    for (const story of [PRE_N5_DEFAULT, N5_DEFAULT]) {
      for (const sentence of story.sentences) {
        const tokens = segmentSentence(sentence);
        expect(tokens.map((t) => t.text).join("")).toBe(sentence.jp);
      }
    }
  });

  it("every non-punct token can answer with at least a reading aid", () => {
    // The promise: tap anything, get something. Story/particle tokens
    // carry glosses; kana tokens carry romaji; bare kanji carry the
    // source tag the popover turns into a kanji-page link.
    for (const story of [PRE_N5_DEFAULT, N5_DEFAULT]) {
      for (const sentence of story.sentences) {
        for (const token of segmentSentence(sentence)) {
          if (token.source === "punct") {
            continue;
          }
          const aids = [token.gloss, token.romaji, token.reading];
          expect(aids.some((a) => a !== undefined)).toBe(true);
        }
      }
    }
  });

  it("particles fill the gaps story words leave — with TRUE readings", () => {
    const [, secondSentence] = PRE_N5_DEFAULT.sentences; // すみません。駅はどこですか。
    const tokens = segmentSentence(secondSentence);
    expect(tokens.map((t) => [t.text, t.source])).toEqual([
      ["すみません", "story"],
      ["。", "punct"],
      ["駅", "story"],
      ["は", "particle"],
      ["どこ", "particle"],
      ["ですか", "particle"],
      ["。", "punct"],
    ]);
    // The topic は reads WA, not HA — the point of the particle table.
    const topic = tokens.find((t) => t.text === "は");
    expect(topic?.romaji).toBe("wa");
    expect(topic?.gloss).toBe("topic marker");
  });

  it("longest match wins at the same position (ですか before か)", () => {
    const sentence: Sentence = {
      en: "How much is it?",
      jp: "いくらですか。",
      level: "N5",
      words: [],
    };
    const texts = segmentSentence(sentence).map((t) => t.text);
    expect(texts).toContain("ですか");
    expect(texts).not.toContain("か");
  });

  it("geminate っ doubles the next consonant in the romaji aid", () => {
    const sentence: Sentence = {
      en: "A little, please.",
      jp: "ちょっとください。",
      level: "N5",
      words: [
        {
          gloss: "a little",
          jp: "ちょっと",
          level: "N5",
          reading: "ちょっと",
          themes: ["test"],
        },
      ],
    };
    const chotto = segmentSentence(sentence).find((t) => t.text === "ちょっと");
    // No raw kana leaks into the aid; the sokuon folds to a doubled t.
    expect(chotto?.romaji).toBe("chotto");
  });

  it("bare kanji with no entry become kanji tokens (linked, never invented)", () => {
    const sentence: Sentence = {
      en: "Tokyo (no dictionary entries authored)",
      jp: "東京",
      level: "N5",
      words: [],
    };
    const tokens = segmentSentence(sentence);
    expect(tokens.map((t) => [t.text, t.source])).toEqual([
      ["東", "kanji"],
      ["京", "kanji"],
    ]);
    // No reading is invented for them — the popover links kanji detail.
    expect(tokens.every((t) => t.reading === undefined)).toBe(true);
  });

  it("token keys are stable and unique (no index keys in JSX)", () => {
    const [firstSentence] = N5_DEFAULT.sentences;
    const tokens = segmentSentence(firstSentence);
    const keys = tokens.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("tokenCapabilities (popover actions by source)", () => {
  const tokenBySource = (
    source: string,
    jp: string,
    words: Sentence["words"] = []
  ) => {
    const sentence: Sentence = { en: "x", jp, level: "N5", words };
    const found = segmentSentence(sentence).find((t) => t.source === source);
    if (!found) {
      throw new Error(`no ${source} token in ${jp}`);
    }
    return found;
  };

  it("story tokens speak, save, and link; particles speak and save", () => {
    const [storyWord] = PRE_N5_DEFAULT.sentences[1]?.words ?? [];
    if (!storyWord) {
      throw new Error("story word expected");
    }
    expect(
      tokenCapabilities(tokenBySource("story", "すみません", [storyWord]))
    ).toEqual({
      linkable: true,
      savable: true,
      speakable: true,
    });
    expect(tokenCapabilities(tokenBySource("particle", "は"))).toEqual({
      linkable: false,
      savable: true,
      speakable: true,
    });
  });

  it("kana morae speak only; kanji link only; punct does nothing", () => {
    expect(tokenCapabilities(tokenBySource("kana", "さ"))).toEqual({
      linkable: false,
      savable: false,
      speakable: true,
    });
    expect(tokenCapabilities(tokenBySource("kanji", "東京"))).toEqual({
      linkable: true,
      savable: false,
      speakable: false,
    });
    expect(tokenCapabilities(tokenBySource("punct", "。"))).toEqual({
      linkable: false,
      savable: false,
      speakable: false,
    });
  });
});
