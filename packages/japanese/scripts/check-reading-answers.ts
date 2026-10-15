/**
 * `check:reading-answers` — the deterministic answer-position audit for every
 * shipped reading store. NO LLM, no network.
 *
 * Why this exists: the exam serves one reading row per 小問, and a row whose
 * correct option sits in the same position as most other rows lets a learner
 * score by pattern instead of by reading. This walks every store and reports
 * the position distribution, and FAILS on the one unambiguous defect: a store
 * in which the correct option is in the SAME position for EVERY row (a
 * constant key position). That is not sampling noise, it is a build bug.
 *
 * It deliberately does NOT fail on a merely skewed store. Every store here is
 * small (10–60 rows), so a 40–60% mode share is expected noise around the 25%
 * of a four-option item (e.g. N1 主張理解's 6-of-10 at index 0 is inside the
 * binomial envelope). Dropping the surplus rows to flatten it would be the
 * wrong repair twice over: it would strip authored/verbatim content the stores
 * can ill afford (N1 中文's 10 rows are one above its 9-小問 floor), and for
 * the two LICENSED stores the option ORDER is upstream's and is documented as
 * verbatim, so reordering it would falsify the provenance record. The skewed
 * stores are therefore reported, not "fixed" by deletion.
 *
 * Run from this package: `bun run check:reading-answers`. Exit 0 = no store has
 * a constant key position; exit 1 = at least one does, listed by store + index.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Every shipped reading ITEM store, in level order. `hakusho.jsonl` is the
 * raw corpus (no answer keys) and is not an item store, so it is excluded. */
export const READING_STORES: readonly string[] = [
  "n5.json",
  "n5-chuubun.json",
  // TASK-173.9.7: the licensed 情報検索 rows were the same 12 stamped with the level
  // they served, so every one of those files is audited. TASK-173.9.18 and
  // TASK-173.9.19 replaced the N3 and N4 stamps with authored 素材, so N5 is the only
  // level left reading the verbatim set.
  "n5-jouhou.json",
  "n4-jouhou.json",
  "n3-jouhou.json",
  // TASK-173.9.13: the N2/N1 情報検索 rows are COMPOSED, so their option order is
  // this repo's authoring rather than an upstream paper's, which is exactly why it
  // belongs in the audit.
  "n2-jouhou.json",
  "n1-jouhou.json",
  "n4.json",
  // TASK-173.9.11: the N2/N1 短文 stores are masked-slot rows blanked out of short
  // 白書 paragraphs, so their option order is our draw and their key positions are
  // audited like the 中文 rows built the same way. N3 joined this list as a masked
  // store and is authored since TASK-173.9.18, which changes nothing here: the audit
  // reads `answerIndex`, not the provenance behind it.
  "n3.json",
  "n2.json",
  "n1.json",
  "n3-chuubun.json",
  "n2-chuubun.json",
  "n1-chuubun.json",
  // TASK-173.9.15 audited these when they were stitched from licensed sentences;
  // TASK-173.9.19 wrote them, so the option order is entirely this repo's and the
  // spread is authored into the row rather than drawn from a pool.
  "n4-chuubun.json",
  "n2-chuushou.json",
  "n1-chuushou.json",
  // TASK-173.9.3: the 統合理解 pairs are option-drawn by a seeded permutation,
  // so their positions are audited like every other store.
  "n2-tougou.json",
  "n1-tougou.json",
  // TASK-173.9.12: the 長文 window store draws its options the same seeded way as
  // the 中文 and 短文 rows, so its key positions are audited too.
  "n1-choubun.json",
  // TASK-173.9.16: the authored N3 長文 rows are the purest case for this audit —
  // their option order is this repo's own arrangement with no upstream paper to
  // inherit it from, so a constant key position would be a defect nobody noticed.
  "n3-choubun.json",
  // DELIBERATELY ABSENT: `{level}-usage.json` (TASK-173.9.23) and
  // `{level}-bunshou.json` (TASK-173.9.24). Their rows carry the key at
  // `options[0]` by contract, because that is what each gate screens
  // (`usage-row-issues`, `answerIndex-0` / `key-not-options-0` here) and what the
  // server's picker reads as `source.target`. Adding them would report a constant
  // key position and invite a "fix" that breaks the gate. The learner never sees
  // that order: `shuffleQuestionItemOptions`
  // (`packages/item-engine/src/paper.ts:2141`) re-permutes every assembled item's
  // options from examId + seed + itemId, so the position on the page is a
  // per-paper draw and not a property of the store.
];

export interface AnswerAudit {
  /** True when EVERY row's key is at the same index (>= 2 rows). */
  readonly constant: boolean;
  /** Answer index -> how many rows put the key there. */
  readonly distribution: Readonly<Record<number, number>>;
  /** The fraction of rows whose key sits at the modal index. */
  readonly modeShare: number;
  readonly rows: number;
  readonly store: string;
}

interface HasAnswerIndex {
  readonly answerIndex: number;
}

/**
 * Audit one store's answer-index distribution. A store with fewer than two rows
 * is never `constant` (there is nothing to be degenerate relative to).
 */
export const auditAnswers = (
  store: string,
  entries: readonly HasAnswerIndex[]
): AnswerAudit => {
  const distribution: Record<number, number> = {};
  for (const entry of entries) {
    distribution[entry.answerIndex] =
      (distribution[entry.answerIndex] ?? 0) + 1;
  }
  const counts = Object.values(distribution);
  const rows = entries.length;
  const mode = counts.length === 0 ? 0 : Math.max(...counts);
  return {
    constant: rows >= 2 && counts.length === 1,
    distribution,
    modeShare: rows === 0 ? 0 : mode / rows,
    rows,
    store,
  };
};

export interface AnswerAuditReport {
  readonly audit: AnswerAudit;
  readonly issues: readonly string[];
}

export const checkAnswers = (
  store: string,
  entries: readonly HasAnswerIndex[]
): AnswerAuditReport => {
  const audit = auditAnswers(store, entries);
  const issues: string[] = [];
  if (audit.constant) {
    const [index] = Object.keys(audit.distribution);
    issues.push(`constant-key-position:${index}(${audit.rows} rows)`);
  }
  return { audit, issues };
};

const formatAudit = (audit: AnswerAudit): string => {
  const dist = Object.entries(audit.distribution)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([index, count]) => `${index}:${count}`)
    .join(" ");
  return `${audit.store}: n=${audit.rows} [${dist}] mode ${(audit.modeShare * 100).toFixed(0)}%`;
};

if (import.meta.main) {
  const dataDir = join(import.meta.dir, "..", "data", "reading");
  const reports: AnswerAuditReport[] = [];
  for (const store of READING_STORES) {
    const path = join(dataDir, store);
    if (!existsSync(path)) {
      continue;
    }
    const entries = JSON.parse(readFileSync(path, "utf8")) as HasAnswerIndex[];
    reports.push(checkAnswers(store, entries));
  }
  for (const report of reports) {
    const skew =
      report.audit.modeShare >= 0.5 ? "  (skewed, reported only)" : "";
    console.log(`${formatAudit(report.audit)}${skew}`);
  }
  const failing = reports.filter((report) => report.issues.length > 0);
  if (failing.length === 0) {
    console.log(
      `check:reading-answers: ${reports.length} store(s) audited, no constant key position`
    );
    process.exit(0);
  }
  for (const report of failing) {
    for (const issue of report.issues) {
      console.log(`${report.audit.store}: ${issue}`);
    }
  }
  process.exit(1);
}
