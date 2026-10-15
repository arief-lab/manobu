/**
 * `check-reading-shared.ts` — the item-engine scaffolding every reading gate
 * repeats. NO LLM runs here, and nothing about a specific 大問 lives here.
 *
 * Each of the seven composed-store gates (`check-reading-{tanbun,chuubun,
 * choubun,chuushou,jouhou,tougou,n4}.ts`) ends its per-row screens with the same
 * question: is this row still a structurally valid item per
 * `validateQuestionItem`? Answering it always takes the same four pieces — an
 * anchor id, a `QuestionItem` projection of the row, the per-option
 * `OptionSource` list, and a minimal `ItemCorpusView` that resolves only this
 * row's anchor and caps the passage at the block's own ceiling. The gates differ
 * on exactly two inputs: the `itemType` literal the block assembles as, and the
 * passage cap. Those live here; everything route-specific (bands, sourcing,
 * authored screens, ledgers) stays in the gates and their `reading-*-corpus.ts`
 * modules, because that is where the proof actually is.
 *
 * The shape a row presents to the engine is deliberately minimal
 * (`ReadingItemShape`): a gate's own entry interface always has AT LEAST these
 * fields, so it passes in directly without a projection object.
 */

import { join } from "node:path";
import type {
  ItemCorpusView,
  ItemValidationResult,
  OptionSource,
  QuestionItem,
} from "@manobu/item-engine/types";
import { validateQuestionItem } from "@manobu/item-engine/validation";
import {
  AUTHORED_SIGNER,
  isAuthoredConstruction,
} from "./reading-authored-corpus";

/** One frozen row's verdict: its id plus every issue the screens found, empty
 * when the row passes. The gates print one line per issue, prefixed by this id
 * (or `(file)` for batch-level issues). */
export interface EntryReport {
  readonly entryId: string;
  readonly issues: readonly string[];
}

/** The whole surface a reading row owes the structural validator. `passages` is
 * plural because the 統合 gate ships a document PAIR and the validator's
 * two-passage requirement reads `stimuli`; every single-passage store simply
 * passes `[row.passage]`. */
export interface ReadingItemShape {
  readonly answerIndex: number;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passages: readonly string[];
  readonly stem: string;
}

/** The anchor a reading row attests against: the store's id namespaced to the
 * reading surface, the same id the server's anchor registry resolves. */
export const anchorIdFor = (row: { readonly id: string }): string =>
  `reading:${row.id}`;

/** The row as the engine sees it. The singular `passage` projection is the first
 * document, which is also the only document for single-passage stores. */
export const structuralItemFor = (
  row: ReadingItemShape,
  itemType: QuestionItem["itemType"]
): QuestionItem => {
  const anchorId = anchorIdFor(row);
  return {
    anchors: [anchorId],
    answerIndex: row.answerIndex,
    id: anchorId,
    itemType,
    level: row.level,
    mask: null,
    options: row.options,
    passage: row.passages[0] ?? "",
    prompt: row.stem,
    stem: row.stem,
    stimuli: row.passages.map((text): { kind: "passage"; text: string } => ({
      kind: "passage",
      text,
    })),
    surface: "exam",
  };
};

/** The answer's source is the row's own anchor; every distractor is declared as
 * authored against that stimulus, which is what `isOptionSourceValid` accepts
 * below without a corpus lookup. */
export const optionSourcesFor = (
  row: ReadingItemShape
): readonly OptionSource[] => {
  const anchorId = anchorIdFor(row);
  return row.options.map(
    (_, index): OptionSource =>
      index === row.answerIndex
        ? { anchorId, kind: "answer" }
        : { anchorId, kind: "corpus", relation: "stimulus" }
  );
};

/** Minimal corpus view: the reading anchor resolves at the row's own level
 * (real content-attestation is the gate's byte-equality or authored screens,
 * not this view), every option source is accepted, and the passage cap is the
 * block's own ceiling so the engine's `passage-length` reason fires here too.
 * The cap may be a function when the row's construction picks its ceiling
 * (中文's per-construction bands). */
export const corpusViewFor = (
  row: ReadingItemShape,
  maxPassageLength: number | (() => number)
): ItemCorpusView => {
  const anchorId = anchorIdFor(row);
  const cap =
    typeof maxPassageLength === "function"
      ? maxPassageLength
      : (): number => maxPassageLength;
  return {
    isOptionSourceValid: () => true,
    maxPassageLength: cap,
    resolveAnchor: (candidate) =>
      candidate === anchorId
        ? { id: anchorId, level: row.level, surfaces: ["exam"] }
        : null,
  };
};

/** A failing structural verdict is one issue, prefixed so a store that passes
 * its route screens but breaks the engine's contract reads differently. */
export const structuralIssue = (result: ItemValidationResult): string | null =>
  result.ok ? null : `structural:${result.reason}`;

/** The single-document row most 大問 ship, adapted to the plural shape the
 * engine builder takes. 情報検索/主張/中文/長文/短文/N4 rows all have one
 * `passage`; only 統合 carries a pair and passes its `passages` directly. */
export const readingShapeOf = (row: {
  readonly answerIndex: number;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly stem: string;
}): ReadingItemShape => ({
  answerIndex: row.answerIndex,
  id: row.id,
  level: row.level,
  options: row.options,
  passages: [row.passage],
  stem: row.stem,
});

/** The one call a gate makes: project the row, run `validateQuestionItem`,
 * return 0 or 1 issue. */
export const structuralIssuesFor = ({
  itemType,
  maxPassageLength,
  row,
}: {
  itemType: QuestionItem["itemType"];
  maxPassageLength: number | (() => number);
  row: ReadingItemShape;
}): string[] => {
  const issue = structuralIssue(
    validateQuestionItem(
      structuralItemFor(row, itemType),
      optionSourcesFor(row),
      corpusViewFor(row, maxPassageLength)
    )
  );
  return issue === null ? [] : [issue];
};

/** The cert trio every composed-store gate reads off the frozen row before it
 * runs any content screen. `blockSigner` is the deterministic generator's stamp
 * for THIS 大問; the authored branch has one stamp for every gate, the judge
 * record, so it is not a parameter. */
export interface CertFields {
  readonly construction?: string;
  readonly provenance?: "licensed" | "composed";
  readonly validated?: boolean;
  readonly validatedBy?: string;
}

/** The provenance/validated/signer screens every composed gate repeats, in the
 * order each gate has always printed them. */
export const certIssues = (
  entry: CertFields,
  blockSigner: string
): string[] => {
  const issues: string[] = [];
  if (entry.provenance !== "composed") {
    issues.push("provenance-not-composed");
  }
  if (entry.validated !== true) {
    issues.push("not-validated");
  }
  if (isAuthoredConstruction(entry.construction)) {
    // The written row is signed by the judge record, not by the deterministic
    // generator: nothing generated it, so claiming the generator's stamp would
    // point the proof at a pipeline that never ran.
    if (entry.validatedBy !== AUTHORED_SIGNER) {
      issues.push("validatedBy-not-authored-signer");
    }
  } else if (entry.validatedBy !== blockSigner) {
    issues.push("validatedBy-missing-or-bad-form");
  }
  return issues;
};

/** Is this a string the row actually filled in? Gates repeat the same screen
 * on stems, ids and glosses; callers pass the trimmed value where whitespace
 * must not count (`entry.sourceEn?.trim()` reads as absent when unfillable). */
export const isFilledText = (value: unknown): boolean =>
  typeof value === "string" && value.length > 0;

/** The stamps a row cannot re-own, in the order every gate has always printed
 * them: the level it was read at, the block's own tag, and a stem and id that
 * are not empty. `blockName` only phrases the issue (`block-not-tanbun`); the
 * proof is the `block` field against the block's constant. */
export const stampIssues = ({
  block,
  blockName,
  entry,
  level,
}: {
  block: string;
  blockName: string;
  entry: {
    readonly block: string;
    readonly id: string;
    readonly level: string;
    readonly stem: string;
  };
  level: string;
}): string[] => {
  const issues: string[] = [];
  if (entry.level !== level) {
    issues.push(`level-not-${level}`);
  }
  if (entry.block !== block) {
    issues.push(`block-not-${blockName}`);
  }
  if (!isFilledText(entry.stem)) {
    issues.push("stem-empty");
  }
  if (!isFilledText(entry.id)) {
    issues.push("id-empty");
  }
  return issues;
};

/** Spend one key in a store walk's ledger: the issue code when the key was
 * already spent, none otherwise, and the key is recorded either way. Every
 * gate's id/passage/source/answer ledger is this line; the sets are mutated
 * here so the gate itself stays a walk instead of a pile of bookkeeping. */
export const spendIssue = (
  seen: Set<string>,
  key: string,
  issue: string
): string[] => {
  const hit = seen.has(key);
  seen.add(key);
  return hit ? [issue] : [];
};

/** The fields every single-passage composed reading row carries, so a gate's
 * own interface adds only what its 大問 actually differs on: a narrower
 * `construction` union, an extra evidence or source field. */
export interface ReadingEntryFields {
  readonly answerIndex: number;
  readonly block: string;
  readonly construction?: string;
  readonly evidence?: string;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly provenance?: "licensed" | "composed";
  readonly sourceCredit?: string;
  readonly sourceIds?: readonly string[];
  readonly sourceUrl?: string;
  readonly stem: string;
  readonly validated?: boolean;
  readonly validatedBy?: string;
}

/** The `--level` value the gate was invoked with, or its default. */
const readingGateLevel = (defaultLevel: string): string => {
  const levelIndex = process.argv.indexOf("--level");
  if (levelIndex < 0) {
    return defaultLevel;
  }
  return process.argv[levelIndex + 1] ?? defaultLevel;
};

/** One `entryId: issue` line per failing row, in report order. */
const printFailingIssues = (failing: readonly EntryReport[]): void => {
  for (const report of failing) {
    for (const issue of report.issues) {
      console.log(`${report.entryId}: ${issue}`);
    }
  }
};

/** The whole CLI tail every one-store gate has: parse `--level`, read the
 * store, print one line per issue, exit 1 on any failure or an unreadable
 * store. `reportLines` is an optional extra report printed to stderr AFTER the
 * failing filter and BEFORE the verdict — 長文 uses it for the coverage number
 * doc-27 §10 refuses to gate on, which is a measurement, not an issue. */
export const runReadingGateMain = ({
  check,
  defaultLevel,
  gateName,
  reportLines,
  storeFileName,
}: {
  check: (args: {
    dataDir: string;
    level: string;
    storePath: string;
  }) => readonly EntryReport[];
  defaultLevel: string;
  gateName: string;
  reportLines?: (args: {
    dataDir: string;
    level: string;
    storePath: string;
  }) => readonly string[];
  storeFileName: (level: string) => string;
}): void => {
  const dataDir = join(import.meta.dir, "..", "data");
  const level = readingGateLevel(defaultLevel);
  const storePath = join(dataDir, "reading", storeFileName(level));
  let reports: readonly EntryReport[];
  try {
    reports = check({ dataDir, level, storePath });
  } catch (error) {
    console.error(
      `${gateName} cannot read the ${level} store: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
  const failing = reports.filter((report) => report.issues.length > 0);
  if (reportLines !== undefined) {
    for (const line of reportLines({ dataDir, level, storePath })) {
      console.error(line);
    }
  }
  if (failing.length === 0) {
    console.log(`${gateName} ${level}: all ${reports.length} rows pass`);
    process.exit(0);
  }
  printFailingIssues(failing);
  process.exit(1);
};
