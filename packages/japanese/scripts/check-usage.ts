/**
 * `check:usage` — the deterministic CI gate for the 用法 stores (TASK-173.9.23.1
 * AC#3). NO LLM runs here.
 *
 * This gate is the only thing that makes `validated: true` in
 * `data/reading/{n1,n2,n3}-usage.json` mean something: the server's honesty
 * gate (`isRefused`, apps/server/src/services/exam-service.ts) trusts the flag
 * at assembly time, so this script re-proves offline, on every run, that each
 * frozen row is
 *
 *   1. provenance `composed` AND `validated` AND `validatedBy:
 *      authored:agent-blind-judged` (the two-blind-pass cert record),
 *   2. the target form (option 0) is the whole-CJK token of the licensed
 *      pattern that occurs EXACTLY ONCE in the source example — the
 *      solvability gate the generator applies, re-derived here so a hand-edited
 *      row cannot claim a key the sentence does not actually use,
 *   3. the passage is the source example with that single occurrence blanked
 *      (one ＿＿ run), so the item is a fill-the-blank, not a two-hole or
 *      no-hole question,
 *   4. the four options are distinct and no distractor is a substring of the
 *      key (a truncated form of the target is a second defensible answer, the
 *      two-answer failure the two blind passes catch and this gate re-checks),
 *   5. a verdict record exists in `{level}-usage-rejected.json` and does NOT
 *      list this row's id (a row the two passes rejected is out of the store).
 *
 * Exits 0 when every shipped row passes all five checks; exits 1 naming the
 * first failing row so a regression is caught in CI, not at assembly time.
 */

import { join } from "node:path";

import {
  DATA_DIR,
  loadRejectedLedger,
  readJson,
  rejectedLedgerFor,
  storeFile,
} from "./check-word-shared";

const CJK_OR_KANA_RE = /[\u3000-\u30ff\u4e00-\u9fff]/;
const NON_CJK_RE = /[^　-ゟ一-龯]/g;
const STRIP_PARENS_RE = /[()（）[\]【】]/g;
const WHITESPACE_RE = /\s+/;
const BLANK = "＿＿";

export interface GrammarRow {
  examples: { japanese: string; english: string; source: string }[];
  id: string;
  level: string;
  pattern: string;
  related?: string[];
}

export interface UsageRow {
  answerIndex: number;
  block: string;
  construction: string;
  evidence?: string;
  id: string;
  key: string[];
  level: string;
  options: string[];
  passage: string;
  provenance: string;
  sourceIds?: string[];
  stem: string;
  validated: boolean;
  validatedBy?: string;
}

export { BLANK, USAGE_STEM };

/** Mirror of gen-usage.ts's target recovery: the CJK form the example actually
 * uses, found as the token of the pattern that occurs exactly once in the
 * example. Re-implemented here so the gate is independent of the generator. */
const targetFormOf = (pattern: string, example: string): string => {
  const tokens = pattern
    .split(WHITESPACE_RE)
    .map((tok) => tok.replace(STRIP_PARENS_RE, ""))
    .filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i] ?? "";
    const residual = token.replace(NON_CJK_RE, "").trim();
    if (residual.length < 2) {
      continue;
    }
    if (!CJK_OR_KANA_RE.test(residual)) {
      continue;
    }
    const occurrences = example.split(residual).length - 1;
    if (occurrences === 1) {
      return residual;
    }
  }
  return "";
};

const loadGrammarLevel = (level: string): Map<string, GrammarRow> => {
  const file = join(DATA_DIR, "grammar", `${level.toLowerCase()}.json`);
  const raw = readJson<GrammarRow[] | { rows: GrammarRow[] }>(file);
  const rows = Array.isArray(raw) ? raw : raw.rows;
  return new Map(rows.map((r) => [r.id, r]));
};

const loadUsageLevel = (level: string): UsageRow[] =>
  readJson<UsageRow[]>(storeFile(level, "usage"));

const USAGE_STEM =
  "つぎの文の（  ）に入れるのに、いちばん 適切 なものを、１・２・３・４から一つ えらびなさい。";

/** The screens one 用法 row must clear, returned as a list of issue codes
 * (empty when the row passes). Exported so `check-usage.test.ts` can drive the
 * gate over fixtures without re-implementing it. */
const provenanceIssues = (
  row: UsageRow,
  rejectedIds: ReadonlySet<string>
): string[] => {
  const issues: string[] = [];
  // 1. Provenance + validation contract.
  if (row.provenance !== "composed") {
    issues.push(`provenance-is-${row.provenance}`);
  }
  if (row.validated !== true) {
    issues.push("not-validated");
  }
  if (row.validatedBy !== "authored:agent-blind-judged") {
    issues.push(`validatedBy-is-${row.validatedBy ?? "missing"}`);
  }
  // 2. A row the two passes rejected must not be in the store.
  if (rejectedIds.has(row.id)) {
    issues.push("row-judge-rejected");
  }
  return issues;
};

/** Screens 3 + 4: the key is the pattern's own form occurring exactly once in
 * the source example, and the passage is that example with the occurrence
 * blanked. The recovery is re-derived here, not imported from the generator. */
const sentenceIssues = (row: UsageRow, src: GrammarRow): string[] => {
  const issues: string[] = [];
  const example = src.examples[0]?.japanese ?? "";
  const key = row.options[0] ?? "";
  const recovered = targetFormOf(src.pattern, example);
  if (recovered === "") {
    issues.push("target-form-not-recoverable");
  } else if (recovered !== key) {
    issues.push(`key-not-target:${key}!=${recovered}`);
  }
  const occurrences = example.split(key).length - 1;
  if (occurrences !== 1) {
    issues.push(`target-occurs-${occurrences}x-in-example`);
  }
  const keyAt = example.indexOf(key);
  const expected =
    example.slice(0, keyAt) + BLANK + example.slice(keyAt + key.length);
  if (row.passage !== expected) {
    issues.push("passage-not-blanked-example");
  }
  if (row.passage.split(BLANK).length - 1 !== 1) {
    issues.push("passage-blank-count-not-1");
  }
  return issues;
};

/** Screens 5 + 6: four distinct options, no truncated second answer, and the
 * fixed 用法 instruction line under its own block. */
const optionIssues = (row: UsageRow): string[] => {
  const issues: string[] = [];
  const key = row.options[0] ?? "";
  if (row.options.length !== 4) {
    issues.push(`options-count-${row.options.length}`);
  }
  if (new Set(row.options).size !== 4) {
    issues.push("options-not-distinct");
  }
  for (const distractor of row.options.slice(1)) {
    if (key.includes(distractor) && distractor.length >= 2) {
      issues.push(`distractor-is-substring-of-key:${distractor}`);
    }
  }
  if (row.stem !== USAGE_STEM) {
    issues.push("stem-not-fixed-usage-line");
  }
  if (row.block !== "youhou") {
    issues.push(`block-is-${row.block}`);
  }
  return issues;
};

export const usageRowIssues = (
  row: UsageRow,
  grammarById: Map<string, GrammarRow>,
  rejectedIds: ReadonlySet<string>
): string[] => {
  const issues = provenanceIssues(row, rejectedIds);
  const srcId = row.sourceIds?.[0];
  const src = srcId === undefined ? undefined : grammarById.get(srcId);
  if (src === undefined) {
    issues.push("sourceId-not-in-grammar-store");
    return issues;
  }
  issues.push(...sentenceIssues(row, src));
  issues.push(...optionIssues(row));
  return issues;
};

/** The CI run, guarded so `check-usage.test.ts` can import the screens without
 * screening the shipped stores as a side effect of the import. */
if (import.meta.main) {
  // TASK-179: N4 joins the sweep. 用法 prints 5 小問 at N4 (doc-26 §3.2) and the
  // screens are level-agnostic (the key re-derives from `grammar/n4.json`), so
  // the only thing that made N4 unshielded was this list. N5 stays out: the N5
  // format has no 用法 大問 (doc-26 §3.1).
  for (const LEVEL of ["N4", "N3", "N2", "N1"]) {
    const grammarById = loadGrammarLevel(LEVEL);
    const rows = loadUsageLevel(LEVEL);
    const rejectedIds = loadRejectedLedger(rejectedLedgerFor(LEVEL, "usage"));
    let failures = 0;

    for (const row of rows) {
      const issues = usageRowIssues(row, grammarById, rejectedIds);
      if (issues.length > 0) {
        failures += 1;
        console.log(`  ${LEVEL} ${row.id}: ${issues.join(", ")}`);
      }
    }

    if (failures === 0) {
      console.log(`${LEVEL}: ${rows.length} 用法 rows pass all screens`);
    } else {
      console.log(`${LEVEL}: ${failures} row(s) failed the 用法 gate`);
      process.exitCode = 1;
    }
  }
}
