/** Shared constants for the N2/N1 主張理解（長文） reading pipeline
 * (TASK-173.9.2 slice 2). Same sourcing contract as the 中文 pipeline
 * (`reading-chuubun-corpus.ts`): one 白書 paragraph, one sourced 小問, four
 * Japanese options, judged before freeze. The DIFFERENCE is the 小問 shape:
 * 中文 masks one word and asks what fills the blank; 主張理解 prints the
 * passage whole and asks what the author is claiming/emphasizing/asserting.
 *
 * Because the key is authored (a claim the corpus does not print as a claim),
 * this module does NOT re-derive solvability the way the masked-slot pipeline
 * does. The deterministic screens still run in the generator and again in the
 * gate (passage length band, in-level coverage floor, the claim term printed
 * by its own paragraph, no distractor in the source), and the semantic
 * question "does the passage actually support this claim" is removed by the
 * same blind-judge pass the 中文 pipeline uses
 * (`data/reading/{level}-chuushou-rejected.json`, `prompts/reading-validator.md`).
 * So the SAME signer convention holds: `deterministic:gen-reading-chuushou`
 * names the construction, and `validated: true` is re-proved by
 * `check-reading-chuushou`, not trusted on the generator's say-so.
 */

import {
  CHUUBUN_MAX_PASSAGE_LENGTH,
  CHUUBUN_MIN_PASSAGE_LENGTH,
  type PassageBand,
} from "./reading-chuubun-corpus";
import { readRejectedIdsFrom } from "./reading-n4-corpus";

/** The block this pipeline fills: N1 大問12 / N2 大問13. */
export const CHUSHOU_BLOCK = "shuchou-rikai-choubun";

/** The signer a generated 主張理解 row carries. Names the PIPELINE, not a
 * model: the batch signs the CONSTRUCTION (passage + fixed stem + four JP
 * options + the deterministic screens), and the semantic claim is what the
 * judge pass freezes. */
export const CHUSHOU_SIGNER = "deterministic:gen-reading-chuushou";

/** Fixed stem every 主張理解 小問 prints. Fixed text, so it can never leak the
 * claim, and inspectable in the frozen file itself. */
export const CHUSHOU_STEM = "この文章で筆者が最も主張していることはどれか";

/** Stable English gloss of the stem so the prompt layer can render an English
 * instruction without re-deriving the question from the passage. */
export const CHUSHOU_SOURCE_EN =
  "Which of the following best expresses what the author is claiming/emphasizing/asserting in this passage?";

/** Length band is shared with 中文 so the two pipelines draw from one 白書
 * paragraph pool without one starving the other. Mirror of the server's
 * medium-reading passage cap. */
export const CHUSHOU_MIN_PASSAGE_LENGTH = CHUUBUN_MIN_PASSAGE_LENGTH;
export const CHUSHOU_MAX_PASSAGE_LENGTH = CHUUBUN_MAX_PASSAGE_LENGTH;

/** Row id prefix: `n2s-<paragraph id>`, mirroring 中文's `n2c-`. One 主張理解
 * claim backs one paragraph per store, so the id is paragraph-scoped and a
 * judge rejection blocks that pair across regenerations. */
export const chuushouIdFor = (level: string, paragraphId: string): string =>
  `${level.toLowerCase()}s-${paragraphId}`;

/** The freeze-time judge record, same shape and same reason as 中文's
 * `readChuubunRejections` (see `prompts/reading-validator.md`): a regeneration
 * skips a rejected row and walks deeper into the claims file; CI only ever
 * reads the list. Missing file = no rejections. */
export const readChuushouRejections = (
  storeDir: string,
  level: string
): ReadonlySet<string> =>
  readRejectedIdsFrom(
    storeDir,
    `${level.toLowerCase()}-chuushou-rejected.json`
  );

/** The construction a 主張理解 store is built with, per level. The generator reads
 * this to decide whether it may run at all, and the gate reads it to decide which
 * proof a row may claim: a row cannot choose its own evidence, so a 白書 window
 * tagged into the authored N2 store is refused exactly like an authored row
 * smuggled into a windowed one. `hakusho` is the one-paragraph store with the
 * authored-key claim, `authored` is a written 長文 argument. Since
 * TASK-173.9.21 both levels this block serves are `authored`, so the `hakusho`
 * arm has no level left and the generator refuses every level in this table. */
export const CHUSHOU_SOURCE: Readonly<Record<string, "authored" | "hakusho">> =
  {
    N1: "authored",
    N2: "authored",
  };

/** The construction tags this block's two routes print. A row tagged anything else
 * is unknown at the boundary and gets no branch, hence no proof. */
export const CHUSHOU_CONSTRUCTIONS = ["authored", "authored-key"] as const;

export type ChuushouConstruction = (typeof CHUSHOU_CONSTRUCTIONS)[number];

/** The construction the level's route builds. A level with no entry is treated as
 * the windowed store it would have to be: the block only exists at N1 and N2, so
 * an unknown level has no authored band either and its row fails there. */
export const chuushouConstructionForLevel = (
  level: string
): ChuushouConstruction =>
  CHUSHOU_SOURCE[level] === "authored" ? "authored" : "authored-key";

/** The construction a frozen row claims, or null when the tag is not one this
 * block knows. */
export const chuushouConstructionOf = (
  construction: string | undefined
): ChuushouConstruction | null =>
  CHUSHOU_CONSTRUCTIONS.find((each) => each === construction) ?? null;

/* ---------------------------------------------------------------------------
 * THE AUTHORED ROUTE (TASK-173.9.20).
 *
 * The 白書 branch is closed, not deleted: since TASK-173.9.21 no level routes here,
 * because its passage was one sourced paragraph and its key a term THAT PARAGRAPH
 * PRINTS (`claim-not-in-source` is the screen), which is a word lookup wearing a
 * 主張理解 heading — the same defect doc-27 §10 names for 中文. An authored 主張 row
 * writes the document and the argument, and the screens change with it: the passage
 * is multi-paragraph, the deciding sentence travels as `evidence`, and the key is a
 * PARAPHRASE of the thesis rather than a copy of it.
 * ------------------------------------------------------------------------ */

/**
 * The band a written 主張理解（長文） passage prints, per level. Only the levels
 * this block WRITES at appear; a level it does not name is refused with
 * `authored-band-unknown` rather than measured against a borrowed band.
 *
 * Both ends are measured, not invented. `max` is the budget the SERVER declares
 * for the item type: `claim-understanding` fills at
 * `MEDIUM_READING_MAX_PASSAGE_LENGTH` = 1200
 * (`apps/server/src/services/exam-service.ts:162`, applied at `:3079`), so a
 * longer document is not servable at this 大問 however good it reads. `min` = 700
 * sits strictly ABOVE the 中文 authored ceiling (`PASSAGE_BAND.authored.max` =
 * 600) and above the 521-rune ceiling of the single-paragraph store this level
 * shipped until this task, so a written 主張 row cannot be a 中文 row re-headed:
 * the same band-over-band shape `JOUHOU_AUTHORED_BAND` uses to make a lower-level
 * borrow fail instead of passing quietly. No official 字程度 for 主張理解（長文）is
 * pinned anywhere in this repo (doc-26 §1 pins the レベル別 PDFs and §3 lists the
 * 小問 count), which is why the two measured numbers carry the decision.
 */
export const CHUSHOU_AUTHORED_BAND: Readonly<Record<string, PassageBand>> = {
  // N1's floor is 100 runes above N2's (700) so a written N1 主張 cannot be an
  // N2 one by length, and it clears both the 中文 authored ceiling (600) and the
  // 521-rune ceiling of the single-paragraph 白書 store this level shipped until
  // TASK-173.9.21. `max` is the same server budget: 1200.
  N1: { max: 1200, min: 800 },
  N2: { max: 1200, min: 700 },
};

/** An argument is a position, reasons, and a turn where the objection is answered.
 * Four paragraphs is the minimum that structure, and it is what separates this
 * 大問 from the one-paragraph store it replaces (every shipped N2 主張 row printed
 * exactly one). */
export const CHUSHOU_AUTHORED_MIN_PARAGRAPHS = 4;

/** The 主張理解 大問 fixes its own stem (「この文章で筆者が最も主張していることは
 *どれか」 is the block's whole question set, printed 3 times at N2), so the ねらい
 * SPREAD screen that governs 短文, 中文 and 長文 cannot govern it: a store that
 * varied its stems would be inventing questions the 大問 does not ask. This maps
 * the fixed stem onto the 内容理解 intent it is (`opinion`), and returns null for
 * anything else, so a row that asks some other question fails
 * `stem-intent-unclassified` rather than being counted. `CHUSHOU_AUTHORED_MIN_INTENTS`
 * disables the spread floor for this block; the replacement spread is the
 * distractor-reason floor below. */
export const chuushouAuthoredIntentFor = (stem: string): string | null =>
  stem === CHUSHOU_STEM ? "opinion" : null;

/** One intent is what this 大問 asks, three times. Stated rather than silent so a
 * reader of the config sees a decision, not an oversight. */
export const CHUSHOU_AUTHORED_MIN_INTENTS = 1;

/**
 * Why a wrong option is wrong, as a closed set. AC#2 of TASK-173.9.20 is the
 * distractor CONTRACT: an authored 主張 store that says "three plausible
 * distractors" states nothing about whether any of them is defensible. Each
 * reason is decidable against the printed passage, which is what makes the field
 * more than decoration:
 *
 * - `reversed-stance`: the passage takes the opposite position, so the option
 *   contradicts the text rather than being beside it. Not printed verbatim.
 * - `detail-as-claim`: the passage really says this, but as a supporting detail,
 *   not as the thesis. PROVED by the option occurring verbatim in the passage.
 * - `counter-position`: an objection the passage never raises. Not printed.
 *
 * A store must span all three (one detail-as-claim row is a coincidence; three
 * classes means the writer had to build each failure mode on purpose).
 */
export const CHUSHOU_DISTRACTOR_REASONS = [
  "counter-position",
  "detail-as-claim",
  "reversed-stance",
] as const;

export type ChuushouDistractorReason =
  (typeof CHUSHOU_DISTRACTOR_REASONS)[number];

const DETAIL_REASON: ChuushouDistractorReason = "detail-as-claim";

/** The 小問 prints four options, so exactly three carry a reason. */
export const CHUSHOU_DISTRACTOR_COUNT = 3;

/** The whole set of failure modes a store must cover. */
export const CHUSHOU_MIN_REASON_CLASSES = CHUSHOU_DISTRACTOR_REASONS.length;

/** The row fields the option screens read, as a structural type so the gate's own
 * entry interface is not widened into a union nobody consumes. */
export interface ChuushouAuthoredRow {
  readonly answerIndex: number;
  readonly distractorReasons?: readonly string[];
  readonly options: readonly string[];
  readonly passage: string;
}

/** The three distractors in option order, with the key position skipped. Exported
 * because the gate reports the same alignment the generator wrote. */
export const chuushouDistractorsOf = (
  row: ChuushouAuthoredRow
): readonly { option: string; position: number }[] =>
  row.options
    .map((option, position) => ({ option, position }))
    .filter(({ position }) => position !== row.answerIndex);

/** Whether one stated reason matches what the passage prints of that option: a
 * 詳細な情報 option must be printed, an invented 主張反転/対比 option must not
 * be, and any other reason string is not one of the three the shape admits. */
const distractorReasonIssues = ({
  distractors,
  passage,
  position,
  reason,
}: {
  readonly distractors: readonly { option: string; position: number }[];
  readonly passage: string;
  readonly position: number;
  readonly reason: string;
}): string[] => {
  if (!CHUSHOU_DISTRACTOR_REASONS.some((known) => known === reason)) {
    return [`distractor-reason-unknown:${String(reason)}`];
  }
  const option = distractors[position]?.option ?? "";
  const printed = passage.includes(option);
  if (reason === DETAIL_REASON && !printed) {
    return ["detail-claim-not-printed-in-passage"];
  }
  if (reason !== DETAIL_REASON && printed) {
    return ["invented-option-printed-in-passage"];
  }
  return [];
};

/**
 * The authored 主張 screens on one row: the key must be a PARAPHRASE (a claim the
 * passage prints word-for-word is the lookup this route exists to end, and the
 * thesis itself already travels as `evidence`), and each distractor's stated
 * reason must match what the text actually prints.
 */
export const chuushouAuthoredOptionIssues = (
  row: ChuushouAuthoredRow
): string[] => {
  const reasons = row.distractorReasons ?? [];
  if (reasons.length !== CHUSHOU_DISTRACTOR_COUNT) {
    return [`distractor-reasons-not-${CHUSHOU_DISTRACTOR_COUNT}`];
  }
  const issues: string[] = [];
  const distractors = chuushouDistractorsOf(row);
  const answer = row.options[row.answerIndex];
  if (answer !== undefined && row.passage.includes(answer)) {
    issues.push("authored-claim-printed-in-passage");
  }
  for (const [at, reason] of reasons.entries()) {
    issues.push(
      ...distractorReasonIssues({
        distractors,
        passage: row.passage,
        position: at,
        reason,
      })
    );
  }
  return issues;
};

/** The store-level half of the distractor contract: all three failure modes, not
 * one of them three times. `reasons` is the tally the caller keeps while walking
 * its own rows. */
export const chuushouReasonSpreadIssues = (
  reasons: ReadonlySet<string>
): string[] => {
  const known = CHUSHOU_DISTRACTOR_REASONS.filter((reason) =>
    reasons.has(reason)
  );
  return known.length < CHUSHOU_MIN_REASON_CLASSES
    ? [
        `distractor-reasons-below-floor:${known.length}<${CHUSHOU_MIN_REASON_CLASSES}`,
      ]
    : [];
};
