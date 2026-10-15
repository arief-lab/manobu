/**
 * Measure the readable supply of the pinned 白書 corpus WITHOUT touching any
 * store (TASK-173.9.9, extended for 統合理解 by TASK-173.9.3). Per level it
 * prints: paragraphs in the 200–1200 rune band, how many clear the shared
 * COVERAGE_FLOOR, and how many rows the generator could actually build with the
 * judge-rejection record applied. The clearing count is the floor metric the
 * widening decisions are made on; the generator supply is the real ceiling,
 * because frame solvability and the one-row-per-answer-word rule spend
 * paragraphs the floor count cannot.
 *
 * 統合理解 adds a second axis: a row needs a PAIR, so the probe prints how many
 * admissible pairs the screens license at all and how many rows survive once
 * each paragraph may be spent only once. That gap is the paper depth.
 *
 * 短文 (TASK-173.9.11) measures the same corpus through its own 100–240 rune
 * band, the server's 短文 cap, so its supply is a different and much narrower
 * cut of the paragraphs than the 中文 number above it. Its generator supply
 * already excludes the paragraphs the shipped 短文 and 中文 stores spent, so it
 * is what a refill can still build, not what ever existed.
 *
 * N4 中文 (TASK-173.9.15) measures the 白書 last to prove it empty and then asks
 * the same question of the licensed sentence corpus, because the shipped N4 rows
 * are stitched from sentences, not drawn from a paragraph.
 *
 * **EVERY NUMBER THIS PRINTS IS HISTORY SINCE TASK-173.9.21.** It still runs,
 * because the probe reads the SCREENS directly (`coverageOf`, `slotsFor`,
 * `buildBatch`) and not the routing tables, so no level's `*_SOURCE` entry can
 * switch it off. What it can no longer do is justify a store decision: with N1
 * converted, the 白書 短文/中文/長文 window, the authored-key 主張 window and the
 * shared-topic 統合 pair back nothing that ships, and doc-27 §10/.13/.14/.15/.16
 * own why the answer to a thin-supply measurement became authoring rather than
 * filling. Treat a healthy supply figure here as a measurement of a route this
 * repo left, never as a reason to reopen it.
 *
 * Deterministic, no network. Run from this package:
 * `bun run measure:reading-supply [path.jsonl]`.
 */

import { join } from "node:path";
import { buildBatch, buildStitchedBatch } from "./gen-reading-chuubun";
import { buildBatch as buildTanbunBatch } from "./gen-reading-tanbun";
import {
  admissiblePairs,
  buildBatch as buildTougouBatch,
} from "./gen-reading-tougou";
import {
  CHUUBUN_MAX_PASSAGE_LENGTH,
  CHUUBUN_MIN_PASSAGE_LENGTH,
  COVERAGE_FLOOR,
  coverageOf,
  type HakushoParagraph,
  inLevelSentences,
  LEVEL_RANKS,
  levelsUpTo,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
  STITCH_MIN_TOPIC_SENTENCES,
  stitchedTopicSupply,
} from "./reading-chuubun-corpus";
import { readSourceSentences } from "./reading-n4-corpus";
import {
  TANBUN_MAX_PASSAGE_LENGTH,
  TANBUN_MIN_PASSAGE_LENGTH,
} from "./reading-tanbun-corpus";
import { nounIndex, prepareTougouCorpus } from "./reading-tougou-corpus";

const dataDir = join(import.meta.dir, "..", "data");

const SUPPLY_TARGET = 1_000_000;

/**
 * How many paragraphs of the corpus sit in a passage band, and how many of
 * those clear the level's coverage floor. One probe for both the 中文 and the
 * 短文 bands, because a store's ceiling is a different cut of the same corpus
 * and the two numbers must be comparable.
 */
const bandSupply = (
  paragraphs: readonly HakushoParagraph[],
  index: ReturnType<typeof readCumulativeVocabIndex>,
  maxRank: number,
  floor: number,
  min: number,
  max: number
): { readonly clearsFloor: number; readonly inBand: number } => {
  let inBand = 0;
  let clearsFloor = 0;
  for (const paragraph of paragraphs) {
    const runes = [...paragraph.text].length;
    if (runes < min || runes > max) {
      continue;
    }
    inBand += 1;
    if (coverageOf(paragraph.text, index, maxRank) >= floor) {
      clearsFloor += 1;
    }
  }
  return { clearsFloor, inBand };
};

/**
 * The N4 中文 line (TASK-173.9.15). The 白書 numbers come first because they ARE
 * the refusal the second construction exists to answer: at N4 no paragraph clears
 * the floor, so the supply question moves to the licensed sentence corpus, where it
 * asks how many topic nouns can hold a 400-600 rune document at all, and how many
 * of those documents the screens leave as rows.
 */
const stitchSupply = (paragraphs: readonly HakushoParagraph[]): void => {
  const level = "N4";
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const floor = COVERAGE_FLOOR[level] ?? 1;
  const hakusho = bandSupply(
    paragraphs,
    index,
    maxRank,
    floor,
    CHUUBUN_MIN_PASSAGE_LENGTH,
    CHUUBUN_MAX_PASSAGE_LENGTH
  );
  const sentences = inLevelSentences(
    readSourceSentences(join(dataDir, "sentences", "sentences.jsonl")),
    index
  );
  const topics = stitchedTopicSupply(sentences, index, maxRank);
  let eligible = 0;
  for (const holders of topics.values()) {
    if (holders.length >= STITCH_MIN_TOPIC_SENTENCES) {
      eligible += 1;
    }
  }
  const rows = buildStitchedBatch(dataDir, level, SUPPLY_TARGET).length;
  console.log(
    `${level} 白書: in-band ${hakusho.inBand}, clears floor ${hakusho.clearsFloor} (floor ${floor})`
  );
  console.log(
    `${level} 中文 stitch: in-level sentences ${sentences.length}, topic nouns ${topics.size}, topics with ${STITCH_MIN_TOPIC_SENTENCES}+ sentences ${eligible}, generator supply ${rows}`
  );
};

const measure = (corpusPath: string): void => {
  const paragraphs = readHakushoParagraphs(corpusPath);
  console.log(`corpus: ${corpusPath} (${paragraphs.length} paragraphs)`);
  for (const level of ["N3", "N2", "N1"]) {
    const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
    const maxRank = LEVEL_RANKS[level] ?? 0;
    const floor = COVERAGE_FLOOR[level] ?? 1;
    const { clearsFloor, inBand } = bandSupply(
      paragraphs,
      index,
      maxRank,
      floor,
      CHUUBUN_MIN_PASSAGE_LENGTH,
      CHUUBUN_MAX_PASSAGE_LENGTH
    );
    const supply = buildBatch(paragraphs, dataDir, level, SUPPLY_TARGET).length;
    console.log(
      `${level}: in-band ${inBand}, clears floor ${clearsFloor} (floor ${floor}), generator supply ${supply}`
    );
    const tanbun = bandSupply(
      paragraphs,
      index,
      maxRank,
      floor,
      TANBUN_MIN_PASSAGE_LENGTH,
      TANBUN_MAX_PASSAGE_LENGTH
    );
    const tanbunSupply = buildTanbunBatch(
      paragraphs,
      dataDir,
      level,
      SUPPLY_TARGET
    ).length;
    console.log(
      `${level} 短文: in-band ${tanbun.inBand}, clears floor ${tanbun.clearsFloor} (floor ${floor}), generator supply ${tanbunSupply}`
    );
  }
  stitchSupply(paragraphs);
  for (const level of ["N2", "N1"]) {
    const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
    const docs = prepareTougouCorpus(paragraphs, index, level);
    const pairs = admissiblePairs(docs, nounIndex(docs));
    const rows = buildTougouBatch(paragraphs, dataDir, level, SUPPLY_TARGET);
    console.log(
      `${level} 統合理解: clearing documents ${docs.length}, admissible pairs ${pairs.length}, disjoint rows ${rows.length}`
    );
  }
};

if (import.meta.main) {
  const corpusPath =
    process.argv[2] ?? join(dataDir, "reading", "hakusho.jsonl");
  measure(corpusPath);
}
