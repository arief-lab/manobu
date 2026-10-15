/**
 * `check:reading-jouhou` — the deterministic CI gate for the 情報検索 store
 * (TASK-173.9.13 AC#6, authored route added by TASK-173.9.18). NO LLM runs here.
 *
 * This gate is what makes `validated: true` in
 * `data/reading/{n4,n3,n2,n1}-jouhou.json` mean something: the server trusts that
 * flag at assembly time exactly the way it trusts a licensed 案内 notice, so this
 * script re-proves offline, on every run, that each frozen row
 *
 *   1. is provenance `composed`, `validated`, and carries `block:
 *      "jouhou-kensaku"`. A `sourced-table` row is signed by
 *      `deterministic:gen-reading-jouhou` and sits at N2 or N1; an
 *      `authored-table` row is signed by `authored:agent-blind-judged`, sits at a
 *      level `JOUHOU_AUTHORED_BAND` names (N4 and N3), and may print NO 出典,
 *      編集・加工, URL, 取得日 or licence, because those are claims about a document
 *      it does not have (doc-26 §3.5: N3's ねらい is a 書き下ろした情報素材, which
 *      nothing published can be, and doc-26 §4 gives N4 the same 書き下ろし 素材 at
 *      400字程度, which no PDL fee table is),
 *   2. prints a 素材 inside the band the engine budgets an `info-search` passage
 *      for that route: 600-800 runes for a `sourced-table` row, and the level's
 *      `JOUHOU_AUTHORED_BAND` window for an `authored-table` row,
 *   3. (a `sourced-table` row) prints NOTHING the vendored snapshot does not
 *      print: the gate re-reads `jouhou-upstream.jsonl` and checks the RENDERED
 *      passage (title, every quote line, every table cell) against it,
 *      whitespace-insensitively. That is the table-integrity half of AC#1, and it
 *      reads the shipped text rather than the generator's spec, so a row cannot
 *      pass by describing a document it does not carry. The snapshot itself carries
 *      the artifact's sha256 and its 取得日, so the extraction stays attributable
 *      rather than remembered. An `authored-table` row has no snapshot to be
 *      measured against, so the gate checks its lookup screens instead,
 *   4. answers its own question out of the cells it prints: the answer appears in
 *      the 素材, appears inside the `key` line(s) the stem names, and no distractor
 *      appears inside that key (so the 素材 answers the stem in exactly one place),
 *   5. leaks nothing across documents: no distractor is readable from a DIFFERENT
 *      shipped 素材, which is the property that would let a reader answer without
 *      finding this one,
 *   6. (a `sourced-table` row) carries all three PDL1.0 obligations (出典 with the
 *      page URL, the 編集・加工 statement with the actor, an 取得日 equal to the
 *      snapshot's),
 *   7. is not in the freeze-time judge record `{level}-jouhou-rejected.json`,
 *   8. is structurally valid per `validateQuestionItem` as an `info-search` item
 *      under this block's own passage cap.
 *
 * Neither route carries a coverage floor. The vocabulary instrument scores
 * `円`, `,`, `～` and 令和 as unknown, so it measures the notation of a fee table
 * rather than the difficulty of the reading; doc-27 §1 records the official N1
 * 情報素材 scoring 89.1% under it. doc-27 §4 freezes the screen that replaces it:
 * a 情報検索 item is decidable because the printed cells answer it, which items 4
 * and 5 above check directly.
 *
 * File-level: at least one 大問's worth of rows per level (4 at N2/N1, 8 at N4 and
 * N3), at least two DISTINCT 素材 per level (a 大問 prints 2 小問 and the server spends
 * passages, so two rows over one document fill one slot), and unique ids and
 * stems.
 *
 * Run from this package: `bun run check:reading-jouhou` re-measures both composed
 * stores, and `bun run check:reading-jouhou --level N2` one level only. Exit 0 =
 * every row passes; exit 1 = issues listed, each prefixed with its level. The
 * exported `checkReadingFile` is the test seam.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type EntryReport,
  readingShapeOf,
  spendIssue,
  structuralIssuesFor,
} from "./check-reading-shared";
import {
  isJouhouAuthored,
  JOUHOU_MAX_PASSAGE_LENGTH,
  JOUHOU_MIN_DISTINCT_PASSAGES,
  type JouhouQuestion,
  type JouhouStoreRow,
  type JouhouUpstream,
  jouhouAuthoredBandIssues,
  jouhouBandIssues,
  jouhouCrossRowIssues,
  jouhouObligationIssues,
  jouhouPassageVerbatimIssues,
  jouhouQuestionIssues,
  jouhouRowIssues,
  jouhouStorePath,
  readJouhouRejections,
  readJouhouUpstream,
} from "./reading-jouhou-corpus";

/** One real 大問 prints 4 小問 at N2 and 3 at N1 in the official papers, but this
 * store only has to fill the 2 小問 the engine asks of one 情報検索 block, twice
 * over, so 4 rows is one level's worth with room for a rejected row. */
const MIN_ITEMS_BY_LEVEL: Readonly<Record<string, number>> = {
  N1: 4,
  N2: 4,
  // N3 大問7 prints 2 小問 and a learner runs the block more than once per paper
  // set, so 8 rows is four 素材 pairs: the depth the owner's 読解-finished rule asks
  // for, not the minimum this gate used to accept at N2/N1.
  N3: 8,
  // N4 大問6 prints the same 2 小問, over a 書き下ろし 素材 no PDL document serves at
  // this length, so the authored route carries the same four 素材 pairs N3 ships.
  N4: 8,
};

const SHA_RE = /^[a-f0-9]{64}$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

/** The row's verdict shape lives in `check-reading-shared`; re-exported so the
 * store's test keeps importing it from here. */
export type { EntryReport } from "./check-reading-shared";

const questionOf = (row: JouhouStoreRow): JouhouQuestion => ({
  answerIndex: row.answerIndex,
  key: row.key,
  options: row.options,
  stem: row.stem,
});

/** What the vendored snapshot owes: an id the row can cite, the artifact's
 * sha256, and the day the extraction was taken. */
const snapshotIssues = (upstream: JouhouUpstream | undefined): string[] => {
  if (upstream === undefined) {
    return ["source-not-in-upstream"];
  }
  const issues: string[] = [];
  if (!SHA_RE.test(upstream.sha256)) {
    issues.push("snapshot-artifact-unpinned");
  }
  if (!DATE_RE.test(upstream.fetchedAt)) {
    issues.push("snapshot-undated");
  }
  if (upstream.text.length === 0) {
    issues.push("snapshot-empty");
  }
  return issues;
};

/** One frozen row: shape, band, the document it prints, its own answer contract,
 * the obligations, then the structural validator. The cross-document rule is a
 * property of the batch, so the caller adds it.
 *
 * The two routes share the answer contract and differ on everything that can only
 * be proved about a REAL document: an authored 書き下ろし 素材 has no snapshot to be
 * byte-equal to, so the verbatim, pinning and PDL-obligation screens are skipped
 * for it, while the band, the key-line lookup, the cross-素材 leak rule and the
 * structural validator are checked identically. That is the whole argument for
 * letting a written-down page into this block: what made a sourced row decidable
 * was never the licence, it was items 4 and 5 of the header list. */
export const checkEntry = ({
  rejections,
  row,
  upstream,
}: {
  rejections: ReadonlySet<string>;
  row: JouhouStoreRow;
  upstream: JouhouUpstream | undefined;
}): string[] => {
  const issues: string[] = [...jouhouRowIssues(row)];
  if (isJouhouAuthored(row)) {
    issues.push(
      ...jouhouAuthoredBandIssues({
        level: row.level,
        passage: row.passage,
      })
    );
  } else {
    issues.push(...jouhouBandIssues(row.passage));
    issues.push(...snapshotIssues(upstream));
    if (upstream !== undefined) {
      // Table integrity over the RENDERED text, not the generator's spec.
      issues.push(
        ...jouhouPassageVerbatimIssues({ passage: row.passage, upstream })
      );
      issues.push(...jouhouObligationIssues({ row, upstream }));
      if ((row.sourceIds?.[0] ?? "") !== upstream.id) {
        issues.push(`source-not-cited:${upstream.id}`);
      }
    }
  }
  issues.push(
    ...jouhouQuestionIssues({ passage: row.passage, question: questionOf(row) })
  );
  if (rejections.has(row.id)) {
    issues.push("row-judge-rejected");
  }
  issues.push(
    ...structuralIssuesFor({
      itemType: "info-search",
      maxPassageLength: JOUHOU_MAX_PASSAGE_LENGTH,
      row: readingShapeOf(row),
    })
  );
  return issues;
};

/** Bucket the batch's cross-document issues by the row they name, so each
 * leaking distractor is reported against its own row rather than the file. */
const crossIssuesByRow = (issues: readonly string[]): Map<string, string[]> => {
  const crossByRow = new Map<string, string[]>();
  for (const issue of issues) {
    const [, rowId] = issue.split(":");
    if (rowId === undefined) {
      continue;
    }
    const list = crossByRow.get(rowId) ?? [];
    list.push(issue);
    crossByRow.set(rowId, list);
  }
  return crossByRow;
};

/** The repeats only the whole store can see: the same id or the same stem
 * twice, which no single-row screen can notice. */
const repeatIssuesFor = ({
  row,
  seenIds,
  seenStems,
}: {
  row: JouhouStoreRow;
  seenIds: Set<string>;
  seenStems: Set<string>;
}): string[] => [
  ...spendIssue(seenIds, row.id, "duplicate-id"),
  ...spendIssue(seenStems, row.stem, "duplicate-stem"),
];

/** The whole gate over one store file. */
/** One report per frozen row: its own screens, the ledger's repeat issues, and
 * the cross-row verdicts that name it. */
const rowReportsFor = ({
  byId,
  crossByRow,
  rejections,
  rows,
}: {
  byId: ReadonlyMap<string, JouhouUpstream>;
  crossByRow: Map<string, string[]>;
  rejections: ReadonlySet<string>;
  rows: readonly JouhouStoreRow[];
}): EntryReport[] => {
  const reports: EntryReport[] = [];
  const seenIds = new Set<string>();
  const seenStems = new Set<string>();
  for (const row of rows) {
    const upstream = byId.get(row.sourceIds?.[0] ?? "");
    const issues = checkEntry({ rejections, row, upstream });
    issues.push(...repeatIssuesFor({ row, seenIds, seenStems }));
    for (const issue of crossByRow.get(row.id) ?? []) {
      issues.push(issue);
    }
    reports.push({ entryId: row.id, issues });
  }
  return reports;
};

export const checkReadingFile = ({
  level,
  storePath,
}: {
  level: string;
  storePath: string;
}): EntryReport[] => {
  const rows = JSON.parse(
    readFileSync(storePath, "utf8")
  ) as readonly JouhouStoreRow[];
  const storeDir = join(storePath, "..");
  const byId = new Map<string, JouhouUpstream>();
  for (const upstream of readJouhouUpstream(storeDir)) {
    byId.set(upstream.id, upstream);
  }
  const rejections = readJouhouRejections(storeDir, level);
  const crossByRow = crossIssuesByRow(jouhouCrossRowIssues(rows));
  const reports = rowReportsFor({ byId, crossByRow, rejections, rows });

  const minItems = MIN_ITEMS_BY_LEVEL[level] ?? 4;
  if (rows.length < minItems) {
    reports.push({
      entryId: "(file)",
      issues: [`too-few-items:${rows.length}<${minItems}`],
    });
  }
  // A sourced row's 素材 is the document it cites; an authored 素材 has no id, so
  // the page itself is the identity. Both count as 素材, neither may be double-printed.
  const documents = new Set(
    rows.map((row) => row.sourceIds?.[0] ?? row.passage)
  );
  if (documents.size < JOUHOU_MIN_DISTINCT_PASSAGES) {
    reports.push({
      entryId: "(file)",
      issues: [
        `too-few-materials:${documents.size}<${JOUHOU_MIN_DISTINCT_PASSAGES}`,
      ],
    });
  }
  return reports;
};

if (import.meta.main) {
  const dataDir = join(import.meta.dir, "..", "data", "reading");
  const levelIndex = process.argv.indexOf("--level");
  // Without --level the gate covers BOTH composed stores. Each one is a shipped
  // file the server trusts for `validated: true`, so a default that quietly read
  // only N2 would print a whole-gate verdict over half the stores.
  const levels =
    levelIndex >= 0
      ? [process.argv[levelIndex + 1] ?? "N2"]
      : ["N1", "N2", "N3", "N4"];
  for (const level of levels) {
    if (level !== "N1" && level !== "N2" && level !== "N3" && level !== "N4") {
      console.error(
        "check:reading-jouhou takes --level N4, N3, N2 or N1; 情報検索 is 大問6 at N4, 大問7 at N3, 大問14 at N2 and 大問13 at N1"
      );
      process.exit(1);
    }
  }
  const failing: EntryReport[] = [];
  for (const level of levels) {
    let reports: EntryReport[];
    try {
      reports = checkReadingFile({
        level,
        storePath: jouhouStorePath(dataDir, level),
      });
    } catch (error) {
      console.error(
        `check:reading-jouhou cannot read the ${level} store: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
    const levelFailing = reports.filter((report) => report.issues.length > 0);
    if (levelFailing.length === 0) {
      console.log(
        `check:reading-jouhou ${level}: all ${reports.length} rows pass`
      );
      continue;
    }
    for (const report of levelFailing) {
      failing.push({ ...report, entryId: `${level}/${report.entryId}` });
    }
  }
  if (failing.length === 0) {
    process.exit(0);
  }
  for (const report of failing) {
    for (const issue of report.issues) {
      console.log(`${report.entryId}: ${issue}`);
    }
  }
  process.exit(1);
}
