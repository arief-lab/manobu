/**
 * `check:reading-tougou` — the deterministic CI gate for the composed N2/N1
 * 統合理解 store (TASK-173.9.3). NO LLM runs here.
 *
 * The server trusts `validated: true` at assembly time the way it trusts a
 * licensed store row, so this script re-proves offline, on every run, that each
 * frozen row is
 *
 *   1. provenance `composed`, `validated`, and signed by whichever route its own
 *      `construction` claims: `shared-topic-pair` by the pipeline
 *      (`deterministic:gen-reading-tougou`), `authored` by the blind judge record
 *      (`authored:agent-blind-judged`),
 *   2. ON THE 白書 ROUTE: sourced from EXACTLY TWO 白書 paragraphs on DIFFERENT
 *      pages, each present in the corpus with its passage byte-equal to its
 *      source, inside both length bands (each document 200–1200 runes, the pair
 *      400–800) and at the level's measured coverage floor per document,
 *      carrying the fixed 両方 construction stem, with the key in BOTH documents
 *      and each distractor in EXACTLY ONE (`rowClaimIssues`) and no distractor
 *      what the other document names under a synonym
 *      (`optionParaphraseIssues`), and pair-specific: no third clearing document
 *      prints the key, re-derived here from the corpus rather than trusted from
 *      the generator's walk,
 *   3. ON THE AUTHORED ROUTE (TASK-173.9.20): a WRITTEN pair, each document
 *      inside `TOUGOU_AUTHORED_BAND` and at least two paragraphs, with an
 *      `evidence` sentence it prints verbatim, one of the three 比較・統合 stems,
 *      the pair still inside the 合計 band, and the relation INVERTED against the
 *      lookup this route replaces: the key printed by NEITHER document and every
 *      distractor printed by EXACTLY ONE (`authoredPairClaimIssues`),
 *   4. structurally valid per the item-engine validator (`validateQuestionItem`)
 *      as a two-passage `text-comparison` item,
 *   5. absent from the freeze-time judge record.
 *
 * Screen 2's specificity half is the expensive one: it re-runs
 * `prepareTougouCorpus` over the whole corpus, which is exactly what makes it a
 * proof rather than a receipt. It is the same pass the generator pays, so the CI
 * budget for this gate is the budget for composing the store again. A store of
 * written rows has no corpus to be specific against, so it does not pay it.
 *
 * File-level: at least one paper's worth of rows (N2 大問12 prints 2 小問, N1
 * 大問11 prints 3), ids and passage pairs unique, ONE construction per store, and
 * on the authored route the store spans all three relation classes rather than
 * printing one of them twice.
 *
 * Run from this package: `bun run check:reading-tougou --level N2`. Exit 0 =
 * every row passes; exit 1 = issues listed, or a store is not frozen yet. The
 * exported `checkEntry` / `checkReadingFile` are the test seams.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type EntryReport,
  isFilledText,
  runReadingGateMain,
  spendIssue,
  structuralIssuesFor,
} from "./check-reading-shared";
import {
  AUTHORED_MAX_EVIDENCE_RATIO,
  AUTHORED_MIN_EVIDENCE_RUNES,
  AUTHORED_SIGNER,
  type AuthoredConfig,
  type AuthoredRow,
  authoredFileIssues,
  authoredRowIssues,
  isAuthoredConstruction,
  mixedConstructionIssue,
} from "./reading-authored-corpus";
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
  authoredPairClaimIssues,
  nounIndex,
  optionParaphraseIssues,
  pairTotalIssues,
  prepareTougouCorpus,
  readTougouRejections,
  rowClaimIssues,
  TOUGOU_AUTHORED_BAND,
  TOUGOU_AUTHORED_MIN_INTENTS,
  TOUGOU_AUTHORED_MIN_PARAGRAPHS,
  TOUGOU_BLOCK,
  TOUGOU_MAX_DOC_LENGTH,
  TOUGOU_MAX_STIMULUS_TEXT_LENGTH,
  TOUGOU_MIN_DOC_LENGTH,
  TOUGOU_SIGNER,
  TOUGOU_STEM,
  type TougouDocument,
  tougouAuthoredIntentFor,
  tougouConstructionForLevel,
  tougouConstructionOf,
} from "./reading-tougou-corpus";

/** One paper's worth of 統合理解 小問: N2 大問12 prints 2, N1 大問11 prints 3
 * (`PAPER_BLOCK_SHAPES` counts in `packages/item-engine/src/paper.ts`). */
const MIN_ITEMS: Readonly<Record<string, number>> = { N1: 3, N2: 2 };

/** The 統合 block's authored configuration. `bandFor` and `minParagraphs` are
 * PER DOCUMENT, because a 統合 小問 is a pair: the shared screens run once against
 * each side, and the pair's own total band is re-proved separately by
 * `pairTotalIssues`. `minIntents` is the count of 比較・統合 stems, so a store of
 * written rows must ask all three relations, not one of them twice. */
const AUTHORED_CONFIG: AuthoredConfig = {
  bandFor: (level) => TOUGOU_AUTHORED_BAND[level],
  evidence: {
    maxRatio: AUTHORED_MAX_EVIDENCE_RATIO,
    minRunes: AUTHORED_MIN_EVIDENCE_RUNES,
  },
  intentFor: tougouAuthoredIntentFor,
  minIntents: TOUGOU_AUTHORED_MIN_INTENTS,
  minParagraphs: TOUGOU_AUTHORED_MIN_PARAGRAPHS,
  optionCount: 4,
};

/** The reading store row shape as frozen in `{level}-tougou.json`. */
export interface TougouReadingEntry {
  readonly answerIndex: number;
  readonly block: string;
  readonly construction?: string;
  /** The deciding sentence of EACH document, parallel to `passages`: a 比較・統合
   * 小問 is decided by two spans, one per side, so an authored row cites both. */
  readonly evidence?: readonly string[];
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passages: readonly string[];
  readonly provenance?: "licensed" | "composed";
  readonly sourceCredits?: readonly string[];
  readonly sourceEn?: string | undefined;
  readonly sourceIds?: readonly string[];
  readonly sourceUrls?: readonly string[];
  readonly stem: string;
  readonly validated?: boolean;
  readonly validatedBy?: string;
}

const isAuthored = (entry: TougouReadingEntry): boolean =>
  isAuthoredConstruction(entry.construction);

export type { EntryReport } from "./check-reading-shared";

/** The two freeze stamps every route demands before its own proof runs. */
const provenanceIssues = (entry: TougouReadingEntry): string[] => {
  const issues: string[] = [];
  if (entry.provenance !== "composed") {
    issues.push("provenance-not-composed");
  }
  if (entry.validated !== true) {
    issues.push("not-validated");
  }
  return issues;
};

/** The route the LEVEL's corpus backs, read off the row's own tag. The level,
 * not the row, decides which proof runs: a topic-matched 白書 pair tagged into
 * the authored N2 store claims the easier corpus, and it never reaches the
 * corpus screens that would expose it. */
const routeIssues = (entry: TougouReadingEntry, level: string): string[] => {
  const construction = tougouConstructionOf(entry.construction);
  if (construction === null) {
    return ["construction-unknown"];
  }
  if (construction !== tougouConstructionForLevel(level)) {
    return [`construction-not-for-${level}`];
  }
  return [];
};

/** The signature a row must carry depends on the route its own construction
 * claims: the blind-judge record for a written pair, the generator's stamp for
 * a 白書 pair. */
const signerIssues = (entry: TougouReadingEntry): string[] => {
  if (isAuthored(entry)) {
    // The written pair is signed by the judge record, not by the deterministic
    // generator: nothing generated it, so claiming the generator's stamp would
    // point the proof at a pipeline that never ran.
    return entry.validatedBy === AUTHORED_SIGNER
      ? []
      : ["validatedBy-not-authored-signer"];
  }
  return entry.validatedBy === TOUGOU_SIGNER
    ? []
    : ["validatedBy-missing-or-bad-form"];
};

const identityIssues = (entry: TougouReadingEntry, level: string): string[] => {
  const issues: string[] = [];
  if (entry.level !== level) {
    issues.push(`level-not-${level}`);
  }
  if (entry.block !== TOUGOU_BLOCK) {
    issues.push("block-not-tougou");
  }
  if (!isFilledText(entry.stem)) {
    issues.push("stem-empty");
  } else if (!isAuthored(entry) && entry.stem !== TOUGOU_STEM) {
    // The authored route replaces this stem, so its own three 比較・統合 asks are
    // screened by `authoredRowIssues` (`stem-intent-unclassified`), not here.
    issues.push("stem-not-tougou-stem");
  }
  if (!isFilledText(entry.sourceEn?.trim())) {
    issues.push("sourceEn-missing");
  }
  if (!isFilledText(entry.id)) {
    issues.push("id-empty");
  }
  return issues;
};

const checkFields = (entry: TougouReadingEntry, level: string): string[] => [
  ...provenanceIssues(entry),
  ...routeIssues(entry, level),
  ...signerIssues(entry),
  ...identityIssues(entry, level),
];

/** One document of the pair, screened against the corpus row it claims to
 * come from: byte-equal to its source, printed with its source's own page url
 * and credit, inside the per-document band and at the level's coverage floor. */
const provenancePrintIssues = ({
  at,
  entry,
  passage,
  row,
}: {
  at: number;
  entry: TougouReadingEntry;
  passage: string;
  row: HakushoParagraph;
}): string[] => {
  const issues: string[] = [];
  if (row.text !== passage) {
    issues.push("passage-not-byte-equal-to-source");
  }
  if ((entry.sourceUrls?.[at] ?? "") !== row.pageUrl) {
    issues.push("sourceUrl-not-from-source-page");
  }
  if ((entry.sourceCredits?.[at] ?? "") !== row.source) {
    issues.push("sourceCredit-not-from-source");
  }
  return issues;
};

const documentBandIssues = ({
  floor,
  index,
  maxRank,
  passage,
}: {
  floor: number;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  maxRank: number;
  passage: string;
}): string[] => {
  const issues: string[] = [];
  const runes = [...passage].length;
  if (runes < TOUGOU_MIN_DOC_LENGTH) {
    issues.push("document-too-short");
  }
  if (runes > TOUGOU_MAX_DOC_LENGTH) {
    issues.push("document-too-long");
  }
  if (coverageOf(passage, index, maxRank) < floor) {
    issues.push("coverage-below-floor");
  }
  return issues;
};

const documentIssues = ({
  at,
  entry,
  floor,
  index,
  maxRank,
  passage,
  row,
}: {
  at: number;
  entry: TougouReadingEntry;
  floor: number;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  maxRank: number;
  passage: string;
  row: HakushoParagraph;
}): string[] => [
  ...provenancePrintIssues({ at, entry, passage, row }),
  ...documentBandIssues({ floor, index, maxRank, passage }),
];

/** The sourcing screens, re-proved on every run: exactly two source paragraphs,
 * both present in the corpus and on different pages, each passage byte-equal to
 * its own source, each document in the band at the coverage floor, and the pair
 * inside the 合計600字程度 band. */
const sourceProvenanceIssues = (entry: TougouReadingEntry): string[] =>
  (entry.sourceUrls?.length ?? 0) === 2 &&
  (entry.sourceCredits?.length ?? 0) === 2
    ? []
    : ["source-provenance-not-pair"];

const documentsAgainstCorpusIssues = ({
  entry,
  floor,
  index,
  maxRank,
  paragraphs,
  sourceIds,
}: {
  entry: TougouReadingEntry;
  floor: number;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  maxRank: number;
  paragraphs: ReadonlyMap<string, HakushoParagraph>;
  sourceIds: readonly string[];
}): string[] => {
  const issues: string[] = [];
  const pages: string[] = [];
  for (const [at, passage] of entry.passages.entries()) {
    const sourceId = sourceIds[at];
    const row = sourceId === undefined ? undefined : paragraphs.get(sourceId);
    if (row === undefined) {
      issues.push("sourceId-unknown");
      continue;
    }
    pages.push(row.pageId);
    issues.push(
      ...documentIssues({
        at,
        entry,
        floor,
        index,
        maxRank,
        passage,
        row,
      })
    );
  }
  if (pages.length === 2 && pages[0] === pages[1]) {
    issues.push("same-page-pair");
  }
  issues.push(...pairTotalIssues(entry.passages));
  return issues;
};

const sourcingIssues = ({
  entry,
  index,
  level,
  paragraphs,
}: {
  entry: TougouReadingEntry;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  level: string;
  paragraphs: ReadonlyMap<string, HakushoParagraph>;
}): string[] => {
  const sourceIds = entry.sourceIds ?? [];
  if (sourceIds.length !== 2) {
    return ["sourceIds-not-pair"];
  }
  return [
    ...sourceProvenanceIssues(entry),
    ...documentsAgainstCorpusIssues({
      entry,
      floor: COVERAGE_FLOOR[level] ?? 1,
      index,
      maxRank: LEVEL_RANKS[level] ?? 0,
      paragraphs,
      sourceIds,
    }),
  ];
};

/** The option screens on the printed text: four options, the key in both
 * documents, every distractor in exactly one. */
const optionIssues = (entry: TougouReadingEntry): string[] => {
  const answer = entry.options[entry.answerIndex];
  if (answer === undefined) {
    return ["answer-index-out-of-range"];
  }
  return rowClaimIssues({
    answer,
    distractors: entry.options.filter((_, at) => at !== entry.answerIndex),
    passages: entry.passages,
  });
};

/** Screen 5's paraphrase half, re-proved on the row's OWN documents: a distractor
 * the other document names under a synonym is defensibly 挙げられている in both,
 * and no surface test of the printed text can see that. The documents are looked
 * up by the row's own `sourceIds`, so a row cannot cite one pair and screen
 * another. */
const paraphraseIssuesFor = ({
  clearingDocs,
  entry,
}: {
  clearingDocs: readonly TougouDocument[];
  entry: TougouReadingEntry;
}): string[] => {
  const sourceIds = entry.sourceIds ?? [];
  if (sourceIds.length !== 2) {
    return [];
  }
  const a = clearingDocs.find((doc) => doc.id === sourceIds[0]);
  const b = clearingDocs.find((doc) => doc.id === sourceIds[1]);
  const answer = entry.options[entry.answerIndex];
  if (a === undefined || b === undefined || answer === undefined) {
    return [];
  }
  return optionParaphraseIssues({
    a,
    b,
    distractors: entry.options.filter((_, at) => at !== entry.answerIndex),
  });
};

/** The two corpus documents the key's owner indices resolve to, or null when
 * an index is out of range. */
const keyOwnerPair = (
  clearingDocs: readonly TougouDocument[],
  owners: readonly number[]
): readonly [TougouDocument, TougouDocument] | null => {
  const a = clearingDocs[owners[0] ?? -1];
  const b = clearingDocs[owners[1] ?? -1];
  return a !== undefined && b !== undefined ? [a, b] : null;
};

/**
 * Screen 6: the key must belong to THIS pair. Re-derived from the corpus rather
 * than from the row, so a frozen row cannot claim a topic the whole 白書 leans
 * on. The clearing set is recomputed here with the generator's own screens.
 */
const specificityIssues = ({
  clearingDocs,
  byNoun,
  entry,
}: {
  byNoun: ReadonlyMap<string, readonly number[]>;
  clearingDocs: ReturnType<typeof prepareTougouCorpus>;
  entry: TougouReadingEntry;
}): string[] => {
  const answer = entry.options[entry.answerIndex];
  if (answer === undefined) {
    return [];
  }
  const owners = byNoun.get(answer) ?? [];
  if (owners.length !== 2) {
    return ["key-not-pair-specific"];
  }
  const pair = keyOwnerPair(clearingDocs, owners);
  if (pair === null) {
    return ["key-owners-unknown"];
  }
  const sourceIds = entry.sourceIds ?? [];
  return sourceIds.includes(pair[0].id) && sourceIds.includes(pair[1].id)
    ? []
    : ["key-owners-not-row-sources"];
};

/**
 * The authored route's screens. Each written document is measured on its own
 * against the shared written-row contract (band, paragraph floor, option shape,
 * a stem that names a known 比較・統合 relation, an `evidence` span it prints
 * verbatim), then the pair is measured together: the 合計 band the 大問 declares,
 * and the relation screen that INVERTS the lookup contract — the key printed by
 * NEITHER document, every distractor printed by EXACTLY ONE. Screens that do not
 * read the document (the judge record, the option shape) are unioned, not
 * repeated, so one defect reports once.
 */
const authoredPairIssues = ({
  entry,
  level,
  rejections,
}: {
  entry: TougouReadingEntry;
  level: string;
  rejections: ReadonlySet<string>;
}): string[] => {
  if (entry.passages.length !== 2) {
    return ["passages-not-pair"];
  }
  const issues: string[] = [];
  const seen = new Set<string>();
  const evidence = entry.evidence ?? [];
  for (const [at, passage] of entry.passages.entries()) {
    const document: AuthoredRow = {
      answerIndex: entry.answerIndex,
      construction: entry.construction,
      evidence: evidence[at],
      id: entry.id,
      level: entry.level,
      options: entry.options,
      passage,
      sourceIds: entry.sourceIds,
      stem: entry.stem,
    };
    for (const issue of authoredRowIssues(
      document,
      level,
      AUTHORED_CONFIG,
      rejections
    )) {
      if (seen.has(issue)) {
        continue;
      }
      seen.add(issue);
      issues.push(issue);
    }
  }
  const answer = entry.options[entry.answerIndex];
  if (answer === undefined) {
    issues.push("answer-index-out-of-range");
    return issues;
  }
  issues.push(
    ...pairTotalIssues(entry.passages),
    ...authoredPairClaimIssues({
      answer,
      distractors: entry.options.filter((_, at) => at !== entry.answerIndex),
      passages: entry.passages,
    })
  );
  return issues;
};

/** One frozen row: fields, then the screens of the route its construction claims
 * (byte-equal sourcing, the pair screens and the corpus specificity screen, or the
 * written-pair screens), then the item-engine structural validator. */
export const checkEntry = ({
  byNoun,
  clearingDocs,
  entry,
  index,
  level,
  paragraphs,
  rejections,
}: {
  byNoun: ReadonlyMap<string, readonly number[]>;
  clearingDocs: readonly TougouDocument[];
  entry: TougouReadingEntry;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  level: string;
  paragraphs: ReadonlyMap<string, HakushoParagraph>;
  rejections: ReadonlySet<string>;
}): string[] => {
  const issues = checkFields(entry, level);
  if (isAuthored(entry)) {
    issues.push(...authoredPairIssues({ entry, level, rejections }));
  } else {
    if (rejections.has(entry.id)) {
      issues.push("row-judge-rejected");
    }
    issues.push(...sourcingIssues({ entry, index, level, paragraphs }));
    issues.push(...optionIssues(entry));
    issues.push(...paraphraseIssuesFor({ clearingDocs, entry }));
    issues.push(...specificityIssues({ byNoun, clearingDocs, entry }));
  }
  issues.push(
    ...structuralIssuesFor({
      itemType: "text-comparison",
      maxPassageLength: TOUGOU_MAX_STIMULUS_TEXT_LENGTH,
      row: {
        answerIndex: entry.answerIndex,
        id: entry.id,
        level: entry.level,
        options: entry.options,
        passages: entry.passages,
        stem: entry.stem,
      },
    })
  );
  return issues;
};

/** The whole gate over one store file. */
/** Cross-row bookkeeping no single row can do: ids and passage pairs are unique
 * across the store, and a written store tallies the relations it asks. Mutates
 * the ledgers, returns the issues this row contributes. */
const repeatIssuesFor = ({
  entry,
  seenIds,
  seenPairs,
}: {
  entry: TougouReadingEntry;
  seenIds: Set<string>;
  seenPairs: Set<string>;
}): string[] => {
  const pairKey = [...entry.passages].join("\u0000");
  return [
    ...spendIssue(seenIds, entry.id, "duplicate-id"),
    ...spendIssue(seenPairs, pairKey, "duplicate-passage-pair"),
  ];
};

const fileIssuesFor = ({
  entries,
  intents,
  level,
}: {
  entries: readonly TougouReadingEntry[];
  intents: ReadonlySet<string>;
  level: string;
}): string[] => {
  const fileIssues: string[] = [];
  const min = MIN_ITEMS[level] ?? 2;
  if (entries.length < min) {
    fileIssues.push(`too-few-items:${entries.length}<${min}`);
  }
  const mixed = mixedConstructionIssue(entries);
  if (mixed !== null) {
    fileIssues.push(mixed);
  }
  if (entries.some(isAuthored)) {
    fileIssues.push(...authoredFileIssues(intents, AUTHORED_CONFIG));
  }
  return fileIssues;
};

export const checkReadingFile = ({
  dataDir,
  level,
  storePath,
}: {
  dataDir: string;
  level: string;
  storePath: string;
}): EntryReport[] => {
  const entries = JSON.parse(
    readFileSync(storePath, "utf8")
  ) as readonly TougouReadingEntry[];
  // Screen 6 re-derives specificity from the WHOLE corpus, which a written pair
  // has no use for: nothing about an authored row can be proven by a corpus it
  // does not cite. So the corpus walk, and with it the `prepareTougouCorpus` pass
  // this gate's budget is written about, runs only when a windowed row is present.
  const windowed = entries.some((entry) => !isAuthored(entry));
  const paragraphs = new Map<string, HakushoParagraph>();
  const corpus = windowed
    ? readHakushoParagraphs(join(dataDir, "reading", "hakusho.jsonl"))
    : [];
  for (const paragraph of corpus) {
    paragraphs.set(paragraph.id, paragraph);
  }
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const clearingDocs = windowed
    ? prepareTougouCorpus(corpus, index, level)
    : [];
  const byNoun = windowed
    ? nounIndex(clearingDocs)
    : new Map<string, readonly number[]>();
  const rejections = readTougouRejections(join(storePath, ".."), level);

  const reports: EntryReport[] = [];
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();
  // The relation spread is counted over the store, so one row cannot pass itself
  // by asking one novel relation. A windowed store tallies nothing.
  const intents = new Set<string>();
  for (const entry of entries) {
    const issues = [
      ...checkEntry({
        byNoun,
        clearingDocs,
        entry,
        index,
        level,
        paragraphs,
        rejections,
      }),
      ...repeatIssuesFor({ entry, seenIds, seenPairs }),
    ];
    if (isAuthored(entry)) {
      const intent = tougouAuthoredIntentFor(entry.stem);
      if (intent !== null) {
        intents.add(intent);
      }
    }
    reports.push({ entryId: entry.id, issues });
  }
  const fileIssues = fileIssuesFor({ entries, intents, level });
  if (fileIssues.length > 0) {
    reports.push({ entryId: "(file)", issues: fileIssues });
  }
  return reports;
};

if (import.meta.main) {
  runReadingGateMain({
    check: checkReadingFile,
    defaultLevel: "N2",
    gateName: "check:reading-tougou",
    storeFileName: (level): string => `${level.toLowerCase()}-tougou.json`,
  });
}
