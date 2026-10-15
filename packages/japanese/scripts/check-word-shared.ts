/**
 * `check-word-shared.ts` — the screens and the runner the authored 語彙 gates
 * share (`check-hyouki.ts`, `check-goseikei.ts`, `check-iikae.ts`,
 * `check-iikae-sentence.ts`, `check-bunshou.ts`, and in part `check-usage.ts`).
 *
 * Every one of these gates proves the same contract over a differently-shaped
 * item: a frozen authored row carries the two-blind-pass cert record, prints a
 * four-option question whose answer sits in the frozen first slot, is written in
 * clean Japanese orthography under the level's own official instruction line,
 * and is justified by a one-sentence Japanese evidence. The family grew slice by
 * slice and each gate re-implemented that contract inline; this module is the
 * single place it is written, the way `check-listening-shared.ts` already is for
 * the 聴解 gates.
 *
 * What stays in each gate: the screens that are the block's OWN falsifiable half
 * (the 表記 vocab-attestation guard, the 語形成 compound completion, the
 * 言い換え類義 bracketed target, the 文章の文法 blank placement, the 用法 source
 * re-derivation). A message string a gate prints is load-bearing for its tests
 * and for mutation-gate seam anchors, so nothing here renames an issue code;
 * each gate composes its row's issue list from these helpers plus its own.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The authored-row record all these stores ship: passage, stem, four options,
 * the frozen key slot, and the two-blind-pass cert fields. */
export interface AuthoredWordRow {
  answerIndex: number;
  block: string;
  construction: string;
  evidence: string;
  id: string;
  key: string[];
  level: string;
  options: string[];
  passage: string;
  provenance: string;
  stem: string;
  validated: boolean;
  validatedBy?: string;
}

/** The licensed vocab entry shape the bands ship. */
export interface VocabEntry {
  readonly reading: string;
  readonly word: string;
}

export const DATA_DIR = join(import.meta.dir, "..", "data");

export const runes = (text: string): number => [...text].length;

/** Spellings compared as the learner sees them: NFKC so a full-width and a
 * half-width form of one headword are one headword. */
export const normalise = (text: string): string =>
  text.normalize("NFKC").toLowerCase();

export const LATIN_RE = /[A-Za-z]/;
/** Half-width ASCII that never belongs in a Japanese word or sentence: digits,
 * punctuation and symbols (letters are the separate `latin` screen). The paper
 * prints full-width １・２・３・４ in its stem, so a half-width digit inside an
 * authored text is an authoring slip, not paper orthography. */
export const HALFWIDTH_ASCII_RE = /[\u0021-\u0040\u005B-\u0060\u007B-\u007E]/;
/** Full-width digits and letters, including the （） a 語形成 blank uses. */
export const FULLWIDTH_ASCII_RE =
  /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\uFF08\uFF09]/;
/** Simplified-Chinese forms whose codepoint differs from the Japanese
 * shinjitai. 写 造 除 与 医 叶 机 are ordinary Japanese kanji and are
 * deliberately absent: a screen that bans them rejects correct Japanese, which
 * is how the first draft of this list misfired. 书 衔 单 joined after a
 * KANJIDIC2-membership scan of every shipped reading store found each one had
 * actually slipped through prose rounds. One vetted list for the whole family,
 * kept honest by `check-hyouki.test.ts` quoting it against the store. */
export const SIMPLIFIED_RE = new RegExp(
  `[${[
    0x9a_7b, 0x65_f6, 0x89_c1, 0x8f_6e, 0x66_3e, 0x90_02, 0x7e_a7, 0x89_c2,
    0x60_01, 0x7c_7b, 0x98_7e, 0x5f_c6, 0x5f_52, 0x8f_dc, 0x8f_d0, 0x8f_b9,
    0x8b_ed, 0x4f_20, 0x51_73, 0x5e_94, 0x5b_fc, 0x67_81, 0x5c_81, 0x96_35,
    0x90_57, 0x53_86, 0x54_cd, 0x67_2f, 0x67_84, 0x8f_db, 0x8f_d9, 0x5b_f9,
    0x7e_cf, 0x8f_c7, 0x8b_fb, 0x89_c9, 0x8b_a9, 0x8b_a4, 0x8b_ae, 0x8b_e2,
    0x4e_66, 0x88_54, 0x53_55,
  ]
    .map((code) => String.fromCodePoint(code))
    .join("")}]`
);
export const HANGUL_RE = /[\uAC00-\uD7A3]/;
export const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
export const HIRA_RE = /^[\u3041-\u309F\u30FC\u30FD\u30FEー]+$/u;
export const KATA_RE = /^[\u30A1-\u30F6\u30FCー]+$/u;

/** The five orthography screens over one labelled text. The issue codes are the
 * ones every gate has always printed. */
export const orthographyIssues = (where: string, text: string): string[] => {
  const issues: string[] = [];
  if (LATIN_RE.test(text)) {
    issues.push(`latin-in-${where}`);
  }
  if (HALFWIDTH_ASCII_RE.test(text)) {
    issues.push(`halfwidth-ascii-in-${where}`);
  }
  if (FULLWIDTH_ASCII_RE.test(text)) {
    issues.push(`fullwidth-ascii-in-${where}`);
  }
  if (SIMPLIFIED_RE.test(text)) {
    issues.push(`simplified-hanzi-in-${where}`);
  }
  if (HANGUL_RE.test(text)) {
    issues.push(`hangul-in-${where}`);
  }
  return issues;
};

/** The authored texts of one row, labelled the way the issue codes name them.
 * `passage` is what the caller wants screened (a 語形成 row strips its own
 * blank before handing it over). */
export const authoredTexts = (
  passage: string,
  evidence: string,
  options: readonly string[]
): readonly (readonly [string, string])[] => [
  ["passage", passage],
  ["evidence", evidence],
  ...options.map((option, i): [string, string] => [`option${i}`, option]),
];

export const orthographySweep = (
  texts: readonly (readonly [string, string])[]
): string[] => {
  const issues: string[] = [];
  for (const [where, text] of texts) {
    issues.push(...orthographyIssues(where, text));
  }
  return issues;
};

/** Screens 1 + 2: the cert trio, and the row is not one the passes rejected. */
export const certIssues = (
  row: AuthoredWordRow,
  rejectedIds: ReadonlySet<string>
): string[] => {
  const issues: string[] = [];
  if (row.construction !== "authored") {
    issues.push(`construction-is-${row.construction}`);
  }
  if (row.provenance !== "composed") {
    issues.push(`provenance-is-${row.provenance}`);
  }
  if (row.validated !== true) {
    issues.push("not-validated");
  }
  if (row.validatedBy !== "authored:agent-blind-judged") {
    issues.push(`validatedBy-is-${row.validatedBy ?? "missing"}`);
  }
  if (rejectedIds.has(row.id)) {
    issues.push("row-judge-rejected");
  }
  return issues;
};

/** The burned-id ledger for one store file. A missing or unreadable verdict
 * file yields the empty set: nothing is burned. Whether that is safe is each
 * gate's call — a store whose rows must carry the cert trio (screen 1) refuses
 * unjudged rows anyway. */
export const loadRejectedLedger = (file: string): Set<string> => {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as
      | { rejectedIds?: string[] }
      | { rejectedIds?: string[] }[];
    const records = Array.isArray(raw) ? raw : [raw];
    const ids = new Set<string>();
    for (const record of records) {
      if (Array.isArray(record.rejectedIds)) {
        for (const id of record.rejectedIds) {
          if (typeof id === "string") {
            ids.add(id);
          }
        }
      }
    }
    return ids;
  } catch {
    return new Set<string>();
  }
};

/** The ledger path of one store family: `data/reading/{level}-{stem}-rejected.json`. */
export const rejectedLedgerFor = (level: string, stem: string): string =>
  join(DATA_DIR, "reading", `${level.toLowerCase()}-${stem}-rejected.json`);

/** Read one JSON file, or null when it is not there yet. */
export const tryReadJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Read one JSON file that MUST be there: a gate whose store or grammar input
 * is missing fails loudly rather than printing a green line over zero rows. */
export const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, "utf8")) as T;

/** The store file of one level of one family: `data/reading/{level}-{stem}.json`. */
export const storeFile = (level: string, stem: string): string =>
  join(DATA_DIR, "reading", `${level.toLowerCase()}-${stem}.json`);

/** One level's store, or null when the file is not there yet. */
export const tryLoadStore = <R>(level: string, stem: string): R[] | null =>
  tryReadJson<R[]>(storeFile(level, stem));

/** Bands whose words every learner at `level` has met (cumulative), for every
 * level the papers print. */
export const CUMULATIVE_BANDS: Readonly<Record<string, readonly string[]>> = {
  N1: ["n5", "n4", "n3", "n2", "n1"],
  N2: ["n5", "n4", "n3", "n2"],
  N3: ["n5", "n4", "n3"],
  N4: ["n5", "n4"],
  N5: ["n5"],
};

/** One licensed vocab band: either a bare array or an `{entries}` envelope. */
export const loadVocabBand = (band: string): VocabEntry[] => {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, `${band}.json`), "utf8")
  ) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { entries?: VocabEntry[] }).entries ?? []);
  return list as VocabEntry[];
};

/** The four-option contract the paper always prints, in the shared preamble:
 * exactly four options, all distinct, the answer in the frozen first slot. The
 * gate-specific proof that `key` names that answer stays with the gate, because
 * each block words that fault in its own terms. */
export const answerSlotIssues = (row: AuthoredWordRow): string[] => {
  const issues: string[] = [];
  if (row.options.length !== 4) {
    issues.push(`options-count-${row.options.length}`);
  }
  if (new Set(row.options).size !== row.options.length) {
    issues.push("options-not-distinct");
  }
  if (row.answerIndex !== 0) {
    issues.push(`answerIndex-${row.answerIndex}`);
  }
  return issues;
};

/** The passage shape every single-sentence 語彙 block shares: a sentence of
 * legal length. The block's own leak screens run on top of this. */
export const sentenceFormIssues = (
  passage: string,
  min: number,
  max: number
): string[] => {
  const issues: string[] = [];
  if (!passage.trimEnd().endsWith("。")) {
    issues.push("passage-not-a-sentence");
  }
  const length = runes(passage);
  if (length < min || length > max) {
    issues.push(`passage-${length}runes-outside-${min}-${max}`);
  }
  return issues;
};

/** No option may be printed verbatim inside the passage — the surface match the
 * learner could take without reading, and (for the answer) the leak that makes
 * `hasStemLeak` assembly-drop the row in silence. */
export const optionLeakIssues = (
  options: readonly string[],
  passage: string
): string[] => {
  const issues: string[] = [];
  for (const option of options) {
    if (passage.includes(option)) {
      issues.push(`option-verbatim-in-passage:${option}`);
    }
  }
  return issues;
};

/** Options are words or short clauses, never phrases of paragraph length. */
export const optionBandIssues = (
  options: readonly string[],
  min: number,
  max: number
): string[] => {
  const issues: string[] = [];
  for (const option of options) {
    const optionLength = runes(option);
    if (optionLength < min || optionLength > max) {
      issues.push(`option-${optionLength}runes-outside-${min}-${max}`);
    }
  }
  return issues;
};

/** The evidence must at least be one Japanese sentence of substance; whether it
 * NAMES this row's material is the gate's own screen on top. */
export const evidenceFormIssues = (
  evidence: string,
  minRunes: number,
  message: string
): string[] => {
  const short = runes(evidence) < minRunes || !evidence.endsWith("。");
  return short ? [message] : [];
};

/** The level's own stamps: the instruction line quoted from the sample paper
 * and the block the assembler routes this shape under. */
export const stampIssues = (
  row: AuthoredWordRow,
  stems: Readonly<Record<string, string>>,
  block: string
): string[] => {
  const issues: string[] = [];
  if (row.stem !== stems[row.level]) {
    issues.push("stem-not-official-instruction-line");
  }
  if (row.block !== block) {
    issues.push(`block-is-${row.block}`);
  }
  return issues;
};

/** The reuse screen's owner map: one text backs exactly one 小問. Distractors
 * may repeat; the material being asked may not. */
export const ownerClashes = (
  items: readonly { id: string; texts: readonly string[] }[]
): ReadonlyMap<string, string> => {
  const owner = new Map<string, string>();
  const clashes = new Map<string, string>();
  for (const item of items) {
    for (const text of item.texts) {
      if (text.length === 0) {
        continue;
      }
      const prior = owner.get(text);
      if (prior !== undefined && prior !== item.id) {
        clashes.set(item.id, `${text.slice(0, 24)} already used by ${prior}`);
      }
      owner.set(text, item.id);
    }
  }
  return clashes;
};

/** The same map over kinds: a 言い換え類義 target and its passage are different
 * identities, so each kind owns its own map and the clash names the kind. */
export const kindedOwnerClashes = (
  items: readonly {
    id: string;
    texts: readonly { kind: string; text: string }[];
  }[]
): ReadonlyMap<string, string> => {
  const owners = new Map<string, Map<string, string>>();
  const clashes = new Map<string, string>();
  for (const item of items) {
    for (const { kind, text } of item.texts) {
      const owner = owners.get(kind) ?? new Map<string, string>();
      owners.set(kind, owner);
      const prior = owner.get(text);
      if (prior !== undefined && prior !== item.id) {
        clashes.set(
          item.id,
          `${kind} ${text.slice(0, 24)} already used by ${prior}`
        );
      }
      owner.set(text, item.id);
    }
  }
  return clashes;
};

/** The per-level state the runner carries for a block that screens more than
 * rows — 表記 counts its katakana 小問 against the official 大問 cap. The
 * caller closes over its own counter; the runner only observes and reports. */
export interface GateLevelMetric<R> {
  observe: (row: R) => void;
  /** The extra verdict line for this level, printed after the row failures and
   * before the floor line; a non-null line means exitCode 1. */
  report: (level: string) => string | null;
}

export interface WordGateSpec<R> {
  /** The block label the verdict lines print: `表記`, `語形成`, … */
  blockLabel: string;
  clashes?: (rows: readonly R[]) => ReadonlyMap<string, string>;
  /** The texts whose reuse this store forbids (single-owner screen). Ignored
   * when the gate supplies its own `clashes`. */
  clashTexts?: (row: R) => readonly string[];
  /** Store family file stem: `hyouki` reads `{level}-hyouki.json` and names
   * that file in the missing-store line. */
  fileStem: string;
  /** The parenthetical after the floor line; the 小問数 x 4 papers standard
   * unless the block fixed its own wording. */
  floorNote?: string;
  levels: readonly string[];
  loadRows: (level: string) => R[] | null;
  metric?: GateLevelMetric<R>;
  minRows: Readonly<Record<string, number>>;
  rejectedIdsFor: (level: string) => ReadonlySet<string>;
  rowIdentity: (row: R) => { id: string; level: string };
  /** Everything this row must clear, minus the runner's own stamp and clash
   * screens. `level` is the file the row was found in, so a gate can look up
   * its per-level attestation. */
  rowIssues: (
    row: R,
    rejectedIds: ReadonlySet<string>,
    level: string
  ) => string[];
  /** The `row-stamped-{level}-in-{file}-file` screen; some blocks stamp-check
   * implicitly through their stem lookup and never printed this line. */
  stampCheck?: boolean;
}

const screenRows = <R>(
  spec: WordGateSpec<R>,
  level: string,
  rows: readonly R[],
  clashes: ReadonlyMap<string, string>
): number => {
  const rejectedIds = spec.rejectedIdsFor(level);
  let failing = 0;
  for (const row of rows) {
    const issues = spec.rowIssues(row, rejectedIds, level);
    const { id, level: stamp } = spec.rowIdentity(row);
    const clash = clashes.get(id);
    if (clash !== undefined) {
      issues.push(`reused-material:${clash}`);
    }
    if (spec.stampCheck !== false && stamp !== level) {
      issues.push(`row-stamped-${stamp}-in-${level}-file`);
    }
    spec.metric?.observe(row);
    if (issues.length > 0) {
      failing += 1;
      console.log(`  ${level} ${id}: ${issues.join(", ")}`);
    }
  }
  return failing;
};

const reportLevel = <R>(
  spec: WordGateSpec<R>,
  level: string,
  rows: readonly R[] | null,
  clashes: ReadonlyMap<string, string>
): void => {
  if (rows === null) {
    console.log(
      `  ${level}: no data/reading/${level.toLowerCase()}-${spec.fileStem}.json store file`
    );
    process.exitCode = 1;
    return;
  }
  const failing = screenRows(spec, level, rows, clashes);
  const metricLine = spec.metric?.report(level);
  if (metricLine !== null && metricLine !== undefined) {
    console.log(metricLine);
    process.exitCode = 1;
  }
  const floor = spec.minRows[level] ?? 0;
  const floorNote = spec.floorNote ?? "(小問数 x 4 papers)";
  if (rows.length < floor) {
    console.log(
      `  ${level}: store holds ${rows.length} rows, below the ${floor} required ${floorNote}`
    );
    process.exitCode = 1;
  } else if (failing > 0) {
    console.log(
      `${level}: ${failing} row(s) failed the ${spec.blockLabel} screens`
    );
    process.exitCode = 1;
  } else {
    console.log(
      `${level}: ${rows.length} ${spec.blockLabel} rows pass all screens`
    );
  }
};

/** The CI run every word gate performs: one read of every shipped store, one
 * reuse pass over the whole family, then the per-level verdict lines. A missing
 * store is reported in one line, not as a stack trace. */
export const runWordGate = <R>(spec: WordGateSpec<R>): void => {
  const storeFor = new Map<string, R[] | null>();
  for (const level of spec.levels) {
    storeFor.set(level, spec.loadRows(level));
  }
  const allRows: R[] = [];
  for (const level of spec.levels) {
    allRows.push(...(storeFor.get(level) ?? []));
  }
  const clashes =
    spec.clashes?.(allRows) ??
    ownerClashes(
      allRows.map((row) => {
        const { id } = spec.rowIdentity(row);
        return { id, texts: spec.clashTexts?.(row) ?? [] };
      })
    );
  for (const level of spec.levels) {
    reportLevel(spec, level, storeFor.get(level) ?? null, clashes);
  }
};
