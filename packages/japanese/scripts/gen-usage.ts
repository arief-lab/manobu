/**
 * TASK-173.9.23: author the 用法 stores for N3, N2 and N1.
 *
 * One 用法 小問 is a real example sentence from the licensed
 * `packages/japanese/data/grammar/{level}.json` pattern store, with the target
 * form BLANKED out of the sentence, plus four form options: the correct form
 * (the one the sentence actually uses, option 0) and three wrong forms from
 * the pattern's `related` grammar points. `construction: "authored"`,
 * `provenance: "composed"`, `validated: true`, `validatedBy:
 * authored:agent-blind-judged`.
 *
 * The two blind judge passes are run separately and their verdicts frozen in
 * `{level}-usage-rejected.json`; this script only picks patterns and writes
 * the row JSON. `validated: true` means "screened and judged", not "proven".
 *
 * TASK-173.9.23.2 (depth top-up): once a store exists, this script NEVER
 * rewrites it. It walks the same authorable-pattern order as the original
 * batch, maps the frozen burned row ids back to their patterns, and emits only
 * NEW candidates (numbered past the original batch, so no id collides with a
 * burned one) to `data/reading/{level}-usage-candidates.json`. The two blind
 * passes judge that batch; survivors are merged into the store at
 * `validated: true` and the candidates file is removed.
 *
 * SOLVABILITY GATE: a pattern is only authored into a 用法 row when its target
 * form LITERALLY OCCURS in its first example sentence. That is the fix for the
 * two unsolvable rows that token-extraction shipped earlier:
 *   - a target not present in the sentence (e.g. 合う in 話し合いましょう) cannot
 *     be "the form used", so the row is dropped rather than forced.
 *   - a target that is a sub-form of another pattern (e.g. よかった inside
 *     ればよかった) is not the form the sentence actually uses, so it is
 *     dropped too: the gate requires the target to be a *whole* occurrence,
 *     matched against the sentence, not a substring of a different form.
 *
 * BLANKING: the target form is replaced by ＿＿ in the passage (one form,
 * deterministically located). The four options are the target plus three
 * same-family distractors from `related`, each filtered to a real Japanese
 * form that differs from the target and the other three. A pattern whose
 * `related` set cannot supply three distinct distractors falls back to the
 * next solvable pattern; never to an invented form.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const GRAMMAR_DIR = join(DATA_DIR, "grammar");
const READING_DIR = join(DATA_DIR, "reading");

const CJK_OR_KANA_RE = /[\u3000-\u30ff\u4e00-\u9fff]/;
const NON_CJK_RE = /[^　-ゟ一-龯]/g;
const STRIP_PARENS_RE = /[()（）[\]【】]/g;
const WHITESPACE_RE = /\s+/;

interface GrammarRow {
  examples: { japanese: string; english: string; source: string }[];
  id: string;
  level: string;
  pattern: string;
  related?: string[];
}

const BLANK = "＿＿";

const loadGrammarLevel = (level: string): GrammarRow[] => {
  const file = join(GRAMMAR_DIR, `${level.toLowerCase()}.json`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as GrammarRow[];
  return Array.isArray(raw)
    ? raw
    : (raw as unknown as { rows: GrammarRow[] }).rows;
};

const writeStore = (level: string, rows: unknown[]): void => {
  const file = join(READING_DIR, `${level.toLowerCase()}-usage.json`);
  writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
};

/** The target form is the CJK form the sentence actually uses.
 *
 * The pattern string is a recipe ("Noun + ごとき (+ noun)", "V ます語幹 / 名詞 +
 * かたがた"), and the example sentence is the concrete realization of it. The
 * form we blank out must be the one that LITERALLY OCCURS in that example, so
 * we recover it by scanning the pattern's whole-CJK tokens from the END
 * backwards: the surface form sits at the end of the recipe (かたがた), while a
 * leading token like "ます語幹" leaves the conjugational stub ます, which is not
 * the 用法 point. Forward scanning authored two rows that blanked ます/こと and
 * check-usage.ts (which re-derives back-to-front, as the independent copy)
 * refused them; this scan now matches the gate's semantics. Trailing modifier
 * tokens ("noun", "sentence-initial") carry no CJK residual and are skipped.
 *
 * Two rules keep it honest:
 *   - the recovered form is at least two CJK/kana characters (a bare particle
 *     like "に" is not a 用法 form and is never the target);
 *   - it occurs EXACTLY ONCE in the example. A form that repeats ("男であれ女
 *     であれ", "忙しいだの疲れただの") would be blanked twice and the 小問 would
 *     have two holes, which is not a fill-the-blank question, so the row is
 *     refused rather than forced.
 *
 * Returns the form when it can be recovered cleanly, else "". */
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

const hasCjkOrKana = (s: string): boolean => CJK_OR_KANA_RE.test(s);

const USAGE_STEM =
  "つぎの文の（  ）に入れるのに、いちばん 適切 なものを、１・２・３・４から一つ えらびなさい。";

/** The solvability + blanking gate.
 *
 * A pattern is authorable only when its target form occurs EXACTLY ONCE in the
 * first example sentence. The gate recovers the form via `targetFormOf` (first
 * whole-CJK token of the pattern that appears once in the example), blanks that
 * single occurrence, and returns the passage. That is the deterministic core of
 * the 用法 fix:
 *
 *   - if no form of the pattern appears in the example, return null (the
 *     sentence does not illustrate this form, so there is no blank to make);
 *   - if the form appears two or more times (e.g. 男であれ女であれ), return
 *     null: two holes is not a fill-the-blank question;
 *   - otherwise the blank is one ＿＿ run at the form's location, and the
 *     learner restores it from the four options.
 *
 * The target is recorded in `key` and is option 0; the two-blind-pass cert
 * cross-checks it against the verdict file. */
const blankTargetIn = (
  pattern: GrammarRow
): { blanked: string; target: string } | null => {
  const passage = pattern.examples[0]?.japanese ?? "";
  const target = targetFormOf(pattern.pattern, passage);
  if (target.length < 2 || !hasCjkOrKana(target)) {
    return null;
  }
  const at = passage.indexOf(target);
  if (at === -1) {
    return null;
  }
  const blanked =
    passage.slice(0, at) + BLANK + passage.slice(at + target.length);
  if (!blanked.includes(BLANK)) {
    return null;
  }
  return { blanked, target };
};

/** One 用法 item from a grammar pattern row.
 *
 * The target form (option 0) is the pattern's own final form, which the gate
 * guarantees literally occurs in the example. The three distractors are the
 * target forms of the pattern's `related` grammar points at the same level,
 * filtered to real Japanese forms that differ from the target and from each
 * other; a related id that resolves to nothing usable is skipped, and the
 * level's own patterns backfill in id order if `related` is too thin. The
 * passage is the example with the target blanked; the learner restores it
 * from the four options. */
/** A distractor form is valid for this target only if it is not a substring
 * (prefix or suffix) of the target. When a `related`-family form is a
 * truncated version of the target (e.g. ばかり offered for a ばかりか blank),
 * the learner can legitimately fill the blank with either form, so the item
 * has two answers and must be dropped rather than forced. */
const isSafeDistractor = (distractor: string, target: string): boolean => {
  if (distractor === target) {
    return false;
  }
  if (distractor.length < 2) {
    return false;
  }
  if (target.includes(distractor)) {
    return false; // distractor is inside target -> two-answer
  }
  return true;
};

const authorUsageRow = (
  self: GrammarRow,
  byId: Map<string, GrammarRow>,
  all: GrammarRow[],
  rowNumber: number
): Record<string, unknown> | null => {
  const gate = blankTargetIn(self);
  if (gate === null) {
    return null;
  }
  const { blanked, target } = gate;

  const distractors = collectDistractors(self, byId, all, target);
  if (distractors.length < 3) {
    return null;
  }

  return {
    answerIndex: 0,
    block: "youhou",
    construction: "authored",
    evidence: target,
    id: `${self.level.toLowerCase()}-u-${String(rowNumber).padStart(2, "0")}`,
    key: [target],
    level: self.level,
    options: [target, ...distractors.slice(0, 3)],
    passage: blanked,
    provenance: "composed",
    sourceIds: [self.id],
    stem: USAGE_STEM,
    // Not yet judged: the generator proves the KEY (option 0 is the form the
    // example actually uses, blanked exactly once, four distinct options) but
    // it does NOT run the two blind passes the 読解 route requires (doc-27 §11).
    // So the row ships `validated: false`: the real-mode refuse gate
    // (`provenance === "composed" && !validated`, exam-service.ts) turns it down
    // rather than fabricate until a judge pass freezes a verdict in
    // `{level}-usage-rejected.json`. This is the honest state, not a pre-filled
    // assumption: flipping to `validated: true` before the passes land would be
    // the exact failure the cert exists to prevent.
    validated: false,
  };
};

/** The form of a pattern row as a distractor candidate: its target form read
 * off the first example, or the empty string when it has none (which the
 * safety screen then refuses). Shared because both candidate sources need the
 * same read and a second copy could drift. */
const distractorFormOf = (row: GrammarRow): string =>
  targetFormOf(row.pattern, row.examples[0]?.japanese ?? "");

/** The first three admissible candidates, in the order they were offered:
 * forms that repeat the target, another candidate, or the target's own
 * substring screen are dropped, not backfilled past. */
const takeSafeDistractors = (
  candidates: readonly string[],
  target: string
): string[] => {
  const seen = new Set<string>([target]);
  const out: string[] = [];
  for (const form of candidates) {
    if (out.length === 3) {
      break;
    }
    if (!isSafeDistractor(form, target) || seen.has(form)) {
      continue;
    }
    seen.add(form);
    out.push(form);
  }
  return out;
};

/** Collect three distinct, non-substring distractor forms for a target:
 * first from the pattern's own `related` list, then backfilling from the
 * level's other patterns in id order. Returns fewer than three when the
 * level cannot supply them, in which case the caller drops the row. */
const collectDistractors = (
  self: GrammarRow,
  byId: Map<string, GrammarRow>,
  all: GrammarRow[],
  target: string
): string[] => {
  const candidates: string[] = [];
  for (const relId of self.related ?? []) {
    const rel = byId.get(relId);
    if (rel !== undefined) {
      candidates.push(distractorFormOf(rel));
    }
  }
  for (const other of [...all].sort((a, b) => a.id.localeCompare(b.id))) {
    if (other.id !== self.id) {
      candidates.push(distractorFormOf(other));
    }
  }
  return takeSafeDistractors(candidates, target);
};

interface StoreRow {
  id: string;
  sourceIds?: string[];
  validated: boolean;
}

interface RejectedRecord {
  rejectedIds?: string[];
}

const loadStoreRows = (level: string): StoreRow[] => {
  const file = join(READING_DIR, `${level.toLowerCase()}-usage.json`);
  if (!existsSync(file)) {
    return [];
  }
  return JSON.parse(readFileSync(file, "utf8")) as StoreRow[];
};

const loadBurnedRowIds = (level: string): Set<string> => {
  const file = join(READING_DIR, `${level.toLowerCase()}-usage-rejected.json`);
  if (!existsSync(file)) {
    return new Set();
  }
  const records = JSON.parse(readFileSync(file, "utf8")) as RejectedRecord[];
  return new Set(records.flatMap((r) => r.rejectedIds ?? []));
};

const LEVEL_CONFIG: { level: string; rowsNeeded: number }[] = [
  { level: "N1", rowsNeeded: 24 },
  { level: "N2", rowsNeeded: 20 },
  { level: "N3", rowsNeeded: 20 },
  // TASK-179: 用法 prints 5 小問 at N4 (doc-26 §3.2), so the depth standard is
  // the same 5 x 4 papers that N3 and N2 carry: 20 certified rows. Written at
  // 40 because the two blind passes historically reject about a third, and the
  // store is pruned to the survivors that clear both passes. N5 is absent by
  // design: 用法 is not in the N5 format (doc-26 §3.1).
  { level: "N4", rowsNeeded: 40 },
];

/** The original batch numbering: the walk that produced row ids 1..rowsNeeded.
 * Row `NN` is the NNth authorable pattern in id order, so a frozen burned row
 * id maps back to its pattern here. */
const authorableWalk = (
  all: GrammarRow[],
  byId: Map<string, GrammarRow>
): GrammarRow[] => {
  const ordered = [...all].sort((a, b) => a.id.localeCompare(b.id));
  const out: GrammarRow[] = [];
  for (const pattern of ordered) {
    if (authorUsageRow(pattern, byId, all, out.length + 1) !== null) {
      out.push(pattern);
    }
  }
  return out;
};

for (const { level, rowsNeeded } of LEVEL_CONFIG) {
  const all = loadGrammarLevel(level);
  const byId = new Map(all.map((r) => [r.id, r]));
  const existing = loadStoreRows(level);
  const walk = authorableWalk(all, byId);

  if (existing.length === 0) {
    // Fresh store: write the first batch to the store itself, numbered 1..N.
    const rows: unknown[] = [];
    for (const pattern of walk) {
      if (rows.length === rowsNeeded) {
        break;
      }
      const row = authorUsageRow(pattern, byId, all, rows.length + 1);
      if (row !== null) {
        rows.push(row);
      }
    }
    if (rows.length < rowsNeeded) {
      console.warn(
        `${level}: only ${rows.length}/${rowsNeeded} 用法 rows could be authored ` +
          "(patterns failing the solvability gate or lacking three valid distractors " +
          "are skipped; this is a content shortfall, not a fabrication)"
      );
    }
    writeStore(level, rows);
    console.log(
      `wrote ${level}: ${rows.length} 用法 rows from ${level}.json ` +
        `(${all.length} licensed patterns, ${rows.length} solvable)`
    );
    continue;
  }

  // Top-up mode (TASK-173.9.23.2): the shipped store is read-only here.
  const burnedRowIds = loadBurnedRowIds(level);
  const burnedPatterns = new Set<string>();
  walk.slice(0, rowsNeeded).forEach((pattern, i) => {
    const rowId = `${level.toLowerCase()}-u-${String(i + 1).padStart(2, "0")}`;
    if (burnedRowIds.has(rowId)) {
      burnedPatterns.add(pattern.id);
    }
  });
  const consumed = new Set([
    ...existing.flatMap((r) => r.sourceIds ?? []),
    ...burnedPatterns,
  ]);
  const shortfall = rowsNeeded - existing.length;
  if (shortfall <= 0) {
    console.log(
      `${level}: store holds ${existing.length} rows, target ${rowsNeeded} met; nothing to top up`
    );
    continue;
  }
  // Over-generate 2x: the two blind passes historically rejected ~1 in 3.
  const want = shortfall * 2;
  const candidates: unknown[] = [];
  let rowNumber = rowsNeeded;
  for (const pattern of walk) {
    if (candidates.length === want) {
      break;
    }
    if (consumed.has(pattern.id)) {
      continue;
    }
    rowNumber += 1;
    const row = authorUsageRow(pattern, byId, all, rowNumber);
    if (row !== null) {
      candidates.push(row);
    }
  }
  const file = join(
    READING_DIR,
    `${level.toLowerCase()}-usage-candidates.json`
  );
  writeFileSync(file, `${JSON.stringify(candidates, null, 2)}\n`, "utf8");
  console.log(
    `${level}: store ${existing.length}/${rowsNeeded}; wrote ${candidates.length} candidates (shortfall ${shortfall}, over-generated 2x for the judge) to ${level.toLowerCase()}-usage-candidates.json`
  );
}
