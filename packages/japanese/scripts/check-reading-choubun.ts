/**
 * `check:reading-choubun` — the deterministic CI gate for the composed 内容理解
 * （長文） stores (TASK-173.9.12 AC#3, TASK-173.9.16 AC#2). NO LLM runs here.
 *
 * This gate is what makes `validated: true` in `data/reading/n1-choubun.json`
 * mean something: the server trusts that flag at assembly time exactly the way
 * it trusts a licensed row, so this script re-proves offline, on every run, that
 * each frozen row
 *
 *   1. is provenance `composed`, `validated`, signed by
 *      `deterministic:gen-reading-choubun`, tagged `construction: "masked-slot"`
 *      and carries `block: "naiyou-rikai-choubun"`,
 *   2. prints a window the CORPUS still admits: the gate re-runs
 *      `choubunWindowsFor` over `hakusho.jsonl` and requires the row's exact
 *      `sourceIds` to be one of its windows. That single check re-proves the four
 *      properties that make a 長文 window rather than a collage, because they are
 *      the rules that builder implements: 2 to 5 paragraphs, consecutive
 *      positions inside ONE pinned page, every paragraph at least 150 runes, and
 *      the joined text inside the 900-1200 rune band,
 *   3. sources no paragraph ANY shipped store spends at any level, so one real
 *      paper never prints the same text in two 大問,
 *   4. structurally valid per `validateQuestionItem` as a `long-reading` item
 *      under this block's own passage cap,
 *
 * plus the whole masked-slot contract, shared with the 中文 and 短文 gates
 * through `reading-chuubun-corpus.ts`: one `BLANK`, restoring the answer
 * reproduces the window byte for byte, the answer occurs exactly once and is an
 * in-level noun in its listed kanji form, no distractor occurs in the window,
 * every distractor is in the pool and fills the answer's collocation frame in no
 * other sentence corpus-wide, and the row is not in the freeze-time judge record.
 *
 * THE GATE HAS A SECOND BRANCH, and it proves less, because there is less to
 * prove. `data/reading/n3-choubun.json` is tagged `construction: "authored"`:
 * comprehension 小問 written for this app, because doc-27 §10 measured the N3
 * 白書 corpus against the screens above and found one buildable row where the
 * 大問 prints four. Such a row has no source window to restore to, no `＿＿` to
 * refill and no wordlist noun as its key, so items 1 to 3 and the masked-slot
 * contract CANNOT run on it. What the authored branch checks instead is shape
 * plus self-citation: the signer and tag, the level's own 500-700 rune band, at
 * least 2 paragraphs, exactly 4 distinct options with an in-range key, no
 * `sourceIds` and no blank (claiming neither a source nor a slot it lacks), a
 * stem that classifies into a known ねらい, an `evidence` span that is printed
 * VERBATIM in the passage and is between 20 runes and half of it, the row absent
 * from the freeze-time judge record, and the structural validator. File-level it
 * additionally demands 4 distinct ねらい across the store.
 *
 * Which is all mechanically decidable and deliberately does NOT include the
 * coverage floor: `coverageOf` is reported per authored row as a diagnostic on
 * stderr, never as an issue. The floor screens vocabulary simplicity, and the
 * official N3 長文 itself scores 88.9% under it (doc-27 §1, §10). What the
 * screens cannot decide is whether the cited evidence actually entails the key.
 * That is the residue doc-27 §11 names and the blind-judge record freezes: two
 * independent passes over a key-less packet had to agree with the key and quote
 * a deciding sentence, and `validatedBy: "authored:agent-blind-judged"` says so.
 *
 * The one place this gate deliberately diverges from its siblings on the
 * masked-slot side is the coverage bar: `COVERAGE_FLOOR.N1 = 0.9` would reject
 * authentic N1 exam prose (the official 2018 読解 sample texts score 86.0-89.1%
 * under `coverageOf`; doc-27 §1), so 長文 screens at
 * `CHOUBUN_COVERAGE_FLOOR = 0.85` and every other 大問 keeps 0.9. The trade is
 * stated in `data/LICENSE.md`, not hidden here, and it stays exactly where it
 * was for the N1 rows while the authored branch ignores the bar entirely.
 *
 * File-level: at least one real 大問's worth of rows (4 at both levels), and ids,
 * passages, answers and source paragraphs unique.
 *
 * Run from this package: `bun run check:reading-choubun --level N1`. Exit 0 =
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
  authoredRowIssues,
  comprehensionIntentFor,
  isAuthoredConstruction,
  mixedAndAuthoredFileIssues,
} from "./reading-authored-corpus";
import {
  CHOUBUN_AUTHORED_BAND,
  CHOUBUN_BLOCK,
  CHOUBUN_COVERAGE_FLOOR,
  CHOUBUN_MAX_PASSAGE_LENGTH,
  CHOUBUN_MIN_PARAGRAPHS,
  CHOUBUN_MIN_PASSAGE_LENGTH,
  CHOUBUN_SIGNER,
  choubunSpentSourceIds,
  choubunWindowsFor,
  readChoubunRejections,
} from "./reading-choubun-corpus";
import {
  buildFrameFillers,
  coverageOf,
  LEVEL_RANKS,
  levelsUpTo,
  maskedSlotIssues,
  readCumulativeVocabIndex,
  readHakushoParagraphs,
  sentencesOfText,
  splitSentences,
} from "./reading-chuubun-corpus";

/** One real 大問 prints 4 小問, so each store must hold at least one 大問's
 * worth: N1 大問10 and N3 大問6 alike. */
const MIN_ITEMS_BY_LEVEL: Readonly<Record<string, number>> = {
  N1: 4,
  N3: 4,
};

/** The server's `loadReadingLevel` prints exactly 4 options per row. */
const OPTION_COUNT = 4;

/** The 長文 block's authored configuration: the numbers doc-27 §1 and §10
 * measured for THIS 大問, handed to the shared screens in
 * `reading-authored-corpus.ts` rather than baked into them, so the 中文 and 短文
 * gates can pass their own bands without a second copy of the predicates.
 * `CHOUBUN_AUTHORED_BAND` deliberately has no N2 entry: a level this block
 * does not write at must be refused, not measured against a borrowed band. */
const AUTHORED_CONFIG: AuthoredConfig = {
  bandFor: (level) => CHOUBUN_AUTHORED_BAND[level],
  evidence: {
    maxRatio: AUTHORED_MAX_EVIDENCE_RATIO,
    minRunes: AUTHORED_MIN_EVIDENCE_RUNES,
  },
  intentFor: comprehensionIntentFor,
  minIntents: AUTHORED_MIN_INTENTS,
  minParagraphs: CHOUBUN_MIN_PARAGRAPHS,
  optionCount: OPTION_COUNT,
};

/** The reading store row shape as frozen in `{level}-choubun.json`. Both
 * constructions share the fields; `sourceIds` belongs to masked-slot and
 * `evidence` to authored, and each branch refuses the other's. */
export interface ChoubunReadingEntry extends ReadingEntryFields {
  readonly construction?: "authored" | "masked-slot";
}

/** The row's verdict shape and the item-engine scaffolding live in
 * `check-reading-shared`; EntryReport is re-exported for this store's tests. */
export type { EntryReport } from "./check-reading-shared";

/** Is this row written rather than windowed? The tag picks the branch, and a
 * row with no tag falls into the masked-slot arm and fails its check, so an
 * untagged row can never slip through on the easier screens. */
const isAuthored = (entry: ChoubunReadingEntry): boolean =>
  isAuthoredConstruction(entry.construction);

/** Screens 1: the cert trio and the construction tag, per branch. The shared
 * cert screens the trio and the signer; this block's masked-slot arm adds its
 * own construction tag AFTER them, the position it has always printed at. */
const signerIssues = (entry: ChoubunReadingEntry): string[] => [
  ...certIssues(entry, CHOUBUN_SIGNER),
  ...(isAuthored(entry) || entry.construction === "masked-slot"
    ? []
    : ["construction-not-masked-slot"]),
];

/** Screens 2: the stamps a row cannot re-choose — level, block, stem, id. */
const identityIssues = (entry: ChoubunReadingEntry, level: string): string[] =>
  stampIssues({
    block: CHOUBUN_BLOCK,
    blockName: "choubun",
    entry,
    level,
  });

const checkFields = (entry: ChoubunReadingEntry, level: string): string[] => [
  ...signerIssues(entry),
  ...identityIssues(entry, level),
];

/** The masked-slot screens (single `BLANK`, restore-to-source byte equality,
 * the in-level noun key, frame solvability, the distractor contract, the judge
 * record) live in `reading-chuubun-corpus.ts` as `maskedSlotIssues`, shared with
 * the 短文 and 中文 gates: the three composed cloze gates re-prove one
 * contract, so a screen one of them keeps as a private copy is only a claim.
 * What is 長文's own stays here: the window admission, this block's 0.85
 * coverage bar (`CHOUBUN_COVERAGE_FLOOR` reported under its own issue code, so
 * a 長文 shortfall never reads like the others'), and the band. */

/** The admissible windows, keyed by the exact id list a row must print. */
const windowKeyFor = (ids: readonly string[]): string => ids.join("+");

/** The masked-slot half of one frozen row: the window the corpus still admits,
 * the all-store exclusion, the 900-1200 band and the blank contract. */
const checkMaskedWindow = ({
  entry,
  fillers,
  index,
  maxRank,
  rejections,
  spent,
  windows,
}: {
  entry: ChoubunReadingEntry;
  fillers: ReturnType<typeof buildFrameFillers>;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  maxRank: number;
  rejections: ReadonlySet<string>;
  spent: ReadonlySet<string>;
  windows: ReadonlyMap<string, string>;
}): string[] => {
  const issues: string[] = [];
  const sourceIds = entry.sourceIds ?? [];
  const sourceText = windows.get(windowKeyFor(sourceIds));
  if (sourceIds.length === 0) {
    return [...issues, "sourceIds-empty"];
  }
  if (sourceText === undefined) {
    // Not a window the corpus admits. One message names the whole contract:
    // unknown paragraphs, a non-consecutive or cross-page id list, a paragraph
    // under 150 runes and a joined length outside 900-1200 all land here,
    // because `choubunWindowsFor` is what filters each of them out.
    return [...issues, "window-not-admissible"];
  }
  for (const sourceId of sourceIds) {
    if (spent.has(sourceId)) {
      issues.push(`source-spent-by-another-store:${sourceId}`);
    }
  }
  const runes = [...entry.passage].length;
  if (runes > CHOUBUN_MAX_PASSAGE_LENGTH) {
    issues.push("passage-too-long");
  }
  if (runes < CHOUBUN_MIN_PASSAGE_LENGTH) {
    issues.push("passage-too-short");
  }
  issues.push(
    ...maskedSlotIssues({
      context: { fillers, index, maxRank, rejections },
      coverageFloor: CHOUBUN_COVERAGE_FLOOR,
      coverageIssue: "source-coverage-below-choubun-floor",
      entry,
      sourceSentences: sentencesOfText(sourceText),
      sourceText,
    })
  );
  return issues;
};

/** One frozen row: the fields, then the screens its own construction can be
 * held to, then the structural validator both branches share. */
export const checkEntry = ({
  entry,
  level,
  windows,
  index,
  fillers,
  rejections,
  spent,
}: {
  entry: ChoubunReadingEntry;
  level: string;
  windows: ReadonlyMap<string, string>;
  index: ReturnType<typeof readCumulativeVocabIndex>;
  fillers: ReturnType<typeof buildFrameFillers>;
  rejections: ReadonlySet<string>;
  spent: ReadonlySet<string>;
}): string[] => {
  const issues = checkFields(entry, level);
  const maxRank = LEVEL_RANKS[level] ?? 0;
  issues.push(
    ...(isAuthored(entry)
      ? authoredRowIssues(entry, level, AUTHORED_CONFIG, rejections)
      : checkMaskedWindow({
          entry,
          fillers,
          index,
          maxRank,
          rejections,
          spent,
          windows,
        }))
  );
  issues.push(
    ...structuralIssuesFor({
      itemType: "long-reading",
      maxPassageLength: CHOUBUN_MAX_PASSAGE_LENGTH,
      row: readingShapeOf(entry),
    })
  );
  return issues;
};

/** What the store has already printed, so a second row cannot repeat it, plus
 * the ねらい tally only the authored branch reads. */
interface RowLedger {
  readonly answers: Set<string>;
  readonly ids: Set<string>;
  readonly intents: Set<string>;
  readonly passages: Set<string>;
  readonly sources: Set<string>;
}

/** The paragraphs this row cites that an earlier row already spent. */
const sourceReuseIssues = (
  sourceIds: readonly string[],
  seen: Set<string>
): string[] => {
  const issues: string[] = [];
  for (const sourceId of sourceIds) {
    issues.push(...spendIssue(seen, sourceId, "duplicate-source"));
  }
  return issues;
};

/** The answer this row repeats from an earlier row, if any. */
const answerReuseIssues = ({
  entry,
  seen,
}: {
  entry: ChoubunReadingEntry;
  seen: Set<string>;
}): string[] => {
  const answer = entry.options[entry.answerIndex];
  return answer === undefined
    ? []
    : spendIssue(seen, answer, "duplicate-answer");
};

/** The all-store uniqueness bookkeeping, named in place on the row that
 * repeats something. */
const ledgerIssuesFor = (
  entry: ChoubunReadingEntry,
  issues: string[],
  ledger: RowLedger
): string[] => {
  issues.push(
    ...spendIssue(ledger.ids, entry.id, "duplicate-id"),
    ...spendIssue(ledger.passages, entry.passage, "duplicate-passage")
  );
  issues.push(...sourceReuseIssues(entry.sourceIds ?? [], ledger.sources));
  issues.push(...answerReuseIssues({ entry, seen: ledger.answers }));
  if (isAuthored(entry)) {
    const intent = comprehensionIntentFor(entry.stem);
    if (intent !== null) {
      ledger.intents.add(intent);
    }
  }
  return issues;
};

/** What no single row can satisfy or break: one 大問's worth of rows, one
 * construction per store, and `AUTHORED_MIN_INTENTS` distinct ねらい when the
 * rows are written rather than windowed. The spread is counted over the store so
 * a row cannot pass itself by asking one novel question. */
const fileIssuesFor = (
  entries: readonly ChoubunReadingEntry[],
  level: string,
  intents: ReadonlySet<string>
): string[] => {
  const issues: string[] = [];
  const minItems = MIN_ITEMS_BY_LEVEL[level] ?? 4;
  if (entries.length < minItems) {
    issues.push(`too-few-items:${entries.length}<${minItems}`);
  }
  issues.push(
    ...mixedAndAuthoredFileIssues({
      config: AUTHORED_CONFIG,
      entries,
      intents,
    })
  );
  return issues;
};

/** The whole gate over one store file. The 白書 corpus, the all-store `spent`
 * set and the frame-fillers map are loaded only when the store actually holds a
 * masked-slot row: they exist to re-prove a window's provenance, and an authored
 * store prints none, so scanning the corpus for it would be work that decides
 * nothing. */
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
  ) as readonly ChoubunReadingEntry[];
  const storeDir = join(storePath, "..");
  const needsWindows = entries.some((entry) => !isAuthored(entry));
  const paragraphs = needsWindows
    ? readHakushoParagraphs(join(storeDir, "hakusho.jsonl"))
    : [];
  const spent = needsWindows
    ? choubunSpentSourceIds(storeDir)
    : new Set<string>();
  const windows = new Map<string, string>();
  for (const window of choubunWindowsFor({ paragraphs, spent })) {
    windows.set(windowKeyFor(window.ids), window.text);
  }
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const sentences = paragraphs.flatMap((paragraph) =>
    splitSentences(paragraph)
  );
  const fillers = buildFrameFillers(sentences, index, maxRank);
  const rejections = readChoubunRejections(storeDir, level);

  const ledger: RowLedger = {
    answers: new Set(),
    ids: new Set(),
    intents: new Set(),
    passages: new Set(),
    sources: new Set(),
  };
  const reports: EntryReport[] = entries.map(
    (entry): EntryReport => ({
      entryId: entry.id,
      issues: ledgerIssuesFor(
        entry,
        checkEntry({
          entry,
          fillers,
          index,
          level,
          rejections,
          spent,
          windows,
        }),
        ledger
      ),
    })
  );
  const fileIssues = fileIssuesFor(entries, level, ledger.intents);
  if (fileIssues.length > 0) {
    reports.push({ entryId: "(file)", issues: fileIssues });
  }
  return reports;
};

/** Per-authored-row vocabulary coverage, as a REPORTED number only. doc-27 §10
 * takes the floor off this route because it screens vocabulary simplicity, not
 * item quality, but the number is still what a learner feels when they open the
 * row, so the CLI prints it instead of dropping it. */
export const authoredCoverageLines = ({
  storePath,
  level,
  dataDir,
}: {
  storePath: string;
  level: string;
  dataDir: string;
}): string[] => {
  const entries = JSON.parse(
    readFileSync(storePath, "utf8")
  ) as readonly ChoubunReadingEntry[];
  const authored = entries.filter(isAuthored);
  if (authored.length === 0) {
    return [];
  }
  const index = readCumulativeVocabIndex(dataDir, levelsUpTo(level));
  const maxRank = LEVEL_RANKS[level] ?? 0;
  return authored.map(
    (entry): string =>
      `${entry.id}: coverage ${(coverageOf(entry.passage, index, maxRank) * 100).toFixed(1)}%`
  );
};

if (import.meta.main) {
  runReadingGateMain({
    check: checkReadingFile,
    defaultLevel: "N1",
    gateName: "check:reading-choubun",
    // The number doc-27 §10 refuses to gate on, printed so the route stays
    // measured rather than merely unpoliced. stderr, because it is not an issue.
    reportLines: ({ dataDir, level, storePath }) =>
      authoredCoverageLines({ dataDir, level, storePath }),
    storeFileName: (level): string => `${level.toLowerCase()}-choubun.json`,
  });
}
