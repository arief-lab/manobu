/**
 * Shared screening primitives for the masked-slot N4 reading pipeline
 * (TASK-173.9.6). Both halves of the pipeline import this module, and that
 * shared import is the whole point: the generator picks sentences and slots
 * with these predicates, and `check-reading-n4.ts` re-proves the emitted batch
 * with the SAME predicates. A screen that lives only in the generator is a
 * claim; a screen both halves run is a contract.
 *
 * What is mechanically decidable here, and why that is enough:
 *
 *   - `isInLevelSentence`  every word of the sentence is N5+N4 vocabulary
 *                          (measured difficulty, not a promise),
 *   - `blankedPassage`     the answer word occurs EXACTLY once in the sentence,
 *                          so blanking it neither cuts a neighbour in half nor
 *                          leaves the answer visible elsewhere in the passage,
 *   - `restorePassage`     puts the answer back and reproduces the source
 *                          sentence byte for byte, which is the key the CI gate
 *                          checks on every run.
 *
 * What is NOT decidable, and deliberately absent: whether a second option could
 * also read as correct. That judgement is not smuggled in here as a heuristic.
 * It is removed by construction instead - the key is the word the source
 * sentence itself prints, and every distractor is a same-category in-level word
 * that does NOT occur in the source sentence (`distractorPool`).
 *
 * Source data: `data/sentences/sentences.jsonl` (Tatoeba CC BY 2.0, Tanaka
 * dictionary PD) and `data/n5.json` + `data/n4.json` (see `data/LICENSE.md`).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The cloze blank: two ideographic underscores, the JLPT printed form. The
 * gate re-proves this exact marker, so a different blank cannot pass silently. */
export const BLANK = "＿＿";

/** The signer a generated row carries in `validatedBy`. It names the PIPELINE,
 * not a model, because nothing here was judged by a model: `check-reading-n4`
 * re-proves every property `gen-reading-n4` claims, so the signature points at
 * code CI runs. Kept here (not in either script) because the generator writes it
 * and the gate must accept exactly one string. */
export const GENERATOR_SIGNER = "deterministic:gen-reading-n4";

/** The 小問 every masked-slot row asks. Fixed text, so it can never leak the
 * answer (the item-engine validator's `stem-leak` check reads it), and so the
 * question a row asks is inspectable in the frozen file itself. */
export const READING_STEM =
  "文の＿＿に入る語として、最も適切なものを一つ選びなさい。";

/** Coarse POS categories a masked slot may draw from, in preference order.
 * Nouns first: a noun is the slot whose replacement the surrounding particles
 * and the English translation both constrain most tightly, which is what makes
 * the distractors non-defensible. */
export const CONTENT_POS = ["noun", "verb", "adjective", "adverb"] as const;

export type ContentPos = (typeof CONTENT_POS)[number];

export interface VocabEntry {
  readonly level: string;
  readonly meaning?: string;
  readonly partOfSpeech?: string;
  readonly reading: string;
  /** English glosses GROUPED BY JMdict SENSE (see `src/types.ts`): one group is one
   * meaning, and every gloss inside it is an alternative RENDERING of that
   * meaning. Two entries whose groups share a content word are therefore two
   * labels for the same thing, which is what makes a distractor defensible. */
  readonly senses?: readonly (readonly string[])[];
  readonly word: string;
}

/** One `sentences.jsonl` row, narrowed to the fields the pipeline reads. */
export interface SourceSentence {
  readonly en: string;
  readonly id: string;
  readonly jp: string;
  readonly linkedWords: readonly string[];
}

/** N5 + N4 vocabulary indexed both ways. The reading index resolves the Tanaka
 * notation's kana forms; the word index resolves kanji bases. */
export interface VocabIndex {
  readonly byReading: ReadonlyMap<string, VocabEntry>;
  readonly byWord: ReadonlyMap<string, VocabEntry>;
  /** Printed forms and readings of every grammar-POS entry, derived at load
   * time from the same files (see GRAMMAR_POS_TOKENS). */
  readonly functionWords: ReadonlySet<string>;
}

/** One parsed Tanaka linked word. */
export interface LinkedWord {
  readonly base: string;
  readonly reading: string | null;
  readonly surface: string;
}

/** Tanaka B-line notation: `二十歳(はたち){２０歳}` is the base form, the kana
 * reading in parentheses, and the inflected/orthographic surface actually
 * printed in the sentence inside braces. Any part may be absent. */
const LINKED_WORD_RE = /^([^(]+?)(?:\(([^)]*)\))?(?:\{(.*)\})?$/;

export const parseLinkedWord = (raw: string): LinkedWord | null => {
  const matched = raw.match(LINKED_WORD_RE);
  if (!matched) {
    return null;
  }
  const base = matched[1] ?? "";
  if (base.length === 0) {
    return null;
  }
  const parenthetical = matched[2] ?? "";
  const surface = matched[3] ?? "";
  return {
    base,
    reading: parenthetical.length > 0 ? parenthetical : null,
    surface: surface.length > 0 ? surface : base,
  };
};

/**
 * Grammar POS tokens. An entry carrying one of these is a FUNCTION WORD for the
 * in-level screen, and they are read FROM the vocabulary files rather than
 * hand-listed: the previous hand-typed list had to be maintained by hand, and a
 * missing particle silently shrank the candidate pool.
 *
 * The vocabulary files carry 59 such entries at N5+N4 (particle 9, auxiliary 24,
 * conjunction 25, copula 1), which is what covers は/が/を/に/で/と/も/の/か and
 * the inflected connectives the corpus actually prints.
 */
const GRAMMAR_POS_TOKENS: ReadonlySet<string> = new Set([
  "auxiliary",
  "conjunction",
  "copula",
  "particle",
]);

/**
 * The residue: grammar forms that CANNOT be derived from the vocabulary files.
 *
 * Measured, not assumed: the N5+N4 files hold 53 grammar-POS entries and they
 * are all connectives (でも, より, など, けれど) and auxiliaries - they contain
 * ZERO case particles. `が`, `は` and `を` are absent from both files, because a
 * JLPT word list is a list of content words and 「雨が降っている。」 with only
 * listed words in it is not a sentence. So the in-level screen cannot be
 * purely data-derived; this residue is the part that must be maintained by
 * hand, and it is kept as small as the grammar actually allows.
 *
 * Every entry here is a form a learner at this level is assumed to know, so
 * nothing in this set can make an out-of-level CONTENT sentence look in-level.
 * A missing entry shrinks the candidate pool; it never inflates it. The
 * coverage test is what keeps that honest: every shipped row is re-screened on
 * every gate run.
 */
const AUXILIARY_RESIDUE: ReadonlySet<string> = new Set([
  // Case and binding particles. Zero of these exist in the vocabulary files.
  "が",
  "は",
  "を",
  "に",
  "へ",
  "で",
  "と",
  "も",
  "の",
  "から",
  "まで",
  "より",
  "や",
  "か",
  "ね",
  "よ",
  "な",
  "さ",
  "ぞ",
  "わ",
  "え",
  "し",
  "ら",
  "り",
  "だけ",
  "ほど",
  "ばかり",
  "ずつ",
  // Connectives and aspect endings (several also ship as grammar-POS entries;
  // overlap with the derived set is harmless and the union is what is tested).
  "ながら",
  "ので",
  "のに",
  "ば",
  "なら",
  "たら",
  "たり",
  "けど",
  "けれど",
  "けれども",
  "でも",
  "こそ",
  "さえ",
  "なんて",
  "くらい",
  "ぐらい",
  // Copula and volitional / provisional endings.
  "だ",
  "です",
  "だった",
  "だっ",
  "でした",
  "でしょう",
  "ましょう",
  "ではない",
  "じゃない",
  // ます / ない / たい auxiliaries.
  "ます",
  "ません",
  "ました",
  "ませんでした",
  "ない",
  "なかった",
  "なくて",
  "ないで",
  "なく",
  "たい",
  "たかった",
  "たければ",
  // Function nouns below N5 with no list entry.
  "とき",
  "ところ",
  "ため",
  "ほう",
  "あいだ",
  "うち",
]);

/** Is this linked word a function word in any of its three forms? */
export const isFunctionWord = (word: LinkedWord, index: VocabIndex): boolean =>
  AUXILIARY_RESIDUE.has(word.base) ||
  AUXILIARY_RESIDUE.has(word.surface) ||
  (word.reading !== null && AUXILIARY_RESIDUE.has(word.reading)) ||
  index.functionWords.has(word.base) ||
  index.functionWords.has(word.surface) ||
  (word.reading !== null && index.functionWords.has(word.reading));

/** Resolve a linked word to its vocabulary entry, trying the base, the printed
 * surface and the kana reading against both indexes. */
export const lookupVocab = (
  word: LinkedWord,
  index: VocabIndex
): VocabEntry | null => {
  for (const candidate of [word.base, word.surface, word.reading]) {
    if (!candidate) {
      continue;
    }
    const hit = index.byWord.get(candidate) ?? index.byReading.get(candidate);
    if (hit) {
      return hit;
    }
  }
  return null;
};

/**
 * Resolve the entry of a word the item is ABOUT, by printed form only. The
 * reading fallback above is right for an in-level screen (a kana inflection of
 * an in-level kanji word is still in-level) and catastrophically wrong here:
 * the particle は resolves to 葉 ("leaf", reading は) and becomes the answer of
 * 「津山一高い山＿滝山だと思っていました。」. A blanked slot must be a word the
 * sentence actually PRINTS, so this lookup never consults the reading index.
 */
export const lookupPrintedVocab = (
  word: LinkedWord,
  index: VocabIndex
): VocabEntry | null =>
  index.byWord.get(word.surface) ?? index.byWord.get(word.base) ?? null;

/** In-level means: an N5/N4 vocabulary entry, or a function word. */
export const isInLevel = (word: LinkedWord, index: VocabIndex): boolean =>
  lookupVocab(word, index) !== null || isFunctionWord(word, index);

/** Every word of the sentence is in-level? One out-of-level word fails the
 * whole sentence, because the passage IS the difficulty claim. */
export const isInLevelSentence = (
  sentence: SourceSentence,
  index: VocabIndex
): boolean => {
  for (const raw of sentence.linkedWords) {
    const parsed = parseLinkedWord(raw);
    if (parsed === null || !isInLevel(parsed, index)) {
      return false;
    }
  }
  return true;
};

/** POS tokens that disqualify an entry from being masked or used as a
 * distractor. JMdict abbreviates (`suf`, not `suffix`), so the check is on the
 * token's stem: affixes, counters and particles make unanswerable clozes
 * (さん, ちゃん, 所-as-suffix, は). */
const NON_CONTENT_POS_TOKENS: ReadonlySet<string> = new Set([
  "counter",
  "counters",
  "particle",
  "particles",
  "pref",
  "prefix",
  "suf",
  "suffix",
  "suffixes",
]);

/** The coarse POS bucket of an entry, or null when the entry must never be
 * masked or used as a distractor. */
export const contentPosOf = (entry: VocabEntry): ContentPos | null => {
  const tokens = (entry.partOfSpeech ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.some((token) => NON_CONTENT_POS_TOKENS.has(token))) {
    return null;
  }
  for (const pos of CONTENT_POS) {
    if (tokens.some((token) => token === pos || token.endsWith(` ${pos}`))) {
      return pos;
    }
  }
  return null;
};

/** Count non-overlapping occurrences of `needle` in `haystack`. */
export const countOccurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      return count;
    }
    count += 1;
    from = at + needle.length;
  }
};

/* ------------------------------------------------------------------------- *
 * English-side screens: the two judgement gaps construction cannot close.
 * ------------------------------------------------------------------------- */

/** English function words, dropped before any token comparison. They carry no
 * meaning, so matching on them would prove nothing (every "to change" would
 * overlap every other "to change"). */
const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "can",
  "do",
  "does",
  "doing",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "more",
  "most",
  "my",
  "no",
  "not",
  "now",
  "of",
  "on",
  "one",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "own",
  "she",
  "so",
  "some",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  // JMdict / WordNet boilerplate. NOT stopwords in the linguistic sense, but
  // placeholders that appear inside many unrelated glosses: without dropping
  // them, 私 and 角 both contain "etc" and every pair whose gloss ends
  // "(... etc.)" collided - 22,990 false pairs across 842 nouns, measured.
  "etc",
  "esp",
  "cf",
  "eg",
  "ie",
  "us",
  "uk",
  "aus",
  "nz",
  "lit",
  "c",
  "orig",
  "qtd",
  "pl",
  "str",
  "colloquially",
  "figuratively",
  "usually",
  "especially",
  "sometimes",
  "archaic",
  "obscure",
  "dated",
  "poetic",
]);

/**
 * A content token of an English gloss: lowercase, letters only, stopwords gone,
 * and the common inflection tails trimmed (`raining` -> `rain`, `policemen` ->
 * `policemen` minus `en` is NOT attempted - only the four regulars).
 *
 * The tail trim is deliberately shallow. A deeper stemmer would collapse
 * unrelated words onto each other, and a false synonym is exactly the defect
 * these screens exist to catch, so under-matching is the safe direction.
 */
const englishContentToken = (raw: string): string | null => {
  const word = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length < 3 || ENGLISH_STOPWORDS.has(word)) {
    return null;
  }
  for (const tail of ["ing", "ed", "es", "s"]) {
    if (word.length - tail.length >= 3 && word.endsWith(tail)) {
      return word.slice(0, word.length - tail.length);
    }
  }
  return word;
};

/** Anything that is not a letter is a token boundary in a gloss. */
const NON_LETTER_RE = /[^A-Za-z]+/;

const englishTokens = (text: string): ReadonlySet<string> => {
  const tokens = new Set<string>();
  for (const raw of text.split(NON_LETTER_RE)) {
    const token = englishContentToken(raw);
    if (token !== null) {
      tokens.add(token);
    }
  }
  return tokens;
};

/** Every content token across every JMdict sense of an entry. */
const senseTokensOf = (entry: VocabEntry): ReadonlySet<string> => {
  const tokens = new Set<string>();
  const groups =
    entry.senses ?? (entry.meaning ? [entry.meaning.split(";")] : []);
  for (const group of groups) {
    for (const gloss of group) {
      for (const token of englishTokens(gloss)) {
        tokens.add(token);
      }
    }
  }
  return tokens;
};

/** The content tokens of the entry's FIRST sense group only - see
 * `collidesWithAnswer` for why the other groups are excluded. */
const dominantSenseTokensOf = (entry: VocabEntry): ReadonlySet<string> => {
  const first = entry.senses?.[0];
  const tokens = new Set<string>();
  if (!first) {
    return tokens;
  }
  for (const gloss of first) {
    for (const token of englishTokens(gloss)) {
      tokens.add(token);
    }
  }
  return tokens;
};

/**
 * Screen #1: does the ANSWER's own English gloss appear in the source sentence's
 * English translation?
 *
 * Without this, a row can pass every Japanese-side screen and still lean on
 * knowledge the learner has no way to reach: 話 was the answer to "To change the
 * subject", where nothing in the English names the word. Such a row is not
 * measuring reading, it is measuring that the reviewer happens to be Japanese.
 */
export const answerIsNamedByTranslation = (
  entry: VocabEntry,
  english: string
): boolean => {
  const sentenceTokens = englishTokens(english);
  if (sentenceTokens.size === 0) {
    return false;
  }
  for (const token of senseTokensOf(entry)) {
    if (sentenceTokens.has(token)) {
      return true;
    }
  }
  return false;
};

/**
 * Screen #2: is this distractor ANOTHER LABEL FOR THE ANSWER?
 *
 * Only the DOMINANT sense of each entry is compared, because JMdict orders
 * senses by frequency and that is the meaning a learner would reach for. An
 * earlier version compared every sense group and was badly wrong: 私's
 * "personal (affairs, etc.)" met 色's "paramour" on the token `affair`, which
 * turned 22,990 of 842 nouns into "colliding pairs". Restricted to group 0 and
 * with the JMdict boilerplate (`etc`, `esp`) dropped, the same measurement gives
 * 346 pairs, and the survivors are the pairs this screen exists for - 一日/七日,
 * 一日/今日, 警察/警官.
 *
 * A shared KANJI was tried and deliberately left out: it fires on 一日/一人,
 * where the source translation ("one day" vs "one person") disambiguates them
 * and both are legitimate options. A screen that refuses correct distractors
 * teaches the pipeline nothing; this one only has to catch real synonyms.
 */
export const collidesWithAnswer = (
  candidate: VocabEntry,
  answer: VocabEntry
): boolean => {
  const answerTokens = dominantSenseTokensOf(answer);
  if (answerTokens.size === 0) {
    return false;
  }
  for (const token of dominantSenseTokensOf(candidate)) {
    if (answerTokens.has(token)) {
      return true;
    }
  }
  return false;
};

/**
 * Blank `surface` inside `sentence` and return the cloze passage, or null when
 * the slot is not maskable. Maskable means: the surface occurs EXACTLY once in
 * the printed sentence (an ambiguous occurrence would leave the blank position
 * uncertain and could leave the answer readable elsewhere), the sentence does
 * not already carry the blank marker, and the masked text stays inside the
 * short-reading cap.
 */
export const blankedPassage = (
  sentence: SourceSentence,
  surface: string,
  maxPassageLength: number
): string | null => {
  if (surface.length === 0 || sentence.jp.includes(BLANK)) {
    return null;
  }
  if (countOccurrences(sentence.jp, surface) !== 1) {
    return null;
  }
  const at = sentence.jp.indexOf(surface);
  const passage = `${sentence.jp.slice(0, at)}${BLANK}${sentence.jp.slice(
    at + surface.length
  )}`;
  return [...passage].length <= maxPassageLength ? passage : null;
};

/** Put the answer back into a masked passage. The gate requires the result to be
 * byte-equal to the re-parsed source sentence. */
export const restorePassage = (passage: string, answer: string): string =>
  passage.replace(BLANK, answer);

/** The grammar-function set, derived from the same rows the maps were built
 * from: any word or reading of a row whose 品詞 list touches a grammar token. */
const grammarFunctionWords = (byWord: Map<string, VocabEntry>): Set<string> => {
  const functionWords = new Set<string>();
  for (const entry of byWord.values()) {
    const tokens = (entry.partOfSpeech ?? "")
      .split(",")
      .map((token) => token.trim());
    if (!tokens.some((token) => GRAMMAR_POS_TOKENS.has(token))) {
      continue;
    }
    if (entry.word.length > 0) {
      functionWords.add(entry.word);
    }
    if (entry.reading.length > 0) {
      functionWords.add(entry.reading);
    }
  }
  return functionWords;
};

/** Build a VocabIndex from entries, deriving the grammar-function set from the
 * same rows. First entry wins on a collision, which is the order the files are
 * merged in (N5 before N4). Exported because the test fixtures must derive
 * `functionWords` the same way the pipeline does - a fixture that hand-maintains
 * it would test a screen the pipeline does not run. */
export const buildVocabIndex = (entries: readonly VocabEntry[]): VocabIndex => {
  const byWord = new Map<string, VocabEntry>();
  const byReading = new Map<string, VocabEntry>();
  for (const entry of entries) {
    if (entry.word.length > 0 && !byWord.has(entry.word)) {
      byWord.set(entry.word, entry);
    }
    if (entry.reading.length > 0 && !byReading.has(entry.reading)) {
      byReading.set(entry.reading, entry);
    }
  }
  return {
    byReading,
    byWord,
    functionWords: grammarFunctionWords(byWord),
  };
};

/**
 * The CONTEXT KEY of a sentence for a given target word: the sentence's other
 * linked surfaces in printed order, joined with `|`. Two sentences share a
 * context when every word but the slot is the same, i.e. the same frame holds
 * both words: 「雨が降っている」 and 「雪が降っている」 share `が|降っている`, so a
 * reader who knows the frame could argue either word into the blank of the
 * other.
 */
export const contextKeyFor = (
  sentence: SourceSentence,
  target: string
): string =>
  sentence.linkedWords
    .map((raw) => parseLinkedWord(raw))
    .filter((word) => word !== null && word?.surface !== target)
    .map((word) => word?.surface ?? "")
    .join("|");

/** The surface of one linked word, if it is admitted as a filler: printed,
 * in-vocab, a listed noun. Mirrors the slot criteria exactly, so a looser set
 * cannot flag distractors the construction never needed to exclude. */
const fillerSurface = (raw: string, index: VocabIndex): string | null => {
  const word = parseLinkedWord(raw);
  if (word === null || isFunctionWord(word, index)) {
    return null;
  }
  const entry = lookupPrintedVocab(word, index);
  if (entry === null || entry.word !== word.surface) {
    return null;
  }
  if (contentPosOf(entry) !== "noun") {
    return null;
  }
  return word.surface;
};

/** Add one filler surface to its context key's bucket. */
const addFiller = (
  fillers: Map<string, Set<string>>,
  key: string,
  surface: string
): void => {
  const bucket = fillers.get(key);
  if (bucket === undefined) {
    fillers.set(key, new Set([surface]));
    return;
  }
  bucket.add(surface);
};

/**
 * The corpus-context index: for every context key, the set of in-level nouns
 * that some OTHER in-level sentence fills that key with. A distractor in this
 * set is CORPUS-PLAUSIBLE: the corpus itself shows the frame accepting both
 * words, so the passage alone does not exclude it. This is the only screen
 * here that can reject a distractor no other clause rejects - and it is
 * measured insurance: over the shipped 24-row batch it fires ZERO times, and
 * corpus-wide 638 of 24,224 keys hold more than one filler (に|行く ->
 * 旅行/食事/私/どこ), so the screen bites on real data the moment a future
 * regeneration wanders into one of those keys.
 */
export const buildContextFillers = (
  sentences: readonly SourceSentence[],
  index: VocabIndex
): ReadonlyMap<string, ReadonlySet<string>> => {
  const fillers = new Map<string, Set<string>>();
  for (const sentence of sentences) {
    if (!isInLevelSentence(sentence, index)) {
      continue;
    }
    for (const raw of sentence.linkedWords) {
      const surface = fillerSurface(raw, index);
      if (surface !== null) {
        addFiller(fillers, contextKeyFor(sentence, surface), surface);
      }
    }
  }
  return fillers;
};

/** Is `candidate` a corpus-plausible distractor for `answer` in `source`'s
 * context frame? */
export const isCorpusPlausibleDistractor = (
  source: SourceSentence,
  answer: string,
  candidate: string,
  fillers: ReadonlyMap<string, ReadonlySet<string>>
): boolean =>
  fillers.get(contextKeyFor(source, answer))?.has(candidate) ?? false;

/** Does the sentence's frame carry at least one content word other than the
 * answer? A bare frame (function words only) has no Japanese evidence at all:
 * uniqueness there just means the corpus holds no second witness. */
const frameCarriesContentWord = (
  source: SourceSentence,
  answer: string,
  index: VocabIndex
): boolean => {
  for (const raw of source.linkedWords) {
    const word = parseLinkedWord(raw);
    if (word === null || word.surface === answer) {
      continue;
    }
    if (isFunctionWord(word, index)) {
      continue;
    }
    const entry = lookupVocab(word, index);
    if (entry !== null && contentPosOf(entry) !== null) {
      return true;
    }
  }
  return false;
};

/**
 * SOLVABILITY screen (the inverse of the distractor screen): the passage must
 * be DECIDABLE from the Japanese the learner actually sees. The server never
 * serves `sourceEn`, so a row whose frame the corpus shows accepting OTHER
 * nouns (「＿＿はかわりますが。」 -> 話/薬/ステーキ all fit) is not a reading
 * question, it is a coin flip: the independent-model blind judge run
 * (TASK-173.9.6) marked 13 of 24 shipped rows AMBIGUOUS or UNANSWERABLE under
 * exactly this condition. A slot is solvable only when its context frame is
 * filled by exactly ONE noun corpus-wide - the sentence itself is the only
 * witness, so the blank's answer is forced, not guessed.
 *
 * Measured consequence: this is the filter that does real work. It rejects
 * most bare-frame sentences and keeps the ones whose surrounding words pin the
 * noun (「この＿＿の本は私の物ではありません」 -> 部屋 unique).
 */
export const isContextSolvable = (
  source: SourceSentence,
  answer: string,
  index: VocabIndex,
  fillers: ReadonlyMap<string, ReadonlySet<string>>
): boolean => {
  if ((fillers.get(contextKeyFor(source, answer))?.size ?? 1) !== 1) {
    return false;
  }
  // Require the frame to carry at least one content word that can pin the noun.
  return frameCarriesContentWord(source, answer, index);
};

/**
 * The freeze-time judge record shape, over ONE named file: a missing record
 * means "nothing rejected", and every run record's `rejectedIds` merge. Each
 * judge pass APPENDS a run record; verdicts accumulate, so a row a later pass
 * cleared stays rejected until a record names it as accepted (see
 * `acceptedIds`). A bare object (single pass) is also accepted, because an
 * earlier revision of this reader wrote that shape. This is the shape every
 * composed 大問's `read*-rejected.json` carries, so the six block readers
 * below are thin wrappers over this function: same file, same semantics, one
 * filename each.
 */
export const readRejectedIdsFrom = (
  storeDir: string,
  fileName: string
): ReadonlySet<string> => {
  const ids = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(join(storeDir, fileName), "utf8");
  } catch {
    return ids;
  }
  const parsed = JSON.parse(raw) as
    | { readonly rejectedIds?: unknown }
    | readonly { readonly rejectedIds?: unknown }[];
  const records = Array.isArray(parsed) ? parsed : [parsed];
  for (const record of records) {
    if (!Array.isArray(record?.rejectedIds)) {
      continue;
    }
    for (const id of record.rejectedIds) {
      if (typeof id === "string") {
        ids.add(id);
      }
    }
  }
  return ids;
};

/**
 * The N4 freeze-time judge record: row ids the independent blind judge
 * rejected (verdict AMBIGUOUS or UNANSWERABLE, `prompts/reading-validator.md`).
 * The deterministic screens cannot model open-world grammar (the corpus not
 * containing 「発音の授業」 does not mean a learner cannot say it), so the
 * semantic backstop is the judge — but only at FREEZE time, recorded as data:
 * CI re-proves the deterministic clauses and that no frozen row sits in this
 * list, and never runs a model. A regeneration that would re-emit a rejected
 * row skips it and walks deeper into the corpus.
 */
export const readJudgeRejections = (storeDir: string): ReadonlySet<string> =>
  readRejectedIdsFrom(storeDir, "n4-rejected.json");

/** Read `data/n5.json` + `data/n4.json` into a VocabIndex. */
export const readVocabIndex = (dataDir: string): VocabIndex => {
  const entries: VocabEntry[] = [];
  for (const level of ["N5", "N4"]) {
    const raw = readFileSync(
      join(dataDir, `${level.toLowerCase()}.json`),
      "utf8"
    );
    entries.push(...(JSON.parse(raw) as VocabEntry[]));
  }
  return buildVocabIndex(entries);
};

/** Parse the whole Tatoeba corpus into source sentences. Ids are normalized to
 * strings because the corpus stores them as JSON numbers (`"id":4707`) while
 * the store's `sourceIds` are strings; matching them without this coercion
 * silently yields an empty corpus. */
export const readSourceSentences = (path: string): SourceSentence[] => {
  const sentences: SourceSentence[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const parsed = JSON.parse(line) as {
      en?: unknown;
      id?: unknown;
      jp?: unknown;
      linkedWords?: unknown;
    };
    if (
      (typeof parsed.id !== "string" && typeof parsed.id !== "number") ||
      typeof parsed.jp !== "string" ||
      typeof parsed.en !== "string" ||
      !Array.isArray(parsed.linkedWords)
    ) {
      continue;
    }
    sentences.push({
      en: parsed.en,
      id: String(parsed.id),
      jp: parsed.jp,
      linkedWords: parsed.linkedWords.filter(
        (word): word is string => typeof word === "string"
      ),
    });
  }
  return sentences;
};

/**
 * The distractor pool for one row: in-level entries of `pos` whose printed word
 * is not a substring of the source sentence (a distractor already present in
 * the passage would be a second defensible answer), is not the answer, shares
 * neither the answer's reading nor another distractor's (a homophone
 * near-duplicate is the classic accidental second key), and is not another
 * English label for the answer (see `collidesWithAnswer`).
 */
export const distractorPool = (
  index: VocabIndex,
  pos: ContentPos,
  answer: VocabEntry,
  answerSurface: string,
  sourceSentence: string
): readonly string[] => {
  const used = new Set<string>([answerSurface]);
  const pool: string[] = [];
  for (const entry of index.byWord.values()) {
    if (contentPosOf(entry) !== pos || used.has(entry.word)) {
      continue;
    }
    if (
      entry.word.length === 0 ||
      entry.reading === answer.reading ||
      sourceSentence.includes(entry.word)
    ) {
      continue;
    }
    if (collidesWithAnswer(entry, answer)) {
      continue;
    }
    used.add(entry.word);
    pool.push(entry.word);
  }
  return pool;
};
