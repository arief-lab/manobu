/**
 * `check:bunshou` — the deterministic CI gate for the 文章の文法 stores
 * (TASK-173.9.24 AC#7). NO LLM runs here.
 *
 * This gate is the only thing that makes `validated: true` in
 * `data/reading/{n1,n2,n3,n4,n5}-bunshou.json` mean something. Unlike 用法, there is
 * no licensed corpus here that re-derives the key: the two blind judge passes
 * ARE the solvability proof, so the flag is a claim about a run CI cannot
 * repeat. What CI can re-prove is everything the passes did NOT screen — that
 * the shipped rows are the rows those passes actually certified, and that each
 * row is still the single-blank, four-distinct-options shape a 流れ question
 * needs. So this script re-checks, on every run, that each frozen row is
 *
 *   1. provenance `composed` AND `validated` AND `validatedBy:
 *      authored:agent-blind-judged` (the two-blind-pass cert record),
 *   2. NOT listed in `{level}-bunshou-rejected.json` (a row a pass rejected is
 *      out of the store, and the store may not quietly re-adopt it),
 *   3. carrying exactly one ＿＿ run, joined to the text by 。 or 、, never in
 *      the first or the last sentence — a blank at the edge has no following
 *      flow to test, which is the whole ねらい,
 *   4. four distinct options with `options[0] === key[0]` and `answerIndex: 0`,
 *      none of them a verbatim substring of the passage (a sentence the passage
 *      already prints is a second defensible answer sitting in plain sight),
 *   5. stamped with this level's official instruction line, block
 *      `bunshou-no-bunpou`, and the level the file is filed under,
 *   6. inside the length bands this task fixed from the official sample papers
 *      (doc-27 §11: 文章の文法 has no per-level 字数 in the ねらい PDF, so the
 *      bands come from the sample passages themselves),
 *   7. clean Japanese orthography: no Latin, no half-width ASCII, no
 *      simplified-Chinese-only codepoint,
 *   8. one-sentence Japanese `evidence` naming the discourse cue, and
 *   9. a store of at least 大問 count × 4 papers, with no passage or option
 *      reused anywhere in the three levels (a spent passage backs one 小問).
 *
 * Exits 0 when every shipped row clears all nine screens; exits 1 naming the
 * failing rows so a regression is caught in CI, not at assembly time.
 *
 * The cert trio, the option slot, the stamps, the reuse pass and the runner
 * come from `check-word-shared.ts`. What stays here is this block's own
 * placement screens: where the ＿＿ sits, in which sentence, and the
 * stem-inclusive orthography sweep the 流れ 文 need (the quoted instruction
 * line's own １・２・３・４ are full-width digits by design, so this gate screens
 * more texts than the shared sweep and skips full-width ASCII on the stem).
 */

import {
  type AuthoredWordRow,
  answerSlotIssues,
  certIssues,
  evidenceFormIssues,
  FULLWIDTH_ASCII_RE,
  HANGUL_RE,
  LATIN_RE,
  loadRejectedLedger,
  optionBandIssues,
  readJson,
  rejectedLedgerFor,
  runes,
  runWordGate,
  SIMPLIFIED_RE,
  stampIssues,
  storeFile,
} from "./check-word-shared";

const BLANK = "＿＿";
/** The paper's own instruction line per level, quoted from the 2018 current-level
 * sample papers (N1G.pdf 問題７, N2G.pdf 問題９, N3G.pdf 問題３, N4G.pdf もんだい３,
 * N5G.pdf もんだい３). A stem that drifts from this stopped being the exam's
 * instruction and became a paraphrase.
 *
 * TASK-179: the two new legs read 「文章の意味を考えて」, not N3's 「文章全体の
 * 内容を考えて」. That is not a simplification of the wording for lower levels,
 * it is what the N4 and N5 papers actually print (both sample 大問 say
 * ぶんしょうの/文章の意味を考えて), and it is a different ねらい: the item asks
 * what the passage MEANS at the blank, not what it globally CONTENTS. So the
 * stem difference is the block's level adaptation, and the gate keeps the two
 * wordings apart rather than letting N5 inherit N3's. */
const BUNSHOU_STEMS: Readonly<Record<string, string>> = {
  N1: "次の文章を読んで、文章全体の趣旨を踏まえて、＿＿に入る最もよいものを、１・２・３・４から一つ選びなさい。",
  N2: "次の文章を読んで、文章全体の内容を考えて、＿＿に入る最もよいものを、１・２・３・４から一つ選びなさい。",
  N3: "つぎの文章を読んで、文章全体の内容を考えて、＿＿に入る最もよいものを、１・２・３・４から一つえらびなさい。",
  N4: "次の文章を読んで、文章の意味を考えて、＿＿に入る最もよいものを、１・２・３・４から一つ選びなさい。",
  N5: "つぎの文章をよんで、ぶんしょうの意味をかんがえて、＿＿に入るいちばんいいものを、１・２・３・４から一つえらんでください。",
};

/** [passage min, passage max, option min, option max] per level, in runes.
 *
 * doc-27 §11: the ねらい PDF gives no per-level 字数 for 文章の文法, so N1-N3
 * come from the sample passages. N4 and N5 cannot be read off their samples the
 * same way, because the official N4/N5 大問 prints ONE passage carrying five
 * blanks and this store ships one passage per 小問 (see the sample's
 * 水泳/さくぶん layout in doc-26 §3.1-§3.2). So the bands anchor on the two
 * certified 読解 stores at the same level, which do bound a single-passage
 * 小問: N4 短文 `n4.json` measures 111-130 runes and 中文 `n4-chuubun.json`
 * 251-321, and 文章の文法 sits between them (a 文法 passage, one paragraph);
 * N5 短文 `n5.json` measures 102-149 and 中文 `n5-chuubun.json` 195-265. The
 * maxima are the 中文 floor minus the paragraph headroom, so a row that reads
 * as long as a 中文 text fails here rather than quietly making the level's
 * 文法 大問 the hardest thing on the paper. N3's shipped rows run 100-140
 * against a 220 ceiling, so a band is a bound, not a target. */
const BANDS: Readonly<
  Record<string, readonly [number, number, number, number]>
> = {
  N1: [170, 320, 8, 50],
  N2: [140, 260, 8, 50],
  N3: [100, 220, 6, 45],
  N4: [90, 180, 6, 40],
  N5: [70, 150, 5, 35],
};

/** 文章の文法 prints 5 小問 at every level (doc-26 §3.1-§3.5), and the depth
 * standard is 4 papers of supply, so a level shipping fewer than this is not a
 * store yet. */
const MIN_ROWS: Readonly<Record<string, number>> = {
  N1: 20,
  N2: 20,
  N3: 20,
  N4: 20,
  N5: 20,
};

const TRAILING_COMMA_RE = /、+$/;

/** The shipped row is the shared authored-row record: a multi-sentence passage,
 * a four-sentence 流れ, the frozen key slot, and the cert fields. */
export type BunshouRow = AuthoredWordRow;

/** Split on 。 the way a reader sees sentences, with the blank counted as text
 * so a blank-bearing sentence is a sentence. */
const sentencesOf = (passage: string): string[] =>
  passage
    .split("。")
    .map((part) => part.replace(TRAILING_COMMA_RE, ""))
    .filter((part) => part.trim() !== "");

/** The store must be there: a missing file is a broken CI checkout, and this
 * gate has always failed loudly on one rather than printing a green line. */
const loadBunshouLevel = (level: string): BunshouRow[] =>
  readJson<BunshouRow[]>(storeFile(level, "bunshou"));

/** Screen 3: one blank, joined by punctuation, sitting inside the passage. */
const blankIssues = (row: BunshouRow): string[] => {
  const blankCount = row.passage.split(BLANK).length - 1;
  if (blankCount !== 1) {
    return [`passage-blank-count-${blankCount}`];
  }
  return [...blankPlacementIssues(row), ...blankSentenceIssues(row)];
};

/** The blank itself: not doubled, and joined to the text by 。 or 、 — an
 * unjoined blank is a word slot, not a 流れ cue. */
const blankPlacementIssues = (row: BunshouRow): string[] => {
  const issues: string[] = [];
  if (row.passage.includes(`${BLANK}${BLANK}`)) {
    issues.push("blank-adjacent-to-blank");
  }
  const chars = [...row.passage];
  const blankAt = chars.indexOf("＿");
  const next = chars[blankAt + 2] ?? "";
  if (next !== "。" && next !== "、") {
    issues.push(`blank-followed-by-${next}`);
  }
  return issues;
};

/** Where the blank sits in the passage: a 流れ text of 4-6 sentences, and the
 * blank never at either edge — the first sentence has no flow to follow and
 * the last has nothing after it to test. */
const blankSentenceIssues = (row: BunshouRow): string[] => {
  const issues: string[] = [];
  const sentences = sentencesOf(row.passage);
  if (sentences.length < 4 || sentences.length > 6) {
    issues.push(`passage-sentences-${sentences.length}`);
  }
  const blankSentence = sentences.findIndex((s) => s.includes(BLANK));
  if (blankSentence === 0) {
    issues.push("blank-in-first-sentence");
  }
  if (blankSentence === sentences.length - 1) {
    issues.push("blank-in-last-sentence");
  }
  return issues;
};

/** Screen 4 (second half): an option carries neither the blank it would fill,
 * nor a full stop the passage already supplies, nor the passage's own text. */
const optionTextIssues = (row: BunshouRow): string[] => {
  const issues: string[] = [];
  for (const option of row.options) {
    if (option.includes(BLANK)) {
      issues.push(`option-carries-blank:${option}`);
    }
    if (option.endsWith("。")) {
      issues.push(`option-ends-with-period:${option}`);
    }
    if (row.passage.includes(option)) {
      issues.push(`option-verbatim-in-passage:${option}`);
    }
  }
  return issues;
};

/** Screen 4 + 5: the option contract and the level's own stamps. */
const optionIssues = (row: BunshouRow): string[] => {
  const key = row.options[0] ?? "";
  return [
    ...answerSlotIssues(row),
    ...(row.key[0] === key ? [] : ["key-not-options-0"]),
    ...optionTextIssues(row),
    ...stampIssues(row, BUNSHOU_STEMS, "bunshou-no-bunpou"),
  ];
};

/** Screen 6 (first half): the passage is a 流れ text of this level's length. */
const passageBandIssues = (
  passage: string,
  min: number,
  max: number
): string[] => {
  const length = runes(passage);
  if (length < min || length > max) {
    return [`passage-${length}runes-outside-${min}-${max}`];
  }
  return [];
};

/** Screen 7: this gate's own sweep. It guards the quoted stem too (a drift in
 * the instruction line must fail here, not only in the exact-match stamp), but
 * exempts it from the full-width screen, because the paper's own １・２・３・４
 * are full-width digits by design. Half-width ASCII is not screened: no shipped
 * 流れ row has ever needed the check, and the four screens below are the ones
 * this store was certified against. */
const bunshouOrthographyIssues = (row: BunshouRow): string[] => {
  const issues: string[] = [];
  const texts: readonly (readonly [string, string])[] = [
    ["passage", row.passage],
    ["stem", row.stem],
    ["evidence", row.evidence],
    ...row.options.map((option, i): [string, string] => [`option${i}`, option]),
  ];
  for (const [where, text] of texts) {
    if (LATIN_RE.test(text)) {
      issues.push(`latin-in-${where}`);
    }
    if (where !== "stem" && FULLWIDTH_ASCII_RE.test(text)) {
      issues.push(`fullwidth-ascii-in-${where}`);
    }
    if (SIMPLIFIED_RE.test(text)) {
      issues.push(`simplified-hanzi-in-${where}`);
    }
    if (HANGUL_RE.test(text)) {
      issues.push(`hangul-in-${where}`);
    }
  }
  return issues;
};

/** Screens 6 + 7 + 8: bands, orthography, evidence. */
const shapeIssues = (row: BunshouRow): string[] => {
  const [pMin, pMax, oMin, oMax] = BANDS[row.level] ?? [0, 0, 0, 0];
  return [
    ...passageBandIssues(row.passage, pMin, pMax),
    ...optionBandIssues(row.options, oMin, oMax),
    ...bunshouOrthographyIssues(row),
    ...evidenceFormIssues(
      row.evidence,
      5,
      "evidence-not-one-japanese-sentence"
    ),
  ];
};

export const bunshouRowIssues = (
  row: BunshouRow,
  rejectedIds: ReadonlySet<string>
): string[] => [
  ...certIssues(row, rejectedIds),
  ...blankIssues(row),
  ...optionIssues(row),
  ...shapeIssues(row),
];

/** Screen 9: no passage and no option may serve two rows across all five
 * levels, because a spent passage backs exactly one 小問. */
const reuseTexts = (row: BunshouRow): string[] => [row.passage, ...row.options];

const LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;

/** The CI run. The store file is required, so a checkout without it fails
 * loudly at the read, exactly as this gate always has. */
if (import.meta.main) {
  runWordGate({
    blockLabel: "文章の文法",
    clashTexts: reuseTexts,
    fileStem: "bunshou",
    floorNote: "(5 小問 × 4 papers)",
    levels: LEVELS,
    loadRows: loadBunshouLevel,
    minRows: MIN_ROWS,
    rejectedIdsFor: (level) =>
      loadRejectedLedger(rejectedLedgerFor(level, "bunshou")),
    rowIdentity: (row) => ({ id: row.id, level: row.level }),
    rowIssues: (row, rejectedIds) => bunshouRowIssues(row, rejectedIds),
    stampCheck: false,
  });
}
