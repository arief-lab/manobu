/**
 * `check:goseikei` — the deterministic CI gate for the 語形成 store
 * (TASK-173.9.26 AC#6). NO LLM runs here.
 *
 * 語形成 prints a sentence whose compound is missing ONE kanji at one end, the
 * gap shown as （　） beside the printed fragment (the official shape measured
 * from the 2018 N2 sample paper N2V.pdf 問題３: 結婚（　） with 観・識・念・察, and
 * （　）水準 with 高), and offers FOUR SINGLE KANJI of which exactly one completes
 * a compound the sentence means. The mechanical half of the item is falsifiable
 * against the licensed vocab corpus:
 *
 *   1. provenance `composed` AND `validated` AND `validatedBy:
 *      authored:agent-blind-judged` (the two-blind-pass cert record),
 *   2. NOT listed in `n2-goseikei-rejected.json` — a burned id stays burned,
 *   3. the passage carries exactly one （　）, is one proper sentence of
 *      8-80 runes, and prints NEITHER the completed compound NOR the key kanji
 *      itself. The second half is the n2-g-013 lesson: the item-engine leak
 *      rule (`hasStemLeak` in packages/item-engine/src/validation.ts) reads
 *      prompt+passage for the answer text, so a passage that says 電車 under a
 *      key 車 is not a weak row, it is a row the assembly silently drops
 *      forever. The gate must refuse it where the server only hides it,
 *   4. the four options are DISTINCT single kanji the learner has met by N2
 *      (each occurs in some word of the n5-n2 bands), the answer is options[0]
 *      with `answerIndex: 0`, and options[0] sits at one END of the compound in
 *      `key` — prefix like （高）水準 or suffix like 機関（車）, never mid-word,
 *   5. `key` (the completed compound) is an attested word in the bands at or
 *      below N2 — the 小問 asks material the learner has met — the printed
 *      fragment is itself an attested word (all four official 小問 print a real
 *      word beside the blank), and every distractor completion (fragment+kanji
 *      and kanji+fragment) is attested as NO word in ANY band N5-N1: an
 *      attested completion is a second defensible answer, which is what the
 *      blind passes then judge for sentence fit,
 *   6. the N2 instruction line, block `goseikei`, level stamp N2,
 *   7. clean Japanese orthography (no Latin, no half-width ASCII, no
 *      full-width ASCII, no simplified-Chinese-only codepoint, no hangul) in
 *      passage, options and evidence, and
 *   8. a one-sentence Japanese `evidence` naming the key, plus the store
 *      floors (5 小問 x 4 papers = 20) and no passage or compound spent twice.
 *
 * The shared contract of the authored 語彙 gates (cert trio, orthography, the
 * four-option preamble, the reuse map, the runner) lives in
 * `check-word-shared.ts`; what is written here is the compound completion the
 * corpus can falsify.
 *
 * What this gate cannot see is whether the SENTENCE means the compound —
 * 昨日その前 reads fine yet completes nothing — and that is exactly what the
 * two blind judge passes certify on top. Exits 0 when every shipped row clears
 * all screens; exits 1 naming the failing rows so a regression is caught in CI,
 * not at assembly time.
 */

import {
  type AuthoredWordRow,
  answerSlotIssues,
  authoredTexts,
  CUMULATIVE_BANDS,
  certIssues,
  evidenceFormIssues,
  KANJI_RE,
  loadRejectedLedger,
  loadVocabBand,
  orthographySweep,
  rejectedLedgerFor,
  runes,
  runWordGate,
  sentenceFormIssues,
  stampIssues,
  tryLoadStore,
} from "./check-word-shared";

/** The paper's own instruction line, quoted from the 2018 N2 sample vocabulary
 * paper (N2V.pdf p.5, 問題３), matching `PAPER_BLOCK_INSTRUCTIONS['goseikei']`
 * in the item engine. 語形成 exists at N2 only (doc-26 §1: the measured N3/N4/N5
 * papers print no such 大問 and N1 has none), so N2 is the only row here. */
const GOSEIKEI_STEMS: Readonly<Record<string, string>> = {
  N2: "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
};

/** 語形成 prints 5 小問 per paper and the depth standard is 4 papers
 * (paper.ts:587), so the store floor is 20. */
const MIN_ROWS: Readonly<Record<string, number>> = {
  N2: 20,
};

/** The one （　） the paper prints per 小問: full-width parens around one
 * full-width space, exactly as N2V.pdf sets it. */
const BLANK = "（　）";
const BLANK_RE = /（　）/g;

/** 語形成 文 are single sentences, the same band 表記 and 文章の文法 ships.
 * The options are single kanji, so their length is screened exactly (=1)
 * rather than by a band. */
const PASSAGE_MIN = 8;
const PASSAGE_MAX = 80;

const ONE_KANJI_RE = /^[\u4E00-\u9FFF\u3400-\u4DBF]$/u;

export type GoseikeiRow = AuthoredWordRow;

/** What the licensed vocab corpus says, for one level and for the whole
 * corpus. `wordsBySpellingAtOrBelow` answers "has the N2 learner met this
 * word" (the key compound must be yes, the distractor kanji pool derives from
 * it); `allWords` answers "is this a real Japanese word at all" (the fragment
 * must be yes, every distractor completion must be no, at ANY level including
 * N1 — a completion attested only above the paper's level is still a defensible
 * reading a judge could pick, so it is still a two-answer risk). */
export interface GoseikeiAttestation {
  readonly allWords: ReadonlySet<string>;
  readonly kanjiAtOrBelow: ReadonlySet<string>;
  readonly wordsBySpellingAtOrBelow: ReadonlySet<string>;
}

/** Bands whose words every learner at `level` has met (cumulative), and the
 * full five-band universe the two-answer guard must search. */
const ALL_BANDS = ["n5", "n4", "n3", "n2", "n1"] as const;

/** Every kanji the learner has met: one character of any cumulative-band word. */
const collectKanji = (words: ReadonlySet<string>): Set<string> => {
  const kanji = new Set<string>();
  for (const word of words) {
    for (const ch of word) {
      if (KANJI_RE.test(ch)) {
        kanji.add(ch);
      }
    }
  }
  return kanji;
};

export const attestationFor = (level: string): GoseikeiAttestation => {
  const allWords = new Set<string>();
  const wordsBySpellingAtOrBelow = new Set<string>();
  const cumulative = new Set(CUMULATIVE_BANDS[level] ?? []);
  for (const band of ALL_BANDS) {
    const atOrBelow = cumulative.has(band) ? wordsBySpellingAtOrBelow : null;
    for (const entry of loadVocabBand(band)) {
      if (entry.word.length === 0) {
        continue;
      }
      allWords.add(entry.word);
      if (atOrBelow !== null) {
        atOrBelow.add(entry.word);
      }
    }
  }
  return {
    allWords,
    kanjiAtOrBelow: collectKanji(wordsBySpellingAtOrBelow),
    wordsBySpellingAtOrBelow,
  };
};

const loadRejectedIds = (level: string): Set<string> =>
  loadRejectedLedger(rejectedLedgerFor(level, "goseikei"));

/** Screens 1 + 2: the cert trio, and the row is not one the passes rejected. */
const provenanceIssues = certIssues;

/** The fragment the blank explains: the compound with the answer kanji cut off
 * at whichever END it sits. Null when the option is not at that end of a
 * two-rune-or-longer compound. */
const endFragment = (
  compound: string,
  option: string,
  side: "prefix" | "suffix"
): string | null => {
  if (runes(compound) < 2) {
    return null;
  }
  if (side === "suffix") {
    return compound.endsWith(option) ? compound.slice(0, -1) : null;
  }
  return compound.startsWith(option) ? compound.slice(1) : null;
};

/** Exactly one side may glue: a blank with an attested fragment on both sides
 * or on neither is not the single compound gap the paper prints. */
const gluedFragment = (
  compound: string,
  option: string,
  passage: string
): string | null => {
  const suffix = endFragment(compound, option, "suffix");
  const prefix = endFragment(compound, option, "prefix");
  const suffixGlued = suffix !== null && passage.includes(`${suffix}${BLANK}`);
  const prefixGlued = prefix !== null && passage.includes(`${BLANK}${prefix}`);
  if (suffixGlued === prefixGlued) {
    return null;
  }
  return suffixGlued ? suffix : prefix;
};

/** The blank's two legal neighbourhoods: `fragment（　）` (suffix gap, 機関（車）)
 * or `（　）fragment` (prefix gap, （高）水準). The issue list when the passage
 * prints no single （　） with an attested-word fragment glued to exactly one
 * side, or when the compound itself is printed (which the key-kanji screen in
 * `passageIssues` catches independently). */
const blankSplitOf = (
  row: GoseikeiRow,
  attestation: GoseikeiAttestation
): { fragment: string } | string[] => {
  const blanks = [...row.passage.matchAll(BLANK_RE)];
  if (blanks.length !== 1) {
    return [`passage-blanks-${blanks.length}`];
  }
  const compound = row.key[0] ?? "";
  const option = row.options[0] ?? "";
  if (runes(option) !== 1) {
    return ["key-option-not-single-kanji"];
  }
  const glued = gluedFragment(compound, option, row.passage);
  if (glued === null) {
    return [`blank-not-adjacent-to-compound-fragment:${compound}`];
  }
  if (!attestation.allWords.has(glued)) {
    return [`fragment-not-attested-word:${glued}`];
  }
  return { fragment: glued };
};

/** Screens 3-5: passage shape, the option contract, and the corpus attestation
 * that makes options[0] the ONLY completion of the fragment. */
export const contentIssues = (
  row: GoseikeiRow,
  attestation: GoseikeiAttestation
): string[] => {
  const issues: string[] = [...passageIssues(row)];
  issues.push(...optionIssues(row, attestation));
  const split = blankSplitOf(row, attestation);
  if (!("fragment" in split)) {
    return [...issues, ...split];
  }
  const { fragment } = split;
  // The evidence must be about THIS item: naming the compound outright (機関車)
  // or the fragment it explains (n2-g-003 spells why 不 attaches to 規則). A
  // first-kanji fallback would let any prose containing one kanji pass, and
  // demanding the full compound alone would refuse that row.
  const compound = row.key[0] ?? "";
  if (!(row.evidence.includes(compound) || row.evidence.includes(fragment))) {
    issues.push("evidence-names-neither-compound-nor-fragment");
  }
  for (const distractor of row.options.slice(1)) {
    if (
      attestation.allWords.has(fragment + distractor) ||
      attestation.allWords.has(distractor + fragment)
    ) {
      issues.push(`distractor-completion-attested:${fragment}${distractor}`);
    }
  }
  return issues;
};

/** The passage: one sentence of legal length that answers neither itself nor
 * the leak. `key-kanji-in-passage` here is stricter than 表記's: the whole
 * compound may not be printed, and NEITHER may the single kanji that is the
 * answer, because `hasStemLeak` searches prompt+passage for the ANSWER TEXT
 * (the option), not the compound. n2-g-013 shipped with 車 only inside 電車 and
 * the assembly would have dropped it in silence. */
const passageIssues = (row: GoseikeiRow): string[] => {
  const issues: string[] = sentenceFormIssues(
    row.passage,
    PASSAGE_MIN,
    PASSAGE_MAX
  );
  const compound = row.key[0] ?? "";
  if (compound.length > 0 && row.passage.includes(compound)) {
    issues.push(`compound-in-passage:${compound}`);
  }
  const option = row.options[0] ?? "";
  if (option.length > 0 && row.passage.includes(option)) {
    issues.push(`key-kanji-in-passage:${option}`);
  }
  return issues;
};

/** The four-option contract the paper always prints: exactly one answer in the
 * frozen first slot, four DISTINCT single kanji the learner has met by this
 * level, and the answer kanji sitting at one END of an attested compound. A
 * fragment+option reassembly is exact by construction here (the fragment is cut
 * FROM the compound in `blankSplitOf`), so the compound attestation in this
 * screen is the whole corpus-side proof. */
const optionIssues = (
  row: GoseikeiRow,
  attestation: GoseikeiAttestation
): string[] => [
  ...answerSlotIssues(row),
  ...compoundSlotIssues(row, attestation),
  ...optionKanjiIssues(row, attestation),
];

const compoundSlotIssues = (
  row: GoseikeiRow,
  attestation: GoseikeiAttestation
): string[] => {
  const issues: string[] = [];
  const compound = row.key[0] ?? "";
  const option = row.options[0] ?? "";
  if (row.key.length !== 1 || compound.length === 0) {
    issues.push("key-not-one-compound");
  }
  if (!(compound.endsWith(option) || compound.startsWith(option))) {
    issues.push(`key-option-not-at-compound-end:${option}`);
  }
  if (!attestation.wordsBySpellingAtOrBelow.has(compound)) {
    issues.push(`compound-not-attested-at-or-below-level:${compound}`);
  }
  return issues;
};

/** A non-word distractor kanji is legal for 語形成 (the paper offers shapes,
 * not words), but a kanji from above the level asks a character the learner
 * was never taught. */
const optionKanjiIssues = (
  row: GoseikeiRow,
  attestation: GoseikeiAttestation
): string[] => {
  const issues: string[] = [];
  for (const each of row.options) {
    if (!ONE_KANJI_RE.test(each)) {
      issues.push(`option-not-single-kanji:${each}`);
    }
    if (each.length > 0 && !attestation.kanjiAtOrBelow.has(each)) {
      issues.push(`option-kanji-above-level:${each}`);
    }
  }
  return issues;
};

/** Screens 6-8: the level's own stamps, orthography, evidence. */
export const shapeIssues = (row: GoseikeiRow): string[] => [
  ...stampIssues(row, GOSEIKEI_STEMS, "goseikei"),
  // The blank's own （） are the paper's orthography, not smuggled full-width
  // ASCII, so the passage is screened with its one blank stripped.
  ...orthographySweep(
    authoredTexts(row.passage.replaceAll(BLANK, ""), row.evidence, row.options)
  ),
  // What the sentence must SAY (it names the compound or its fragment) is the
  // attestation side of the screen, in `contentIssues`; this half is its shape.
  ...evidenceFormIssues(row.evidence, 10, "evidence-not-one-japanese-sentence"),
];

export const goseikeiRowIssues = (
  row: GoseikeiRow,
  rejectedIds: ReadonlySet<string>,
  attestation: GoseikeiAttestation
): string[] => [
  ...provenanceIssues(row, rejectedIds),
  ...contentIssues(row, attestation),
  ...shapeIssues(row),
];

const LEVELS = ["N2"] as const;

/** One attestation per level: building it reads all five vocab bands, and
 * every row of the level asks the same question of them. */
const attestationCache = new Map<string, GoseikeiAttestation>();
const attestationOf = (level: string): GoseikeiAttestation => {
  const cached = attestationCache.get(level);
  if (cached !== undefined) {
    return cached;
  }
  const fresh = attestationFor(level);
  attestationCache.set(level, fresh);
  return fresh;
};

/** The CI run. Guarded so that importing the screens (the authoring cull and
 * the gate's own test) does not read the shipped stores. */
const main = (): void => {
  runWordGate<GoseikeiRow>({
    blockLabel: "語形成",
    clashTexts: (row) => [row.passage, row.key[0] ?? ""],
    fileStem: "goseikei",
    levels: LEVELS,
    loadRows: (level) => tryLoadStore<GoseikeiRow>(level, "goseikei"),
    minRows: MIN_ROWS,
    rejectedIdsFor: loadRejectedIds,
    rowIdentity: (row) => row,
    rowIssues: (row, rejectedIds, level) =>
      goseikeiRowIssues(row, rejectedIds, attestationOf(level)),
  });
};

if (import.meta.main) {
  main();
}
