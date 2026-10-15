/*
 * Reader story data (SCR-05) · extracted from the old features/reader
 * compound in the reading-corner redesign so the stories are pure data
 * (lib zone) and the UI compound holds no authored content.
 *
 * TASK-23.3 lineage: the pre-N5 illustrated story (旅の一日) is the
 * Obo-style emoji-led storyboard · every sentence has an inline icon so
 * a zero-knowledge learner maps Japanese to a situation before tapping
 * words. Vocabulary sourced from `data/phrases.json` (greetings +
 * ordering) plus pre-N5 particles.
 */

import type { JlptLevel } from "@manobu/api-contract";
import { segmentReading } from "./lesson-cards";

/** Derive romaji from a kana reading: katakana folded to hiragana
 * (U+30A2 − 0x60 = U+3042), mora-segmented (yōon longest-match), joined.
 * The reading is hand-authored data, so this is a derivation, not a guess. */
const WHITESPACE_SPLIT = /\s+/u;

/* Romanize one mora run, folding the geminate consonant (っ/ッ): the
 * small tsu doubles the initial consonant of the following mora ·
 * ちょっと → chotto, がっこう → gakkou, いらっしゃいませ → irasshaimase.
 * segmentReading yields an empty romaji for っ, so without this the raw
 * character leaks into the aid line (iraっshaimase). */
const chunkRomaji = (chunk: string): string => {
  const morae = segmentReading(chunk);
  let out = "";
  for (let i = 0; i < morae.length; i += 1) {
    const mora = morae[i];
    if (mora.romaji) {
      out += mora.romaji;
    } else if (mora.text === "っ" || mora.text === "ッ") {
      const next = morae.slice(i + 1).find((m) => m.romaji);
      out += next?.romaji.charAt(0) ?? "";
    } else {
      out += mora.text;
    }
  }
  return out;
};

const romajiFromReading = (reading: string): string =>
  reading
    .split("")
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x30_a2 && code <= 0x30_f3
        ? String.fromCodePoint(code - 0x60)
        : ch;
    })
    .join("")
    .split(WHITESPACE_SPLIT)
    .map((word) => {
      const romaji = word
        .split("ー")
        .filter(Boolean)
        .map((chunk) => chunkRomaji(chunk))
        .join("");
      // Word-final は is read WA (こんにちは → konnichiwa) · the same
      // particle spelling-pronunciation convention, standard romanization.
      return romaji.endsWith("ha") ? `${romaji.slice(0, -2)}wa` : romaji;
    })
    .join(" ");

export interface Word {
  gloss: string;
  jp: string;
  /** Kanji head for the full-entry link (when the word rides one). */
  kanji?: string;
  level: JlptLevel;
  reading: string;
  // Polyhierarchy: the same vocab can live under multiple themes.
  themes: string[];
}

export interface Sentence {
  en: string;
  jp: string;
  level: JlptLevel;
  words: Word[];
}

export interface ReaderStory {
  icon?: string;
  level: JlptLevel;
  sentences: Sentence[];
  subtitle: string;
  title: string;
}

export type StoryKey = "konbini" | "n5" | "preN5";

export const N5_DEFAULT: ReaderStory = {
  icon: "🏪",
  level: "N5",
  sentences: [
    {
      en: "I go to the convenience store.",
      jp: "私はコンビニで  行きます。",
      level: "N5",
      words: [
        {
          gloss: "I / me",
          jp: "私",
          level: "N5",
          reading: "わたし",
          themes: ["Daily"],
        },
        {
          gloss: "convenience store",
          jp: "コンビニ",
          kanji: "店",
          level: "N5",
          reading: "こんびに",
          themes: ["Daily", "Travel"],
        },
        {
          gloss: "to go",
          jp: "行きます",
          kanji: "行",
          level: "N5",
          reading: "いきます",
          themes: ["Daily", "Travel"],
        },
      ],
    },
  ],
  subtitle: "at the convenience store",
  title: "コンビニで",
};

/** Pre-N5 short illustrated story (8 sentences) · see header note. */
export const PRE_N5_DEFAULT: ReaderStory = {
  icon: "🚃",
  level: "N5",
  sentences: [
    {
      en: "Hello!",
      jp: "こんにちは!",
      level: "N5",
      words: [
        {
          gloss: "hello (daytime)",
          jp: "こんにちは",
          level: "N5",
          reading: "こんにちは",
          themes: ["Daily", "Travel"],
        },
      ],
    },
    {
      en: "Excuse me · where is the station?",
      jp: "すみません。駅はどこですか。",
      level: "N5",
      words: [
        {
          gloss: "excuse me / sorry",
          jp: "すみません",
          level: "N5",
          reading: "すみません",
          themes: ["Daily", "Travel"],
        },
        {
          gloss: "station",
          jp: "駅",
          level: "N5",
          reading: "えき",
          themes: ["Travel"],
        },
      ],
    },
    {
      en: "Turn right at the next corner.",
      jp: "右に曲がってください。",
      level: "N5",
      words: [
        {
          gloss: "right",
          jp: "右",
          level: "N5",
          reading: "みぎ",
          themes: ["Travel"],
        },
        {
          gloss: "to turn (polite request)",
          jp: "曲がって",
          level: "N5",
          reading: "まがって",
          themes: ["Travel"],
        },
      ],
    },
    {
      en: "Where is the restroom?",
      jp: "トイレはどこですか。",
      level: "N5",
      words: [
        {
          gloss: "restroom",
          jp: "トイレ",
          level: "N5",
          reading: "トイレ",
          themes: ["Travel"],
        },
      ],
    },
    {
      en: "This one, please. (at the register)",
      jp: "これをください。",
      level: "N5",
      words: [
        {
          gloss: "this (one)",
          jp: "これ",
          level: "N5",
          reading: "これ",
          themes: ["Daily"],
        },
      ],
    },
    {
      en: "How much is it?",
      jp: "いくらですか。",
      level: "N5",
      words: [
        {
          gloss: "how much",
          jp: "いくら",
          level: "N5",
          reading: "いくら",
          themes: ["Travel", "Shopping"],
        },
      ],
    },
    {
      en: "A bag, please.",
      jp: "袋をください。",
      level: "N5",
      words: [
        {
          gloss: "bag",
          jp: "袋",
          level: "N5",
          reading: "ふくろ",
          themes: ["Shopping"],
        },
      ],
    },
    {
      en: "Thank you very much!",
      jp: "ありがとうございます!",
      level: "N5",
      words: [
        {
          gloss: "thank you (polite)",
          jp: "ありがとうございます",
          level: "N5",
          reading: "ありがとうございます",
          themes: ["Daily", "Travel"],
        },
      ],
    },
  ],
  subtitle: "a day of travel",
  title: "旅の一日",
};

/* ── inline rendering + full coverage (TASK-72 improve pass) ──── */

export type TokenSource = "kana" | "kanji" | "particle" | "punct" | "story";

export interface Token {
  /** English gloss · story + particle tokens only. */
  gloss?: string;
  /** Stable React key (position + text) · no index keys in JSX. */
  key: string;
  level?: JlptLevel;
  /** Kana reading · set ONLY when it differs from text (ruby material). */
  reading?: string;
  /** Romaji · the reading aid every non-punct token can answer with. */
  romaji?: string;
  source: TokenSource;
  text: string;
}

/* The coverage ladder: every character of a sentence ends up in a
 * token, so "tap anything, always get at least a reading" holds.
 * 1. hand-authored story words (full dictionary entries)
 * 2. this closed particle/function-word table · the recurring misses
 *    (は を に で ですか ください …) with real fixed glosses; the topic
 *    は carries its TRUE reading (wa), which is the whole point
 * 3. kana fallback via segmentReading (lesson-cards) · per-mora romaji,
 *    yōon never splits
 * 4. bare kanji with no entry · no reading invented; the popover links
 *    the kanji detail page (strokes + on/kun live there)
 * Punctuation/spaces are plain (not tappable). */
const PARTICLES: readonly Omit<Token, "key">[] = [
  { gloss: "topic marker", romaji: "wa", source: "particle", text: "は" },
  { gloss: "object marker", romaji: "wo", source: "particle", text: "を" },
  {
    gloss: "to / at / by (direction, time, place)",
    romaji: "ni",
    source: "particle",
    text: "に",
  },
  {
    gloss: "at / by (where it happens, means)",
    romaji: "de",
    source: "particle",
    text: "で",
  },
  {
    gloss: "and / with / (quoting)",
    romaji: "to",
    source: "particle",
    text: "と",
  },
  { gloss: "also / too", romaji: "mo", source: "particle", text: "も" },
  { gloss: "of / modifier", romaji: "no", source: "particle", text: "の" },
  { gloss: "from / because", romaji: "kara", source: "particle", text: "から" },
  {
    gloss: "until / as far as",
    romaji: "made",
    source: "particle",
    text: "まで",
  },
  { gloss: "question ending", romaji: "ka", source: "particle", text: "か" },
  {
    gloss: "is it? (polite question)",
    romaji: "desu ka",
    source: "particle",
    text: "ですか",
  },
  {
    gloss: "was (polite past)",
    romaji: "deshita",
    source: "particle",
    text: "でした",
  },
  {
    gloss: "please give",
    romaji: "kudasai",
    source: "particle",
    text: "ください",
  },
  {
    gloss: "polite verb ending",
    romaji: "masu",
    source: "particle",
    text: "ます",
  },
  { gloss: "where", romaji: "doko", source: "particle", text: "どこ" },
  {
    gloss: "how (polite)",
    romaji: "ikaga",
    source: "particle",
    text: "いかが",
  },
] as const;

const KANJI_RE = /[㐀-鿿]/;
const KANA_RE = /[ぁ-ゖァ-ヺ]/;

/** Turn a leftover run (no dictionary hit) into kanji / kana-mora /
 * punct tokens so coverage is total. */
const fallbackTokens = (run: string, keyAt: (i: number) => string): Token[] => {
  const out: Token[] = [];
  let kanaRun = "";
  const flushKana = () => {
    if (!kanaRun) {
      return;
    }
    for (const m of segmentReading(kanaRun)) {
      if (m.romaji) {
        out.push({
          key: `kana:${m.text}:${out.length}`,
          romaji: m.romaji,
          source: "kana",
          text: m.text,
        });
      } else {
        for (const ch of m.text) {
          out.push({
            key: `punct:${ch}:${out.length}`,
            source: "punct",
            text: ch,
          });
        }
      }
    }
    kanaRun = "";
  };
  for (const ch of run) {
    if (KANJI_RE.test(ch)) {
      flushKana();
      out.push({ key: `kanji:${ch}:${out.length}`, source: "kanji", text: ch });
    } else if (KANA_RE.test(ch)) {
      kanaRun += ch;
    } else {
      flushKana();
      out.push({ key: `punct:${ch}:${out.length}`, source: "punct", text: ch });
    }
  }
  flushKana();
  return out.map((t, i) => ({ ...t, key: keyAt(i) }));
};

/** Dictionary candidates for a sentence: story words (full entries,
 * ruby + derived romaji) then the particle table, longest text first. */
const candidatesFor = (sentence: Sentence): Token[] =>
  [
    ...sentence.words.map((w) => ({
      gloss: w.gloss,
      key: w.jp,
      level: w.level,
      // Ruby only when the reading differs from the face (kanji words).
      reading: w.reading === w.jp ? undefined : w.reading,
      // Every story token can answer "how is this read?" · kana words
      // get their romaji derived from the hand-authored reading.
      romaji: romajiFromReading(w.reading),
      source: "story" as const,
      text: w.jp,
    })),
    ...PARTICLES.map((p) => ({ ...p, key: p.text })),
  ].sort((a, b) => b.text.length - a.text.length);

/** Earliest occurrence among candidates; the list is length-sorted, so
 * the first candidate found at the same index is the longest match. */
const earliestHit = (
  candidates: Token[],
  rest: string
): null | { index: number; token: Token } => {
  let hit: null | { index: number; token: Token } = null;
  for (const token of candidates) {
    const index = rest.indexOf(token.text);
    if (index !== -1 && (hit === null || index < hit.index)) {
      hit = { index, token };
    }
  }
  return hit;
};

/** Append leftover text as kanji/kana/punct fallback tokens. */
const pushFallback = (tokens: Token[], run: string): void => {
  const base = tokens.length;
  for (const t of fallbackTokens(run, (i) => `fb:${base + i}`)) {
    tokens.push(t);
  }
};

/** Split a sentence into fully-covering tokens: the Japanese renders
 * ONCE with every word tappable inline (story word → particle → kana
 * mora → kanji link). Earliest match wins; ties go to the longest
 * candidate (ですか before か, story words before particles). */
export const segmentSentence = (sentence: Sentence): Token[] => {
  const candidates = candidatesFor(sentence);
  const tokens: Token[] = [];
  let rest = sentence.jp;
  let pending = "";
  while (rest.length > 0) {
    const hit = earliestHit(candidates, rest);
    if (!hit) {
      pending += rest;
      break;
    }
    if (hit.index > 0) {
      pending += rest.slice(0, hit.index);
    }
    if (pending) {
      pushFallback(tokens, pending);
      pending = "";
    }
    tokens.push({
      ...hit.token,
      key: `${hit.token.source}:${hit.token.text}:${tokens.length}`,
    });
    candidates.splice(candidates.indexOf(hit.token), 1);
    rest = rest.slice(hit.index + hit.token.text.length);
  }
  if (pending) {
    pushFallback(tokens, pending);
  }
  return tokens;
};

/** The 8 sentence emojis drive the inline illustration (pre-N5 only). */
export const PRE_N5_ICONS: readonly string[] = [
  "👋", // こんにちは
  "🚉", // 駅はどこですか
  "➡️", // 右に曲がってください
  "🚻", // トイレ
  "🛒", // これをください
  "💴", // いくらですか
  "🛍️", // 袋
  "🙏", // ありがとうございます
];

/** Shelf order + card copy live here; the UI renders whatever it gets. */
export const STORY_SHELF: readonly { key: StoryKey; story: ReaderStory }[] = [
  { key: "preN5", story: PRE_N5_DEFAULT },
  { key: "konbini", story: N5_DEFAULT },
];

export const storyForKey = (key: StoryKey): ReaderStory =>
  key === "preN5" ? PRE_N5_DEFAULT : N5_DEFAULT;

export const iconForSentence = (
  story: ReaderStory,
  index: number
): string | undefined =>
  story === PRE_N5_DEFAULT ? PRE_N5_ICONS[index] : undefined;
