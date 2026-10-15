/**
 * `check:kitei` — the deterministic CI gate for the 文脈規定 stores
 * (TASK-173.9.29). NO LLM runs here.
 *
 * 文脈規定 prints ONE sentence with a （　） blank and offers FOUR words of
 * which exactly one completes the meaning the CONTEXT around the blank
 * establishes — the 語彙 menus' closest-meaning sibling that cannot be assembled
 * from the licensed corpus, so the rows are agent-authored and two blind judge
 * passes certify them. The mechanical half the corpus can falsify:
 *
 *   1. provenance `composed` AND `validated` AND `validatedBy:
 *      authored:agent-blind-judged` (the two-blind-pass cert record),
 *   2. NOT listed in `{level}-kitei-rejected.json` — a burned id stays burned,
 *   3. the passage carries exactly one （　）, is one proper sentence of
 *      8-80 runes, and prints NONE of the four options verbatim: 文脈規定 is
 *      NOT stimulus-answered, so `hasStemLeak` treats the passage itself as
 *      leak evidence and a row that prints its answer is a row the assembly
 *      silently drops forever,
 *   4. the four options are DISTINCT words each attested in the vocab bands at
 *      or below the row's level, sharing at least one JMdict part-of-speech tag
 *      with the answer (the paper always prints one form class per 小問), the
 *      answer is options[0] with `answerIndex: 0`, and `key` is exactly
 *      [options[0]],
 *   5. `evidence` is the passage with the answer byte-substituted into the
 *      blank — the mechanical proof the answer SLOTS there,
 *   6. the level's own instruction line quoted from the 2018 sample papers
 *      (N3V.pdf 問題３, N2V.pdf 問題４, N1V.pdf 問題２) and block
 *      `bunmi-kitei`,
 *   7. clean Japanese orthography (no Latin, no half-width ASCII, no
 *      full-width ASCII beyond the blank's own （）, no simplified-Chinese-only
 *      codepoint, no hangul) in passage, options and evidence, and
 *   8. store floors 小問数 x 3 papers (N3 11x3=33, N2 7x3=21, N1 7x3=21) and
 *      no passage or answer spent twice — across the WHOLE family, since one
 *      served store may not print the same 小問 twice in one paper.
 *
 * What this gate cannot see is whether the SENTENCE actually pins the answer —
 * any of the four may slot grammatically — and that is exactly what the two
 * blind judge passes certify on top. Exits 0 when every shipped row clears all
 * screens; exits 1 naming the failing rows so a regression is caught in CI, not
 * at assembly time.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AuthoredWordRow,
  answerSlotIssues,
  authoredTexts,
  CUMULATIVE_BANDS,
  certIssues,
  DATA_DIR,
  evidenceFormIssues,
  loadRejectedLedger,
  normalise,
  orthographySweep,
  rejectedLedgerFor,
  runWordGate,
  sentenceFormIssues,
  stampIssues,
  tryLoadStore,
} from "./check-word-shared";

/** The three papers' own instruction lines, transcribed verbatim from the 2018
 * official sample vocabulary PDFs (the blank is （　） on all three, matching
 * the 語形成 store's convention; PAPER_BLOCK_INSTRUCTIONS carries no
 * bunmi-kitei row — TASK-173.5 slice 5 stayed citation-gated — so store rows
 * print their stem via the STEM_CUE_ITEM_TYPES path). */
const KITEI_STEMS: Readonly<Record<string, string>> = {
  N1: "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  N2: "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  N3: "（　）に入れるのに最もよいものを、１・２・３・４から一つえらびなさい。",
};

/** 小問数 x 3 papers: N3 11, N2 7, N1 7 (paper.ts). */
const MIN_ROWS: Readonly<Record<string, number>> = {
  N1: 21,
  N2: 21,
  N3: 33,
};

const BLANK = "（　）";

const PASSAGE_MIN = 8;
const PASSAGE_MAX = 80;

export type KiteiRow = AuthoredWordRow;

interface BandEntry {
  readonly partOfSpeech?: string;
  readonly word: string;
}

/** A vocab band file is either the flat array or the `{ entries }` wrapper the
 * newer band dumps use; the POS map builder reads both shapes the same way. */
const bandEntriesOf = (
  raw: BandEntry[] | { entries?: BandEntry[] }
): readonly BandEntry[] => (Array.isArray(raw) ? raw : (raw.entries ?? []));

/** The normalized tag list one entry carries: an entry of several POS ("noun,
 * 引っ越しする family") contributes every tag it ever holds. */
const posTagsOf = (partOfSpeech: string | undefined): string[] =>
  (partOfSpeech ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);

/** spelling -> union of normalized POS tags, over the bands the learner at
 * `level` has met. A word of several entries (引っ越し noun and 引っ越しする
 * family) contributes every tag it ever carries. */
export const posAtOrBelow = (level: string): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  for (const band of CUMULATIVE_BANDS[level] ?? []) {
    const raw = JSON.parse(
      readFileSync(join(DATA_DIR, `${band}.json`), "utf8")
    ) as BandEntry[] | { entries?: BandEntry[] };
    for (const entry of bandEntriesOf(raw)) {
      const spelling = normalise(entry.word);
      if (spelling.length === 0) {
        continue;
      }
      const tags = map.get(spelling) ?? new Set<string>();
      for (const tag of posTagsOf(entry.partOfSpeech)) {
        tags.add(tag);
      }
      map.set(spelling, tags);
    }
  }
  return map;
};

/** The per-option corpus screen: the leak of ANY option into its own passage,
 * and the attestation of every option in the bands at or below the level.
 * 文脈規定 is not stimulus-answered, so printing a distractor narrows the
 * elimination the 小問 exists to test, and `hasStemLeak` searches
 * prompt+passage for the ANSWER text, making the answer slot fatal at
 * assembly. */
const optionCorpusIssues = (
  row: KiteiRow,
  pos: ReadonlyMap<string, Set<string>>
): string[] => {
  const issues: string[] = [];
  for (const option of row.options) {
    if (option.length > 0 && row.passage.includes(option)) {
      issues.push(`option-verbatim-in-passage:${option}`);
    }
    if (!pos.has(normalise(option))) {
      issues.push(`option-not-attested-at-or-below-level:${option}`);
    }
  }
  return issues;
};

/** A distractor from a different POS family than the answer makes the blank
 * mechanically solvable by part of speech alone, which the 大問 does not
 * ask. Only screened when the corpus knows the answer's own tags. */
const posFamilyMismatchIssues = (
  answer: string,
  options: readonly string[],
  pos: ReadonlyMap<string, Set<string>>
): string[] => {
  const issues: string[] = [];
  const answerTags = pos.get(normalise(answer));
  if (answerTags === undefined) {
    return issues;
  }
  for (const distractor of options.slice(1)) {
    const distractorTags = pos.get(normalise(distractor));
    if (
      distractorTags !== undefined &&
      [...distractorTags].every((tag) => !answerTags.has(tag))
    ) {
      issues.push(`pos-family-mismatch:${distractor}`);
    }
  }
  return issues;
};

/** Screens 3 + 4 + 5: the single blank, the sentence shape, the leak, the
 * four-option corpus contract, and the evidence reconstruction. */
export const contentIssues = (
  row: KiteiRow,
  pos: ReadonlyMap<string, Set<string>>
): string[] => {
  const issues: string[] = [];
  const blanks = [...row.passage.matchAll(/（　）/g)].length;
  if (blanks !== 1) {
    issues.push(`passage-blanks-${blanks}`);
  }
  issues.push(...sentenceFormIssues(row.passage, PASSAGE_MIN, PASSAGE_MAX));
  issues.push(...answerSlotIssues(row));
  const answer = row.options[0] ?? "";
  if (row.key.length !== 1 || row.key[0] !== answer) {
    issues.push("key-not-one-answer");
  }
  issues.push(...optionCorpusIssues(row, pos));
  issues.push(...posFamilyMismatchIssues(answer, row.options, pos));
  if (blanks === 1 && row.evidence !== row.passage.replace(BLANK, answer)) {
    issues.push("evidence-not-blank-reconstruction");
  }
  return issues;
};

/** Screens 6-8: the level's own stamps, orthography, evidence shape. */
export const shapeIssues = (row: KiteiRow): string[] => [
  ...stampIssues(row, KITEI_STEMS, "bunmi-kitei"),
  // The blank's own （） are the paper's orthography, not smuggled full-width
  // ASCII, so the passage is screened with its blank stripped (語形成 precedent).
  ...orthographySweep(
    authoredTexts(row.passage.replaceAll(BLANK, ""), row.evidence, row.options)
  ),
  ...evidenceFormIssues(
    row.evidence,
    PASSAGE_MIN,
    "evidence-not-one-japanese-sentence"
  ),
];

export const kiteiRowIssues = (
  row: KiteiRow,
  rejectedIds: ReadonlySet<string>,
  pos: ReadonlyMap<string, Set<string>>
): string[] => [
  ...certIssues(row, rejectedIds),
  ...contentIssues(row, pos),
  ...shapeIssues(row),
];

const LEVELS = ["N3", "N2", "N1"] as const;

const loadRejectedIds = (level: string): Set<string> =>
  loadRejectedLedger(rejectedLedgerFor(level, "kitei"));

/** One POS map per level: building it reads every cumulative vocab band, and
 * every row of the level asks the same question of them. */
const posCache = new Map<string, Map<string, Set<string>>>();
const posOf = (level: string): Map<string, Set<string>> => {
  const cached = posCache.get(level);
  if (cached !== undefined) {
    return cached;
  }
  const fresh = posAtOrBelow(level);
  posCache.set(level, fresh);
  return fresh;
};

/** The CI run. Guarded so that importing the screens (the authoring cull and
 * the gate's own test) does not read the shipped stores. */
const main = (): void => {
  runWordGate<KiteiRow>({
    blockLabel: "文脈規定",
    clashTexts: (row) => [row.passage, row.key[0] ?? ""],
    fileStem: "kitei",
    floorNote: "(小問数 x 3 papers)",
    levels: LEVELS,
    loadRows: (level) => tryLoadStore<KiteiRow>(level, "kitei"),
    minRows: MIN_ROWS,
    rejectedIdsFor: loadRejectedIds,
    rowIdentity: (row) => row,
    rowIssues: (row, rejectedIds, level) =>
      kiteiRowIssues(row, rejectedIds, posOf(level)),
  });
};

if (import.meta.main) {
  main();
}
