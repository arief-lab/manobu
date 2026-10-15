/*
 * Lesson card decks + the worksheet stage machine (SCR-08 redesign).
 *
 * The desk philosophy extended to the lesson: the card shows the learner
 * only what they can ACT on. A first-day travel user cannot read · so the
 * travel face is meaning + sound first, script as a label they collect
 * after hearing it. The JLPT face is word-first (they are there precisely
 * to learn to read). The goal answer from setup picks the face; before
 * this module it only picked the corpus.
 *
 * Data-honesty notes:
 * - Curated decks below are hand-picked real phrases (same contract as
 *   the setup page's sample tokens), NOT generated content.
 * - The worksheet's romaji fade reads persisted per-kana drill mastery;
 *   tap-reveal remains available so the crutch is never banned.
 * - segmentReading() derives romaji from @manobu/japanese kana.json ·
 *   real syllabary data, longest-match so yōon (きゃ = kya) never splits.
 */

import kanaData from "@manobu/japanese/data/kana.json";
import { queryOptions } from "@tanstack/react-query";
import { orpc } from "./orpc";

export interface WordChipData {
  en: string;
  jp: string;
  rd: string;
}

export interface LessonCard {
  /** English meaning · the anchor, shown before any Japanese. */
  en: string;
  /** Japanese face: kana for travel, kanji+kana for jlpt/work. */
  jp: string;
  /** One-line sensei note (politeness, pattern, register). Optional. */
  note?: string;
  /** Kana reading · what TTS speaks and what tap-reveal segments. */
  rd: string;
  /** Full romanization (shown in the read stage, the scaffold). */
  romaji: string;
  /** Hand-picked word breakdown for tap-reveal (setup-token shape). */
  words?: readonly WordChipData[];
}

export interface LessonDeck {
  cards: LessonCard[];
  /** "Listen first" hides the script until the sound has been heard. */
  soundFirst: boolean;
}

/* ── curated decks (hand-picked, real Japanese) ───────────────── */

const TRAVEL_CARDS: readonly LessonCard[] = [
  {
    en: "this one, please",
    jp: "これをください",
    note: "polite request · point and say it; を marks the thing you want",
    rd: "これをください",
    romaji: "kore wo kudasai",
    words: [
      { en: "this", jp: "これ", rd: "これ" },
      { en: "object marker", jp: "を", rd: "を" },
      { en: "please give", jp: "ください", rd: "ください" },
    ],
  },
  {
    en: "excuse me",
    jp: "すみません",
    note: "gets attention, apologizes, and thanks · the Swiss-army word",
    rd: "すみません",
    romaji: "sumimasen",
    words: [{ en: "excuse me / sorry", jp: "すみません", rd: "すみません" }],
  },
  {
    en: "where is the station?",
    jp: "えきは どちらですか",
    note: "どちら = which way (polite); か turns it into a question",
    rd: "えきは どちらですか",
    romaji: "eki wa dochira desu ka",
    words: [
      { en: "station", jp: "えき", rd: "えき" },
      { en: "topic marker", jp: "は", rd: "は" },
      { en: "which way", jp: "どちら", rd: "どちら" },
      { en: "question", jp: "ですか", rd: "ですか" },
    ],
  },
  {
    en: "water, please",
    jp: "みずをください",
    note: "same をください pattern as card 1 · swap in anything",
    rd: "みずをください",
    romaji: "mizu wo kudasai",
    words: [
      { en: "water", jp: "みず", rd: "みず" },
      { en: "object marker", jp: "を", rd: "を" },
      { en: "please give", jp: "ください", rd: "ください" },
    ],
  },
  {
    en: "how much is it?",
    jp: "いくらですか",
    note: "いくら = how much; point at the item and ask",
    rd: "いくらですか",
    romaji: "ikura desu ka",
    words: [
      { en: "how much", jp: "いくら", rd: "いくら" },
      { en: "question", jp: "ですか", rd: "ですか" },
    ],
  },
] as const;

const ANIME_CARDS: readonly LessonCard[] = [
  {
    en: "awesome!",
    jp: "すごい",
    note: "the universal reaction · say it a lot, people light up",
    rd: "すごい",
    romaji: "sugoi",
  },
  {
    en: "really?",
    jp: "ほんと？",
    note: "casual short form of 本当 · friends only",
    rd: "ほんと",
    romaji: "honto",
  },
  {
    en: "fun!",
    jp: "楽しい",
    note: "たのしい · describe anything you enjoyed",
    rd: "たのしい",
    romaji: "tanoshii",
  },
  {
    en: "cute",
    jp: "かわいい",
    note: "kawaii · the word you already know; now you can say it",
    rd: "かわいい",
    romaji: "kawaii",
  },
  {
    en: "do your best!",
    jp: "がんばって",
    note: "ganbatte · encouragement to a friend (add ください to be polite)",
    rd: "がんばって",
    romaji: "ganbatte",
  },
] as const;

const WORK_CARDS: readonly LessonCard[] = [
  {
    en: "please (I am asking you)",
    jp: "お願いします",
    note: "one level up from ください · requests to strangers and seniors",
    rd: "おねがいします",
    romaji: "onegai shimasu",
  },
  {
    en: "thank you very much",
    jp: "ありがとうございます",
    note: "the full polite thanks; ありがとう alone is for friends",
    rd: "ありがとうございます",
    romaji: "arigatou gozaimasu",
  },
  {
    en: "understood (to a superior)",
    jp: "かしこまりました",
    note: "humble “I will do it” · the phrase that marks good service",
    rd: "かしこまりました",
    romaji: "kashikomarimashita",
  },
  {
    en: "excuse me (leaving)",
    jp: "失礼します",
    note: "shitsurei shimasu · leave a room or hang up with this",
    rd: "しつれいします",
    romaji: "shitsurei shimasu",
  },
  {
    en: "let's work together",
    jp: "よろしくお願いします",
    note: "the email-meeting opener · literally “please treat me well”",
    rd: "よろしくおねがいします",
    romaji: "yoroshiku onegai shimasu",
  },
] as const;

/** Goal → deck. "fun" rides the travel corpus (same mapping as setup
 * Begin's goal→search); "jlpt" is served from the real corpus elsewhere
 * and gets no curated deck. */
export const deckForGoal = (
  goal: "travel" | "jlpt" | "anime" | "work" | "fun"
): LessonDeck | null => {
  switch (goal) {
    case "anime":
      return { cards: [...ANIME_CARDS], soundFirst: true };
    case "jlpt":
      return null;
    case "travel":
      return { cards: [...TRAVEL_CARDS], soundFirst: true };
    case "work":
      return { cards: [...WORK_CARDS], soundFirst: false };
    default:
      return { cards: [...TRAVEL_CARDS], soundFirst: true };
  }
};

/** Corpus rows → the JLPT word-first deck. Face keeps kanji (the whole
 * point of the path is learning to read it); meaning is the first gloss. */
export const jlptDeckFromVocab = (
  rows: readonly {
    gloss?: null | string;
    level?: string;
    reading: string;
    word: string;
  }[]
): LessonDeck => ({
  cards: rows.map((row) => ({
    en: row.gloss?.trim() || "(no gloss)",
    jp: row.word,
    note: row.level ? `${row.level} word · learn to read this face` : undefined,
    rd: row.reading,
    romaji: segmentReading(row.reading)
      .map((m) => m.romaji)
      .filter(Boolean)
      .join(" "),
  })),
  soundFirst: false,
});

/** The JLPT deck's data source: /api/vocab rows (word/reading/meaning ·
 * NextCard omits the gloss, so the word-first face needs this endpoint).
 * Offline-first like every other query; failure → empty deck → the
 * worksheet renders "no cards today", never a fake. */
export const lessonVocabQueryOptions = (level: string) =>
  queryOptions({
    gcTime: 1000 * 60 * 5,
    networkMode: "offlineFirst",
    queryFn: async (): Promise<readonly VocabRow[]> => {
      try {
        const data = await orpc.jap.vocab.list({
          level: level as "N5" | "N4" | "N3" | "N2" | "N1",
        });
        return data.vocab.slice(0, 5);
      } catch {
        return [];
      }
    },
    queryKey: ["lesson", "vocab", level] as const,
    retry: 1,
    staleTime: 60 * 1000,
  });

interface VocabRow {
  gloss?: null | string;
  level?: string;
  reading: string;
  word: string;
}

/* ── kana segmentation (tap-reveal data) ──────────────────────── */

export interface ReadingMorpheme {
  /** "" for chars outside the syllabary (kanji, punctuation, spaces). */
  romaji: string;
  text: string;
}

/** Hiragana syllabary from kana.json (gojuon + dakuten + yōon rows;
 * katakana kinds excluded · readings are hiragana). Built once. */
const HIRA_ROMAJI: ReadonlyMap<string, string> = new Map(
  (kanaData as { char: string; kind: string; romaji: string }[])
    .filter(
      (k) => k.kind === "gojuon" || k.kind === "dakuten" || k.kind === "yoon"
    )
    .map((k) => [k.char, k.romaji])
);

/** Longest-match segmentation of a kana reading: きゃ never splits into
 * き・ゃ. Unknown chars (kanji in a reading, spaces, punctuation) become
 * single-char morphemes with empty romaji · the UI shows them un-tappable. */
export const segmentReading = (reading: string): ReadingMorpheme[] => {
  const out: ReadingMorpheme[] = [];
  for (let i = 0; i < reading.length; ) {
    const two = reading.slice(i, i + 2);
    const one = reading[i] ?? "";
    const hit = HIRA_ROMAJI.get(two) ?? HIRA_ROMAJI.get(one);
    if (hit === undefined) {
      out.push({ romaji: "", text: one });
      i += 1;
    } else {
      const text = HIRA_ROMAJI.has(two) ? two : one;
      out.push({ romaji: hit, text });
      i += text.length;
    }
  }
  return out;
};

/* ── stage machine ────────────────────────────────────────────── */

export type CardStage = "listen" | "read";

/** A card the learner has not heard yet hides its script (soundFirst
 * decks): meaning + [hear it] only. After the first play the face
 * appears · a label for a sound they now own. */
export const cardStage = (deck: LessonDeck, heard: boolean): CardStage =>
  deck.soundFirst && !heard ? "listen" : "read";

/** Honest close-line for the Done stage · facts about the session only. */
export const doneCopy = (saved: number): string =>
  saved === 0
    ? "Nothing saved · reviews only start once you save a phrase."
    : `${saved} saved · first review: tomorrow · you'll see them on the desk`;
