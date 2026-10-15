/**
 * `check:reading-chuushou` — the deterministic CI gate for the composed N2/N1
 * 主張理解（長文） store (TASK-173.9.2 slice 2; the authored route is
 * TASK-173.9.20). NO LLM runs here.
 *
 * This gate is the only thing that makes `validated: true` in
 * `data/reading/{level}-chuushou.json` mean something: the server trusts the
 * flag at assembly time exactly the way it trusts a licensed store row, so
 * this script re-proves offline, on every run, that each frozen row is
 *
 *   1. provenance `composed`, `validated`, and signed by whichever route its own
 *      `construction` claims: `authored-key` by the pipeline
 *      (`deterministic:gen-reading-chuushou`), `authored` by the blind judge
 *      record (`authored:agent-blind-judged`),
 *   2. ON THE 白書 ROUTE: sourced from EXACTLY ONE 白書 paragraph, present in the
 *      corpus, byte-equal to that source, inside the passage band (200–1200 runes)
 *      at the level's measured coverage floor, claiming a term the source prints
 *      with NO distractor printed by it,
 *   3. ON THE AUTHORED ROUTE: a written multi-paragraph document inside
 *      `CHUSHOU_AUTHORED_BAND` carrying the fixed 主張理解 stem, an `evidence`
 *      sentence it prints verbatim, a key that is a PARAPHRASE of that sentence
 *      rather than a copy of it, and three distractors each failing for a stated
 *      reason the printed text can check (`chuushouAuthoredOptionIssues`),
 *   4. structurally valid per the item-engine validator
 *      (`validateQuestionItem`) over a minimal corpus view,
 *   5. absent from the freeze-time judge record.
 *
 * File-level: at least one paper's worth of rows (N2 大問13 prints 3 小問, N1
 * 大問12 prints 4), ids, passages and claims unique, ONE construction per store,
 * and on the authored route the distractor contract SPREAD over all three failure
 * modes rather than one of them three times.
 *
 * Run from this package: `bun run check:reading-chuushou --level N2`. Exit 0 =
 * every row passes; exit 1 = issues listed, or a store is not frozen yet. The
 * exported `checkEntry` / `checkReadingFile` are the test seams.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  certIssues,
  type EntryReport,
  isFilledText,
  type ReadingEntryFields,
  readingShapeOf,
  runReadingGateMain,
  structuralIssuesFor,
} from "./check-reading-shared";
import {
  AUTHORED_MAX_EVIDENCE_RATIO,
  AUTHORED_MIN_EVIDENCE_RUNES,
  type AuthoredConfig,
  authoredRowIssues,
  isAuthoredConstruction,
  mixedAndAuthoredFileIssues,
} from "./reading-authored-corpus";
import {
  COVERAGE_FLOOR,
  coverageOf,
  LEVEL_RANKS,
  levelsUpTo,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
} from "./reading-chuubun-corpus";
import {
  CHUSHOU_AUTHORED_BAND,
  CHUSHOU_AUTHORED_MIN_INTENTS,
  CHUSHOU_AUTHORED_MIN_PARAGRAPHS,
  CHUSHOU_BLOCK,
  CHUSHOU_MAX_PASSAGE_LENGTH,
  CHUSHOU_MIN_PASSAGE_LENGTH,
  CHUSHOU_SIGNER,
  CHUSHOU_STEM,
  chuushouAuthoredIntentFor,
  chuushouAuthoredOptionIssues,
  chuushouConstructionForLevel,
  chuushouConstructionOf,
  chuushouReasonSpreadIssues,
  readChuushouRejections,
} from "./reading-chuushou-corpus";

/** One paper's worth of 主張理解 小問: N2 大問13 prints 3, N1 大問12 prints 4
 * (`PAPER_BLOCK_SHAPES` counts in `packages/item-engine/src/paper.ts`). How deep
 * the store actually has to be is asserted per block in the server's real-mode
 * test, next to the row-identity assertion that proves the store answers the 大問. */
const MIN_ITEMS: Readonly<Record<string, number>> = { N1: 4, N2: 3 };

/** The 主張 block's authored configuration. `minIntents` is
 * `CHUSHOU_AUTHORED_MIN_INTENTS` = 1 because this 大問 fixes its own stem, so the
 * ねらい spread that governs 短文, 中文 and 長文 cannot govern it; what replaces it
 * is the distractor-reason floor below. `minParagraphs` is what makes the passage
 * a 長文 argument rather than the one-paragraph store this route replaces. */
const AUTHORED_CONFIG: AuthoredConfig = {
  bandFor: (level) => CHUSHOU_AUTHORED_BAND[level],
  evidence: {
    maxRatio: AUTHORED_MAX_EVIDENCE_RATIO,
    minRunes: AUTHORED_MIN_EVIDENCE_RUNES,
  },
  intentFor: chuushouAuthoredIntentFor,
  minIntents: CHUSHOU_AUTHORED_MIN_INTENTS,
  minParagraphs: CHUSHOU_AUTHORED_MIN_PARAGRAPHS,
  optionCount: 4,
};

/** The reading store row shape as frozen in `{level}-chuushou.json`. */
export interface ChuushouReadingEntry extends ReadingEntryFields {
  readonly distractorReasons?: readonly string[];
  readonly sourceEn?: string | undefined;
}

const isAuthored = (entry: ChuushouReadingEntry): boolean =>
  isAuthoredConstruction(entry.construction);

/** The row's verdict shape and the item-engine scaffolding live in
 * `check-reading-shared`; EntryReport is re-exported for this store's tests. */
export type { EntryReport } from "./check-reading-shared";

/** Screens 1: the cert trio — provenance, the validation flag, and whichever
 * signer the row's own construction claims. */
const signerIssues = (entry: ChuushouReadingEntry): string[] =>
  certIssues(entry, CHUSHOU_SIGNER);

/** Screens 2a: the route the LEVEL chose. A 白書 window tagged into the authored
 * N2 store would claim the easier corpus, and it never reaches the sourcing step
 * that would expose it, so the level's route — not the row's tag — decides. */
const routeIssues = (entry: ChuushouReadingEntry, level: string): string[] => {
  const construction = chuushouConstructionOf(entry.construction);
  if (construction === null) {
    return ["construction-unknown"];
  }
  if (construction !== chuushouConstructionForLevel(level)) {
    return [`construction-not-for-${level}`];
  }
  return [];
};

/** Screens 2b: the stamps the row cannot re-own — the level and block, the
 * fixed stem, the translation, and the id. */
const identityIssues = (
  entry: ChuushouReadingEntry,
  level: string
): string[] => {
  const issues: string[] = [];
  if (entry.level !== level) {
    issues.push(`level-not-${level}`);
  }
  if (entry.block !== CHUSHOU_BLOCK) {
    issues.push("block-not-chuushou");
  }
  if (!isFilledText(entry.stem)) {
    issues.push("stem-empty");
  } else if (entry.stem !== CHUSHOU_STEM) {
    issues.push("stem-not-chuushou-stem");
  }
  if (!isFilledText(entry.sourceEn?.trim())) {
    issues.push("sourceEn-missing");
  }
  if (!isFilledText(entry.id)) {
    issues.push("id-empty");
  }
  return issues;
};

const checkFields = (entry: ChuushouReadingEntry, level: string): string[] => [
  ...signerIssues(entry),
  ...routeIssues(entry, level),
  ...identityIssues(entry, level),
];

/** The claim's own contract against its source: the claim term the source
 * prints, and no distractor printed by the source (a second defensible answer
 * the learner can read off the page). */
const claimIssues = (
  entry: ChuushouReadingEntry,
  sourceText: string
): string[] => {
  const issues: string[] = [];
  const answer = entry.options[entry.answerIndex];
  if (answer === undefined) {
    return issues;
  }
  if (!sourceText.includes(answer)) {
    issues.push("claim-not-in-source");
  }
  for (let at = 0; at < entry.options.length; at += 1) {
    if (at === entry.answerIndex) {
      continue;
    }
    const option = entry.options[at];
    if (option !== undefined && sourceText.includes(option)) {
      issues.push("distractor-occurs-in-source");
    }
  }
  return issues;
};

/** The window's own shape against its resolved source: the band and the
 * byte-equality that makes the row a quotation rather than a paraphrase. */
const windowIssues = ({
  entry,
  sourceText,
}: {
  entry: ChuushouReadingEntry;
  sourceText: string;
}): string[] => {
  const issues: string[] = [];
  if ([...entry.passage].length > CHUSHOU_MAX_PASSAGE_LENGTH) {
    issues.push("passage-too-long");
  }
  if ([...entry.passage].length < CHUSHOU_MIN_PASSAGE_LENGTH) {
    issues.push("passage-too-short");
  }
  if (entry.passage !== sourceText) {
    issues.push("passage-not-byte-equal-to-source");
  }
  return issues;
};

/** The measured difficulty claim: the level's vocabulary floor over this
 * passage, re-counted on every run rather than remembered. */
const coverageIssues = ({
  entry,
  index,
  level,
}: {
  entry: ChuushouReadingEntry;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  level: string;
}): string[] => {
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const floor = COVERAGE_FLOOR[level] ?? 1;
  if (coverageOf(entry.passage, index, maxRank) < floor) {
    return ["coverage-below-floor"];
  }
  return [];
};

/** The sourcing screens, re-proved on every run: exactly one source paragraph
 * present in the corpus, a passage byte-equal to it, the length band, and the
 * measured coverage floor (the difficulty claim is measured, not asserted). */
const sourcingIssues = ({
  entry,
  index,
  level,
  paragraphs,
  rejections,
}: {
  entry: ChuushouReadingEntry;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  level: string;
  paragraphs: ReadonlyMap<string, string>;
  rejections: ReadonlySet<string>;
}): string[] => {
  const issues: string[] = [];
  // The freeze-time judge record screens this route; an authored row reaches the
  // same list through `authoredRowIssues`, so the check runs once per row either
  // way. It runs before the source resolution so a row with a broken citation is
  // still refused for being judged down.
  if (rejections.has(entry.id)) {
    issues.push("row-judge-rejected");
  }
  const sourceIds = entry.sourceIds ?? [];
  if (sourceIds.length !== 1) {
    issues.push("sourceIds-not-single");
    return issues;
  }
  const sourceText = paragraphs.get(sourceIds[0] as string);
  if (sourceText === undefined) {
    issues.push("sourceId-unknown");
    return issues;
  }
  issues.push(...windowIssues({ entry, sourceText }));
  issues.push(...coverageIssues({ entry, index, level }));
  issues.push(...claimIssues(entry, sourceText));
  return issues;
};

/** One frozen row: fields, then the screens of the route its construction claims
 * (the shared authored screens plus the distractor contract, or byte-equal
 * sourcing plus the authored-key claim contract), then the item-engine structural
 * validator. */
export const checkEntry = ({
  entry,
  level,
  paragraphs,
  index,
  rejections,
}: {
  entry: ChuushouReadingEntry;
  level: string;
  paragraphs: ReadonlyMap<string, string>;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  rejections: ReadonlySet<string>;
}): string[] => {
  const issues = checkFields(entry, level);
  if (isAuthored(entry)) {
    // No source to restore to, so the shared written-row screens decide the
    // passage: the band, the paragraph count, the option shape, the stem, and an
    // evidence sentence the row prints verbatim. On top of those, the distractor
    // contract, which is this 大問's own proof.
    issues.push(
      ...authoredRowIssues(entry, level, AUTHORED_CONFIG, rejections),
      ...chuushouAuthoredOptionIssues(entry)
    );
  } else {
    issues.push(
      ...sourcingIssues({ entry, index, level, paragraphs, rejections })
    );
  }
  issues.push(
    ...structuralIssuesFor({
      itemType: "claim-understanding",
      maxPassageLength: CHUSHOU_MAX_PASSAGE_LENGTH,
      row: readingShapeOf(entry),
    })
  );
  return issues;
};

/** The corpus a windowed row is measured against. An authored store restores to no
 * source, so the 白書 paragraph walk runs only when the store still has a row that
 * cites one; the gate spends no corpus pass a written row cannot use. */
const storeContextFor = ({
  dataDir,
  entries,
  level,
  storePath,
}: {
  readonly dataDir: string;
  readonly entries: readonly ChuushouReadingEntry[];
  readonly level: string;
  readonly storePath: string;
}): {
  readonly index: ReturnType<typeof readCumulativeVocabIndex>;
  readonly paragraphs: ReadonlyMap<string, string>;
  readonly rejections: ReadonlySet<string>;
} => {
  const paragraphs = new Map<string, string>();
  if (entries.some((entry) => !isAuthored(entry))) {
    for (const paragraph of readHakushoParagraphs(
      join(dataDir, "reading", "hakusho.jsonl")
    )) {
      paragraphs.set(paragraph.id, paragraph.text);
    }
  }
  return {
    index: readCumulativeVocabIndex(dataDir, levelsUpTo(level)),
    paragraphs,
    rejections: readChuushouRejections(join(storePath, ".."), level),
  };
};

/** The repeats only the whole store can see: the same id, the same passage or the
 * same claim twice, which no single-row screen can notice. */
const repeatIssuesFor = ({
  entry,
  seenClaims,
  seenIds,
  seenPassages,
}: {
  entry: ChuushouReadingEntry;
  seenClaims: Set<string>;
  seenIds: Set<string>;
  seenPassages: Set<string>;
}): string[] => {
  const issues: string[] = [];
  if (seenIds.has(entry.id)) {
    issues.push("duplicate-id");
  }
  seenIds.add(entry.id);
  if (seenPassages.has(entry.passage)) {
    issues.push("duplicate-passage");
  }
  seenPassages.add(entry.passage);
  const claim = entry.options[entry.answerIndex];
  if (claim !== undefined) {
    if (seenClaims.has(claim)) {
      issues.push("duplicate-claim");
    }
    seenClaims.add(claim);
  }
  return issues;
};

/** What no single row can satisfy or break: the batch size, ONE construction per
 * store, and on the authored route the two spreads — the ねらい this 大問 admits and
 * the distractor failure modes it has to cover. */
const fileIssuesFor = ({
  entries,
  intents,
  level,
  reasons,
}: {
  entries: readonly ChuushouReadingEntry[];
  intents: ReadonlySet<string>;
  level: string;
  reasons: ReadonlySet<string>;
}): string[] => {
  const issues: string[] = [];
  const min = MIN_ITEMS[level] ?? 3;
  if (entries.length < min) {
    issues.push(`too-few-items:${entries.length}<${min}`);
  }
  issues.push(
    ...mixedAndAuthoredFileIssues({
      config: AUTHORED_CONFIG,
      entries,
      extras: () => chuushouReasonSpreadIssues(reasons),
      intents,
    })
  );
  return issues;
};

/** The whole gate over one store file. */
export const checkReadingFile = ({
  storePath,
  level,
  dataDir,
}: {
  storePath: string;
  level: string;
  dataDir: string;
}): EntryReport[] => {
  const entries = JSON.parse(
    readFileSync(storePath, "utf8")
  ) as readonly ChuushouReadingEntry[];
  const { index, paragraphs, rejections } = storeContextFor({
    dataDir,
    entries,
    level,
    storePath,
  });

  const reports: EntryReport[] = [];
  const seenIds = new Set<string>();
  const seenPassages = new Set<string>();
  const seenClaims = new Set<string>();
  // The ねらい spread and the distractor-reason spread are counted over the store,
  // so one row cannot pass itself by asking one novel question or inventing one
  // novel failure mode. A windowed store tallies nothing.
  const intents = new Set<string>();
  const reasons = new Set<string>();
  for (const entry of entries) {
    const issues = checkEntry({
      entry,
      index,
      level,
      paragraphs,
      rejections,
    });
    issues.push(
      ...repeatIssuesFor({ entry, seenClaims, seenIds, seenPassages })
    );
    if (isAuthored(entry)) {
      const intent = chuushouAuthoredIntentFor(entry.stem);
      if (intent !== null) {
        intents.add(intent);
      }
      for (const reason of entry.distractorReasons ?? []) {
        reasons.add(reason);
      }
    }
    reports.push({ entryId: entry.id, issues });
  }
  const fileIssues = fileIssuesFor({ entries, intents, level, reasons });
  if (fileIssues.length > 0) {
    reports.push({ entryId: "(file)", issues: fileIssues });
  }
  return reports;
};

if (import.meta.main) {
  runReadingGateMain({
    check: checkReadingFile,
    defaultLevel: "N2",
    gateName: "check:reading-chuushou",
    storeFileName: (level): string => `${level.toLowerCase()}-chuushou.json`,
  });
}
