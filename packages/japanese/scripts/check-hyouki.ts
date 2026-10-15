/**
 * `check:hyouki` — the deterministic CI gate for the 表記 stores
 * (TASK-173.9.25 AC#6). NO LLM runs here.
 *
 * 表記 prints one word of a sentence in kana and offers four spellings, exactly
 * one of which writes that word (the official shape measured from the 2018
 * sample papers: N5V/N4V もんだい２ 「＿＿の ことばは どう かきますか。」, N3V/N2V
 * 問題２ 「＿＿のことばを漢字で書くとき…」). Unlike 文章の文法, the key here IS
 * mechanically falsifiable: it must be a word+reading pair the licensed vocab
 * corpus attests, and the printed kana must map to exactly one attested word
 * (a second attested spelling is a two-answer item no blind pass can fix).
 * What the two blind judge passes certify on top is context fit - that the
 * authored sentence reads as that word. This gate re-proves, on every run,
 * everything falsifiable about a shipped row:
 *
 *   1. provenance `composed` AND `validated` AND `validatedBy:
 *      authored:agent-blind-judged` (the two-blind-pass cert record),
 *   2. NOT listed in `{level}-hyouki-rejected.json`,
 *   3. the passage carries exactly one 「…」 span of pure kana (the printed
 *      word), is a proper sentence, and prints NO option verbatim - a sentence
 *      that already shows a spelling is a leak, which is the one fact the
 *      item-engine validator shares (`hasStemLeak` checks prompt+passage),
 *   4. the key is options[0] with `answerIndex: 0`, four DISTINCT options, and
 *      the printed kana maps to EXACTLY the key across the vocab bands at or
 *      below the level (the two-answer guard: 保証 and 保障 both read ほしょう,
 *      so neither kana can anchor a 表記 小問),
 *   5. every wrong option is the official shape for its side: a kanji-shape
 *      row offers four kanji spellings (real words read differently, or
 *      component-mangled non-words - either way not the printed kana), and a
 *      kana-shape row (N5's katakana 表記 items: わいしゃつ → ワイシャツ) offers
 *      four katakana spellings,
 *   6. the level's official instruction line and block `hyouki`,
 *   7. length bands, clean Japanese orthography (no Latin, no half-width
 *      ASCII, no simplified-Chinese-only codepoint, no hangul),
 *   8. a one-sentence Japanese `evidence` that names the key, and
 *   9. store floors (小問数 x 4 papers: N5 32, N4 24, N3 24, N2 20), at most
 *      one katakana 小問 per 8 (the official 大問 shape), no passage or key
 *      spent twice across the four levels.
 *
 * The shared contract of the authored 語彙 gates - the cert trio, the
 * orthography screens, the four-option preamble, the reuse map and the
 * per-level runner - lives in `check-word-shared.ts`. What is written here is
 * the falsifiable heart of the block: the vocab attestation that makes the key
 * the only defensible spelling of the printed kana.
 *
 * Exits 0 when every shipped row clears all nine screens; exits 1 naming the
 * failing rows so a regression is caught in CI, not at assembly time.
 */

import {
  type AuthoredWordRow,
  answerSlotIssues,
  authoredTexts,
  CUMULATIVE_BANDS,
  certIssues,
  evidenceFormIssues,
  HIRA_RE,
  KANJI_RE,
  KATA_RE,
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

/** The paper's own instruction line per level, quoted from the 2018 sample
 * papers (N5V.pdf もんだい２, N4V.pdf もんだい２, N3V.pdf 問題２, N2V.pdf 問題２),
 * matching `PAPER_BLOCK_INSTRUCTIONS['hyouki']` in the item engine. The N2 line
 * really prints no 「、」 after をもの; the screen keeps that fact honest in both
 * directions. */
const HYOUKI_STEMS: Readonly<Record<string, string>> = {
  N2: "＿＿＿ の言葉を漢字で書くとき、最もよいものを１・２・３・４から一つ 選びなさい。",
  N3: "＿＿＿ のことばを漢字で書くとき、最もよいものを、１・２・３・４から一つ えらびなさい。",
  N4: "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
  N5: "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
};

/** 表記 prints 5-8 小問 per paper and the depth standard is 4 papers, so these
 * are the floors: N5 8x4, N4 6x4, N3 6x4, N2 5x4 (paper.ts:633, :610, :585, :560). */
const MIN_ROWS: Readonly<Record<string, number>> = {
  N2: 20,
  N3: 24,
  N4: 24,
  N5: 32,
};

/** The official 大問 carries at most one katakana 表記 小問 per paper (N5V
 * もんだい２ #1: わいしゃつ → ワイシャツ), so a store may hold at most
 * 小問数 of them and none above N5. */
const MAX_KANA_SHAPE_PER_LEVEL: Readonly<Record<string, number>> = {
  N2: 0,
  N3: 0,
  N4: 0,
  N5: 4,
};

/** 表記 文 are single sentences and 表記 options are words. */
const PASSAGE_MIN = 8;
const PASSAGE_MAX = 80;
const OPTION_MIN = 1;
const OPTION_MAX = 8;

/** 「…」 is where the paper underlines its word; the span carries the kana. */
const SPAN_RE = /「([^」]*)」/g;

export type HyoukiRow = AuthoredWordRow;

/** What the licensed vocab corpus says about a level: every spelling attested
 * at or below the level, and every kana with the set of words that carry it.
 * `wordsByReading` is the two-answer guard - a printed kana whose set is not
 * exactly the singleton {key} is either unattested (an invented word) or
 * ambiguous (two defensible spellings). `wordsByKanaFlip` is the same guard for
 * N5's katakana 表記 items, where the corpus stores the reading in katakana
 * (ワイシャツ/ワイシャツ) so `wordsByReading` can never see the printed hiragana:
 * the case-flipped spelling must still belong to exactly one word. */
export interface VocabAttestation {
  readonly wordsByKanaFlip: ReadonlyMap<string, ReadonlySet<string>>;
  readonly wordsByReading: ReadonlyMap<string, ReadonlySet<string>>;
  readonly wordsBySpelling: ReadonlySet<string>;
}

/** The katakana→hiragana identity map (no ー and no small-kana rewriting: the
 * official katakana 表記 items are words like ワイシャツ whose printed kana is the
 * plain case flip). Null when the text is not such a word. */
const toHiragana = (text: string): string | null => {
  if (!KATA_RE.test(text) || text.includes("ー")) {
    return null;
  }
  return [...text]
    .map((c) => {
      const code = c.charCodeAt(0);
      // Katakana sits 0x60 above hiragana in Unicode: ワ U+30EF → わ U+308F.
      return code >= 0x30_a1 && code <= 0x30_f6
        ? String.fromCharCode(code - 0x60)
        : c;
    })
    .join("");
};

export const attestationFor = (level: string): VocabAttestation => {
  const wordsByReading = new Map<string, Set<string>>();
  const wordsByKanaFlip = new Map<string, Set<string>>();
  const wordsBySpelling = new Set<string>();
  for (const band of CUMULATIVE_BANDS[level] ?? []) {
    for (const entry of loadVocabBand(band)) {
      wordsBySpelling.add(entry.word);
      const group = wordsByReading.get(entry.reading) ?? new Set<string>();
      group.add(entry.word);
      wordsByReading.set(entry.reading, group);
      const flip = toHiragana(entry.word);
      if (flip !== null) {
        const kanaGroup = wordsByKanaFlip.get(flip) ?? new Set<string>();
        kanaGroup.add(entry.word);
        wordsByKanaFlip.set(flip, kanaGroup);
      }
    }
  }
  return { wordsByKanaFlip, wordsByReading, wordsBySpelling };
};

const loadRejectedIds = (level: string): Set<string> =>
  loadRejectedLedger(rejectedLedgerFor(level, "hyouki"));

/** The printed kana: the one 「…」 span of the passage, or null when the span
 * is absent, doubled, or carries anything but kana (screens 3's first half). */
const printedKanaOf = (row: HyoukiRow): string | null => {
  const spans = [...row.passage.matchAll(SPAN_RE)];
  if (spans.length !== 1) {
    return null;
  }
  const kana = spans[0]?.[1] ?? "";
  if (kana.length === 0 || KANJI_RE.test(kana)) {
    return null;
  }
  if (!(HIRA_RE.test(kana) || KATA_RE.test(kana))) {
    return null;
  }
  return kana;
};

/** Screens 3-5: passage shape, the option contract, and the vocab attestation
 * that makes the key the ONLY defensible spelling of the printed kana. */
export const contentIssues = (
  row: HyoukiRow,
  attestation: VocabAttestation
): string[] => {
  const printed = printedKanaOf(row);
  if (printed === null) {
    return ["passage-lacks-a-single-kana-span"];
  }
  const key = row.key[0] ?? "";
  return [
    ...passageIssues(row, key),
    ...optionIssues(row, key),
    ...(KANJI_RE.test(key)
      ? kanjiShapeIssues(printed, key, row, attestation)
      : kanaShapeIssues(printed, key, row, attestation)),
  ];
};

/** The passage: one 「…」 kana span is already proven, so what is left is that
 * the sentence is a sentence, is single-sentence length, and does not print the
 * answer it asks for. */
const passageIssues = (row: HyoukiRow, key: string): string[] => {
  const issues: string[] = sentenceFormIssues(
    row.passage,
    PASSAGE_MIN,
    PASSAGE_MAX
  );
  if (key.length > 0 && row.passage.includes(key)) {
    issues.push(`key-spelling-in-passage:${key}`);
  }
  return issues;
};

/** The four-option contract the paper always prints: exactly one answer in the
 * frozen first slot, nothing repeated, and no option that is a phrase. */
const optionIssues = (row: HyoukiRow, key: string): string[] => {
  const slotWrong =
    key.length === 0 || row.key.length !== 1 || row.options[0] !== key;
  return [
    ...answerSlotIssues(row),
    ...(slotWrong ? ["key-not-options-0"] : []),
    ...optionTextIssues(row),
  ];
};

const optionTextIssues = (row: HyoukiRow): string[] => {
  const issues: string[] = [];
  for (const option of row.options) {
    if (option.includes("「") || option.includes("」")) {
      issues.push(`option-carries-span:${option}`);
    }
    if (option.endsWith("。")) {
      issues.push(`option-ends-with-period:${option}`);
    }
    if (row.passage.includes(option)) {
      issues.push(`option-verbatim-in-passage:${option}`);
    }
    const optionLength = runes(option);
    if (optionLength < OPTION_MIN || optionLength > OPTION_MAX) {
      issues.push(
        `option-${optionLength}runes-outside-${OPTION_MIN}-${OPTION_MAX}`
      );
    }
  }
  return issues;
};

/** Kanji shape: the printed kana must map to EXACTLY the key in the cumulative
 * vocab, and every wrong option must be a kanji spelling the paper can offer -
 * a real word read differently, or a component-mangled non-word. */
const kanjiShapeIssues = (
  printed: string,
  key: string,
  row: HyoukiRow,
  attestation: VocabAttestation
): string[] => {
  const issues: string[] = [];
  const words = attestation.wordsByReading.get(printed);
  const uniquelyAttested =
    words !== undefined && words.size === 1 && words.has(key);
  if (!uniquelyAttested) {
    issues.push(
      `printed-kana-not-uniquely-attested:${[...(words ?? [])].join("/")}`
    );
  }
  for (const option of row.options) {
    if (!KANJI_RE.test(option)) {
      issues.push(`kanji-shape-option-lacks-kanji:${option}`);
    }
  }
  return issues;
};

/** Kana shape, N5's katakana 表記 小問 (わいしゃつ → ワイシャツ): the key is the
 * attested katakana word, the printed kana is its plain case flip, and no other
 * katakana spelling at this level case-flips to that same kana. */
const kanaShapeIssues = (
  printed: string,
  key: string,
  row: HyoukiRow,
  attestation: VocabAttestation
): string[] => [
  ...kanaKeyIssues(printed, key, attestation),
  ...kanaOptionIssues(row, attestation),
];

const kanaKeyIssues = (
  printed: string,
  key: string,
  attestation: VocabAttestation
): string[] => {
  const issues: string[] = [];
  if (toHiragana(key) !== printed) {
    issues.push("kana-shape-key-not-case-flip-of-printed");
  }
  if (!attestation.wordsBySpelling.has(key)) {
    issues.push(`kana-shape-key-not-attested:${key}`);
  }
  const flip = attestation.wordsByKanaFlip.get(printed);
  const uniquelySpelled =
    flip !== undefined && flip.size === 1 && flip.has(key);
  if (!uniquelySpelled) {
    issues.push(
      `printed-kana-not-uniquely-katakana-spelled:${[...(flip ?? [])].join("/")}`
    );
  }
  return issues;
};

/** options[0] is the key and the key is attested by `kanaKeyIssues`, so the
 * distractor rule starts at index 1: only a WRONG option must be a non-word.
 * The official distractors are mora-shuffled non-words (ウイシャソ, ワイシャソ);
 * a distractor that is itself an attested katakana word makes the 小問 a
 * vocabulary test rather than a 表記 test. */
const kanaOptionIssues = (
  row: HyoukiRow,
  attestation: VocabAttestation
): string[] => {
  const issues: string[] = [];
  for (const [index, option] of row.options.entries()) {
    if (!KATA_RE.test(option)) {
      issues.push(`kana-shape-option-not-katakana:${option}`);
    }
    if (index > 0 && attestation.wordsBySpelling.has(option)) {
      issues.push(`kana-shape-option-is-attested-word:${option}`);
    }
  }
  return issues;
};

/** Screens 6-8: the level's own stamps, orthography, evidence. */
export const shapeIssues = (row: HyoukiRow): string[] => [
  ...stampIssues(row, HYOUKI_STEMS, "hyouki"),
  ...orthographySweep(authoredTexts(row.passage, row.evidence, row.options)),
  ...hyoukiEvidenceIssues(row),
];

/** The evidence is one Japanese sentence of substance that NAMES the key (or
 * at least its first character, the shape the shipped rows write). */
const hyoukiEvidenceIssues = (row: HyoukiRow): string[] => {
  const key = row.key[0] ?? "";
  const namesKey =
    row.evidence.includes(key) || row.evidence.includes(key[0] ?? "");
  const message = "evidence-not-one-japanese-sentence-naming-the-key";
  return namesKey ? evidenceFormIssues(row.evidence, 10, message) : [message];
};

export const hyoukiRowIssues = (
  row: HyoukiRow,
  rejectedIds: ReadonlySet<string>,
  attestation: VocabAttestation
): string[] => [
  ...certIssues(row, rejectedIds),
  ...contentIssues(row, attestation),
  ...shapeIssues(row),
];

const LEVELS = ["N5", "N4", "N3", "N2"] as const;

/** One attestation per level: building it reads the cumulative vocab bands,
 * and every row of the level asks the same question of them. */
const attestationCache = new Map<string, VocabAttestation>();
const attestationOf = (level: string): VocabAttestation => {
  const cached = attestationCache.get(level);
  if (cached !== undefined) {
    return cached;
  }
  const fresh = attestationFor(level);
  attestationCache.set(level, fresh);
  return fresh;
};

/** Screen 9's katakana cap, counted while the level is screened and printed
 * after the row failures and before the floor line, where the store's own
 * report put it. */
let kanaShapeCount = 0;

/** The CI run. Guarded so that importing the screens (the authoring cull and
 * the gate's own test) does not read the shipped stores. */
const main = (): void => {
  runWordGate<HyoukiRow>({
    blockLabel: "表記",
    clashTexts: (row) => [row.passage, row.key[0] ?? ""],
    fileStem: "hyouki",
    levels: LEVELS,
    loadRows: (level) => tryLoadStore<HyoukiRow>(level, "hyouki"),
    metric: {
      observe: (row) => {
        if (!KANJI_RE.test(row.key[0] ?? "")) {
          kanaShapeCount += 1;
        }
      },
      report: (level) => {
        const count = kanaShapeCount;
        kanaShapeCount = 0;
        const cap = MAX_KANA_SHAPE_PER_LEVEL[level] ?? 0;
        return count > cap
          ? `  ${level}: ${count} katakana rows, above the ${cap} cap`
          : null;
      },
    },
    minRows: MIN_ROWS,
    rejectedIdsFor: loadRejectedIds,
    rowIdentity: (row) => row,
    rowIssues: (row, rejectedIds, level) =>
      hyoukiRowIssues(row, rejectedIds, attestationOf(level)),
  });
};

if (import.meta.main) {
  main();
}
