/**
 * `check:iikae` — the deterministic CI gate for the 言い換え類義 store
 * (TASK-173.9.27 AC#6). NO LLM runs here.
 *
 * 言い換え類義 prints a sentence with ONE word bracketed as 「　」 and offers FOUR
 * candidate meanings for it, of which exactly one keeps what the sentence says
 * (the official shape measured from the 2018 samples: N1V.pdf p.5 問題3 and
 * N2V.pdf p.7 問題5 ask 「＿＿＿の言葉に意味が最も近いものを…」 over a bracketed
 * word, N3V.pdf p.6 問題4 asks the same in kana-only prose). The word form ships
 * at N1/N2/N3; N4 and N5 ask the whole-SENTENCE paraphrase instead, a different
 * construction this file does not cover (TASK-173.9.28). What the licensed vocab
 * corpus can falsify mechanically:
 *
 *   1. provenance `composed` AND `validated` AND `validatedBy:
 *      authored:agent-blind-judged` (the two-blind-pass cert record),
 *   2. NOT listed in `{level}-iikae-rejected.json` — a burned id stays burned,
 *   3. the passage carries EXACTLY ONE 「　」 pair whose 1-8 rune surface is a
 *      headword the learner has met by this level (the bands at or below it), so
 *      the 小問 asks material the paper is allowed to ask,
 *   4. the four options are DISTINCT and NONE of them appears inside the
 *      passage. The first half is the answer leak: `synonym-paraphrase` is
 *      deliberately absent from `STIMULUS_ANSWER_TYPES` in
 *      packages/item-engine/src/validation.ts, so `hasStemLeak` searches
 *      prompt+passage for the ANSWER text, and a passage that prints its own
 *      しばしば is a row the assembly drops forever, not a weak row. The second
 *      half is the same surface match read from the other side: a distractor the
 *      sentence already contains is a giveaway, so one screen protects both.
 *   5. the answer is options[0] with `answerIndex: 0` and `key` repeats exactly
 *      that one string, and the bracketed target is not itself an option (an
 *      item that offers the word under the word's own name asks nothing),
 *   6. the level's own instruction line, block `iikae-ruiji`, level stamp,
 *   7. clean Japanese orthography (no Latin, no half-width ASCII, no
 *      full-width ASCII, no simplified-Chinese-only codepoint, no hangul) in
 *      passage, options and evidence, and
 *   8. a one-sentence Japanese `evidence` naming the bracketed target, plus the
 *      store floors (N1 6 小問 x 4 papers = 24, N2/N3 5 x 4 = 20) and no passage
 *      or target spent twice across the whole store, level included: a word
 *      already asked at N3 is not a new 小問 at N1.
 *
 * What this gate cannot see is whether the OPTION means the TARGET — 頻繁 and
 * しばしば agree, 頻繁 and つい最近 do not, and no word list decides that for a
 * sentence. That is exactly what the two blind judge passes certify on top, and
 * why the options are not screened for band membership: the paraphrase of a word
 * is a meaning, and 残念なことに or 今となっては are legal 言い換え that no vocab
 * band lists as a spelling. Exits 0 when every shipped row clears all screens;
 * exits 1 naming the failing rows so a regression is caught in CI, not at
 * assembly time.
 *
 * The contract every authored 語彙 gate shares — the cert trio, the four-option
 * slot, the single-sentence band, orthography, the level's stamps, the reuse
 * pass and the runner — lives in `check-word-shared.ts`. What stays here is
 * this block's own falsifiable half: the bracketed target and the vocab
 * attestation that makes it material the level has met.
 */

import {
  type AuthoredWordRow,
  answerSlotIssues,
  authoredTexts,
  CUMULATIVE_BANDS,
  certIssues,
  evidenceFormIssues,
  kindedOwnerClashes,
  loadRejectedLedger,
  loadVocabBand,
  normalise,
  orthographySweep,
  rejectedLedgerFor,
  runes,
  runWordGate,
  sentenceFormIssues,
  stampIssues,
  tryLoadStore,
} from "./check-word-shared";

/** The paper's own instruction line per level, quoted from the 2018 samples
 * (N1V.pdf p.5 問題3, N2V.pdf p.7 問題5, N3V.pdf p.6 問題4), matching
 * `PAPER_BLOCK_INSTRUCTIONS['iikae-ruiji']` in the item engine. N4 and N5 print
 * the sentence-paraphrase wording, which belongs to TASK-173.9.28, so they have
 * no entry here. */
const IIKAE_STEMS: Readonly<Record<string, string>> = {
  N1: "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。",
  N2: "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。",
  N3: "＿＿＿に意味が最も近いものを、１・２・３・４から一つえらびなさい。",
};

/** 言い換え類義 prints 6 小問 at N1 and 5 at N2/N3, and the depth standard is 4
 * papers, so these are the floors. */
const MIN_ROWS: Readonly<Record<string, number>> = {
  N1: 24,
  N2: 20,
  N3: 20,
};

/** The one 「　」 the paper prints per 小問. The surface is bounded because a
 * bracket pair that swallowed a clause would stop being a word the item asks
 * about; the longest shipped target is 止むを得ない at 6 runes. */
const TARGET_RE = /「([^」]+)」/gu;
const TARGET_MAX = 8;

/** [passage min, passage max] in runes: 言い換え類義 文 are single sentences, the
 * same band 表記 and 語形成 ship. */
const PASSAGE_MIN = 8;
const PASSAGE_MAX = 80;

/** The shipped row is the shared authored-row record: passage, stem, four
 * options, the frozen key slot, and the two-blind-pass cert fields. */
export type IikaeRow = AuthoredWordRow;

/** The licensed vocab corpus, normalised the way a spelling is compared: NFKC so
 * a full-width and a half-width form of one headword are one headword. */
export interface IikaeAttestation {
  readonly wordsAtOrBelow: ReadonlySet<string>;
}

const buildAttestation = (level: string): IikaeAttestation => {
  const wordsAtOrBelow = new Set<string>();
  for (const band of CUMULATIVE_BANDS[level] ?? []) {
    for (const entry of loadVocabBand(band)) {
      if (entry.word.length > 0) {
        wordsAtOrBelow.add(normalise(entry.word));
      }
    }
  }
  return { wordsAtOrBelow };
};

/** One read of the licensed bands per level, not one read per row. */
const attestationCache = new Map<string, IikaeAttestation>();
const attestationOf = (level: string): IikaeAttestation => {
  const cached = attestationCache.get(level);
  if (cached !== undefined) {
    return cached;
  }
  const built = buildAttestation(level);
  attestationCache.set(level, built);
  return built;
};

export const attestationFor = (level: string): IikaeAttestation =>
  attestationOf(level);

/** The shipped store for one level. A missing file is reported by the floor
 * check as `no store file`, not as a stack trace. */
const loadIikaeLevel = (level: string): IikaeRow[] | null =>
  tryLoadStore<IikaeRow>(level, "iikae");

/** The bracketed word the 小問 asks about, or the reason there is not exactly
 * one. */
const targetOf = (row: IikaeRow): { target: string } | string[] => {
  const brackets = [...row.passage.matchAll(TARGET_RE)];
  if (brackets.length !== 1) {
    return [`passage-target-brackets-${brackets.length}`];
  }
  const target = brackets[0]?.[1] ?? "";
  if (target.length === 0) {
    return ["passage-target-empty"];
  }
  if (runes(target) > TARGET_MAX) {
    return [`passage-target-${runes(target)}runes-above-${TARGET_MAX}`];
  }
  return { target };
};

/** Screens 3-5 and 8: the bracketed target, the option contract, the leak that
 * hides the answer in plain sight, and the evidence that explains the item. */
export const contentIssues = (
  row: IikaeRow,
  attestation: IikaeAttestation
): string[] => {
  const issues = [...passageIssues(row), ...optionIssues(row)];
  const bracket = targetOf(row);
  if (!("target" in bracket)) {
    return [...issues, ...bracket];
  }
  const { target } = bracket;
  if (!attestation.wordsAtOrBelow.has(normalise(target))) {
    issues.push(`target-not-attested-at-or-below-level:${target}`);
  }
  if (row.options.includes(target)) {
    issues.push(`target-offered-as-an-option:${target}`);
  }
  // The evidence must be about THIS item: it explains why the key paraphrases
  // the bracketed word, so a row whose evidence never names that word is
  // carrying another row's justification.
  if (!row.evidence.includes(target)) {
    issues.push(`evidence-names-not-target:${target}`);
  }
  return issues;
};

/** The passage: one sentence of legal length that answers neither itself nor
 * the leak. Printing an option inside the passage is the same fault 語形成
 * catches in `key-kanji-in-passage`, one level coarser: the answer text is
 * `key[0]`, a whole word rather than one kanji, and any of the four strings
 * glued into the sentence is a surface match the learner can take without
 * reading it. */
const passageIssues = (row: IikaeRow): string[] => {
  const issues = sentenceFormIssues(row.passage, PASSAGE_MIN, PASSAGE_MAX);
  for (const option of row.options) {
    if (option.length > 0 && row.passage.includes(option)) {
      issues.push(`option-in-passage:${option}`);
    }
  }
  return issues;
};

/** The four-option contract the paper always prints: exactly one answer in the
 * frozen first slot, four DISTINCT strings, and `key` naming that same answer so
 * the grader and the leak rule read one thing. */
const optionIssues = (row: IikaeRow): string[] => {
  const issues = answerSlotIssues(row);
  const answer = row.options[0] ?? "";
  if (row.key.length !== 1 || row.key[0] !== answer) {
    issues.push("key-not-one-answer-matching-options-0");
  }
  for (const option of row.options) {
    if (option.trim().length === 0) {
      issues.push("option-blank");
    }
  }
  return issues;
};

/** Screens 6-7: the level's own stamps and orthography. */
export const shapeIssues = (row: IikaeRow): string[] => [
  ...stampIssues(row, IIKAE_STEMS, "iikae-ruiji"),
  ...orthographySweep(authoredTexts(row.passage, row.evidence, row.options)),
  ...evidenceFormIssues(row.evidence, 10, "evidence-not-one-japanese-sentence"),
];

export const iikaeRowIssues = (
  row: IikaeRow,
  rejectedIds: ReadonlySet<string>,
  attestation: IikaeAttestation
): string[] => [
  ...certIssues(row, rejectedIds),
  ...contentIssues(row, attestation),
  ...shapeIssues(row),
];

const LEVELS = ["N1", "N2", "N3"] as const;

/** Screen 8 (reuse): one passage and one bracketed target back exactly one 小問
 * across the whole store, level included. Distractors may repeat (the real
 * papers re-offer the same adverbs); the word being asked may not, it is the
 * item's identity, and a target already taught at N3 is not a new question at
 * N1. */
const reuseClashes = (rows: readonly IikaeRow[]): ReadonlyMap<string, string> =>
  kindedOwnerClashes(
    rows.map((row) => {
      const texts: { kind: string; text: string }[] = [];
      if (row.passage.length > 0) {
        texts.push({ kind: "passage", text: row.passage });
      }
      const bracket = targetOf(row);
      if ("target" in bracket) {
        texts.push({ kind: "target", text: normalise(bracket.target) });
      }
      return { id: row.id, texts };
    })
  );

/** The CI run: one read of every shipped store, one reuse pass over the whole
 * family, then the per-level verdict lines. */
if (import.meta.main) {
  runWordGate({
    blockLabel: "言い換え類義",
    clashes: reuseClashes,
    fileStem: "iikae",
    levels: LEVELS,
    loadRows: loadIikaeLevel,
    minRows: MIN_ROWS,
    rejectedIdsFor: (level) =>
      loadRejectedLedger(rejectedLedgerFor(level, "iikae")),
    rowIdentity: (row) => ({ id: row.id, level: row.level }),
    rowIssues: (row, rejectedIds, level) =>
      iikaeRowIssues(row, rejectedIds, attestationOf(level)),
  });
}
