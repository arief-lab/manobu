/**
 * `gen:reading-n4` — build the composed N4 reading store from MASKED SLOTS in
 * in-level Tatoeba sentences (TASK-173.9.6). Deterministic: no LLM, no
 * network, same input bytes produce the same output bytes.
 *
 * SINCE TASK-173.9.19 THIS PATH IS REFUSED AT N4. The store it wrote blanked one
 * noun of a single sentence, which is vocabulary-in-context under a comprehension
 * heading, and doc-27 §10 will not serve that at a level it can author at. N4's 短文
 * is composed as authored rows now, so this script exits 1 whenever
 * `TANBUN_AUTHORED_BAND.N4` names the level — the same table the gate reads, so the
 * two cannot disagree about what backs N4. The construction below stays documented
 * and proved by `check:reading-n4` because the masked rows already frozen in this
 * repo's judge history were produced by it.
 *
 * The item is a cloze whose key comes from the SOURCE, not from a model. One
 * content word of an in-level sentence is blanked, and that word IS the key;
 * the three distractors are same-category in-level vocabulary that does not
 * occur in the sentence. "Exactly one defensible option" is therefore true by
 * construction rather than by a judge's opinion, which is why this batch is
 * signed `deterministic:gen-reading-n4` instead of `opencode:<model>`.
 *
 * What is still judgement, and honestly labelled: whether a learner could argue
 * a distractor on SEMANTIC grounds even though no distractor occurs in the
 * passage. Construction removes the mechanical ambiguity; it cannot prove
 * naturalness. So the batch is screened hard here (single-occurrence slots,
 * POS-matched distractors, homophone and substring screens, no 1-rune katakana
 * answer) and then judged blind, with the verdicts frozen next to the store. There
 * is no human leg: nobody in this repo reads the Japanese, and doc-27 §11 states
 * that limit instead of a reviewer who does not exist.
 *
 * Run from this package: `bun run gen:reading-n4 [--count N]`.
 */

import { join } from "node:path";
import { hashString, seededPermutation } from "@manobu/item-engine/hash";
import { placeSeededOptions } from "./gen-reading-chuubun";
import { writeFormattedStore } from "./gen-reading-cli";
import {
  answerIsNamedByTranslation,
  BLANK,
  blankedPassage,
  buildContextFillers,
  type ContentPos,
  contentPosOf,
  countOccurrences,
  distractorPool,
  isContextSolvable,
  isCorpusPlausibleDistractor,
  isFunctionWord,
  isInLevelSentence,
  lookupPrintedVocab,
  parseLinkedWord,
  READING_STEM,
  readJudgeRejections,
  readSourceSentences,
  readVocabIndex,
  type SourceSentence,
  type VocabEntry,
  type VocabIndex,
} from "./reading-n4-corpus";
import { TANBUN_AUTHORED_BAND } from "./reading-tanbun-corpus";

/** Mirror of MAX_PASSAGE_LENGTH in apps/server/src/services/exam-service.ts:153. */
const MAX_PASSAGE_LENGTH = 240;

/** Four options per item: the source word plus three distractors. */
const OPTION_COUNT = 4;

/** Default batch size. One real N4 大問4 spends four passages, so 24 rows
 * give six distinct papers before the anchor rotation starts repeating. */
const DEFAULT_COUNT = 24;

/** Katakana block. A one-rune katakana answer (ス, メ) is recoverable from
 * register alone, so it is not a reading item. */
const KATAKANA_RE = /[゠-ヿ]/;

/** The signer recorded in `validatedBy`: the pipeline that built the batch, not
 * a model. `check-reading-n4.ts` re-proves every property this script claims,
 * so the signature points at code that CI runs, not at prose. */
export const GENERATOR_SIGNER = "deterministic:gen-reading-n4";

/** The store row shape. Mirrors `ComposedReadingEntry` in
 * `check-reading-n4.ts` (the server's `CorpusShortReadingEntry` is a separate
 * type in a zone this package may not import) plus the construction marker the
 * gate branches on. */
export interface MaskedSlotEntry {
  readonly answerIndex: number;
  readonly block: string;
  /** `masked-slot` marks a row whose key was blanked out of the source, so the
   * gate re-proves the construction instead of the authored-key contract. */
  readonly construction: "masked-slot";
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly provenance: "composed";
  /** The English gloss of the source sentence. Not consumed by the server; kept
   * so a human eyeballing the batch can see what the Japanese actually says. */
  readonly sourceEn: string;
  readonly sourceIds: readonly string[];
  readonly stem: string;
  readonly validated: boolean;
  readonly validatedBy: string;
}

/** A candidate slot: the printed surface to blank and the entry it resolves to. */
interface Slot {
  readonly entry: VocabEntry;
  readonly pos: ContentPos;
  readonly surface: string;
}

/** The noun half of the slot screen for one listed entry: the blanked text must
 * be a form the vocabulary file LISTS, and the answer must be NAMED by the
 * sentence's own English.
 *
 * Without the first, an attached form such as 隣の for 隣 is a different string,
 * is not the word a learner is choosing between, and resolves to nothing the
 * gate can re-derive - which is exactly how a row reached the store with an
 * unresolvable answer. Without the second, a row can pass every Japanese-side
 * screen and still measure nothing: 話 was the answer to "To change the
 * subject", where no English word names it, so the item tests whether the
 * reader guesses the word rather than reads it. */
const nounSlotFor = (
  entry: VocabEntry,
  sentence: SourceSentence,
  surface: string
): Slot | null => {
  const pos = contentPosOf(entry);
  if (pos !== "noun") {
    return null;
  }
  if (surface !== entry.word && surface !== entry.reading) {
    return null;
  }
  if (!answerIsNamedByTranslation(entry, sentence.en)) {
    return null;
  }
  if ([...surface].length < 2 && KATAKANA_RE.test(surface)) {
    return null;
  }
  return { entry, pos, surface };
};

/** Slots worth blanking. NOUNS ONLY, and the reason is the distractor contract:
 * every option is a same-category word, so a verb slot offers verbs that
 * disagree in conjugation class (「死ね！」 answered by 入る / 止まる / 来る), and
 * a form mismatch tells the learner the answer before reading the sentence. A
 * noun blank is filled by a noun in every option, so the only thing separating
 * them is what the sentence means.
 *
 * Also excluded: a word that occurs more than once in the sentence (the blank
 * position would be ambiguous and the answer would still be visible), affixes
 * and counters (さん, 所-as-suffix), function nouns (こと, とき), and one-rune
 * katakana answers (ス is recoverable from register alone). */
const slotsFor = (
  sentence: SourceSentence,
  vocab: VocabIndex
): readonly Slot[] => {
  const slots: Slot[] = [];
  for (const raw of sentence.linkedWords) {
    const parsed = parseLinkedWord(raw);
    if (parsed === null || isFunctionWord(parsed, vocab)) {
      continue;
    }
    if (countOccurrences(sentence.jp, parsed.surface) !== 1) {
      continue;
    }
    const entry = lookupPrintedVocab(parsed, vocab);
    if (entry === null) {
      continue;
    }
    const slot = nounSlotFor(entry, sentence, parsed.surface);
    if (slot !== null) {
      slots.push(slot);
    }
  }
  return slots;
};

/** Type of the corpus-context index (built once per batch). */
export type ContextFillers = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Draw the four options through a seeded permutation rather than taking the
 * head of the pool. Taking the head gives every item the SAME three words (the
 * first nouns in n5.json), which both makes a paper predictable and hides a
 * defect: a bad distractor choice then looks the same on every row. Seeded off
 * the sentence id and the slot, so a rerun reproduces the batch exactly. The
 * placement is seeded too, so the answer is not always in the same slot: a
 * paper whose answer sits at index 0 every time teaches the position, not the
 * sentence.
 */
const drawMaskedOptions = (
  drawSeed: number,
  pool: readonly string[],
  surface: string
): { readonly answerIndex: number; readonly options: string[] } | null => {
  const drawn = [
    surface,
    ...seededPermutation(pool.length, drawSeed)
      .map((position) => pool[position])
      .filter((word): word is string => word !== undefined)
      .slice(0, OPTION_COUNT - 1),
  ];
  return placeSeededOptions(drawn, OPTION_COUNT, drawSeed);
};

/**
 * Build one row, or null when this sentence cannot produce an unambiguous
 * cloze: no maskable slot, a passage over the cap, or fewer than three
 * admissible distractors for the chosen slot's category.
 *
 * `fillers` carries the corpus-context index: a distractor some OTHER in-level
 * sentence fills with the SAME frame is rejected before the draw (the gate
 * re-proves this as `distractor-corpus-plausible`). Optional only so the test
 * fixtures can omit it; `buildBatch` always builds it.
 */
export const buildEntry = (
  sentence: SourceSentence,
  vocab: VocabIndex,
  fillers: ContextFillers = new Map()
): MaskedSlotEntry | null => {
  for (const slot of slotsFor(sentence, vocab)) {
    // SOLVABILITY before anything else: a slot whose frame the corpus fills
    // with other nouns cannot decide the item from the Japanese alone, and the
    // English gloss is never shown to the learner.
    if (!isContextSolvable(sentence, slot.surface, vocab, fillers)) {
      continue;
    }
    const passage = blankedPassage(sentence, slot.surface, MAX_PASSAGE_LENGTH);
    if (passage === null || !passage.includes(BLANK)) {
      continue;
    }
    const pool = distractorPool(
      vocab,
      slot.pos,
      slot.entry,
      slot.surface,
      sentence.jp
    ).filter(
      (word) =>
        !isCorpusPlausibleDistractor(sentence, slot.surface, word, fillers)
    );
    if (pool.length < OPTION_COUNT - 1) {
      continue;
    }
    const drawn = drawMaskedOptions(
      hashString(`distractors:${sentence.id}:${slot.surface}`),
      pool,
      slot.surface
    );
    if (drawn === null) {
      return null;
    }
    return {
      ...drawn,
      block: "naiyou-rikai-tanbun",
      construction: "masked-slot",
      id: `n4m-${sentence.id}`,
      level: "N4",
      passage,
      provenance: "composed",
      sourceEn: sentence.en,
      sourceIds: [sentence.id],
      stem: READING_STEM,
      validated: true,
      validatedBy: GENERATOR_SIGNER,
    };
  }
  return null;
};

/** The whole batch: screen every sentence, keep the first `count` rows in
 * corpus order, and stop. Corpus order (not a shuffle) so a rerun after a data
 * refresh is reviewable as a diff.
 *
 * One row per ANSWER WORD. The gate rejects duplicate passages, but Tatoeba
 * holds several sentences about the same 部屋 or the same 風, so a larger pool
 * filled a batch with three 部屋 rows and a 大問4 would print them together -
 * four 小問 asking the same question in slightly different words. Distinct
 * answer words cost nothing here (the pool is ~9,000 sentences) and make a paper
 * ask four different things. */
export const buildBatch = (
  sentences: readonly SourceSentence[],
  vocab: VocabIndex,
  count: number
): readonly MaskedSlotEntry[] => {
  const fillers = buildContextFillers(sentences, vocab);
  const rejected = readJudgeRejections(
    join(import.meta.dir, "..", "data", "reading")
  );
  const batch: MaskedSlotEntry[] = [];
  const seenIds = new Set<string>();
  const seenAnswers = new Set<string>();
  for (const sentence of sentences) {
    if (batch.length >= count) {
      break;
    }
    if (seenIds.has(sentence.id) || rejected.has(`n4m-${sentence.id}`)) {
      continue;
    }
    if (!isInLevelSentence(sentence, vocab)) {
      continue;
    }
    const entry = buildEntry(sentence, vocab, fillers);
    if (entry === null) {
      continue;
    }
    const answer = entry.options[entry.answerIndex];
    if (answer === undefined || seenAnswers.has(answer)) {
      continue;
    }
    seenIds.add(sentence.id);
    seenAnswers.add(answer);
    batch.push(entry);
  }
  return batch;
};

const packageDataDir = (): string => join(import.meta.dir, "..", "data");

const countFromArgs = (argv: readonly string[]): number => {
  const flagIndex = argv.indexOf("--count");
  if (flagIndex < 0) {
    return DEFAULT_COUNT;
  }
  const parsed = Number.parseInt(argv[flagIndex + 1] ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `--count needs a positive integer, got ${argv[flagIndex + 1]}`
    );
  }
  return parsed;
};

if (import.meta.main) {
  const dataDir = packageDataDir();
  const count = countFromArgs(process.argv.slice(2));
  if (Object.hasOwn(TANBUN_AUTHORED_BAND, "N4")) {
    // The same table `check:reading-n4` reads to pick its proof decides this, so the
    // generator and the gate cannot disagree about what backs N4. N4's 短文 大問 is
    // composed as authored rows (doc-27 §10, TASK-173.9.19), so there is nothing here
    // to generate, and running this would overwrite the blind-judged file with masked
    // rows: the conversion undone by accident, so it stops instead.
    console.error(
      "gen:reading-n4: N4 is composed as authored rows; write the store and freeze its judge record instead of generating"
    );
    process.exit(1);
  }
  const sentences = readSourceSentences(
    join(dataDir, "sentences", "sentences.jsonl")
  );
  const vocab = readVocabIndex(dataDir);
  const batch = buildBatch(sentences, vocab, count);
  const outPath = join(dataDir, "reading", "n4.json");
  writeFormattedStore(outPath, batch, "gen:reading-n4");
  const answered = batch.filter(
    (entry) => entry.options[entry.answerIndex] !== undefined
  ).length;
  console.log(
    `n4.json: ${batch.length} masked-slot rows (${answered} scored) from ${sentences.length} source sentences`
  );
}
