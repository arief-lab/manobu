/**
 * Shared constants and screens for the 情報検索 (情報素材) pipeline
 * (TASK-173.9.13). The generator (`gen-reading-jouhou.ts`) and the gate
 * (`check-reading-jouhou.ts`) both import this module, so a screen is a contract
 * rather than a claim, exactly as in `reading-choubun-corpus.ts`.
 *
 * WHAT THIS STORE IS. N2 大問14 and N1 大問13 ask 「広告、パンフレット、情報誌、
 * ビジネス文書などの情報素材（700字程度）の中から必要な情報を探し出すことができる
 * か」 (doc-26 §3.4/§3.5). The shape was never the problem: `info-search` exists
 * and the server has printed it since TASK-173.9.7. The problem was that the only
 * 素材 in the tree were licensed N5-band 案内・お知らせ notices stamped upward
 * (`data/reading/{n5,n4}-jouhou.json`, and `n3-jouhou.json` until TASK-173.9.18
 * replaced that stamp with authored 素材), which `data/LICENSE.md` §11 refuses to
 * climb further. So this store is built from REAL government 情報素材: fee,
 * rate and schedule tables published by agencies whose terms expressly permit
 * 編集・加工.
 *
 * WHY A SNAPSHOT AND NOT A FETCH. The rows must be provable offline, in CI, with
 * no network and no model. So `data/reading/jouhou-upstream.jsonl` vendors the
 * deterministic extraction of each document (its `pdftotext -layout` output or its
 * HTML table, plus the artifact's sha256 and the 取得日 it was taken on), and a
 * shipped row points at it with `sourceIds`. That gives the honesty chain the
 * 白書 rows have: the row's printed cells are byte-equal to the snapshot (checked
 * here), and the snapshot is the fetched artifact (the sha256 and 取得日 make that
 * attributable rather than remembered).
 *
 * NO COVERAGE FLOOR HERE, AND THAT IS THE PRECEDENT RATHER THAN AN EXCEPTION.
 * Every other composed store in this package screens its prose with
 * `COVERAGE_FLOOR` because the unit is a SENTENCE the learner must read. A 情報素材
 * is a TABLE: the instrument scores `円`, `,`, `～` and 令和 as unknown runes, and
 * doc-27 §1 already records what it does to authentic material - the official N1
 * 情報素材 (the four-library 案内 in `N1R.pdf`, 1105 runes) measures 89.1%, under
 * the 0.9 that level's 中文 rows clear. Loosening a floor to route around an
 * unfilled block is what doc-26 forbids; declining to apply an instrument to a
 * shape it was never built for is not, and the licensed 情報検索 stores this file
 * replaces were never screened at all.
 *
 * WHAT IS SCREENED INSTEAD, AND WHY IT IS THE RIGHT SCREEN. A 情報検索 item is a
 * LOOKUP, so its distractors legitimately come from the SAME 素材: 「6ヶ月前納の口座
 * 振替はいくらか」 distracts with the 現金 and 1年 figures of the very table being
 * read. Barring a distractor from the passage would bar the genre. The two
 * properties that DO make an item decidable are frozen instead: the answer is a
 * cell of the row (or line) the stem names, and no distractor is a cell of that
 * same row, so the printed 素材 answers the question and answers it once
 * (`jouhouQuestionIssues`). The other half is that the distractors cannot be read
 * out of a DIFFERENT document, which is what would let a learner answer without
 * finding this 素材 (`jouhouCrossRowIssues`, AC#6).
 *
 * THE THREE OBLIGATIONS ARE NOT DEcoration. PDL1.0 (and the 準拠 wording the
 * agencies use) asks for the 出典 with the page URL; each agency adds 「コンテンツ
 * を編集・加工等して利用する場合は、上記出典とは別に、編集・加工等を行ったことを
 * 記載してください」 (環境省 and 文科省 also name the 主体), and 国税庁 adds that
 * edited information must never be published あたかも国が作成したかのような態様で.
 * Figures also age: the 令和8年度 前納額 and the 地域別最低賃金 are年度-specific
 * documents, so an 取得日 is the only thing that makes a stale number attributable
 * instead of silently wrong. Every row therefore carries all three.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRejectedIdsFrom } from "./reading-n4-corpus";

/** The block this pipeline fills: N2 大問14 and N1 大問13. It is the same block
 * id the licensed N5/N4 stores and the authored N3 store carry, so the server
 * needs no new wiring. */
export const JOUHOU_BLOCK = "jouhou-kensaku";

/** The signer a generated row carries: the pipeline, not a model. The key is a
 * value the printed cells themselves hold, so it is machine-checked rather than
 * judged (the same freeze style as `deterministic:gen-reading-choubun`). */
export const JOUHOU_SIGNER = "deterministic:gen-reading-jouhou";

/** The construction tag: a real 情報素材, its table reflowed into markdown, with
 * a lookup question this repo authored. */
export const JOUHOU_CONSTRUCTION = "sourced-table";

/** The license every document in this store is used under. */
export const JOUHOU_LICENSE = "PDL-1.0";

/** The printed 素材 band. The official ねらい budgets 700字程度 at both levels
 * (doc-26 §3.4/§3.5); 600 is the floor that still makes it a 素材 rather than a
 * heading plus two rows, and 800 is exactly the ceiling the server now budgets an
 * `info-search` passage (`apps/server/src/services/exam-service.ts`,
 * `JOUHOU_MAX_PASSAGE_LENGTH`), so a row the gate freezes is a row the engine
 * prints. */
export const JOUHOU_MIN_PASSAGE_LENGTH = 600;
export const JOUHOU_MAX_PASSAGE_LENGTH = 800;

/** A 大問 prints 2 小問, so a level needs at least this many DISTINCT 素材: a
 * passage is spent by the first 小問 that takes it
 * (`usedJouhouPassages`), so two rows over one document can only ever fill one
 * slot of one paper. */
export const JOUHOU_MIN_DISTINCT_PASSAGES = 2;

/** The signer an AUTHORED 素材 carries: two blind model passes over the frozen
 * page, not a pipeline. The lookup key is still machine-checked, but which line
 * the stem names is a thing an author decided, so the stamp says who checked it. */
export const JOUHOU_AUTHORED_SIGNER = "authored:agent-blind-judged";

/** The construction tag for a 書き下ろし 素材: a table this repo wrote, with no
 * upstream document behind it. Deliberately not `sourced-table`, which is the
 * claim that a snapshot prints these exact cells. */
export const JOUHOU_AUTHORED_CONSTRUCTION = "authored-table";

/** The authored 素材 band per level, and deliberately only the levels the block
 * composes this way. N3's official ねらい budgets 600字程度 (doc-26 §3.5), so 500-700
 * is that 程度 with the same tolerance the authored 長文 band uses; the ceiling also
 * stays under the server's own `info-search` cap, so a row the gate freezes is a
 * row the engine prints. A level missing here is refused fail-closed rather than
 * falling back to the 600-800 sourced band, which would grade N4's 400字素材 against
 * N1's length. */
export const JOUHOU_AUTHORED_BAND: Readonly<
  Record<string, { readonly max: number; readonly min: number }>
> = {
  N3: { max: 700, min: 500 },
  // N4's ねらい budgets 400字程度 (doc-26 §4), the same ±~17% tolerance N3's 600字
  // gives, and the ceiling sits far above the 160-245 runes of the licensed N5 set
  // this file used to carry, so a written N4 素材 cannot be N5 notices re-labelled.
  N4: { max: 470, min: 340 },
};

/** Which route a row came from, read off its own tag. The gate dispatches on this
 * and never infers it from a field being empty. */
export const isJouhouAuthored = (row: {
  readonly construction?: string;
}): boolean => row.construction === JOUHOU_AUTHORED_CONSTRUCTION;

/** The authored band for one level, or the issue that level has no authored
 * composition at all. */
export const jouhouAuthoredBandIssues = ({
  level,
  passage,
}: {
  readonly level: string;
  readonly passage: string;
}): readonly string[] => {
  const band = JOUHOU_AUTHORED_BAND[level];
  if (band === undefined) {
    return [`authored-band-unknown:${level}`];
  }
  const runes = runesOf(passage);
  const issues: string[] = [];
  if (runes > band.max) {
    issues.push(`passage-too-long:${runes}>${band.max}`);
  }
  if (runes < band.min) {
    issues.push(`passage-too-short:${runes}<${band.min}`);
  }
  return issues;
};

/** Row id, mirroring 長文's `n1b-` and 中文's `n1c-`: `n2j-<upstream id>-<seq>`.
 * The upstream id is inside the row id, so two rows of one document are
 * distinguishable and one document cannot be mistaken for another. */
export const jouhouIdFor = (
  level: string,
  upstreamId: string,
  sequence: number
): string => `${level.toLowerCase()}j-${upstreamId}-${sequence}`;

/** One vendored document snapshot. */
export interface JouhouUpstream {
  readonly agency: string;
  /** Where the artifact was read from (PDF or pamphlet file), when it differs
   * from `pageUrl`. */
  readonly docUrl: string;
  /** The 取得日: the date this extraction was taken. Frozen data, not `Date.now`,
   * so a regeneration that changes it is a visible edit. */
  readonly fetchedAt: string;
  readonly id: string;
  readonly license: string;
  /** The page the 出典 credit points at. */
  readonly pageUrl: string;
  /** sha256 of the artifact bytes, so the extraction is attributable. */
  readonly sha256: string;
  readonly text: string;
  readonly title: string;
}

/** The JSONL the fetch script writes and the gate reads. */
export const JOUHOU_UPSTREAM_FILE = "jouhou-upstream.jsonl";

const DATA_DIR = new URL("../data/reading/", import.meta.url).pathname;

/** Every vendored snapshot, in file order. */
export const readJouhouUpstream = (
  dir: string = DATA_DIR
): readonly JouhouUpstream[] => {
  const file = join(dir, JOUHOU_UPSTREAM_FILE);
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JouhouUpstream);
};

/** Whitespace-insensitive form of a string. A `pdftotext -layout` page pads its
 * cells with spaces and full-width spaces to hold the grid, so "cell-exact" means
 * the same characters in the same order, not the same padding: padding is exactly
 * the 編集・加工 this store declares on every row. */
export const compact = (text: string): string =>
  text.replace(/[\s\u3000\u00a0]+/gu, "");

/** One authored lookup question over one document. `key` is the set of printed
 * LINES the stem names: one bullet of a 通知, or one row of a table. It is what
 * makes the item a lookup rather than a guess, because the gate can then ask
 * whether the printed 素材 answers the question in exactly one place. */
export interface JouhouQuestion {
  readonly answerIndex: number;
  readonly key: readonly string[];
  readonly options: readonly string[];
  readonly stem: string;
}

/** What the generator assembles into one row. `lines`, `header`, `rows` and
 * `notes` are printed in this order, and every one of them must come from the
 * snapshot. */
export interface JouhouAssembly {
  readonly header: readonly string[];
  readonly lines: readonly string[];
  readonly notes: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly title: string;
}

/** The store's markdown shape: the licensed N5 rows print a bare title line, an
 * empty quote, then `> `-prefixed table lines, so a sourced 素材 renders the same
 * way and the reader sees one document rather than two formats. */
export const renderJouhouPassage = (assembly: JouhouAssembly): string => {
  const parts: string[] = [assembly.title, ">"];
  for (const line of assembly.lines) {
    parts.push(`> ${line}`);
  }
  if (assembly.header.length > 0 || assembly.rows.length > 0) {
    // One blank quote between prose and table, never two: a material with no
    // prose lines still starts its table right under the title.
    if (assembly.lines.length > 0) {
      parts.push(">");
    }
    parts.push(`> | ${assembly.header.join(" | ")} |`);
    parts.push(`> |${assembly.header.map(() => "---").join("|")}|`);
    for (const row of assembly.rows) {
      parts.push(`> | ${row.join(" | ")} |`);
    }
  }
  for (const note of assembly.notes) {
    parts.push(`> ${note}`);
  }
  return parts.join("\n");
};

const runesOf = (text: string): number => [...text].length;

/** The 出典 credit, in the wording each agency's own terms page asks for. */
const CREDIT_BY_AGENCY: Readonly<Record<string, string>> = {
  出入国在留管理庁: "出入国在留管理庁ホームページ",
  厚生労働省: "厚生労働省ホームページ",
  国税庁: "国税庁ホームページ",
  文部科学省: "文部科学省ホームページ",
  環境省: "環境省ホームページ",
};

/** `sourceCredit` for one snapshot: the 出典 line with the page URL substituted,
 * exactly as the 白書 rows carry it. */
export const jouhouCreditFor = (upstream: JouhouUpstream): string => {
  const agency = CREDIT_BY_AGENCY[upstream.agency] ?? upstream.agency;
  return `出典：${agency}（${upstream.pageUrl}）`;
};

/** The 編集・加工 statement PDL1.0 and every one of these agencies ask for, with
 * the actor named (環境省 requires the 主体 too) and the 取得日. This is what stops
 * a reflowed table from reading as the ministry's own publication. */
export const jouhouEditedCreditFor = (upstream: JouhouUpstream): string =>
  `この素材は${upstream.agency}の公表資料の表・数値をmanobuが読みやすい形に編集・加工したものです（原文の${upstream.title}ではありません）。取得日：${upstream.fetchedAt}`;

/** Every string the READER of a rendered 素材 sees: the title line, each quote
 * line, each table cell. The markdown separator (`|---|---|`) is furniture rather
 * than document text, so it is not a unit. */
const QUOTE_PREFIX = /^>\s?/u;
const TABLE_SEPARATOR = /^[-:]+$/u;

export const jouhouPassageUnits = (passage: string): readonly string[] => {
  const units: string[] = [];
  for (const line of passage.split("\n")) {
    const body = line.replace(QUOTE_PREFIX, "");
    if (body.includes("|")) {
      for (const cell of body.split("|")) {
        const trimmed = cell.trim();
        if (trimmed.length > 0 && !TABLE_SEPARATOR.test(trimmed)) {
          units.push(trimmed);
        }
      }
      continue;
    }
    if (body.length > 0) {
      units.push(body);
    }
  }
  return units;
};

/** Table integrity read off the SHIPPED text rather than the generator's spec:
 * every unit the printed 素材 shows must be in the snapshot it cites. A gate uses
 * this to prove the row cannot paraphrase a number into existence. */
export const jouhouPassageVerbatimIssues = ({
  passage,
  upstream,
}: {
  readonly passage: string;
  readonly upstream: JouhouUpstream;
}): readonly string[] => {
  const source = compact(upstream.text);
  const issues: string[] = [];
  for (const unit of jouhouPassageUnits(passage)) {
    const needle = compact(unit);
    if (needle.length > 0 && !source.includes(needle)) {
      issues.push(`printed-unit-not-in-upstream:${unit.slice(0, 24)}`);
    }
  }
  return issues;
};

/** Every string the row prints out of the document, in printed order. The gate
 * checks each one against the snapshot, so the passage cannot paraphrase a number
 * into existence. */
export const jouhouPrintedUnits = (
  assembly: JouhouAssembly,
  passage: string
): readonly string[] => {
  const units = [assembly.title, ...assembly.lines, ...assembly.notes];
  for (const row of assembly.rows) {
    units.push(...row);
  }
  units.push(...assembly.header);
  // The rendered passage is also a unit: if the renderer ever escapes or folds a
  // cell, the check sees the text the reader actually gets, not the spec.
  units.push(...jouhouPassageUnits(passage));
  return units;
};

/** Issues with the printed document itself, against the snapshot it cites. */
export const jouhouSourceIssues = ({
  assembly,
  passage,
  upstream,
}: {
  readonly assembly: JouhouAssembly;
  readonly passage: string;
  readonly upstream: JouhouUpstream;
}): readonly string[] => {
  const issues: string[] = [];
  const source = compact(upstream.text);
  for (const unit of jouhouPrintedUnits(assembly, passage)) {
    const needle = compact(unit);
    if (needle.length > 0 && !source.includes(needle)) {
      issues.push(`printed-unit-not-in-upstream:${unit.slice(0, 24)}`);
    }
  }
  return issues;
};

/** Issues with the band. Measured in runes on the joined passage, which is what
 * the engine's `validateStimulusLength` measures. */
export const jouhouBandIssues = (passage: string): readonly string[] => {
  const runes = runesOf(passage);
  const issues: string[] = [];
  if (runes > JOUHOU_MAX_PASSAGE_LENGTH) {
    issues.push(`passage-too-long:${runes}>${JOUHOU_MAX_PASSAGE_LENGTH}`);
  }
  if (runes < JOUHOU_MIN_PASSAGE_LENGTH) {
    issues.push(`passage-too-short:${runes}<${JOUHOU_MIN_PASSAGE_LENGTH}`);
  }
  return issues;
};

const LATIN_RE = /[A-Za-z]/u;

/** A distractor the key line prints would answer the stem a second time, which is
 * the one way this item stops being a lookup. */
const distractorsInKeyLineIssues = ({
  answerIndex,
  keyLine,
  options,
}: {
  readonly answerIndex: number;
  readonly keyLine: string;
  readonly options: readonly string[];
}): string[] => {
  const issues: string[] = [];
  for (const [index, option] of options.entries()) {
    if (index === answerIndex) {
      continue;
    }
    if (keyLine.includes(compact(option))) {
      issues.push(`distractor-in-key-line:${option}`);
    }
  }
  return issues;
};

/** The option-level form checks: four options or nothing else is said about the
 * row, then the index, the script and the duplicate walk. */
const optionFormIssues = (question: JouhouQuestion): string[] => {
  const issues: string[] = [];
  if (question.options.length !== 4) {
    issues.push("options-not-four");
    return issues;
  }
  if (
    question.answerIndex < 0 ||
    question.answerIndex >= question.options.length
  ) {
    issues.push("answer-index-out-of-range");
  }
  if (
    LATIN_RE.test(question.stem) ||
    LATIN_RE.test(question.options.join(""))
  ) {
    issues.push("latin-in-japanese-item");
  }
  const seen = new Set<string>();
  for (const option of question.options) {
    if (seen.has(option)) {
      issues.push("duplicate-option");
    }
    seen.add(option);
  }
  return issues;
};

/** The key half: the answer must sit in the printed passage AND in the key, no
 * other printed line may be missing from the passage, and no distractor may
 * appear in the key. */
const printedAnswerKeyIssues = ({
  answer,
  answerIndex,
  key,
  options,
  printed,
}: {
  readonly answer: string;
  readonly answerIndex: number;
  readonly key: readonly string[];
  readonly options: readonly string[];
  readonly printed: string;
}): string[] => {
  const issues: string[] = [];
  if (!printed.includes(compact(answer))) {
    issues.push("answer-not-printed-in-passage");
  }
  if (key.length === 0) {
    issues.push("key-empty");
    return issues;
  }
  const keyLine = key.map(compact).join("");
  for (const line of key) {
    if (!printed.includes(compact(line))) {
      issues.push(`key-line-not-printed:${line.slice(0, 24)}`);
    }
  }
  if (!keyLine.includes(compact(answer))) {
    issues.push("answer-not-in-key-line");
  }
  issues.push(...distractorsInKeyLineIssues({ answerIndex, keyLine, options }));
  return issues;
};

/** Issues with one question. `key` names the printed lines the stem points at, so
 * the item is decidable out of this 素材 alone: the answer sits in the key, and no
 * other option does. A distractor from another line of the SAME table is allowed
 * and expected, because that is what a lookup is; a distractor in the key line is
 * not, because then the printed cells answer the stem twice. */
export const jouhouQuestionIssues = ({
  passage,
  question,
}: {
  readonly passage: string;
  readonly question: JouhouQuestion;
}): readonly string[] => {
  const formIssues = optionFormIssues(question);
  if (formIssues[0] === "options-not-four") {
    return formIssues;
  }
  const answer = question.options[question.answerIndex];
  if (answer === undefined || compact(answer).length === 0) {
    return [...formIssues, "answer-missing"];
  }
  const key = question.key ?? [];
  return [
    ...formIssues,
    ...printedAnswerKeyIssues({
      answer,
      answerIndex: question.answerIndex,
      key,
      options: question.options,
      printed: compact(passage),
    }),
  ];
};

/** The 出典 half: the credit string names the page, and `sourceUrl` is that
 * page. */
const creditObligationIssues = ({
  row,
  upstream,
}: {
  readonly row: {
    readonly editedCredit?: string;
    readonly sourceCredit?: string;
    readonly sourceUrl?: string;
  };
  readonly upstream: JouhouUpstream;
}): string[] => {
  const issues: string[] = [];
  if (!(row.sourceCredit ?? "").startsWith("出典：")) {
    issues.push("credit-missing");
  }
  if (!(row.sourceCredit ?? "").includes(upstream.pageUrl)) {
    issues.push("credit-missing-page-url");
  }
  if (row.sourceUrl !== upstream.pageUrl) {
    issues.push("source-url-not-page-url");
  }
  return issues;
};

/** The 編集・加工 half, plus the snapshot stamp and the licence. */
const editObligationIssues = ({
  row,
  upstream,
}: {
  readonly row: {
    readonly acquiredAt?: string;
    readonly editedCredit?: string;
    readonly license?: string;
  };
  readonly upstream: JouhouUpstream;
}): string[] => {
  const issues: string[] = [];
  if (!(row.editedCredit ?? "").includes("編集・加工")) {
    issues.push("edit-statement-missing");
  }
  if (!(row.editedCredit ?? "").includes("manobu")) {
    issues.push("edit-actor-missing");
  }
  if (row.acquiredAt !== upstream.fetchedAt) {
    issues.push("acquired-at-not-the-snapshot");
  }
  if (row.license !== JOUHOU_LICENSE) {
    issues.push("license-not-pdl10");
  }
  return issues;
};

/** The three obligations, as one check over the row's own metadata. */
export const jouhouObligationIssues = ({
  row,
  upstream,
}: {
  readonly row: {
    readonly acquiredAt?: string;
    readonly editedCredit?: string;
    readonly license?: string;
    readonly sourceCredit?: string;
    readonly sourceUrl?: string;
  };
  readonly upstream: JouhouUpstream;
}): readonly string[] => [
  ...creditObligationIssues({ row, upstream }),
  ...editObligationIssues({ row, upstream }),
];

/** One shipped row, with the columns this pipeline adds to the reading-store row
 * shape (`CorpusShortReadingEntry` in `apps/server/src/services/exam-corpus.ts`).
 * The server ignores what it does not read, exactly as it ignores 中文's
 * `construction`. */
export interface JouhouStoreRow {
  /** The three PDL obligations plus the licence and the cited document. Present
   * on a `sourced-table` row, REJECTED on an authored one: an authored 素材 that
   * printed a 出典 would be claiming a document that does not exist. */
  readonly acquiredAt?: string;
  readonly answerIndex: number;
  readonly block: string;
  readonly construction: string;
  readonly editedCredit?: string;
  readonly id: string;
  readonly key: readonly string[];
  readonly level: string;
  readonly license?: string;
  readonly options: readonly string[];
  readonly passage: string;
  /** The two values the reading-store shape admits, NOT the one this pipeline
   * writes. This interface is the shape of a file on disk that the gate must be
   * able to reject, and `wrong-provenance` is one of the ways it is rejected:
   * pinning this to `"composed"` would make the screen unrepresentable, and a
   * hand-edited store is exactly the thing the gate exists to catch. */
  readonly provenance: "composed" | "licensed";
  readonly sourceCredit?: string;
  readonly sourceIds?: readonly string[];
  readonly sourceUrl?: string;
  readonly stem: string;
  readonly validated: boolean;
  readonly validatedBy: string;
}

/** The three stamps every frozen row carries, whoever wrote its text. */
const jouhouStampIssues = (row: JouhouStoreRow): string[] => {
  const issues: string[] = [];
  if (row.block !== JOUHOU_BLOCK) {
    issues.push("wrong-block");
  }
  if (row.provenance !== "composed") {
    issues.push("wrong-provenance");
  }
  if (row.validated !== true) {
    issues.push("unvalidated");
  }
  return issues;
};

/** An authored 素材 has no document to cite and no attribution to claim: either
 * one on such a row is the hand-edit this screen exists to stop. */
const authoredAttributionIssues = (row: JouhouStoreRow): string[] => {
  const issues: string[] = [];
  const cited = (row.sourceIds ?? []).length > 0;
  if (cited) {
    issues.push("authored-row-cites-a-document");
  }
  const claimsAttribution = [
    row.sourceCredit,
    row.editedCredit,
    row.sourceUrl,
    row.acquiredAt,
    row.license,
  ].some((value) => value !== undefined);
  if (claimsAttribution) {
    issues.push("authored-row-claims-an-attribution");
  }
  return issues;
};

/** Everything an authored row must look like: its own signer, a level this route
 * serves (the route exists for levels no PDL 素材 serves, and it is refused
 * anywhere else so a store cannot quietly re-skin a licensed level's rows), and
 * no document or attribution. */
const jouhouAuthoredRowIssues = (row: JouhouStoreRow): string[] => {
  const issues: string[] = [];
  if (row.validatedBy !== JOUHOU_AUTHORED_SIGNER) {
    issues.push("wrong-signer");
  }
  if (JOUHOU_AUTHORED_BAND[row.level] === undefined) {
    issues.push(`level-not-authored:${row.level}`);
  }
  issues.push(...authoredAttributionIssues(row));
  return issues;
};

/** Everything a sourced-table row must look like. */
const jouhouSourcedRowIssues = (row: JouhouStoreRow): string[] => {
  const issues: string[] = [];
  if (row.construction !== JOUHOU_CONSTRUCTION) {
    issues.push("wrong-construction");
  }
  if (row.validatedBy !== JOUHOU_SIGNER) {
    issues.push("wrong-signer");
  }
  if ((row.sourceIds ?? []).length === 0) {
    issues.push("no-source-ids");
  }
  if (row.level !== "N2" && row.level !== "N1") {
    issues.push("level-not-n2-or-n1");
  }
  return issues;
};

/** Everything a frozen row must look like, independent of where its text came
 * from. */
export const jouhouRowIssues = (row: JouhouStoreRow): readonly string[] => {
  const issues = jouhouStampIssues(row);
  if (isJouhouAuthored(row)) {
    return [...issues, ...jouhouAuthoredRowIssues(row)];
  }
  return [...issues, ...jouhouSourcedRowIssues(row)];
};

/** One option against every row that is NOT this row's own document. */
const leakedOptionIssues = ({
  needle,
  option,
  otherRows,
  row,
}: {
  readonly needle: string;
  readonly option: string;
  readonly otherRows: readonly JouhouStoreRow[];
  readonly row: JouhouStoreRow;
}): string[] => {
  const issues: string[] = [];
  for (const other of otherRows) {
    if (sharesSource(row, other)) {
      continue;
    }
    if (compact(other.passage).includes(needle)) {
      issues.push(`distractor-printed-in-another-material:${row.id}:${option}`);
    }
  }
  return issues;
};

/** The distractors of one row, each checked against the documents this item
 * does not print. */
const rowOptionLeaks = (
  row: JouhouStoreRow,
  rows: readonly JouhouStoreRow[]
): string[] => {
  const issues: string[] = [];
  for (const [index, option] of row.options.entries()) {
    if (index === row.answerIndex) {
      continue;
    }
    const needle = compact(option);
    if (needle.length < 3) {
      // A two-rune distractor ("３月", "０円") is a shape, not a value; a
      // collision this small is a coincidence of the grid, not a leak.
      continue;
    }
    issues.push(
      ...leakedOptionIssues({ needle, option, otherRows: rows, row })
    );
  }
  return issues;
};

/** The cross-document half of the answer guard: a distractor that another shipped
 * 素材 prints would let a reader answer without the passage this item asks about,
 * which is the property AC#6 names. Checked over the STORE, not the upstream
 * corpus, because the only documents a paper prints are the ones in it. */
export const jouhouCrossRowIssues = (
  rows: readonly JouhouStoreRow[]
): readonly string[] => {
  const issues: string[] = [];
  for (const row of rows) {
    issues.push(...rowOptionLeaks(row, rows));
  }
  return issues;
};

/** Two rows drawn from the same 素材 are one document, and this store deliberately
 * asks two different things of one document. The leak AC#6 rules out is a
 * distractor readable from a document this item does not print.
 *
 * A sourced row names its document with `sourceIds`. An authored 素材 has no
 * document to name, so the printed page IS the identity: two questions over one
 * 書き下ろし 素材 carry the same passage bytes, and anything else is a different
 * 素材 whose cells may not leak into this one's options. */
const sharesSource = (row: JouhouStoreRow, other: JouhouStoreRow): boolean => {
  if (other.id === row.id) {
    return true;
  }
  const own = row.sourceIds ?? [];
  const theirs = other.sourceIds ?? [];
  if (own.length > 0 && theirs.length > 0) {
    return own.some((sourceId) => theirs.includes(sourceId));
  }
  return row.passage === other.passage;
};

/** `{level}-jouhou.json` for one level. */
export const jouhouStorePath = (storeDir: string, level: string): string =>
  join(storeDir, `${level.toLowerCase()}-jouhou.json`);

/**
 * The freeze-time judge record for one 情報検索 level: row ids the blind judge
 * rejected (AMBIGUOUS or UNANSWERABLE). Same shape and same use as 長文's
 * `readChoubunRejections`, and the same rule: CI only ever READS this list, it
 * never runs a model to write it.
 */
export const readJouhouRejections = (
  storeDir: string,
  level: string
): ReadonlySet<string> =>
  readRejectedIdsFrom(storeDir, `${level.toLowerCase()}-jouhou-rejected.json`);
