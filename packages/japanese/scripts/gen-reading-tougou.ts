/**
 * `gen:reading-tougou` — compose the N2/N1 統合理解 reading store from PAIRS of
 * 白書 paragraphs (TASK-173.9.3). Deterministic: no LLM, no network, same input
 * bytes produce the same output bytes.
 *
 * A 統合理解 小問 is the first block in this codebase that is answered from TWO
 * documents. The official ねらい (doc-26 §1) is 「複数のテキスト（合計600字程度）を
 * 読み比べて、比較・統合しながら理解できるかを問う」, so the row prints both
 * paragraphs and asks what BOTH mention.
 *
 * The oracle is the provable surface of that ねらい: the key is an in-level noun
 * printed by both documents and by no third document in the clearing corpus, and
 * each distractor is an in-level noun printed by EXACTLY ONE of the two. A learner
 * who read only one document cannot separate key from distractors, and no option
 * requires a judgement call about what an author "really" claims. What this does
 * NOT deliver is the deeper 比較・統合 (inferring the relationship between two
 * framings of a topic); the store ships that limitation, and `data/LICENSE.md`
 * and doc-26 §4 state it, rather than claiming more than the screens prove.
 *
 * The deterministic screens this generator runs, re-proved by
 * `check-reading-tougou`:
 *   1. each document is in the 200–1200 rune band at the level's coverage floor
 *      (the same `prepareTougouCorpus` the 中文 pool reads),
 *   2. the pair totals 400–800 runes, the 合計600字程度 band,
 *   3. the two documents come from different paragraphs AND different pages,
 *   4. the key is printed by both and by no third clearing document,
 *   5. three distractors exist, each printed by exactly one document, none
 *      sharing the key's reading or dominant English sense, and none the other
 *      document paraphrases (`optionParaphraseIssues`),
 *   6. the emitted row re-passes `rowClaimIssues` against its own printed text.
 *
 * `index` defaults to the shipped cumulative vocabulary read from `dataDir`;
 * tests inject their own.
 *
 * Selection walks corpus order (first document, then the first later document
 * that yields an admissible key), spends each paragraph once per batch so no
 * paragraph backs two 小問, and skips a pair whose row id the judge rejected.
 *
 * The 統合理解 小問 is 大問11 (N1, 3 小問) / 大問12 (N2, 2 小問)
 * (`PAPER_BLOCK_SHAPES.tougou-rikai`, doc-26 §3.4/§3.5).
 *
 * Run from this package: `bun run gen:reading-tougou --level N2 --count 2`.
 */

import { join } from "node:path";
import { hashString } from "@manobu/item-engine/hash";
import { placeSeededOptions } from "./gen-reading-chuubun";
import { parseArgsWithLevel, writeFormattedStore } from "./gen-reading-cli";
import {
  type HakushoParagraph,
  levelsUpTo,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
} from "./reading-chuubun-corpus";
import {
  nounIndex,
  oneSidedNouns,
  optionParaphraseIssues,
  pairIssues,
  prepareTougouCorpus,
  readTougouRejections,
  rowClaimIssues,
  TOUGOU_BLOCK,
  TOUGOU_CONSTRUCTION,
  TOUGOU_DISTRACTOR_COUNT,
  TOUGOU_OPTION_COUNT,
  TOUGOU_SIGNER,
  TOUGOU_SOURCE,
  TOUGOU_SOURCE_EN,
  TOUGOU_STEM,
  type TougouDocument,
  type TougouPair,
  tougouIdFor,
} from "./reading-tougou-corpus";

/** One frozen store row, as written to `{level}-tougou.json`. A row is the only
 * reading row with TWO passages, so provenance is a parallel array per document
 * rather than one url/credit. */
export interface TougouEntry {
  readonly answerIndex: number;
  readonly block: string;
  readonly construction: typeof TOUGOU_CONSTRUCTION;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  /** Printed in reading order: the first document, then the second. */
  readonly passages: readonly string[];
  readonly provenance: "composed";
  readonly sourceCredits: readonly string[];
  readonly sourceEn: string;
  readonly sourceIds: readonly string[];
  readonly sourceUrls: readonly string[];
  readonly stem: string;
  readonly validated: boolean;
  readonly validatedBy: string;
}

/**
 * The four printed options and the key index. The key is drawn into the list by
 * a seeded permutation (seeded on the pair and the key), so no answer position
 * is fixed and the same inputs always print the same bytes.
 */
const drawOptions = (
  key: string,
  distractors: readonly string[],
  seed: number
): { readonly answerIndex: number; readonly options: string[] } | null => {
  const drawn = [key, ...distractors];
  if (drawn.length !== TOUGOU_OPTION_COUNT) {
    return null;
  }
  return placeSeededOptions(drawn, TOUGOU_OPTION_COUNT, seed);
};

/** An admissible pair with the options its key licenses: the generator's unit
 * of selection, one step past the contract's `TougouPair`. */
export interface SelectedPair extends TougouPair {
  readonly distractors: readonly string[];
}

/**
 * The first admissible key of a document pair, with its distractors, or null
 * when the pair cannot carry a 小問. Keys are tried in the first document's
 * appearance order, so the choice is a property of the corpus, not of the walk.
 */
const pairWithKey = (
  a: TougouDocument,
  b: TougouDocument,
  byNoun: ReadonlyMap<string, readonly number[]>
): SelectedPair | null => {
  for (const key of a.nouns.keys()) {
    if (!b.nouns.has(key)) {
      continue;
    }
    if (pairIssues({ a, b, byNoun, key }).length > 0) {
      continue;
    }
    const distractors = oneSidedNouns({ a, b, key }, TOUGOU_DISTRACTOR_COUNT);
    if (distractors.length < TOUGOU_DISTRACTOR_COUNT) {
      continue;
    }
    return { a, b, distractors, key };
  }
  return null;
};

/**
 * Every admissible pair, in deterministic corpus order: documents ascending,
 * then the later documents ascending. The batch walk and the supply probe read
 * the same list, so a measurement of 統合理解 supply is a property of the
 * shipped screens rather than of a scratch script.
 */
export const admissiblePairs = (
  docs: readonly TougouDocument[],
  byNoun: ReadonlyMap<string, readonly number[]>
): readonly SelectedPair[] => {
  const pairs: SelectedPair[] = [];
  for (const [at, a] of docs.entries()) {
    for (const [bt, b] of docs.entries()) {
      if (bt <= at) {
        continue;
      }
      const chosen = pairWithKey(a, b, byNoun);
      if (chosen !== null) {
        pairs.push(chosen);
      }
    }
  }
  return pairs;
};

/** Build one row from an admissible pair, or null when the row it would print
 * fails its own text-level screens. */
export const buildEntry = (
  level: string,
  pair: SelectedPair
): TougouEntry | null => {
  const { a, b, distractors, key } = pair;
  const id = tougouIdFor(level, a.id, b.id);
  const passages = [a.text, b.text];
  if (
    rowClaimIssues({ answer: key, distractors, passages }).length > 0 ||
    optionParaphraseIssues({ a, b, distractors }).length > 0
  ) {
    return null;
  }
  const drawn = drawOptions(key, distractors, hashString(`tougou:${id}`));
  if (drawn === null) {
    return null;
  }
  return {
    ...drawn,
    block: TOUGOU_BLOCK,
    construction: TOUGOU_CONSTRUCTION,
    id,
    level,
    passages,
    provenance: "composed",
    sourceCredits: [a.source, b.source],
    sourceEn: TOUGOU_SOURCE_EN,
    sourceIds: [a.id, b.id],
    sourceUrls: [a.pageUrl, b.pageUrl],
    stem: TOUGOU_STEM,
    validated: true,
    validatedBy: TOUGOU_SIGNER,
  };
};

/**
 * The whole batch for a level: admissible pairs in corpus order, each document
 * spent once, judge-rejected rows skipped so the paragraphs they burned stay
 * available to the rest of the walk.
 */
export const buildBatch = (
  paragraphs: readonly HakushoParagraph[],
  dataDir: string,
  level: string,
  count: number,
  index = readCumulativeVocabIndex(dataDir, levelsUpTo(level))
): readonly TougouEntry[] => {
  const docs = prepareTougouCorpus(paragraphs, index, level);
  const byNoun = nounIndex(docs);
  const rejected = readTougouRejections(join(dataDir, "reading"), level);
  const batch: TougouEntry[] = [];
  const spent = new Set<string>();
  for (const pair of admissiblePairs(docs, byNoun)) {
    if (batch.length >= count) {
      break;
    }
    const { a, b } = pair;
    if (spent.has(a.id) || spent.has(b.id)) {
      continue;
    }
    if (rejected.has(tougouIdFor(level, a.id, b.id))) {
      continue;
    }
    const entry = buildEntry(level, pair);
    if (entry === null) {
      continue;
    }
    spent.add(a.id);
    spent.add(b.id);
    batch.push(entry);
  }
  return batch;
};

const parseArgs = (argv: readonly string[]): { count: number; level: string } =>
  parseArgsWithLevel(argv, {
    defaultCount: 3,
    defaultLevel: "N2",
    levelGuard: (level) => {
      if (level !== "N2" && level !== "N1") {
        throw new Error(`--level must be N2 or N1, got ${level}`);
      }
    },
  });

if (import.meta.main) {
  const dataDir = join(import.meta.dir, "..", "data");
  const { count, level } = parseArgs(process.argv.slice(2));
  // The same table the gate reads for the construction a row may claim decides
  // which levels this block composes as written pairs, so a level cannot be
  // generated against the 白書 and checked as authored.
  if (TOUGOU_SOURCE[level] === "authored") {
    // A written pair is authored and blind-judged, never matched out of the 白書
    // by a shared noun, so there is nothing here to generate. Running this at such
    // a level would overwrite the judged file with topic-lookup rows, which is the
    // conversion undone by accident, so it stops instead.
    console.error(
      `gen:reading-tougou: ${level} is composed as authored 統合理解 pairs (doc-27 §10); write the store and freeze its judge record instead of generating`
    );
    process.exit(1);
  }
  const paragraphs = readHakushoParagraphs(
    join(dataDir, "reading", "hakusho.jsonl")
  );
  const batch = buildBatch(paragraphs, dataDir, level, count);
  const outPath = join(
    dataDir,
    "reading",
    `${level.toLowerCase()}-tougou.json`
  );
  writeFormattedStore(outPath, batch, "gen:reading-tougou");
  console.log(
    `${level}-tougou.json: ${batch.length} pair rows from ${paragraphs.length} paragraphs`
  );
}
