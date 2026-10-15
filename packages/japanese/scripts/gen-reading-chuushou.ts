/**
 * `gen:reading-chuushou` — compose the N2/N1 主張理解（長文） reading store
 * from AUTHORED claims paired to 白書 paragraphs (TASK-173.9.2 slice 2).
 * Deterministic: no LLM, no network, same input bytes produce the same output
 * bytes.
 *
 * The construction mirrors the 中文 pipeline (`gen-reading-chuubun.ts`),
 * scaled to a different 小問: the passage is a whole 白書 paragraph (200–1200
 * runes, in-level coverage at the measured floor), the stem is fixed
 * (`この文章で筆者が最も主張していることはどれか`), and the four options are the
 * authored claim plus three authored Japanese distractors. "Exactly one
 * defensible option" is NOT true by construction the way a maskedslot is —
 * the key is a claim the source does not print as a claim — so the batch is
 * signed `deterministic:gen-reading-chuushou` for the CONSTRUCTION (passage +
 * stem + four JP options + the deterministic screens), and the semantic
 * question is removed by the blind-judge pass recorded in
 * `data/reading/{level}-chuushou-rejected.json` (`prompts/reading-validator.md`).
 *
 * The deterministic screens this generator runs, re-proved by
 * `check-reading-chuushou`:
 *   1. passage length band (200–1200 runes),
 *   2. in-level coverage at the level's measured floor,
 *   3. at least three distractors, all distinct and not the claim,
 *   4. the claim term is printed by its own paragraph (the authored claim is
 *      anchored to a word the source actually prints),
 *   5. no distractor is printed by the source (a second defensible answer the
 *      learner could read off the page).
 *
 * Pairing: a claim pairs with the first UNUSED paragraph that prints its term
 * and clears the screens; each paragraph spends once per batch (one passage
 * per 小問), and judge-rejected paragraph ids are skipped so a regeneration
 * walks deeper into the claims file.
 *
 * The 主張理解 小問 is the JLPT 大問12 (N1) / 大問13 (N2) block
 * (`PAPER_BLOCK_SHAPES.shuchou-rikai-choubun`, doc-26 §3.4/§3.5).
 *
 * Run from this package: `bun run gen:reading-chuushou --level N2 --count 3`.
 * The authored claim set is a freeze-time input at
 * `data/reading/{level}-chuushou-claims.json`
 * (`[{ "claim": "...", "distractors": ["...", "...", "..."] }, ...]`).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashString } from "@manobu/item-engine/hash";
import { placeSeededOptions } from "./gen-reading-chuubun";
import { parseArgsWithLevel, writeFormattedStore } from "./gen-reading-cli";
import {
  COVERAGE_FLOOR,
  coverageOf,
  type HakushoParagraph,
  LEVEL_RANKS,
  levelsUpTo,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
} from "./reading-chuubun-corpus";
import {
  CHUSHOU_BLOCK,
  CHUSHOU_MAX_PASSAGE_LENGTH,
  CHUSHOU_MIN_PASSAGE_LENGTH,
  CHUSHOU_SIGNER,
  CHUSHOU_SOURCE,
  CHUSHOU_SOURCE_EN,
  CHUSHOU_STEM,
  chuushouIdFor,
  readChuushouRejections,
} from "./reading-chuushou-corpus";
import type { VocabIndex } from "./reading-n4-corpus";

const OPTION_COUNT = 4;
const DISTRACTOR_COUNT = OPTION_COUNT - 1;

/** One frozen store row, as written to `{level}-chuushou.json`. */
export interface ChuushouEntry {
  readonly answerIndex: number;
  readonly block: string;
  readonly construction: "authored-key";
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly provenance: "composed";
  /** The PDL1.0 credit the store must print, with the page URL substituted. */
  readonly sourceCredit: string;
  readonly sourceEn: string;
  readonly sourceIds: readonly string[];
  readonly sourceUrl: string;
  readonly stem: string;
  readonly validated: boolean;
  readonly validatedBy: string;
}

/** One authored claim from the freeze-time claims file. */
export interface AuthoredClaim {
  readonly claim: string;
  readonly distractors: readonly string[];
}

/**
 * The four printed options and the key index. The key is drawn into the
 * option list by a seeded permutation (seeded on the paragraph and the claim),
 * so there is no fixed answer position and no batch-wide shared distractor
 * head, and the same inputs always print the same bytes.
 */
const drawOptions = (
  claim: string,
  distractors: readonly string[],
  seed: number
): { readonly answerIndex: number; readonly options: string[] } | null => {
  const drawn = [claim, ...distractors];
  if (drawn.length !== OPTION_COUNT) {
    return null;
  }
  return placeSeededOptions(drawn, OPTION_COUNT, seed);
};

/** Whether the claim and its three distractors fail to form a defensible key
 * set for this paragraph: the claim must be printed, and no distractor may be
 * empty, repeated, or printed by the paragraph. */
const claimSetRejected = (
  chosen: readonly string[],
  claim: string,
  paragraph: HakushoParagraph
): boolean => {
  if (claim.length === 0 || !paragraph.text.includes(claim)) {
    return true;
  }
  const seen = new Set<string>([claim]);
  for (const distractor of chosen) {
    if (distractor.length === 0 || seen.has(distractor)) {
      return true;
    }
    if (paragraph.text.includes(distractor)) {
      return true;
    }
    seen.add(distractor);
  }
  return false;
};

/** Build one row from a paragraph + authored claim, or null when the
 * readable-source screens refuse the pair. `index` defaults to the shipped
 * cumulative vocabulary read from `dataDir`; tests inject their own. */
export const buildEntry = (
  paragraph: HakushoParagraph,
  dataDir: string,
  level: string,
  claim: string,
  distractors: readonly string[],
  index = readCumulativeVocabIndex(dataDir, levelsUpTo(level))
): ChuushouEntry | null => {
  const runes = [...paragraph.text].length;
  if (
    runes < CHUSHOU_MIN_PASSAGE_LENGTH ||
    runes > CHUSHOU_MAX_PASSAGE_LENGTH
  ) {
    return null;
  }
  const maxRank = LEVEL_RANKS[level] ?? 0;
  if (
    coverageOf(paragraph.text, index, maxRank) < (COVERAGE_FLOOR[level] ?? 1)
  ) {
    return null;
  }
  if (distractors.length < DISTRACTOR_COUNT) {
    return null;
  }
  const chosen = distractors.slice(0, DISTRACTOR_COUNT);
  if (claimSetRejected(chosen, claim, paragraph)) {
    return null;
  }
  const drawn = drawOptions(
    claim,
    chosen,
    hashString(`chuushou:${paragraph.id}:${claim}`)
  );
  if (drawn === null) {
    return null;
  }
  return {
    ...drawn,
    block: CHUSHOU_BLOCK,
    construction: "authored-key",
    id: chuushouIdFor(level, paragraph.id),
    level,
    passage: paragraph.text,
    provenance: "composed",
    sourceCredit: paragraph.source,
    sourceEn: CHUSHOU_SOURCE_EN,
    sourceIds: [paragraph.id],
    sourceUrl: paragraph.pageUrl,
    stem: CHUSHOU_STEM,
    validated: true,
    validatedBy: CHUSHOU_SIGNER,
  };
};

/** The first unused, unjudged-rejected paragraph that backs this claim, or null
 * when none of them does. The paragraph id travels with the entry because the
 * caller spends the paragraph, not the row. */
const entryForClaim = ({
  claim,
  dataDir,
  distractors,
  index,
  level,
  paragraphs,
  rejected,
  spentParagraphs,
}: {
  readonly claim: string;
  readonly dataDir: string;
  readonly distractors: readonly string[];
  readonly index: VocabIndex;
  readonly level: string;
  readonly paragraphs: readonly HakushoParagraph[];
  readonly rejected: ReadonlySet<string>;
  readonly spentParagraphs: ReadonlySet<string>;
}): { readonly entry: ChuushouEntry; readonly paragraphId: string } | null => {
  for (const paragraph of paragraphs) {
    if (spentParagraphs.has(paragraph.id)) {
      continue;
    }
    if (rejected.has(chuushouIdFor(level, paragraph.id))) {
      continue;
    }
    const entry = buildEntry(
      paragraph,
      dataDir,
      level,
      claim,
      distractors,
      index
    );
    if (entry !== null) {
      return { entry, paragraphId: paragraph.id };
    }
  }
  return null;
};

/** The whole batch for a level: one row per DISTINCT authored claim, each
 * paired with the first unused paragraph that prints its claim term and
 * clears the screens. Skips any paragraph the judge rejected. */
export const buildBatch = (
  paragraphs: readonly HakushoParagraph[],
  dataDir: string,
  level: string,
  count: number,
  claims: readonly AuthoredClaim[]
): readonly ChuushouEntry[] => {
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const rejected = readChuushouRejections(join(dataDir, "reading"), level);
  const batch: ChuushouEntry[] = [];
  const seenClaims = new Set<string>();
  const spentParagraphs = new Set<string>();
  for (const { claim, distractors } of claims) {
    if (batch.length >= count) {
      break;
    }
    if (seenClaims.has(claim)) {
      continue;
    }
    const found = entryForClaim({
      claim,
      dataDir,
      distractors,
      index,
      level,
      paragraphs,
      rejected,
      spentParagraphs,
    });
    if (found !== null) {
      seenClaims.add(claim);
      spentParagraphs.add(found.paragraphId);
      batch.push(found.entry);
    }
  }
  return batch;
};

const parseArgs = (argv: readonly string[]): { count: number; level: string } =>
  parseArgsWithLevel(argv, {
    defaultCount: 3,
    defaultLevel: "N2",
    levelGuard: (level) => {
      if (!(level in COVERAGE_FLOOR)) {
        throw new Error(`--level must be N2 or N1, got ${level}`);
      }
    },
  });

if (import.meta.main) {
  const dataDir = join(import.meta.dir, "..", "data");
  const { count, level } = parseArgs(process.argv.slice(2));
  // One table decides which levels this block composes from the 白書 and which as
  // written rows, and the gate reads the SAME table for the construction a row may
  // claim, so the file written here and the file `check:reading-chuushou` re-proves
  // cannot disagree about what backs a level.
  if (CHUSHOU_SOURCE[level] === "authored") {
    // A written 主張 store is authored and blind-judged, never paired out of the
    // 白書, so there is nothing here to generate. Running this at such a level
    // would overwrite the judged file with single-paragraph authored-key rows,
    // which is the conversion undone by accident, so it stops instead.
    console.error(
      `gen:reading-chuushou: ${level} is composed as authored 主張理解 rows (doc-27 §10); write the store and freeze its judge record instead of generating`
    );
    process.exit(1);
  }
  const paragraphs = readHakushoParagraphs(
    join(dataDir, "reading", "hakusho.jsonl")
  );
  const claimsPath = join(
    dataDir,
    "reading",
    `${level.toLowerCase()}-chuushou-claims.json`
  );
  let claims: readonly AuthoredClaim[];
  try {
    claims = JSON.parse(
      readFileSync(claimsPath, "utf8")
    ) as readonly AuthoredClaim[];
  } catch {
    console.error(
      `gen:reading-chuushou: no authored claim set at ${claimsPath}; authoring the ${level} claims is a freeze-time step (see prompts/reading-validator.md)`
    );
    process.exit(1);
  }
  const batch = buildBatch(paragraphs, dataDir, level, count, claims);
  const outPath = join(
    dataDir,
    "reading",
    `${level.toLowerCase()}-chuushou.json`
  );
  writeFormattedStore(outPath, batch, "gen:reading-chuushou");
  console.log(
    `${level}-chuushou.json: ${batch.length} authored-key rows from ${paragraphs.length} paragraphs and ${claims.length} claims`
  );
}
