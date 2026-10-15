/**
 * `gen:reading-chuubun` — build the composed 内容理解（中文） reading store:
 * masked slots in in-level 白書 paragraphs at N3/N2/N1 (TASK-173.9.2/173.9.3)
 * and, at N4, a masked slot in a document STITCHED from licensed in-level
 * sentences (TASK-173.9.15). `CHUUBUN_SOURCE` says which corpus a level gets.
 * Deterministic: no LLM, no network, same input bytes produce the same output
 * bytes.
 *
 * The construction is the N4 one (`gen-reading-n4.ts`) scaled to a multi-
 * sentence passage: one content word of the source is blanked, and that word IS
 * the key; the distractors are same-category in-level nouns that do not occur in
 * the passage. "Exactly one defensible option" is true by construction, not by a
 * judge's opinion, so the batch is signed
 * `deterministic:gen-reading-chuubun`.
 *
 * What is still judgement, and honestly labelled: the passage is a longer,
 * denser register than N4, so a learner could argue a distractor on semantic
 * grounds even though no distractor occurs in the passage. The deterministic
 * screens remove the mechanical ambiguity (single occurrence, POS-matched
 * distractors, homophone and substring screens, a collocation window that
 * licenses no other noun, a measured coverage floor); the semantic residue is
 * removed by a blind judge pass recorded in `data/reading/{level}-chuubun-rejected.json`
 * (see `prompts/reading-validator.md`).
 *
 * The N4 stitch adds one judgement of its own, and it is labelled too: sentences
 * gathered around one noun are topic-coherent, not a narrative, so what a learner
 * reads is a set of statements about the same participants rather than the short
 * story a real N4 中文 大問 prints. `stitchedTopicOf` is the screen that keeps the
 * claim to what the data supports, and `data/LICENSE.md` states it.
 *
 * Run from this package: `bun run gen:reading-chuubun --level N2 --count 12`.
 */

import { join } from "node:path";
import { hashString, seededPermutation } from "@manobu/item-engine/hash";
import { parseArgsWithLevel, writeFormattedStore } from "./gen-reading-cli";
import {
  buildFrameFillers,
  CHUUBUN_BLOCK,
  CHUUBUN_MIN_PASSAGE_LENGTH,
  CHUUBUN_SIGNER,
  CHUUBUN_SOURCE,
  CHUUBUN_STEM,
  type ChuubunConstruction,
  type ChuubunSlot,
  COVERAGE_FLOOR,
  chuubunDistractorPool,
  coverageOf,
  type HakushoParagraph,
  inLevelSentences,
  isFrameSolvable,
  LEVEL_RANKS,
  levelsUpTo,
  PASSAGE_BAND,
  type PassageBand,
  pushDistinctAnswer,
  readChuubunRejections,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
  STITCH_MIN_TOPIC_SENTENCES,
  type StitchedDocument,
  sentencesOfText,
  slotsFor,
  splitSentences,
  stitchDocument,
  stitchedTopicOf,
  stitchedTopicSupply,
} from "./reading-chuubun-corpus";
import {
  BLANK,
  blankedPassage,
  readSourceSentences,
  type SourceSentence,
  type VocabIndex,
} from "./reading-n4-corpus";

const OPTION_COUNT = 4;

export interface ChuubunEntry {
  readonly answerIndex: number;
  readonly block: string;
  readonly construction: ChuubunConstruction;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly provenance: "composed";
  /** The PDL1.0 credit the 白書 store must print, with the page URL substituted.
   * Absent on a stitched row: its prose is licensed per SENTENCE, and the
   * sentence ids that credit it travel in `sourceIds` (see
   * `data/LICENSE.md`, which is where the composed 中文 attribution lives). */
  readonly sourceCredit?: string;
  readonly sourceIds: readonly string[];
  readonly sourceUrl?: string;
  readonly stem: string;
  readonly validated: boolean;
  readonly validatedBy: string;
}

/**
 * Arrange `drawn` (the key first) by the seeded permutation so no answer
 * position is fixed and identical inputs print identical bytes, or null when
 * the draw is short. Exported because the 主張理解, 統合理解 and N4 generators
 * place their four options exactly this way, and a second copy of the loop
 * could drift from this one.
 */
export const placeSeededOptions = (
  drawn: readonly string[],
  optionCount: number,
  seed: number
): { readonly answerIndex: number; readonly options: string[] } | null => {
  const order = seededPermutation(optionCount, seed);
  const options = new Array<string>(optionCount);
  for (let at = 0; at < optionCount; at += 1) {
    const sourceSlot = order[at];
    const word = sourceSlot === undefined ? undefined : drawn[sourceSlot];
    if (word === undefined) {
      return null;
    }
    options[at] = word;
  }
  const answerIndex = order.indexOf(0);
  return { answerIndex: answerIndex < 0 ? 0 : answerIndex, options };
};

/**
 * The four printed options and the key index, or null when the seeded draw
 * cannot be completed. `seededPermutation` is seeded on the paragraph and the
 * answer, so no batch-wide shared distractor head and no fixed answer position;
 * the key is drawn into the option list by the same permutation rather than
 * placed at a constant offset.
 *
 * Exported because the 短文 generator (TASK-173.9.11) draws its options the same
 * way for the same construction, and a second copy could drift from this one.
 */
export const drawOptions = (
  answer: string,
  pool: readonly string[],
  seed: number
): { readonly answerIndex: number; readonly options: string[] } | null => {
  const drawn = [
    answer,
    ...seededPermutation(pool.length, seed)
      .map((position) => pool[position])
      .filter((word): word is string => word !== undefined)
      .slice(0, OPTION_COUNT - 1),
  ];
  return placeSeededOptions(drawn, OPTION_COUNT, seed);
};

/**
 * The last half of either construction: blank the slot, draw the options, freeze
 * the row. Shared because the blank/pool/draw sequence IS the row contract, and
 * a stitched copy of it could drift from the 白書 one.
 *
 * `seedId` is the source's own id rather than the row id, because the frozen
 * stores were drawn with it: changing the string would reshuffle every option
 * list the next regeneration produces, and a deterministic generator must
 * reproduce the file it shipped byte for byte.
 */
const finishRow = ({
  band,
  construction,
  id,
  index,
  level,
  maxRank,
  seedId,
  slot,
  sourceCredit,
  sourceIds,
  sourceText,
  sourceUrl,
}: {
  readonly band: PassageBand;
  readonly construction: ChuubunConstruction;
  readonly id: string;
  readonly index: VocabIndex;
  readonly level: string;
  readonly maxRank: number;
  readonly seedId: string;
  readonly slot: ChuubunSlot;
  readonly sourceCredit?: string;
  readonly sourceIds: readonly string[];
  readonly sourceText: string;
  readonly sourceUrl?: string;
}): ChuubunEntry | null => {
  if (CHUUBUN_STEM.includes(slot.surface)) {
    // stem-leak: the fixed stem itself prints 一つ, so a slot with that surface
    // is an answer inside the question, which the gate's validateQuestionItem
    // refuses. Skip the slot, do not emit the row.
    return null;
  }
  const passage = blankedPassage(
    { en: "", id, jp: sourceText, linkedWords: [] },
    slot.surface,
    band.max
  );
  if (passage === null || !passage.includes(BLANK)) {
    return null;
  }
  if ([...passage].length < band.min) {
    // Blanking removes the slot's own runes, so a source sitting on the band
    // floor can print a passage just under it.
    return null;
  }
  const pool = chuubunDistractorPool(
    index,
    slot.pos,
    maxRank,
    slot.entry,
    slot.surface,
    sourceText
  );
  if (pool.length < OPTION_COUNT - 1) {
    return null;
  }
  const drawn = drawOptions(
    slot.surface,
    pool,
    hashString(`chuubun:${seedId}:${slot.surface}`)
  );
  if (drawn === null) {
    return null;
  }
  return {
    ...drawn,
    block: CHUUBUN_BLOCK,
    construction,
    id,
    level,
    passage,
    provenance: "composed",
    ...(sourceCredit === undefined ? {} : { sourceCredit }),
    sourceIds,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    stem: CHUUBUN_STEM,
    validated: true,
    validatedBy: CHUUBUN_SIGNER,
  };
};

/** Build one 白書 row from a paragraph, or null when it cannot back an
 * unambiguous cloze at this level. */
export const buildEntry = (
  paragraph: HakushoParagraph,
  dataDir: string,
  level: string,
  index = readCumulativeVocabIndex(dataDir, levelsUpTo(level)),
  fillers?: ReturnType<typeof buildFrameFillers>
): ChuubunEntry | null => {
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const floor = COVERAGE_FLOOR[level] ?? 1;
  if ([...paragraph.text].length < CHUUBUN_MIN_PASSAGE_LENGTH) {
    return null;
  }
  if (coverageOf(paragraph.text, index, maxRank) < floor) {
    return null;
  }
  const sentences = splitSentences(paragraph);
  const frameFillers = fillers ?? buildFrameFillers(sentences, index, maxRank);
  for (const slot of slotsFor(paragraph.text, sentences, index, maxRank)) {
    if (!isFrameSolvable(sentences, slot, index, frameFillers)) {
      continue;
    }
    const entry = finishRow({
      band: PASSAGE_BAND["masked-slot"],
      construction: "masked-slot",
      id: `${level.toLowerCase()}c-${paragraph.id}`,
      index,
      level,
      maxRank,
      seedId: paragraph.id,
      slot,
      sourceCredit: paragraph.source,
      sourceIds: [paragraph.id],
      sourceText: paragraph.text,
      sourceUrl: paragraph.pageUrl,
    });
    if (entry !== null) {
      return entry;
    }
  }
  return null;
};

/** The stitched document after the before-the-slots screens, or null when the
 * topic earns no row: no document, not readable at this level, or not one
 * document rather than a list. */
const stitchedCandidate = ({
  document,
  fillers,
  index,
  level,
  maxRank,
}: {
  document: StitchedDocument | null;
  fillers: ReturnType<typeof buildFrameFillers> | undefined;
  index: VocabIndex;
  level: string;
  maxRank: number;
}): {
  readonly document: StitchedDocument;
  readonly documentSentences: ReturnType<typeof sentencesOfText>;
  readonly frameFillers: ReturnType<typeof buildFrameFillers>;
} | null => {
  if (document === null) {
    return null;
  }
  if (
    coverageOf(document.text, index, maxRank) < (COVERAGE_FLOOR[level] ?? 1)
  ) {
    return null;
  }
  if (stitchedTopicOf(document.text, index, maxRank) === null) {
    return null;
  }
  const documentSentences = sentencesOfText(document.text);
  return {
    document,
    documentSentences,
    frameFillers:
      fillers ?? buildFrameFillers(documentSentences, index, maxRank),
  };
};

/**
 * One row of the stitched in-level construction (TASK-173.9.15, N4 大問5): the
 * document the topic noun gathers, with one of its other nouns blanked.
 *
 * Every screen the 白書 path runs is run here too, on the same functions; what
 * differs is only where the text comes from. The document is refused before any
 * slot is tried when it is not readable at N4 (`coverageOf`), when nothing
 * licenses it as one document rather than a list (`stitchedTopicOf`), and when no
 * noun of it is decided by its own sentence (`isFrameSolvable`).
 */
export const buildStitchedEntry = (
  topic: string,
  sentences: readonly SourceSentence[],
  level: string,
  index: VocabIndex,
  fillers?: ReturnType<typeof buildFrameFillers>
): ChuubunEntry | null => {
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const candidate = stitchedCandidate({
    document: stitchDocument(topic, sentences),
    fillers,
    index,
    level,
    maxRank,
  });
  if (candidate === null) {
    return null;
  }
  const { document, documentSentences, frameFillers } = candidate;
  const band = PASSAGE_BAND["stitched-in-level"];
  const first = document.ids[0] ?? "";
  for (const slot of slotsFor(
    document.text,
    documentSentences,
    index,
    maxRank
  )) {
    if (!isFrameSolvable(documentSentences, slot, index, frameFillers)) {
      continue;
    }
    const entry = finishRow({
      band,
      construction: "stitched-in-level",
      id: `${level.toLowerCase()}c-${first}`,
      index,
      level,
      maxRank,
      seedId: document.ids.join("+"),
      slot,
      sourceIds: document.ids,
      sourceText: document.text,
    });
    if (entry !== null) {
      return entry;
    }
  }
  return null;
};

/** A topic the batch must not open: too few sentences to gather a document, an
 * id the judge rejected, or an opener another row already spent. */
const stitchedTopicSkipped = ({
  first,
  holders,
  id,
  rejected,
  usedOpeners,
}: {
  first: string;
  holders: readonly SourceSentence[];
  id: string;
  rejected: ReadonlySet<string>;
  usedOpeners: ReadonlySet<string>;
}): boolean =>
  holders.length < STITCH_MIN_TOPIC_SENTENCES ||
  rejected.has(id) ||
  usedOpeners.has(first);

/**
 * The whole stitched batch: walk the topic nouns in the order the corpus prints
 * them, keep the first `count` rows, one row per ANSWER WORD, and skip any row
 * the judge rejected or the batch already opened a document with.
 *
 * `usedOpeners` is the id rule, not a cosmetic one: a row is named by the first
 * sentence its document cites, and two topics can gather their sentences from
 * the same opening line. Without this the second would silently overwrite the
 * first in the store file.
 */
export const buildStitchedBatch = (
  dataDir: string,
  level: string,
  count: number
): readonly ChuubunEntry[] => {
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const supply = inLevelSentences(
    readSourceSentences(join(dataDir, "sentences", "sentences.jsonl")),
    index
  );
  const fillers = buildFrameFillers(
    supply.map((sentence) => ({ id: sentence.id, text: sentence.jp })),
    index,
    maxRank
  );
  const rejected = readChuubunRejections(join(dataDir, "reading"), level);
  const batch: ChuubunEntry[] = [];
  const seenAnswers = new Set<string>();
  const usedOpeners = new Set<string>();
  for (const [topic, holders] of stitchedTopicSupply(supply, index, maxRank)) {
    if (batch.length >= count) {
      break;
    }
    const first = holders[0]?.id ?? "";
    if (
      stitchedTopicSkipped({
        first,
        holders,
        id: `${level.toLowerCase()}c-${first}`,
        rejected,
        usedOpeners,
      })
    ) {
      continue;
    }
    if (
      !pushDistinctAnswer(
        batch,
        buildStitchedEntry(topic, holders, level, index, fillers),
        seenAnswers
      )
    ) {
      continue;
    }
    usedOpeners.add(first);
  }
  return batch;
};

/** The whole batch for a level: walk the corpus in order, keep the first
 * `count` rows, one row per ANSWER WORD (a paper must ask distinct things), and
 * skip any row the judge rejected. */
export const buildBatch = (
  paragraphs: readonly HakushoParagraph[],
  dataDir: string,
  level: string,
  count: number
): readonly ChuubunEntry[] => {
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const allSentences = paragraphs.flatMap((paragraph) =>
    splitSentences(paragraph)
  );
  const fillers = buildFrameFillers(allSentences, index, maxRank);
  const rejected = readChuubunRejections(join(dataDir, "reading"), level);
  const batch: ChuubunEntry[] = [];
  const seenAnswers = new Set<string>();
  for (const paragraph of paragraphs) {
    if (batch.length >= count) {
      break;
    }
    if (rejected.has(`${level.toLowerCase()}c-${paragraph.id}`)) {
      continue;
    }
    pushDistinctAnswer(
      batch,
      buildEntry(paragraph, dataDir, level, index, fillers),
      seenAnswers
    );
  }
  return batch;
};

const parseArgs = (argv: readonly string[]): { count: number; level: string } =>
  parseArgsWithLevel(argv, {
    defaultCount: 12,
    defaultLevel: "N2",
    levelGuard: (level) => {
      if (!(level in COVERAGE_FLOOR)) {
        const allowed = Object.keys(COVERAGE_FLOOR).join(" or ");
        throw new Error(`--level must be ${allowed}, got ${level}`);
      }
    },
  });

if (import.meta.main) {
  const dataDir = join(import.meta.dir, "..", "data");
  const { count, level } = parseArgs(process.argv.slice(2));
  // One table decides which corpus a level composes from, so the file written
  // here and the file `check:reading-chuubun` re-proves cannot disagree about
  // what backs a level.
  if (CHUUBUN_SOURCE[level] === "authored") {
    // A written store is authored and blind-judged, never assembled out of a
    // corpus, so there is nothing here to generate. Running this at such a level
    // would overwrite the judged file with masked rows, which is the conversion
    // undone by accident, so it stops instead.
    console.error(
      `gen:reading-chuubun: ${level} is composed as authored rows (doc-27 §10); write the store and freeze its judge record instead of generating`
    );
    process.exit(1);
  }
  const batch =
    CHUUBUN_SOURCE[level] === "sentences"
      ? buildStitchedBatch(dataDir, level, count)
      : buildBatch(
          readHakushoParagraphs(join(dataDir, "reading", "hakusho.jsonl")),
          dataDir,
          level,
          count
        );
  const outPath = join(
    dataDir,
    "reading",
    `${level.toLowerCase()}-chuubun.json`
  );
  writeFormattedStore(outPath, batch, "gen:reading-chuubun");
  console.log(
    `${level}-chuubun.json: ${batch.length} ${
      CHUUBUN_SOURCE[level] === "sentences"
        ? "stitched-in-level"
        : "masked-slot"
    } rows`
  );
}
