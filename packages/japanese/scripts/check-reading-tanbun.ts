/**
 * `check:reading-tanbun` — the deterministic CI gate for the composed N3/N2/N1
 * 内容理解（短文） store (TASK-173.9.11 AC#2). NO LLM runs here.
 *
 * This gate is the only thing that makes `validated: true` in
 * `data/reading/{level}.json` mean something for these three levels: the server
 * trusts the flag at assembly time exactly the way it trusts a licensed row, so
 * this script re-proves offline, on every run, that each frozen row
 *
 *   1. is provenance `composed`, `validated`, and signed by whichever route its
 *      own `construction` claims: `masked-slot` by the pipeline
 *      (`deterministic:gen-reading-tanbun`), `authored` by the blind judge record
 *      (`authored:agent-blind-judged`), and tagged with the construction the
 *      LEVEL's route prints (`TANBUN_SOURCE`), because the ねらい a level trains is
 *      not something a row gets to choose,
 *   1b. ON THE AUTHORED ROUTE: a written sentence inside
 *      `TANBUN_AUTHORED_BAND[level]` carrying an `evidence` span it prints
 *      verbatim, four options, and no source window it could not have come from,
 *   2. sourced from EXACTLY ONE 白書 paragraph present in the corpus, and NOT a
 *      paragraph the level's 中文/主張理解/統合理解 stores or another 白書 level's
 *      短文 store already print, so one real paper never shows the same text in
 *      two 大問 and a learner changing level is not handed the same passage,
 *   3. inside the 短文 band (100-240 runes: 240 is the server's `short-reading`
 *      cap, 100 is where a 白書 `<p>` stops being a heading),
 *   4. structurally valid per `validateQuestionItem` over a minimal corpus view,
 *
 * plus the whole masked-slot contract, shared with the 中文 gate through
 * `reading-chuubun-corpus.ts`: one `BLANK`, restoring the answer reproduces the
 * source paragraph byte for byte, the answer occurs exactly once and is an
 * in-level noun in its listed kanji form, the source clears the level's
 * coverage floor, no distractor occurs in the source, every distractor is in
 * the pool and fills the answer's collocation frame in no other sentence
 * corpus-wide, and the row is not in the freeze-time judge record.
 *
 * File-level: at least one 大問's worth of rows (4 at N1 and N3, 5 at N2), and
 * ids, passages and answers unique.
 *
 * Run from this package: `bun run check:reading-tanbun --level N3`. Exit 0 =
 * every row passes; exit 1 = issues listed. The exported `checkReadingFile` is
 * the test seam.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  certIssues,
  type EntryReport,
  type ReadingEntryFields,
  readingShapeOf,
  runReadingGateMain,
  spendIssue,
  stampIssues,
  structuralIssuesFor,
} from "./check-reading-shared";
import {
  AUTHORED_MAX_EVIDENCE_RATIO,
  AUTHORED_MIN_EVIDENCE_RUNES,
  AUTHORED_MIN_INTENTS,
  type AuthoredConfig,
  authoredFileIssues,
  authoredRowIssues,
  comprehensionIntentFor,
  isAuthoredConstruction,
  mixedConstructionIssue,
} from "./reading-authored-corpus";
import {
  buildFrameFillers,
  COVERAGE_FLOOR,
  LEVEL_RANKS,
  levelsUpTo,
  maskedSlotIssues,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
  sentencesOfText,
  splitSentences,
} from "./reading-chuubun-corpus";
import {
  readTanbunRejections,
  TANBUN_AUTHORED_BAND,
  TANBUN_BLOCK,
  TANBUN_MAX_PASSAGE_LENGTH,
  TANBUN_MIN_PASSAGE_LENGTH,
  TANBUN_SIGNER,
  tanbunConstructionForLevel,
  tanbunConstructionOf,
  tanbunSpentSourceIds,
} from "./reading-tanbun-corpus";

/** One real 短文 大問 prints 4 小問 at N1 (大問8) and N3 (大問4) and 5 at N2
 * (大問10), so the store must hold at least one 大問's worth. */
const MIN_ITEMS_BY_LEVEL: Readonly<Record<string, number>> = {
  N1: 4,
  N2: 5,
  N3: 4,
};

/** The 短文 block's authored configuration. `minParagraphs` is 0 because a real
 * 大問4 小問 prints ONE short paragraph, so the screen that separates this block
 * from 長文 (two paragraphs) would refuse the very shape the block is; what keeps
 * a written 短文 out of 中文 territory is the band, which stops at the server's
 * 240-rune cap while the 中文 authored band starts at 250. */
const AUTHORED_CONFIG: AuthoredConfig = {
  bandFor: (level) => TANBUN_AUTHORED_BAND[level],
  evidence: {
    maxRatio: AUTHORED_MAX_EVIDENCE_RATIO,
    minRunes: AUTHORED_MIN_EVIDENCE_RUNES,
  },
  intentFor: comprehensionIntentFor,
  minIntents: AUTHORED_MIN_INTENTS,
  minParagraphs: 0,
  optionCount: 4,
};

/** The reading store row shape as frozen in `{level}.json`. `sourceIds` belongs
 * to the windowed row and `evidence` to the written one, and each branch refuses
 * the other's. */
export interface TanbunReadingEntry extends ReadingEntryFields {
  /** Read as a tag, never as a choice: `tanbunConstructionOf` maps it to the two
   * routes this block knows and anything else is refused unread. */
  readonly construction?: string;
}

/** The row's verdict shape and the item-engine scaffolding live in
 * `check-reading-shared`; EntryReport is re-exported for this store's tests. */
export type { EntryReport } from "./check-reading-shared";

/** Is this row written rather than windowed? The tag picks the branch, and an
 * untagged row falls into the masked arm and fails its restore-to-source proof,
 * so a row cannot slip through on the easier screens by omitting the tag. */
const isAuthored = (entry: TanbunReadingEntry): boolean =>
  isAuthoredConstruction(entry.construction);

/** Screens 1: the cert trio, signed per branch. */
const signerIssues = (entry: TanbunReadingEntry): string[] =>
  certIssues(entry, TANBUN_SIGNER);

/** Screens 1b: the route the LEVEL chose — a row may not pick its own proof.
 * `TANBUN_SOURCE` says which proof each level owes, so a windowed row cannot be
 * filed into the authored store by carrying the tag the generator stamped on it
 * at the level above. */
const routeIssues = (entry: TanbunReadingEntry, level: string): string[] => {
  const issues: string[] = [];
  const construction = tanbunConstructionOf(entry.construction);
  if (construction === null) {
    issues.push("construction-unknown");
  } else if (construction !== tanbunConstructionForLevel(level)) {
    issues.push(`construction-not-for-${level}`);
  }
  return issues;
};

/** Screens 2: the stamps the row cannot re-own. */
const identityIssues = (entry: TanbunReadingEntry, level: string): string[] =>
  stampIssues({
    block: TANBUN_BLOCK,
    blockName: "tanbun",
    entry,
    level,
  });

const checkFields = (entry: TanbunReadingEntry, level: string): string[] => [
  ...signerIssues(entry),
  ...routeIssues(entry, level),
  ...identityIssues(entry, level),
];

/** The answer's own contract and the distractor and passage screens the window
 * owes all live in `reading-chuubun-corpus.ts` as `maskedSlotIssues`: the three
 * composed cloze gates (短文, 中文, 長文) re-prove one contract, so a screen one
 * of them keeps as a private copy is only a claim, not the shared proof the
 * header names. What stays here is only what is 短文's own: the band, the single
 * source paragraph, and the spend set its siblings share. */

/** The masked-slot half of one row: the 白書 paragraph it cites must exist, be
 * unspent by a sibling store, sit inside the 短文 band, and print the passage
 * byte-for-byte with exactly one noun blanked. That is the whole provenance claim
 * of this construction, and it is the half an authored row does not have. */
const maskedRowIssues = ({
  entry,
  fillers,
  index,
  maxRank,
  paragraphs,
  rejections,
  spent,
}: {
  readonly entry: TanbunReadingEntry;
  readonly fillers: ReturnType<typeof buildFrameFillers>;
  readonly index: ReturnType<typeof readCumulativeVocabIndex>;
  readonly maxRank: number;
  readonly paragraphs: ReadonlyMap<string, string>;
  readonly rejections: ReadonlySet<string>;
  readonly spent: ReadonlySet<string>;
}): string[] => {
  const sourceIds = entry.sourceIds ?? [];
  if (sourceIds.length !== 1) {
    return ["sourceIds-not-single"];
  }
  const sourceId = sourceIds[0] as string;
  const sourceText = paragraphs.get(sourceId);
  if (sourceText === undefined) {
    return ["sourceId-unknown"];
  }
  const issues: string[] = [];
  if (spent.has(sourceId)) {
    issues.push("source-spent-by-another-store");
  }
  const runes = [...entry.passage].length;
  if (runes > TANBUN_MAX_PASSAGE_LENGTH) {
    issues.push("passage-too-long");
  }
  if (runes < TANBUN_MIN_PASSAGE_LENGTH) {
    issues.push("passage-too-short");
  }
  issues.push(
    ...maskedSlotIssues({
      context: { fillers, index, maxRank, rejections },
      coverageFloor: COVERAGE_FLOOR[entry.level] ?? 1,
      coverageIssue: "source-coverage-too-low",
      entry,
      sourceSentences: sentencesOfText(sourceText),
      sourceText,
    })
  );
  return issues;
};

/** One frozen row: fields, byte-equal sourcing, the 短文 band, the sibling-store
 * exclusion, the masked-slot contract, then the structural validator. */
export const checkEntry = ({
  entry,
  level,
  paragraphs,
  index,
  fillers,
  rejections,
  spent,
}: {
  entry: TanbunReadingEntry;
  level: string;
  paragraphs: ReadonlyMap<string, string>;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  fillers: ReturnType<typeof buildFrameFillers>;
  rejections: ReadonlySet<string>;
  spent: ReadonlySet<string>;
}): string[] => {
  const issues = checkFields(entry, level);
  if (isAuthored(entry)) {
    // No source paragraph to restore to, so the shared written-row screens
    // decide it: the band, the option shape, a stem that classifies into a known
    // ねらい, and an evidence sentence the row prints verbatim.
    issues.push(
      ...authoredRowIssues(entry, level, AUTHORED_CONFIG, rejections)
    );
  } else {
    issues.push(
      ...maskedRowIssues({
        entry,
        fillers,
        index,
        maxRank: LEVEL_RANKS[level] ?? 0,
        paragraphs,
        rejections,
        spent,
      })
    );
  }
  issues.push(
    ...structuralIssuesFor({
      itemType: "short-reading",
      maxPassageLength: TANBUN_MAX_PASSAGE_LENGTH,
      row: readingShapeOf(entry),
    })
  );
  return issues;
};

/** Everything one 短文 store needs from disk, read once per gate run. A written
 * store cites no paragraph, so scanning the whole 白書 for it would be work that
 * decides nothing: the authored branch proves a row against its own passage, and an
 * authored row that names a `sourceIds` is refused for it. The sibling-store SPEND
 * set is skipped for the same reason — nothing is spent by a store that cites
 * nothing — and the frame index is filled from the same paragraphs the generator
 * filled it from, or the two halves measure different ambiguity. */
const storeContextFor = ({
  dataDir,
  entries,
  level,
  storePath,
}: {
  readonly dataDir: string;
  readonly entries: readonly TanbunReadingEntry[];
  readonly level: string;
  readonly storePath: string;
}): {
  readonly fillers: ReturnType<typeof buildFrameFillers>;
  readonly index: ReturnType<typeof readCumulativeVocabIndex>;
  readonly paragraphs: ReadonlyMap<string, string>;
  readonly rejections: ReadonlySet<string>;
  readonly spent: ReadonlySet<string>;
} => {
  const windowed = entries.some((entry) => !isAuthored(entry));
  const paragraphs = new Map<string, string>();
  if (windowed) {
    for (const paragraph of readHakushoParagraphs(
      join(dataDir, "reading", "hakusho.jsonl")
    )) {
      paragraphs.set(paragraph.id, paragraph.text);
    }
  }
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const sentences = [...paragraphs.values()].flatMap((text) =>
    splitSentences({
      id: "corpus",
      license: "",
      pageId: "",
      pageUrl: "",
      source: "",
      text,
      title: "",
    })
  );
  const storeDir = join(storePath, "..");
  return {
    fillers: buildFrameFillers(sentences, index, LEVEL_RANKS[level] ?? 0),
    index,
    paragraphs,
    rejections: readTanbunRejections(storeDir, level),
    spent: windowed ? tanbunSpentSourceIds(storeDir, level) : new Set<string>(),
  };
};

/** The cross-row tallies a store keeps while it is walked: an id, a passage, a
 * source paragraph or an answer word may not repeat inside one file, because a
 * repeat is the same reading served twice while the store claims distinct rows. */
const repeatIssuesFor = ({
  entry,
  seenAnswers,
  seenIds,
  seenPassages,
  seenSources,
}: {
  readonly entry: TanbunReadingEntry;
  readonly seenAnswers: Set<string>;
  readonly seenIds: Set<string>;
  readonly seenPassages: Set<string>;
  readonly seenSources: Set<string>;
}): string[] => {
  const issues: string[] = [
    ...spendIssue(seenIds, entry.id, "duplicate-id"),
    ...spendIssue(seenPassages, entry.passage, "duplicate-passage"),
  ];
  for (const sourceId of entry.sourceIds ?? []) {
    issues.push(...spendIssue(seenSources, sourceId, "duplicate-source"));
  }
  const answer = entry.options[entry.answerIndex];
  if (answer !== undefined) {
    issues.push(...spendIssue(seenAnswers, answer, "duplicate-answer"));
  }
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
  ) as readonly TanbunReadingEntry[];
  const { fillers, index, paragraphs, rejections, spent } = storeContextFor({
    dataDir,
    entries,
    level,
    storePath,
  });

  const reports: EntryReport[] = [];
  const seenIds = new Set<string>();
  const seenPassages = new Set<string>();
  const seenAnswers = new Set<string>();
  const seenSources = new Set<string>();
  // The ねらい spread is counted over the store, so a row cannot pass itself by
  // asking one novel question. A windowed store tallies nothing.
  const intents = new Set<string>();
  for (const entry of entries) {
    const issues = checkEntry({
      entry,
      fillers,
      index,
      level,
      paragraphs,
      rejections,
      spent,
    });
    issues.push(
      ...repeatIssuesFor({
        entry,
        seenAnswers,
        seenIds,
        seenPassages,
        seenSources,
      })
    );
    if (isAuthored(entry)) {
      const intent = comprehensionIntentFor(entry.stem);
      if (intent !== null) {
        intents.add(intent);
      }
    }
    reports.push({ entryId: entry.id, issues });
  }
  const fileIssues: string[] = [];
  const minItems = MIN_ITEMS_BY_LEVEL[level] ?? 4;
  if (entries.length < minItems) {
    fileIssues.push(`too-few-items:${entries.length}<${minItems}`);
  }
  const mixed = mixedConstructionIssue(entries);
  if (mixed !== null) {
    fileIssues.push(mixed);
  }
  if (entries.some(isAuthored)) {
    fileIssues.push(...authoredFileIssues(intents, AUTHORED_CONFIG));
  }
  if (fileIssues.length > 0) {
    reports.push({ entryId: "(file)", issues: fileIssues });
  }
  return reports;
};

if (import.meta.main) {
  runReadingGateMain({
    check: checkReadingFile,
    defaultLevel: "N3",
    gateName: "check:reading-tanbun",
    storeFileName: (level): string => `${level.toLowerCase()}.json`,
  });
}
