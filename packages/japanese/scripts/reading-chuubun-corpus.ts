/**
 * Shared primitives for the N4/N3/N2/N1 内容理解（中文） reading pipeline
 * (TASK-173.9.2/173.9.3, and the N4 stitch of TASK-173.9.15). The generator and
 * the gate both import this module, the same way the N4 pipeline shares
 * `reading-n4-corpus.ts`: a screen that lives only in the generator is a claim,
 * a screen both halves run is a contract.
 *
 * What differs from N4, and why this is not a copy-paste:
 *
 *   1. SOURCE. N4 masks one Tatoeba sentence, which arrives pre-tokenized
 *      (`linkedWords`, Tanaka notation). The 白書 corpus is raw paragraph text,
 *      so this module owns a deterministic segmenter (`segmentText`) that
 *      greedy longest-match resolves against the cumulative vocabulary plus a
 *      kana passthrough. Every token is either a listed word or kana.
 *   2. DIFFICULTY. N4 requires EVERY word of the sentence to be in-level. A
 *      白書 paragraph is dense non-fiction and cannot clear that bar, so the
 *      unit is a COVERAGE ratio (`coverageOf`) over the cumulative vocabulary
 *      up to the item's level: the passage is readable when in-level chars are
 *      at or above a threshold, which the gate re-measures.
 *   3. LENGTH. A 中文 passage is multi-sentence (<= 1200 runes), so the blank
 *      sits in one sentence of a longer passage; the frame that must pin it is
 *      that sentence's other tokens (`frameKeyFor`).
 *   4. THE SECOND CONSTRUCTION. At N4 the 白書 cannot be read at all, so the
 *      passage is STITCHED from sentences of the licensed sentence corpus
 *      (`stitchDocument`), each one verbatim and every word in level. The screens
 *      above do not change: the same segmenter, the same slot rule, the same
 *      frame-solvability proof, the same distractor pool. Only the source proof
 *      and the band differ, and `PASSAGE_BAND` plus `CHUUBUN_SOURCE` are where
 *      both halves read that difference from.
 *
 * Everything else is the N4 contract, imported rather than re-derived: the
 * single `BLANK`, `restorePassage` byte-equality, the noun/POS screens, the
 * distractor pool and the dominant-sense collision screen.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLANK,
  buildVocabIndex,
  type ContentPos,
  collidesWithAnswer,
  contentPosOf,
  countOccurrences,
  isInLevelSentence,
  readRejectedIdsFrom,
  restorePassage,
  type SourceSentence,
  type VocabEntry,
  type VocabIndex,
} from "./reading-n4-corpus";

/** JLPT levels, easiest first. Rank drives the cumulative in-level test. */
export const LEVEL_RANKS: Readonly<Record<string, number>> = {
  N1: 5,
  N2: 4,
  N3: 3,
  N4: 2,
  N5: 1,
};

/** The signer a generated 中文 row carries. Names the PIPELINE, not a model:
 * the gate re-proves every property this batch claims. */
export const CHUUBUN_SIGNER = "deterministic:gen-reading-chuubun";

/** The 大問 every 中文 row fills. */
export const CHUUBUN_BLOCK = "naiyou-rikai-chuubun";

/** The 小問 a masked 中文 row prints. Fixed text, so it can never leak the
 * answer, and inspectable in the frozen file itself. */
export const CHUUBUN_STEM =
  "この文章の＿＿に入る語として、最も適切なものを一つ選びなさい。";

/** Mirror of the server's medium-reading passage cap. */
export const CHUUBUN_MAX_PASSAGE_LENGTH = 1200;

/**
 * Per-level coverage floor: the portion of a passage's runes that must resolve
 * to in-level vocabulary. Measured against the shipped cumulative vocabulary
 * (see `data/LICENSE.md`): the 白書 register clears 0.9 at N1 and only 0.8 at
 * N2, because the corpus is N1 register. The generator and the gate read this
 * one table, so the difficulty claim cannot drift between them.
 *
 * N3 is 0.8, the same value as N2, and NOT a lower one. Coverage is measured
 * over the cumulative vocabulary up to the item's level, so the same paragraph
 * scores at or below its N2 score at N3 (every N2 word is out of level there):
 * requiring 0.8 at N3 is therefore a STRICTER readability bar than 0.8 at N2,
 * not a laxer one. Dropping below 0.8 would ship N3 passages a larger fraction
 * of whose runes are unknown than the N2 store tolerates, a difficulty
 * inversion. The supply is genuinely thin — `bun run measure:reading-supply`
 * counts 46 of the 2035 in-band paragraphs clearing it — which is a large part
 * of why TASK-173.9.18 took N3 off this route entirely: the N3 中文 store is
 * AUTHORED and pays no coverage floor (doc-27 §10), so this entry now screens
 * probes and any future 白書 row at N3, not a shipped store.
 *
 * N4 is 0.8 too, and for a different reason: the N4 rows are not 白書 at all
 * (doc-26 §5 measures 0 clearing paragraphs at N4 even at a 0.7 floor), they are
 * stitched from sentences where EVERY word is in level, which is a strictly
 * stronger claim than 80% of the runes. The floor stays in this one table and
 * the gate still re-measures it, because the difficulty number a learner is
 * entitled to check must be the same number for every 中文 row, and because the
 * greedy segmenter that measures it is conservative: of the 95 band documents
 * the N4 supply can stitch, ALL 95 score below 1.0 and one (topic 年) scores
 * 0.771, below this floor, so the re-measure is a real refusal rather than a
 * formality (measured 2026-10-08).
 */
export const COVERAGE_FLOOR: Readonly<Record<string, number>> = {
  N1: 0.9,
  N2: 0.8,
  N3: 0.8,
  N4: 0.8,
};

/**
 * Shortest passage a 中文 row may print. A 白書 `<p>` is sometimes a heading or
 * lead-in fragment (「コラム：地球温暖化が進行した将来の台風の姿」, 21 runes),
 * and a heading is not a reading passage.
 */
export const CHUUBUN_MIN_PASSAGE_LENGTH = 200;

/**
 * The three 中文 constructions. `masked-slot` blanks one noun of a single 白書
 * paragraph (TASK-173.9.2). `stitched-in-level` blanks one noun of a document
 * assembled from licensed in-level sentences (TASK-173.9.15), which is the only
 * way N4 大問5 can be asked at all: the 白書 yields nothing there, and the
 * licensed upstream ships no N4 中長文.
 *
 * `authored` writes the passage and the comprehension ねらい over it
 * (TASK-173.9.18, doc-27 §10). The other two blank a noun, so their oracle is a
 * word the source itself prints and the gate can restore byte for byte. An
 * authored row has no source to restore to: its proof is the shared authored
 * screens in `reading-authored-corpus.ts` plus two blind judge passes frozen in
 * the rejection file beside the store.
 *
 * The gate resolves a row's SOURCE by this value, so a row cannot choose its
 * own proof. A 白書 row cites exactly one paragraph and must restore to it byte
 * for byte; a stitched row cites the sentence ids it assembled and must restore
 * to their concatenation, with every cited sentence present in the vendored
 * corpus; an authored row cites nothing at all, and carrying `sourceIds` is
 * itself a refusal.
 */
export const CHUUBUN_CONSTRUCTIONS = [
  "authored",
  "masked-slot",
  "stitched-in-level",
] as const;

export type ChuubunConstruction = (typeof CHUUBUN_CONSTRUCTIONS)[number];

/**
 * The passage band each construction prints, and the only place either bound is
 * written. `masked-slot` reuses the 白書 bounds above, whose ceiling is the
 * server's medium-reading cap. `stitched-in-level` prints the official N4 中文
 * ねらい's 450字程度 document (doc-26 §3.2) as a band, which is precisely why N4
 * is a second construction rather than another floor on the first one: no 白書
 * paragraph is readable at N4 at ANY length, and the band an N4 passage must
 * meet is not the band a 白書 passage can be found in. `authored` prints the
 * same 450字程度 document as a band too, but measured against this level's own
 * masked store rather than the official paper: the 32-row N3 中文 store this
 * level shipped until TASK-173.9.18 ran 206-592 runes, the 88-row N2 store it
 * shipped until TASK-173.9.20 ran 200-653, and the 27-row N1 store it shipped
 * until TASK-173.9.21 ran 200-521, so 250-600 asks a written passage to be
 * no shorter and no longer than the reading a learner at that level was already
 * served. What separates an N1 中文 from an N3 one is the word list and the
 * abstraction it is written with, which no band can express: the shipped authored
 * rows sit in the upper half.
 */
/** One construction's passage length band. */
export interface PassageBand {
  readonly max: number;
  readonly min: number;
}

export const PASSAGE_BAND: Readonly<Record<ChuubunConstruction, PassageBand>> =
  {
    authored: { max: 600, min: 250 },
    "masked-slot": {
      max: CHUUBUN_MAX_PASSAGE_LENGTH,
      min: CHUUBUN_MIN_PASSAGE_LENGTH,
    },
    "stitched-in-level": { max: 600, min: 400 },
  };

/**
 * Which corpus backs each level's composed 中文 store. The generator reads this
 * to pick its assembly and the gate reads it to pick its proof, so a level
 * cannot be generated against one corpus and checked against another. N5 is
 * absent: its 中文 store is licensed, not composed, and a different gate reads
 * it.
 *
 * `authored` is the one value the generator refuses: a written store is authored
 * and judged, never assembled out of a corpus, so running the generator at such a
 * level would overwrite the judged file with masked rows. Every level whose store
 * could not be READ at the ねらい takes this route: N4 (no 白書 paragraph is
 * readable at N4 at any length), N3 (a supply of ~7 papers), N2 (TASK-173.9.20,
 * 88 rows deep and still one vocabulary cloze under a 内容理解 heading, which is
 * the conversion rather than the growth doc-27 §10 describes) and N1
 * (TASK-173.9.21, the last level on this block and not a supply verdict: 27 rows
 * were frozen and more were available, but a blanked noun is a vocabulary lookup
 * printed under a 内容理解 heading, which is the reason doc-27 §14 closed N4's
 * stitch). The `sentences` stitch of TASK-173.9.15 and the 白書 window are
 * therefore proofs the gate keeps for history, not routes it prefers.
 */
export const CHUUBUN_SOURCE: Readonly<
  Record<string, "authored" | "hakusho" | "sentences">
> = {
  N1: "authored",
  N2: "authored",
  N3: "authored",
  N4: "authored",
};

const KANA_RE = /^[\u3040-\u30ff\u30fc]+$/u;
const KANJI_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/u;

/** A maskable surface must be written with at least one kanji. A kana-only
 * "noun" is almost always a function word or a fragment the lossy segmenter
 * mis-resolved (股 read as また), and blanking it asks a learner to guess a
 * kana connective, not to read. */
export const isKanjiSurface = (surface: string): boolean =>
  KANJI_RE.test(surface);

/** Longest run we try to match as one listed word. Longer than any JLPT entry
 * this corpus prints, short enough to stay cheap. */
const MAX_MATCH_LENGTH = 12;

/** One paragraph of the 白書 corpus, as written by `fetch-hakusho.ts`. */
export interface HakushoParagraph {
  readonly id: string;
  readonly license: string;
  readonly pageId: string;
  readonly pageUrl: string;
  readonly source: string;
  readonly text: string;
  readonly title: string;
}

/** One segment of a passage: a listed word, or a kana run. */
export interface Segment {
  /** The entry this surface resolved to, or null for kana/unknown runs. */
  readonly entry: VocabEntry | null;
  /** The printed surface. */
  readonly surface: string;
}

/** A 白書 sentence, split on 。！？ but keeping the delimiter. */
export interface Sentence {
  readonly id: string;
  readonly text: string;
}

/** The optional provenance fields read as the empty string when a line omits
 * them; only id and text are required. */
const optionalString = (value: string | undefined): string => value ?? "";

/** One jsonl line into a paragraph, or null when it is blank or malformed. */
const parseHakushoLine = (line: string): HakushoParagraph | null => {
  if (line.length === 0) {
    return null;
  }
  const parsed = JSON.parse(line) as Partial<HakushoParagraph>;
  if (
    typeof parsed.id !== "string" ||
    typeof parsed.text !== "string" ||
    parsed.text.length === 0
  ) {
    return null;
  }
  return {
    id: parsed.id,
    license: optionalString(parsed.license),
    pageId: optionalString(parsed.pageId),
    pageUrl: optionalString(parsed.pageUrl),
    source: optionalString(parsed.source),
    text: parsed.text,
    title: optionalString(parsed.title),
  };
};

/** Read `data/reading/hakusho.jsonl` into typed paragraphs. */
export const readHakushoParagraphs = (
  path: string
): readonly HakushoParagraph[] => {
  const out: HakushoParagraph[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const paragraph = parseHakushoLine(line);
    if (paragraph !== null) {
      out.push(paragraph);
    }
  }
  return out;
};

/**
 * Build the cumulative index for a level: every entry up to and including it.
 * The N4 `readVocabIndex` reads N5+N4 only; an N2 item must know N1 words as
 * OUT of level, so the level tag on each entry is what the coverage test reads.
 */
export const readCumulativeVocabIndex = (
  dataDir: string,
  levels: readonly string[]
): VocabIndex => {
  const entries: VocabEntry[] = [];
  for (const level of levels) {
    const raw = readFileSync(
      join(dataDir, `${level.toLowerCase()}.json`),
      "utf8"
    );
    entries.push(...(JSON.parse(raw) as VocabEntry[]));
  }
  return buildVocabIndex(entries);
};

/** Levels up to and including `maxLevel`, easiest first. */
export const levelsUpTo = (maxLevel: string): readonly string[] => {
  const rank = LEVEL_RANKS[maxLevel] ?? 0;
  return Object.entries(LEVEL_RANKS)
    .filter(([, each]) => each <= rank)
    .sort(([, a], [, b]) => a - b)
    .map(([level]) => level);
};

/**
 * Greedy longest-match segmentation. At each position the longest window that
 * resolves to a listed word/reading wins; a kana run that matches nothing is
 * one passthrough token; an unmatched kanji run is one UNKNOWN token (which
 * costs coverage).
 *
 * Greedy is a choice, not a claim of linguistic correctness: it under-segments
 * a compound the vocabulary does not list and over-segments one the corpus
 * prints inflected, and both directions only ever LOWER measured coverage. The
 * coverage number the gate re-proves is therefore conservative.
 */
const matchAt = (
  chars: readonly string[],
  at: number,
  index: VocabIndex
): { readonly entry: VocabEntry | null; readonly length: number } | null => {
  const limit = Math.min(MAX_MATCH_LENGTH, chars.length - at);
  for (let length = limit; length >= 1; length -= 1) {
    const candidate = chars.slice(at, at + length).join("");
    const entry = index.byWord.get(candidate) ?? index.byReading.get(candidate);
    if (entry !== undefined) {
      return { entry, length };
    }
    if (index.functionWords.has(candidate)) {
      // A function word resolves with no entry, which costs no coverage.
      return { entry: null, length };
    }
  }
  return null;
};

/** How many chars the run at `at` absorbs when nothing resolves there: the
 * maximal kana run, else ONE char (an unmatched kanji is absorbed singly and
 * costs coverage, which is what makes the measured number conservative). */
const absorbedLength = (chars: readonly string[], at: number): number => {
  if (!KANA_RE.test(chars[at] ?? "")) {
    return 1;
  }
  let end = at;
  while (end < chars.length && KANA_RE.test(chars[end] ?? "")) {
    end += 1;
  }
  return end - at;
};

export const segmentText = (text: string, index: VocabIndex): Segment[] => {
  const chars = [...text];
  const segments: Segment[] = [];
  let at = 0;
  while (at < chars.length) {
    const matched = matchAt(chars, at, index);
    if (matched !== null) {
      segments.push({
        entry: matched.entry,
        surface: chars.slice(at, at + matched.length).join(""),
      });
      at += matched.length;
      continue;
    }
    const start = at;
    at += absorbedLength(chars, at);
    segments.push({ entry: null, surface: chars.slice(start, at).join("") });
  }
  return segments;
};

/** Is this segment in-level for `maxRank`? A listed word at or below the
 * target level, or any kana run (a learner reads the script at every level). */
const isInLevelSegment = (segment: Segment, maxRank: number): boolean => {
  if (segment.entry !== null) {
    return (LEVEL_RANKS[segment.entry.level] ?? 0) <= maxRank;
  }
  return KANA_RE.test(segment.surface);
};

/**
 * The coverage of a passage at `maxRank`: in-level runes over total runes.
 * This is the difficulty claim the gate re-measures on every run.
 */
export const coverageOf = (
  text: string,
  index: VocabIndex,
  maxRank: number
): number => {
  const total = [...text].length;
  if (total === 0) {
    return 0;
  }
  let covered = 0;
  for (const segment of segmentText(text, index)) {
    if (isInLevelSegment(segment, maxRank)) {
      covered += [...segment.surface].length;
    }
  }
  return covered / total;
};

/** Split a paragraph into sentences, keeping the terminal punctuation. */
export const splitSentences = (
  paragraph: HakushoParagraph
): readonly Sentence[] => {
  const out: Sentence[] = [];
  let buffer = "";
  let index = 0;
  for (const char of paragraph.text) {
    buffer += char;
    if (char === "。" || char === "！" || char === "？") {
      index += 1;
      out.push({ id: `${paragraph.id}-s${index}`, text: buffer });
      buffer = "";
    }
  }
  if (buffer.trim().length > 0) {
    index += 1;
    out.push({ id: `${paragraph.id}-s${index}`, text: buffer });
  }
  return out;
};

/** Resolve a printed word to its in-level noun entry, or null. */
export const inLevelNounFor = (
  word: string,
  index: ReturnType<typeof readCumulativeVocabIndex>,
  maxRank: number
): VocabEntry | null => {
  const entry = index.byWord.get(word);
  if (entry === undefined) {
    return null;
  }
  if ((LEVEL_RANKS[entry.level] ?? 0) > maxRank) {
    return null;
  }
  return entry;
};

/** The window's OWN sentences: the blank's frame is a property of the sentence
 * that HOLDS it, never of the corpus at large (see `check-reading-chuubun.ts`
 * for the measured failure mode). */
export const sourceSentencesOf = (text: string): readonly Sentence[] =>
  splitSentences({
    id: "source",
    license: "",
    pageId: "",
    pageUrl: "",
    source: "",
    text,
    title: "",
  });

/**
 * One blankable slot in a passage. `sentenceIndex` points at the sentence that
 * holds it, because the frame that must pin the answer is that sentence.
 */
export interface ChuubunSlot {
  readonly entry: VocabEntry;
  readonly pos: ContentPos;
  readonly sentenceIndex: number;
  readonly surface: string;
}

const NOUN: ContentPos = "noun";

/**
 * Candidate slots: an in-level listed NOUN whose PRINTED KANJI form occurs
 * exactly once in the whole passage. Nouns only, for the same reason the N4
 * pipeline restricts to nouns: every option is then the same category, so the
 * choice turns on meaning rather than on a form mismatch.
 *
 * The printed surface must equal `entry.word` - reading matches are refused
 * here, unlike the N4 slot. The N4 source is pre-tokenized, so a reading match
 * there is a real inflection (君 printed as きみ); the 白書 segmenter is a lossy
 * greedy matcher, and under it a reading match is usually a FRAGMENT of a
 * longer word: 「こうした」 split into こうし (講師's reading) + た, which blanked
 * こうし out of こうした and shipped as a key. Requiring the listed kanji form
 * removes that class.
 */
/**
 * Is this segment an in-level noun PRINTED in its listed kanji form? One
 * predicate for both walks below (`slotsFor` and `buildFrameFillers`) so the
 * candidate set cannot drift between them: a string a slot may blank and a
 * string that fills a frame must be the same kind of thing, or "the corpus fills
 * this frame with exactly one noun" is measured over a different vocabulary than
 * the blanks come from.
 */
const isCandidateNoun = (
  segment: Segment,
  maxRank: number
): segment is { readonly entry: VocabEntry; readonly surface: string } => {
  const { entry, surface } = segment;
  return (
    entry !== null &&
    contentPosOf(entry) === NOUN &&
    (LEVEL_RANKS[entry.level] ?? 0) <= maxRank &&
    surface === entry.word &&
    isKanjiSurface(surface)
  );
};

export const slotsFor = (
  passage: string,
  sentences: readonly Sentence[],
  index: VocabIndex,
  maxRank: number
): readonly ChuubunSlot[] => {
  const slots: ChuubunSlot[] = [];
  for (
    let sentenceIndex = 0;
    sentenceIndex < sentences.length;
    sentenceIndex += 1
  ) {
    const sentence = sentences[sentenceIndex];
    if (sentence === undefined) {
      continue;
    }
    for (const segment of segmentText(sentence.text, index)) {
      if (!isCandidateNoun(segment, maxRank)) {
        continue;
      }
      const { surface } = segment;
      if ([...surface].length < 2) {
        continue;
      }
      if (countOccurrences(passage, surface) !== 1) {
        continue;
      }
      slots.push({ entry: segment.entry, pos: NOUN, sentenceIndex, surface });
    }
  }
  return slots;
};

/** Tokens kept on each side of a slot when building its collocation frame. */
const FRAME_WINDOW = 3;

/**
 * The frame of a blank: a window of up to `FRAME_WINDOW` tokens on each side of
 * the slot, joined with `|`, with the slot marked by `_`. Two blanks share a
 * frame when the same local collocation licenses both nouns.
 *
 * A whole-SENTENCE frame was tried first and measured dead: 白書 sentences are
 * long and specific, so every sentence's frame was unique corpus-wide and the
 * screen never fired (99.96% of slots passed it). A window is the unit a
 * collocation actually constrains, and it makes the screen bite (see
 * `data/LICENSE.md` for the measured collision rate).
 */
export const frameKeyFor = (
  sentences: readonly Sentence[],
  sentenceIndex: number,
  target: string,
  index: VocabIndex
): string => {
  const segments = segmentText(sentences[sentenceIndex]?.text ?? "", index);
  const at = segments.findIndex((segment) => segment.surface === target);
  if (at < 0) {
    return "";
  }
  const before = segments
    .slice(Math.max(0, at - FRAME_WINDOW), at)
    .map((segment) => segment.surface);
  const after = segments
    .slice(at + 1, at + 1 + FRAME_WINDOW)
    .map((segment) => segment.surface);
  return [...before, "_", ...after].join("|");
};

/**
 * Corpus-wide frame index: for every frame, the set of in-level noun surfaces
 * some sentence fills it with. A candidate distractor in this set is
 * corpus-plausible (the corpus itself shows the frame accepting it), and an
 * answer whose frame admits other nouns is not decided by the passage alone.
 */
export const buildFrameFillers = (
  sentences: readonly Sentence[],
  index: VocabIndex,
  maxRank: number
): ReadonlyMap<string, ReadonlySet<string>> => {
  const fillers = new Map<string, Set<string>>();
  for (
    let sentenceIndex = 0;
    sentenceIndex < sentences.length;
    sentenceIndex += 1
  ) {
    const sentence = sentences[sentenceIndex];
    if (sentence === undefined) {
      continue;
    }
    for (const segment of segmentText(sentence.text, index)) {
      if (!isCandidateNoun(segment, maxRank)) {
        continue;
      }
      const key = frameKeyFor(sentences, sentenceIndex, segment.surface, index);
      const bucket = fillers.get(key);
      if (bucket === undefined) {
        fillers.set(key, new Set([segment.surface]));
      } else {
        bucket.add(segment.surface);
      }
    }
  }
  return fillers;
};

/** Does the frame carry at least one content word besides the slot? A frame of
 * function words only is a coin flip, the exact failure the N4 judge found. */
const frameCarriesContentWord = (index: VocabIndex, key: string): boolean => {
  for (const token of key.split("|")) {
    if (token === "_" || token.length === 0) {
      continue;
    }
    const entry = index.byWord.get(token) ?? index.byReading.get(token) ?? null;
    if (entry !== null && contentPosOf(entry) !== null) {
      return true;
    }
  }
  return false;
};

/**
 * SOLVABILITY: the passage must decide the answer from the Japanese the learner
 * sees. Two conditions, both measured:
 *
 *   a. the blank's frame is filled by exactly ONE noun corpus-wide, so no other
 *      in-level word the corpus itself pairs with that frame could fit, and
 *   b. the window carries at least one content word besides the slot, so there
 *      is real context to pin it (a frame of function words only is a coin
 *      flip, the exact failure the N4 judge found).
 */
export const isFrameSolvable = (
  sentences: readonly Sentence[],
  slot: ChuubunSlot,
  index: VocabIndex,
  fillers: ReadonlyMap<string, ReadonlySet<string>>
): boolean => {
  const key = frameKeyFor(sentences, slot.sentenceIndex, slot.surface, index);
  if ((fillers.get(key)?.size ?? 1) !== 1) {
    return false;
  }
  return frameCarriesContentWord(index, key);
};

/**
 * In-level distractor pool for one 中文 row: entries of `pos` at or below the
 * item's level, whose printed word is not already in the passage (a distractor
 * the learner can read is a second defensible answer), is not the answer, shares
 * neither the answer's reading nor another distractor's, and is not another
 * English label for the answer.
 */
/** Is `entry` usable as a distractor for `answer` in this passage? */
const isDistractorCandidate = ({
  answer,
  entry,
  maxRank,
  passage,
  pos,
}: {
  answer: VocabEntry;
  entry: VocabEntry;
  maxRank: number;
  passage: string;
  pos: ContentPos;
}): boolean =>
  contentPosOf(entry) === pos &&
  (LEVEL_RANKS[entry.level] ?? 0) <= maxRank &&
  entry.word.length > 0 &&
  entry.reading !== answer.reading &&
  !passage.includes(entry.word) &&
  !collidesWithAnswer(entry, answer);

export const chuubunDistractorPool = (
  index: VocabIndex,
  pos: ContentPos,
  maxRank: number,
  answer: VocabEntry,
  answerSurface: string,
  passage: string
): readonly string[] => {
  const used = new Set<string>([answerSurface]);
  const pool: string[] = [];
  for (const entry of index.byWord.values()) {
    if (used.has(entry.word)) {
      continue;
    }
    if (!isDistractorCandidate({ answer, entry, maxRank, passage, pos })) {
      continue;
    }
    used.add(entry.word);
    pool.push(entry.word);
  }
  return pool;
};

/* ------------------------------------------------------------------------- *
 * The masked-slot gate contract (TASK-173.9.2 AC#1).
 *
 * The 短文/中文/長文 gates re-prove the SAME offline contract on every run, and
 * the screens below are that contract in one place: a screen the generator runs
 * and a gate re-runs is a contract, and a screen one gate keeps as a private
 * copy is only a claim. Each gate still owns its own band, source resolution
 * and coverage floor (長文 screens at `CHOUBUN_COVERAGE_FLOOR`); what is shared
 * here is the single `BLANK`, the restore-to-source byte equality, the in-level
 * noun key, frame solvability and the distractor screens.
 * ------------------------------------------------------------------------- */

/** The row fields the masked-slot screens read: the windowed row's passage
 * carries the blank, the key is the option its `answerIndex` points at. */
export interface MaskedSlotRow {
  readonly answerIndex: number;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
}

/** The store context the masked-slot screens run against, read once per gate
 * or generator run. `rejections` is the freeze-time judge record. */
export interface MaskedSlotContext {
  readonly fillers: ReadonlyMap<string, ReadonlySet<string>>;
  readonly index: VocabIndex;
  readonly maxRank: number;
  readonly rejections: ReadonlySet<string>;
}

/** The answer's own contract, independent of how hard the passage is. */
const maskedAnswerIssues = ({
  answer,
  answerEntry,
  entry,
  sourceText,
}: {
  answer: string;
  answerEntry: VocabEntry | null;
  entry: MaskedSlotRow;
  sourceText: string;
}): string[] => {
  const issues: string[] = [];
  if (countOccurrences(sourceText, answer) !== 1) {
    issues.push("answer-not-single-in-source");
  }
  if (restorePassage(entry.passage, answer) !== sourceText) {
    issues.push("passage-not-restorable-to-source");
  }
  if (answerEntry === null || answerEntry.word !== answer) {
    issues.push("answer-not-in-level-noun");
  }
  return issues;
};

/** Every real distractor fails at most one way, and the first failure is the
 * report: an option the source prints is a second defensible answer the learner
 * can read off the page, an out-of-level option is a form mismatch rather than
 * a reading test, an option outside the pool is a homophone or a second label
 * for the answer, and an option the corpus fills the answer's OWN frame with is
 * corpus-plausible (a reader who knows the collocation could argue it in). */
const maskedDistractorIssues = ({
  answer,
  answerEntry,
  context,
  entry,
  slot,
  sourceSentences,
  sourceText,
}: {
  answer: string;
  answerEntry: VocabEntry;
  context: MaskedSlotContext;
  entry: MaskedSlotRow;
  slot: ChuubunSlot;
  sourceSentences: readonly Sentence[];
  sourceText: string;
}): string[] => {
  const poolSet = new Set(
    chuubunDistractorPool(
      context.index,
      "noun",
      context.maxRank,
      answerEntry,
      answer,
      sourceText
    )
  );
  const frameKey = frameKeyFor(
    sourceSentences,
    slot.sentenceIndex,
    answer,
    context.index
  );
  for (const option of entry.options) {
    if (option === answer) {
      continue;
    }
    if (sourceText.includes(option)) {
      return ["distractor-occurs-in-source"];
    }
    if (inLevelNounFor(option, context.index, context.maxRank) === null) {
      return ["distractor-not-in-level-noun"];
    }
    if (!poolSet.has(option)) {
      return ["distractor-outside-pool"];
    }
    if (frameKey === "") {
      return ["answer-frame-missing"];
    }
    if (context.fillers.get(frameKey)?.has(option) === true) {
      return ["distractor-frame-plausible"];
    }
  }
  return [];
};

/** Does the PASSAGE decide the answer? The blank's frame must be filled by
 * exactly ONE noun corpus-wide, the source must clear the floor the CALLER
 * chose (each 大問 owns its own bar: 長文 measures against its 0.85, the others
 * against `COVERAGE_FLOOR`), and no distractor may be arguable. Reports nothing
 * for a word the corpus does not even list: that fault is `answerIssues`'
 * message, and a second one about the same row would double-count it. */
const maskedPassageDecidesIssues = ({
  answer,
  answerEntry,
  context,
  coverageFloor,
  coverageIssue,
  entry,
  sourceSentences,
  sourceText,
}: {
  answer: string;
  answerEntry: VocabEntry;
  context: MaskedSlotContext;
  coverageFloor: number;
  coverageIssue: string;
  entry: MaskedSlotRow;
  sourceSentences: readonly Sentence[];
  sourceText: string;
}): string[] => {
  const slot: ChuubunSlot = {
    entry: answerEntry,
    pos: "noun",
    sentenceIndex: sourceSentences.findIndex((sentence) =>
      sentence.text.includes(answer)
    ),
    surface: answer,
  };
  const issues: string[] = [];
  if (coverageOf(sourceText, context.index, context.maxRank) < coverageFloor) {
    issues.push(coverageIssue);
  }
  if (
    slot.sentenceIndex < 0 ||
    !isFrameSolvable(sourceSentences, slot, context.index, context.fillers)
  ) {
    issues.push("answer-frame-ambiguous");
  }
  return [
    ...issues,
    ...maskedDistractorIssues({
      answer,
      answerEntry,
      context,
      entry,
      slot,
      sourceSentences,
      sourceText,
    }),
  ];
};

/** The whole masked-slot half of one row against its resolved source text, in
 * the order the gates have always printed: one blank, the answer's contract,
 * the passage's decision (only for a key the corpus lists), the judge record.
 * Each gate computes `sourceSentences` with the splitter its own construction
 * used and passes the coverage floor its level owes. */
export const maskedSlotIssues = ({
  context,
  coverageFloor,
  coverageIssue,
  entry,
  sourceSentences,
  sourceText,
}: {
  context: MaskedSlotContext;
  coverageFloor: number;
  coverageIssue: string;
  entry: MaskedSlotRow;
  sourceSentences: readonly Sentence[];
  sourceText: string;
}): string[] => {
  const issues: string[] = [];
  if (countOccurrences(entry.passage, BLANK) !== 1) {
    issues.push("passage-blank-not-single");
  }
  const answer = entry.options[entry.answerIndex];
  if (answer === undefined) {
    return issues;
  }
  const answerEntry = inLevelNounFor(answer, context.index, context.maxRank);
  issues.push(
    ...maskedAnswerIssues({ answer, answerEntry, entry, sourceText })
  );
  if (answerEntry !== null && answerEntry.word === answer) {
    issues.push(
      ...maskedPassageDecidesIssues({
        answer,
        answerEntry,
        context,
        coverageFloor,
        coverageIssue,
        entry,
        sourceSentences,
        sourceText,
      })
    );
  }
  if (context.rejections.has(entry.id)) {
    issues.push("row-judge-rejected");
  }
  return issues;
};

/**
 * The sentences of a passage: split on 。！？ with the delimiter kept. BOTH
 * halves of the pipeline resolve a frame against this split of the SOURCE text,
 * because a frame is a property of the sentence that holds the blank. If the
 * generator and the gate split differently they measure different keys and the
 * gate's re-proof means nothing. Exported so neither side keeps a local copy.
 */
export const sentencesOfText = (text: string): readonly Sentence[] =>
  splitSentences({
    id: "source",
    license: "",
    pageId: "",
    pageUrl: "",
    source: "",
    text,
    title: "",
  });

/* ------------------------------------------------------------------------- *
 * The stitched in-level document (TASK-173.9.15, N4 大問5).
 *
 * The 白書 is unreadable at N4 (doc-26 §5: 0 paragraphs clear even a 0.7 floor),
 * so the passage is assembled from the licensed sentence corpus instead. That
 * changes WHERE the text comes from and how the gate proves it; it does not
 * change what makes a cloze unambiguous, so every screen above (single
 * occurrence, POS-matched distractors, frame solvability, the dominant-sense
 * collision, the coverage floor) runs on a stitched row exactly as it does on a
 * 白書 row.
 * ------------------------------------------------------------------------- */

/** How many in-level sentences must print a noun before it can head a document.
 * The band floor is 400 runes and the mean in-level sentence is 13.7 runes
 * (measured over the 9,171 in-level sentences of `data/sentences/sentences.jsonl`
 * on 2026-10-08), so a document needs about 30 sentences; below this a topic can
 * never fill the band and the assembly only fails later. */
export const STITCH_MIN_TOPIC_SENTENCES = 30;

/**
 * The in-level sentence supply: every `sentences.jsonl` row whose Tanaka tokens
 * ALL resolve inside the cumulative index for the level. This is a stronger
 * claim than the coverage floor is for the 白書: not "80% of the runes are
 * known" but "every word of every sentence is on the list", which is what lets
 * an N4 passage carry an N4 difficulty claim at 中文 length.
 */
export const inLevelSentences = (
  sentences: readonly SourceSentence[],
  index: VocabIndex
): readonly SourceSentence[] =>
  sentences.filter((sentence) => isInLevelSentence(sentence, index));

/**
 * The candidate noun surfaces a text prints, in printed order and deduplicated.
 * `slotsFor` narrows this further (exactly once in the whole passage); the
 * stitch uses it to ask what a document could be ABOUT, and the gate uses it to
 * re-prove that the answer's document really has such a noun.
 */
export const printedNounSurfaces = (
  text: string,
  index: VocabIndex,
  maxRank: number
): readonly string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const segment of segmentText(text, index)) {
    if (!isCandidateNoun(segment, maxRank) || seen.has(segment.surface)) {
      continue;
    }
    seen.add(segment.surface);
    out.push(segment.surface);
  }
  return out;
};

/**
 * The topic supply: every candidate noun surface, with the in-level sentences
 * that print it, in corpus order. Deterministic given the same corpus and the
 * same vocabulary, which is what keeps a regeneration byte-identical.
 */
export const stitchedTopicSupply = (
  sentences: readonly SourceSentence[],
  index: VocabIndex,
  maxRank: number
): ReadonlyMap<string, readonly SourceSentence[]> => {
  const supply = new Map<string, SourceSentence[]>();
  for (const sentence of sentences) {
    for (const surface of printedNounSurfaces(sentence.jp, index, maxRank)) {
      const bucket = supply.get(surface);
      if (bucket === undefined) {
        supply.set(surface, [sentence]);
        continue;
      }
      if (!bucket.some((each) => each.id === sentence.id)) {
        bucket.push(sentence);
      }
    }
  }
  return supply;
};

/** One assembled document: its printed text and the sentence ids it cites. */
export interface StitchedDocument {
  readonly ids: readonly string[];
  readonly text: string;
}

/**
 * Assemble one document around one topic noun: the sentences that print it, in
 * corpus order, until the band floor is met. Refused, never truncated, when the
 * sentence that would close the document overshoots the ceiling: a sentence cut
 * in half is a sentence the corpus does not contain, and an authored sentence is
 * the one thing this construction may not print.
 *
 * The topic is the coherence this construction can honestly claim. Tatoeba
 * sentences are independent statements, so an arbitrary stitch is a list rather
 * than a document; gathering the sentences that share one noun at least keeps
 * the same participants across the passage. The gate re-proves that shared noun
 * (`stitchedTopicOf`), so the claim is measured and not a comment.
 */
export const stitchDocument = (
  topic: string,
  sentences: readonly SourceSentence[]
): StitchedDocument | null => {
  const band = PASSAGE_BAND["stitched-in-level"];
  const ids: string[] = [];
  const parts: string[] = [];
  let runes = 0;
  for (const sentence of sentences) {
    if (!sentence.jp.includes(topic)) {
      continue;
    }
    runes += [...sentence.jp].length;
    if (runes > band.max) {
      return null;
    }
    ids.push(sentence.id);
    parts.push(sentence.jp);
    if (runes >= band.min) {
      break;
    }
  }
  if (runes < band.min || ids.length === 0) {
    return null;
  }
  return { ids, text: parts.join("") };
};

/**
 * The topic a stitched document is about, or null when nothing licenses its
 * coherence: a candidate noun the document prints that EVERY sentence of it
 * contains. The generator skips a document this returns null for, and the gate
 * fails the row, so both halves answer the same question with the same function.
 */
export const stitchedTopicOf = (
  text: string,
  index: VocabIndex,
  maxRank: number
): string | null => {
  const sentences = sentencesOfText(text);
  if (sentences.length < 2) {
    return null;
  }
  for (const surface of printedNounSurfaces(text, index, maxRank)) {
    if (sentences.every((sentence) => sentence.text.includes(surface))) {
      return surface;
    }
  }
  return null;
};

/**
 * The freeze-time judge record for one 中文 level: row ids the blind judge
 * rejected (AMBIGUOUS or UNANSWERABLE). Same shape and same reason as N4's
 * `readJudgeRejections` - a regeneration skips a rejected row and walks deeper
 * into the corpus; CI only ever reads the list.
 */
export const readChuubunRejections = (
  storeDir: string,
  level: string
): ReadonlySet<string> =>
  readRejectedIdsFrom(storeDir, `${level.toLowerCase()}-chuubun-rejected.json`);

/** A row bare enough for the answer-dedupe walk: an options list and the index
 * the build just chose as correct. */
export interface ScorableRow {
  readonly answerIndex: number;
  readonly options: readonly string[];
}

/**
 * The tail every masked-slot generation loop shares: drop an unbuilt row, skip
 * a row whose answer was already shipped, otherwise take it. Returns whether
 * the row was accepted so a caller can record its own extra state (the 中文
 * stitch loop marks the opener it spent) after the push, not before.
 */
export const pushDistinctAnswer = <T extends ScorableRow>(
  batch: T[],
  entry: T | null,
  seenAnswers: Set<string>
): boolean => {
  if (entry === null) {
    return false;
  }
  const answer = entry.options[entry.answerIndex];
  if (answer === undefined || seenAnswers.has(answer)) {
    return false;
  }
  seenAnswers.add(answer);
  batch.push(entry);
  return true;
};
