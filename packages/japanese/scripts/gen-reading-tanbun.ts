/**
 * `gen:reading-tanbun` — build the composed N3/N2/N1 内容理解（短文）reading
 * store from MASKED SLOTS in short in-level 白書 paragraphs (TASK-173.9.11).
 * Deterministic: no LLM, no network, same input bytes produce the same output
 * bytes.
 *
 * The construction is the 中文 one (`gen-reading-chuubun.ts`) at 短文 length: one
 * noun of a 100-240 rune 白書 paragraph is blanked and that noun IS the key, the
 * distractors are same-category in-level nouns the paragraph does not print, and
 * the options are drawn by the same seeded permutation. "Exactly one defensible
 * option" holds by construction, so the batch is signed
 * `deterministic:gen-reading-tanbun` and the server's existing `short-reading`
 * seam serves these rows with no new item type.
 *
 * What is still judgement, and labelled the same way the 中文 store labels it: a
 * distractor can be semantically arguable even though the paragraph never prints
 * it. The deterministic screens remove the mechanical ambiguity (single
 * occurrence, POS match, a collocation frame no other noun fills, a measured
 * coverage floor); the residue is removed by the blind judge pass frozen in
 * `data/reading/{level}-rejected.json` (see `prompts/reading-validator.md`).
 *
 * Two screens belong to this family alone: the source paragraph may not be one
 * the level's 中文/主張理解/統合理解 stores already print (one paper must not show
 * the same text in two 大問), nor one another 白書 level's 短文 store already
 * prints (the three levels walk the same corpus from its head, so without this
 * an N2 paper can hand back the N3 passage with the same key), and the printed
 * passage must fit the server's `short-reading` cap of 240 runes.
 *
 * Because the exclusion reads the other levels' stores, the freeze has an
 * order: N3, then N2, then N1. A level's output then depends only on the 短文
 * stores frozen before it, and the gate re-proves the disjointness from the
 * shipped files, so the order is a generation convention rather than a claim.
 *
 * Run from this package: `bun run gen:reading-tanbun --level N3 --count 24`.
 */

import { join } from "node:path";
import { hashString } from "@manobu/item-engine/hash";
import { drawOptions } from "./gen-reading-chuubun";
import { parseArgsWithLevel, writeFormattedStore } from "./gen-reading-cli";
import {
  buildFrameFillers,
  type ChuubunSlot,
  COVERAGE_FLOOR,
  chuubunDistractorPool,
  coverageOf,
  type HakushoParagraph,
  isFrameSolvable,
  LEVEL_RANKS,
  levelsUpTo,
  pushDistinctAnswer,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
  slotsFor,
  splitSentences,
} from "./reading-chuubun-corpus";
import { BLANK, blankedPassage, type VocabIndex } from "./reading-n4-corpus";
import {
  readTanbunRejections,
  TANBUN_BLOCK,
  TANBUN_CONSTRUCTION,
  TANBUN_MAX_PASSAGE_LENGTH,
  TANBUN_MIN_PASSAGE_LENGTH,
  TANBUN_SIGNER,
  TANBUN_SOURCE,
  TANBUN_STEM,
  tanbunSpentSourceIds,
} from "./reading-tanbun-corpus";

/** A 短文 小問 prints four options: the key the paragraph states plus three
 * distractors drawn from the same-category in-level pool. */
const OPTION_COUNT = 4;

export interface TanbunReadingEntry {
  readonly answerIndex: number;
  readonly block: string;
  readonly construction: "masked-slot";
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly provenance: "composed";
  /** The PDL1.0 credit the store must print, with the page URL substituted. */
  readonly sourceCredit: string;
  readonly sourceIds: readonly string[];
  readonly sourceUrl: string;
  readonly stem: string;
  readonly validated: boolean;
  readonly validatedBy: string;
}

/** Why this paragraph cannot back a 短文 cloze at all: outside the band on
 * either side, or under the level's coverage floor. */
const paragraphRejected = (
  index: VocabIndex,
  level: string,
  paragraph: HakushoParagraph
): boolean => {
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const floor = COVERAGE_FLOOR[level] ?? 1;
  const runes = [...paragraph.text].length;
  if (runes < TANBUN_MIN_PASSAGE_LENGTH || runes > TANBUN_MAX_PASSAGE_LENGTH) {
    return true;
  }
  return coverageOf(paragraph.text, index, maxRank) < floor;
};

/** The blanked passage for one slot, or null when it cannot be printed: no
 * blank landed, or the masked text fell under the band floor. */
const slotPassage = (
  paragraph: HakushoParagraph,
  slot: ChuubunSlot
): string | null => {
  const passage = blankedPassage(
    { en: "", id: paragraph.id, jp: paragraph.text, linkedWords: [] },
    slot.surface,
    TANBUN_MAX_PASSAGE_LENGTH
  );
  if (passage === null || !passage.includes(BLANK)) {
    return null;
  }
  if ([...passage].length < TANBUN_MIN_PASSAGE_LENGTH) {
    return null;
  }
  return passage;
};

/** What trying to finish one slot yields: a row, nothing for this slot, or a
 * draw failure that ends the row entirely. */
type SlotAttempt =
  | { readonly entry: TanbunReadingEntry; readonly kind: "row" }
  | { readonly kind: "continue" }
  | { readonly kind: "abort" };

const finishSlot = ({
  index,
  level,
  maxRank,
  paragraph,
  slot,
}: {
  readonly index: VocabIndex;
  readonly level: string;
  readonly maxRank: number;
  readonly paragraph: HakushoParagraph;
  readonly slot: ChuubunSlot;
}): SlotAttempt => {
  const passage = slotPassage(paragraph, slot);
  if (passage === null) {
    return { kind: "continue" };
  }
  const pool = chuubunDistractorPool(
    index,
    slot.pos,
    maxRank,
    slot.entry,
    slot.surface,
    paragraph.text
  );
  if (pool.length < OPTION_COUNT - 1) {
    return { kind: "continue" };
  }
  const drawn = drawOptions(
    slot.surface,
    pool,
    hashString(`tanbun:${paragraph.id}:${slot.surface}`)
  );
  if (drawn === null) {
    return { kind: "abort" };
  }
  return {
    entry: {
      ...drawn,
      block: TANBUN_BLOCK,
      construction: TANBUN_CONSTRUCTION,
      id: `${level.toLowerCase()}t-${paragraph.id}`,
      level,
      passage,
      provenance: "composed",
      sourceCredit: paragraph.source,
      sourceIds: [paragraph.id],
      sourceUrl: paragraph.pageUrl,
      stem: TANBUN_STEM,
      validated: true,
      validatedBy: TANBUN_SIGNER,
    },
    kind: "row",
  };
};

/** Build one row from a short paragraph, or null when it cannot back an
 * unambiguous 短文 cloze at this level. */
export const buildEntry = (
  paragraph: HakushoParagraph,
  dataDir: string,
  level: string,
  index = readCumulativeVocabIndex(dataDir, levelsUpTo(level)),
  fillers?: ReturnType<typeof buildFrameFillers>
): TanbunReadingEntry | null => {
  const maxRank = LEVEL_RANKS[level] ?? 0;
  if (paragraphRejected(index, level, paragraph)) {
    return null;
  }
  const sentences = splitSentences(paragraph);
  const frameFillers = fillers ?? buildFrameFillers(sentences, index, maxRank);
  for (const slot of slotsFor(paragraph.text, sentences, index, maxRank)) {
    if (!isFrameSolvable(sentences, slot, index, frameFillers)) {
      continue;
    }
    if (TANBUN_STEM.includes(slot.surface)) {
      // stem-leak: the fixed stem prints 一つ, so a slot with that surface is an
      // answer inside the question, which the gate's validateQuestionItem
      // refuses — skip the slot, do not emit the row.
      continue;
    }
    const attempt = finishSlot({ index, level, maxRank, paragraph, slot });
    if (attempt.kind === "abort") {
      return null;
    }
    if (attempt.kind === "row") {
      return attempt.entry;
    }
  }
  return null;
};

/** The whole batch for a level: walk the corpus in order, keep the first
 * `count` rows, one row per ANSWER WORD, skip the judge rejections and skip any
 * paragraph the level's other 白書 stores already print. */
export const buildBatch = (
  paragraphs: readonly HakushoParagraph[],
  dataDir: string,
  level: string,
  count: number
): readonly TanbunReadingEntry[] => {
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const allSentences = paragraphs.flatMap((paragraph) =>
    splitSentences(paragraph)
  );
  const fillers = buildFrameFillers(allSentences, index, maxRank);
  const storeDir = join(dataDir, "reading");
  const rejected = readTanbunRejections(storeDir, level);
  const spent = tanbunSpentSourceIds(storeDir, level);
  const batch: TanbunReadingEntry[] = [];
  const seenAnswers = new Set<string>();
  for (const paragraph of paragraphs) {
    if (batch.length >= count) {
      break;
    }
    const id = `${level.toLowerCase()}t-${paragraph.id}`;
    if (rejected.has(id) || spent.has(paragraph.id)) {
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
    defaultCount: 24,
    defaultLevel: "N3",
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
  if (TANBUN_SOURCE[level] === "authored") {
    // A written store is authored and blind-judged, never windowed out of the
    // 白書, so there is nothing here to generate. Running this at such a level
    // would overwrite the judged file with masked rows, which is the conversion
    // undone by accident, so it stops instead.
    console.error(
      `gen:reading-tanbun: ${level} is composed as authored 短文 rows (doc-27 §10); write the store and freeze its judge record instead of generating`
    );
    process.exit(1);
  }
  const paragraphs = readHakushoParagraphs(
    join(dataDir, "reading", "hakusho.jsonl")
  );
  const batch = buildBatch(paragraphs, dataDir, level, count);
  const outPath = join(dataDir, "reading", `${level.toLowerCase()}.json`);
  writeFormattedStore(outPath, batch, "gen:reading-tanbun");
  console.log(
    `${level}.json: ${batch.length} masked-slot 短文 rows from ${paragraphs.length} paragraphs`
  );
}
