/**
 * `check:iikae-sentence` — the deterministic CI gate for the whole-SENTENCE form
 * of 言い換え類義 (TASK-173.9.28 AC#5). NO LLM runs here.
 *
 * The same official 大問 (n4_revised.pdf and n5_revised.pdf 文字・語彙 大問4, 出題される
 * 語や表現と意味的に近い語や表現を問う) prints a different shape at the bottom two
 * levels than at N1-N3: the paper underlines a WHOLE sentence and offers four
 * COMPLETE sentences, of which exactly one says what the underlined one says. The
 * 2018 samples show it directly (N4V.pdf p.6 もんだい４: ゆうべ → きのうの よる at
 * the れい, アルバイトをしています → はたらく, びっくりしました → おどろきました;
 * N5V.pdf p.7 もんだい４: りょうしん → ちちと はは, やさしい → かんたん). What the
 * licensed vocab corpus can falsify mechanically:
 *
 *   1. provenance `composed` AND `validated` AND `validatedBy:
 *      authored:agent-blind-judged` (the two-blind-pass cert record), and the row
 *      is NOT listed in `{level}-iikae-sentence-rejected.json`,
 *   2. the passage is ONE sentence of legal length, carrying no 「　」 and no ＿＿:
 *      this form marks nothing inside the sentence (the paper puts the line over
 *      the whole ぶん), so a bracket or a blank means a row from the other form
 *      or a cloze has been filed here,
 *   3. every option is a complete sentence too, within the same band, and each is
 *      the SAME sentence with one piece swapped: the shared frame (the runes the
 *      option and the passage agree on from the front and from the back) must be
 *      at least FRAME_MIN long and the changed piece at most FOCUS_MAX runes on
 *      either side. That is the official shape, and it is what stops four
 *      unrelated sentences from passing themselves off as one 言い換え類義 小問,
 *   4. no option appears inside the passage and the answer's swapped-in piece is
 *      not found in the passage either. `sentence-paraphrase` is deliberately
 *      absent from `STIMULUS_ANSWER_TYPES` (packages/item-engine/src/
 *      validation.ts), so `hasStemLeak` searches prompt+passage for the ANSWER
 *      text and a row whose sentence prints its own answer is dropped by
 *      assembly in silence, not graded,
 *   5. the answer is options[0] with `answerIndex: 0` and `key` repeating exactly
 *      that one string, and no option is the passage itself (a copy answers the
 *      sentence by repeating it, which asks nothing),
 *   6. the level's own instruction line, block `iikae-ruiji`, level stamp,
 *   7. clean Japanese orthography (no Latin, no half-width ASCII, no full-width
 *      ASCII, no simplified-Chinese-only codepoint, no hangul) in passage,
 *      options and evidence,
 *   8. a one-sentence Japanese `evidence` that names one of the two swapped
 *      surfaces (what the sentence said or what the answer says), so the row
 *      carries its own justification rather than another row's, and
 *   9. the store floors (5 小問 x 4 papers = 20 per level) with no passage and no
 *      swap reused anywhere across the two levels: a 言い換え the store already
 *      asked is not a new 小問.
 *
 * What this gate cannot see is whether the swapped-in sentence MEANS the
 * underlined one — びっくりしました and おどろきました agree, びっくりしました and
 * わらいました do not, and no word list decides that for a sentence. That is what
 * the two blind judge passes certify on top, and why no option is screened for
 * vocabulary-band membership: like every other AUTHORED store in this package
 * (see `scripts/reading-authored-corpus.ts`), the prose is written for the level,
 * so level appropriateness is carried by the length bands, the same way
 * `check-bunshou.ts` bands a passage AND each full-sentence option. Exits 0 when
 * every shipped row clears all screens; exits 1 naming the failing rows.
 *
 * The contract every authored 語彙 gate shares — the cert trio, the option slot,
 * orthography, the level's stamps, the reuse pass and the runner — lives in
 * `check-word-shared.ts`. What stays here is this form's own algebra: the
 * frame-and-swap structure that makes four sentences four SAYINGS of one.
 */

import {
  type AuthoredWordRow,
  answerSlotIssues,
  authoredTexts,
  certIssues,
  evidenceFormIssues,
  kindedOwnerClashes,
  loadRejectedLedger,
  orthographySweep,
  rejectedLedgerFor,
  runes,
  runWordGate,
  stampIssues,
  tryLoadStore,
} from "./check-word-shared";

/** The paper's own instruction line per level, quoted verbatim from N4V.pdf p.6
 * (もんだい４) and N5V.pdf p.7 (もんだい４), matching
 * `PAPER_BLOCK_INSTRUCTIONS['iikae-ruiji']` in the item engine. The two booklets
 * print this heading word-for-word the same; the word-form line at N1-N3 belongs
 * to `check-iikae.ts`. */
const IIKAE_SENTENCE_STEMS: Readonly<Record<string, string>> = {
  N4: "＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
  N5: "＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
};

/** 言い換え類義 prints 5 小問 at N4 and at N5, and the depth standard is 4 papers. */
const MIN_ROWS: Readonly<Record<string, number>> = {
  N4: 20,
  N5: 20,
};

/** [passage min, passage max, option min, option max] in runes. Both levels print
 * one short everyday sentence, and every option re-prints that sentence with one
 * piece swapped, so the option band is the passage band: N5 sits at the れい-level
 * length (ゆうべ しゅくだいを しました。 is 13 runes), N4 a little longer. */
const BANDS: Readonly<
  Record<string, readonly [number, number, number, number]>
> = {
  N4: [10, 45, 10, 45],
  N5: [8, 35, 8, 35],
};

/** The least surface an option must share with the sentence it re-says. Two
 * unrelated Japanese sentences still share 。, so the floor has to be above the
 * punctuation; the samples share a clause (しゅくだいを しました。 alone is 11). */
const FRAME_MIN = 6;

/** The most a swapped piece may be. Above this the option stopped being the same
 * sentence with one expression changed and became a rewrite of it. */
const FOCUS_MAX = 14;

/** The marking this form does NOT carry: the paper underlines the whole ぶん, so
 * the shipped sentence holds no bracket pair and no blank. */
const BRACKET_RE = /[「」]/u;
const BLANK_RE = /＿/u;

/** The row is the same record the word form ships (passage, stem, four options,
 * the frozen key slot, the cert trio); what differs is what the screens make of
 * it, so the type is shared rather than duplicated. */
export type IikaeSentenceRow = AuthoredWordRow;

/** One option's difference from the sentence it re-says: what left, what came
 * in, and which of the four slots it sits in. */
interface OptionSwap {
  after: string;
  before: string;
  index: number;
}

/** The papers space their sentences for a beginner reader; a shipped row does not
 * inherit that spacing, and an evidence line may quote a surface with or without
 * it. Compare with the spaces out, so a screen reads the word and not the layout. */
const WHITESPACE_RE = /\s/gu;

const stripSpace = (text: string): string =>
  text.normalize("NFKC").replaceAll(WHITESPACE_RE, "");

/** The one sentence a text must be: a full stop at the end and no other inside. */
const isOneSentence = (text: string): boolean =>
  text.trimEnd().endsWith("。") &&
  text.trimEnd().slice(0, -1).indexOf("。") === -1;

/**
 * What one option changes in the passage: the longest common prefix and suffix
 * (in runes) leave a removed piece and the inserted piece between them. Returns
 * null when the two texts are the same sentence, which is screen 5's fault, not
 * a frame.
 */
export const swapOf = (
  passage: string,
  option: string
): { after: string; before: string; frame: number } | null => {
  const from = [...passage];
  const to = [...option];
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from.at(-(1 + tail)) === to.at(-(1 + tail))
  ) {
    tail += 1;
  }
  const before = from.slice(head, from.length - tail).join("");
  const after = to.slice(head, to.length - tail).join("");
  if (before.length === 0 && after.length === 0) {
    return null;
  }
  return { after, before, frame: head + tail };
};

/** Screen 2: the underlined sentence is one sentence of legal length and
 * carries no marking this form does not print. */
const passageShapeIssues = (
  row: IikaeSentenceRow,
  pMin: number,
  pMax: number
): string[] => {
  const issues: string[] = [];
  if (!isOneSentence(row.passage)) {
    issues.push("passage-not-one-sentence");
  }
  if (BRACKET_RE.test(row.passage)) {
    issues.push("passage-carries-brackets");
  }
  if (BLANK_RE.test(row.passage)) {
    issues.push("passage-carries-blank");
  }
  const length = runes(row.passage);
  if (length < pMin || length > pMax) {
    issues.push(`passage-${length}runes-outside-${pMin}-${pMax}`);
  }
  return issues;
};

/** Screen 5: the shared four-option preamble plus this form's own wording of
 * the frozen answer slot. */
const keySlotIssues = (row: IikaeSentenceRow): string[] => {
  const issues = answerSlotIssues(row);
  const answer = row.options[0] ?? "";
  if (row.key.length !== 1 || row.key[0] !== answer) {
    issues.push("key-not-one-answer-matching-options-0");
  }
  return issues;
};

/** Screen 4 (first half): one option is a complete sentence in the band,
 * unmarked, and not a piece the passage already prints. */
const singleOptionIssues = (
  passage: string,
  option: string,
  index: number,
  oMin: number,
  oMax: number
): string[] => {
  if (option.trim().length === 0) {
    return ["option-blank"];
  }
  const issues: string[] = [];
  if (!isOneSentence(option)) {
    issues.push(`option${index}-not-one-sentence`);
  }
  const optionLength = runes(option);
  if (optionLength < oMin || optionLength > oMax) {
    issues.push(`option${index}-${optionLength}runes-outside-${oMin}-${oMax}`);
  }
  if (BRACKET_RE.test(option) || BLANK_RE.test(option)) {
    issues.push(`option${index}-carries-marking`);
  }
  // The leak, read from the surface the engine reads: `hasStemLeak` compares
  // the answer text against prompt+passage, so an option the sentence already
  // prints is a row assembly drops forever.
  if (passage.includes(option)) {
    issues.push(`option-in-passage:${option}`);
  }
  return issues;
};

const optionSentenceIssues = (
  row: IikaeSentenceRow,
  oMin: number,
  oMax: number
): string[] => {
  const issues: string[] = [];
  for (const [index, option] of row.options.entries()) {
    issues.push(...singleOptionIssues(row.passage, option, index, oMin, oMax));
  }
  return issues;
};

/** Screen 3: every option is the passage with one bounded piece swapped inside
 * a shared frame. Collects the swaps the answer-leak and evidence screens read,
 * and the faults the frame algebra already found. */
const collectSwaps = (
  row: IikaeSentenceRow
): { issues: string[]; swaps: OptionSwap[] } => {
  const issues: string[] = [];
  const swaps: OptionSwap[] = [];
  for (const [index, option] of row.options.entries()) {
    const swap = swapOf(row.passage, option);
    if (swap === null) {
      issues.push(`option${index}-copies-the-passage`);
      continue;
    }
    if (swap.after.length === 0) {
      // The four options are four WAYS OF SAYING the sentence, so an option that
      // only deletes a piece of it paraphrases nothing.
      issues.push(`option${index}-deletes-without-replacement`);
    }
    if (swap.frame < FRAME_MIN) {
      issues.push(`option${index}-frame-${swap.frame}runes-below-${FRAME_MIN}`);
    }
    if (runes(swap.before) > FOCUS_MAX || runes(swap.after) > FOCUS_MAX) {
      issues.push(
        `option${index}-swap-${Math.max(
          runes(swap.before),
          runes(swap.after)
        )}runes-above-${FOCUS_MAX}`
      );
    }
    swaps.push({ after: swap.after, before: swap.before, index });
  }
  return { issues, swaps };
};

/** Screen 4 (second half): the answer's own swap is the leak at span level: a
 * sentence that prints the expression its paraphrase swaps in has the key in
 * plain sight. */
const answerLeakIssues = (
  row: IikaeSentenceRow,
  answerSwap: OptionSwap | undefined
): string[] => {
  if (
    answerSwap !== undefined &&
    answerSwap.after.length > 0 &&
    stripSpace(row.passage).includes(stripSpace(answerSwap.after))
  ) {
    return [`answer-swap-in-passage:${answerSwap.after}`];
  }
  return [];
};

/** Screen 8: the evidence must be about THIS 小問: naming either swapped
 * surface proves it explains this sentence rather than another row's. */
const evidenceSwapIssues = (
  row: IikaeSentenceRow,
  answerSwap: OptionSwap | undefined
): string[] => {
  if (answerSwap === undefined) {
    return [];
  }
  const evidence = stripSpace(row.evidence);
  const namesBefore =
    answerSwap.before.length > 0 &&
    evidence.includes(stripSpace(answerSwap.before));
  const namesAfter =
    answerSwap.after.length > 0 &&
    evidence.includes(stripSpace(answerSwap.after));
  return namesBefore || namesAfter ? [] : ["evidence-names-neither-swap"];
};

/** Screens 2-5 and 8: the sentence, the four re-said sentences, the leak, the
 * answer slot and the evidence. */
export const contentIssues = (row: IikaeSentenceRow): string[] => {
  const [pMin, pMax, oMin, oMax] = BANDS[row.level] ?? [0, 0, 0, 0];
  const { issues: swapIssues, swaps } = collectSwaps(row);
  const answerSwap = swaps.find((swap) => swap.index === 0);
  return [
    ...passageShapeIssues(row, pMin, pMax),
    ...keySlotIssues(row),
    ...optionSentenceIssues(row, oMin, oMax),
    ...swapIssues,
    ...answerLeakIssues(row, answerSwap),
    ...evidenceSwapIssues(row, answerSwap),
  ];
};

/** Screens 6-7: the level's own stamps and orthography. */
export const shapeIssues = (row: IikaeSentenceRow): string[] => [
  ...stampIssues(row, IIKAE_SENTENCE_STEMS, "iikae-ruiji"),
  ...orthographySweep(authoredTexts(row.passage, row.evidence, row.options)),
  ...evidenceFormIssues(row.evidence, 10, "evidence-not-one-japanese-sentence"),
];

export const iikaeSentenceRowIssues = (
  row: IikaeSentenceRow,
  rejectedIds: ReadonlySet<string>
): string[] => [
  ...certIssues(row, rejectedIds),
  ...contentIssues(row),
  ...shapeIssues(row),
];

const LEVELS = ["N4", "N5"] as const;

/** Screen 9 (reuse): one sentence and one 言い換え back exactly one 小問 across
 * the whole store, level included. The frames may repeat (the real papers re-use
 * the same sentence pattern); the swapped pair is the item's identity, so a
 * りょうしん → ちちと はは already asked at N4 is not a new 小問 at N5. */
const reuseClashes = (
  rows: readonly IikaeSentenceRow[]
): ReadonlyMap<string, string> =>
  kindedOwnerClashes(
    rows.map((row) => {
      const texts: { kind: string; text: string }[] = [];
      if (row.passage.length > 0) {
        texts.push({ kind: "passage", text: row.passage });
      }
      const swap = swapOf(row.passage, row.options[0] ?? "");
      if (swap !== null) {
        texts.push({ kind: "swap", text: `${swap.before}→${swap.after}` });
      }
      return { id: row.id, texts };
    })
  );

/** The CI run: one read of every shipped store, one reuse pass over both
 * levels, then the per-level verdict lines. */
if (import.meta.main) {
  runWordGate({
    blockLabel: "言い換え類義 sentence",
    clashes: reuseClashes,
    fileStem: "iikae-sentence",
    levels: LEVELS,
    loadRows: (level) =>
      tryLoadStore<IikaeSentenceRow>(level, "iikae-sentence"),
    minRows: MIN_ROWS,
    rejectedIdsFor: (level) =>
      loadRejectedLedger(rejectedLedgerFor(level, "iikae-sentence")),
    rowIdentity: (row) => ({ id: row.id, level: row.level }),
    rowIssues: (row, rejectedIds) => iikaeSentenceRowIssues(row, rejectedIds),
  });
}
