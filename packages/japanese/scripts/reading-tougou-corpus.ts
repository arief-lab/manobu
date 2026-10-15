/**
 * Shared constants and screens for the N2/N1 統合理解 reading pipeline
 * (TASK-173.9.3). The generator and the gate both import this module, so a
 * screen is a contract rather than a claim, exactly as in
 * `reading-chuubun-corpus.ts`.
 *
 * What differs from every sibling pipeline: a 統合理解 小問 is answered from
 * TWO documents, not one. The official ねらい (the pinned レベル別 PDFs, doc-26
 * §1) is 「複数のテキスト（合計600字程度）を読み比べて、比較・統合しながら理解できるかを問う」,
 * with 比較的平易な内容の added at N2. So a row pairs two 白書 paragraphs and asks
 * what BOTH of them mention.
 *
 * The oracle is the surface form of that ねらい, and it is the form this corpus
 * can PROVE: the key is an in-level noun printed by both documents and by no
 * third document in the clearing corpus, and every distractor is an in-level
 * noun printed by EXACTLY ONE of the two. Reading only one document therefore
 * cannot separate key from distractors, and no option needs a judgement call
 * about what an author "really" claims. The residual limitation is stated in
 * `data/LICENSE.md` and doc-26 §4: the item tests 読み比べて両方に現れる話題を出す, not
 * the deeper 比較・統合 the ねらい names.
 */

import {
  CHUUBUN_MAX_PASSAGE_LENGTH,
  CHUUBUN_MIN_PASSAGE_LENGTH,
  COVERAGE_FLOOR,
  coverageOf,
  LEVEL_RANKS,
  type PassageBand,
  segmentText,
} from "./reading-chuubun-corpus";
import {
  type ContentPos,
  collidesWithAnswer,
  contentPosOf,
  readRejectedIdsFrom,
  type VocabEntry,
  type VocabIndex,
} from "./reading-n4-corpus";

/** The block this pipeline fills: N1 大問11 / N2 大問12. */
export const TOUGOU_BLOCK = "tougou-rikai";

/** The signer a generated 統合理解 row carries. Names the PIPELINE: the batch
 * signs the CONSTRUCTION (two sourced documents + the fixed stem + four JP
 * options + the deterministic two-document screens). */
export const TOUGOU_SIGNER = "deterministic:gen-reading-tougou";

/** The construction tag: the key is the topic BOTH documents print. */
export const TOUGOU_CONSTRUCTION = "shared-topic-pair";

/** The construction a 統合理解 store is built with, per level. `hakusho` is the
 * pair of 白書 paragraphs that share one noun, `authored` is a written pair whose
 * key is the RELATION neither text states alone. The generator reads this table to
 * decide whether it may run, and the gate reads the same table for the construction
 * a row is allowed to claim, so a level cannot volunteer for the easier corpus from
 * inside its own store. Since TASK-173.9.21 both levels this block serves are
 * `authored`: the shared-topic lookup, whose key one surface-form match answers,
 * is closed for history rather than deleted (LICENSE §15). */
export const TOUGOU_SOURCE: Readonly<Record<string, "authored" | "hakusho">> = {
  N1: "authored",
  N2: "authored",
};

/** The construction tags this block's two routes print. A row tagged anything else
 * is unknown at the boundary, so it gets no branch and therefore no proof. */
export const TOUGOU_CONSTRUCTIONS = ["authored", "shared-topic-pair"] as const;

export type TougouConstruction = (typeof TOUGOU_CONSTRUCTIONS)[number];

/** The construction the level's route builds. A level with no entry is treated as
 * the windowed pair it would have to be: the block exists only at N1 and N2, and
 * an unknown level has no authored band either, so its row fails there too. */
export const tougouConstructionForLevel = (
  level: string
): TougouConstruction =>
  TOUGOU_SOURCE[level] === "authored" ? "authored" : TOUGOU_CONSTRUCTION;

/** The construction a frozen row claims, or null when the tag is not one this
 * block knows. */
export const tougouConstructionOf = (
  construction: string | undefined
): TougouConstruction | null =>
  TOUGOU_CONSTRUCTIONS.find((each) => each === construction) ?? null;

/** Fixed stem every 統合理解 小問 prints. It claims exactly what the screens
 * prove (both documents mention it), so the question is never stronger than its
 * oracle. Fixed text, so it cannot leak the key. */
export const TOUGOU_STEM = "二つの文章の両方に挙げられているものはどれか。";

/** Stable English gloss of the stem for the prompt layer. */
export const TOUGOU_SOURCE_EN =
  "Which of the following is mentioned in both of these texts?";

/** Each document keeps the 中文 length band, so one 白書 paragraph pool feeds
 * all three pipelines without one starving the others. */
export const TOUGOU_MIN_DOC_LENGTH = CHUUBUN_MIN_PASSAGE_LENGTH;
export const TOUGOU_MAX_DOC_LENGTH = CHUUBUN_MAX_PASSAGE_LENGTH;

/** The pair's combined length band. The ねらい says 合計600字程度, so a pair that
 * totals far more than that is not this 大問's material however well it screens. */
export const TOUGOU_MIN_TOTAL_LENGTH = 400;
export const TOUGOU_MAX_TOTAL_LENGTH = 800;

/** The item-engine length screen (`validateStimulusLength`) measures a reading
 * item's passages as ONE joined body of text, and `stimulusPassageText` puts a
 * blank line between them. Two documents therefore print two separators' worth
 * of characters the corpus band never counted. */
export const TOUGOU_PASSAGE_JOIN_RUNES = 2;
export const TOUGOU_MAX_STIMULUS_TEXT_LENGTH =
  TOUGOU_MAX_TOTAL_LENGTH + TOUGOU_PASSAGE_JOIN_RUNES;

/** Options are bare nouns, so the POS screen is the noun test the siblings use. */
const NOUN: ContentPos = "noun";

/** 統合理解 prints four options like every sibling 小問: the shared topic plus
 * three one-sided distractors. */
export const TOUGOU_OPTION_COUNT = 4;
export const TOUGOU_DISTRACTOR_COUNT = TOUGOU_OPTION_COUNT - 1;

/** The two word classes a 統合理解 option may NOT be. Both are decided from the
 * list metadata rather than by eye, and both exist because rarity is not
 * topicality: pair-specificity alone keeps a word precisely because the corpus
 * does not lean on it, so which words are worth asking about needs its own
 * screen.
 *
 * - a surface with trailing kana (迎え, 問い, 始め) is a nominalized verb stem:
 *   prose doing something, not a topic.
 * - a noun the list also tags `adverb` (明日, 以降, 大変) is a temporal or degree
 *   word, which two 白書 paragraphs almost always share and which is never the
 * 話題 the ねらい asks about.
 */
const KANJI_ONLY_RE = /^[\u3400-\u4dbf\u4e00-\u9fff]+$/;
const ADVERB_TOKEN = "adverb";

const isTopicSurface = (word: string): boolean => KANJI_ONLY_RE.test(word);

const isTopicalNoun = (entry: VocabEntry): boolean =>
  !(entry.partOfSpeech ?? "")
    .split(",")
    .some((token) => token.trim() === ADVERB_TOKEN);

/** One corpus paragraph, prepared for pairing: its text, its provenance, and
 * the in-level nouns it prints. */
export interface TougouDocument {
  readonly id: string;
  /** surface -> entry, in order of first appearance in the text. */
  readonly nouns: ReadonlyMap<string, VocabEntry>;
  readonly pageId: string;
  readonly pageUrl: string;
  readonly source: string;
  readonly text: string;
}

/** A ready pair: the two documents and the key that ties them. */
export interface TougouPair {
  readonly a: TougouDocument;
  readonly b: TougouDocument;
  readonly key: string;
}

/** The one entry screen a 統合 noun must pass: listed surface, 名詞, within the
 * item's level, topical by both surface and entry tests, at least two runes. */
const candidateNoun = (entry: VocabEntry, maxRank: number): boolean =>
  contentPosOf(entry) === NOUN &&
  (LEVEL_RANKS[entry.level] ?? 0) <= maxRank &&
  isTopicSurface(entry.word) &&
  isTopicalNoun(entry) &&
  [...entry.word].length >= 2;

/**
 * The in-level kanji nouns a text prints, first appearance first, deduplicated
 * by surface. Same entry screens as a 中文 slot: a listed noun at or below the
 * item's level, printed in its listed kanji form (the 白書 segmenter's reading
 * matches are usually a fragment of a longer word), at least two runes.
 */
export const nounsOf = (
  text: string,
  index: VocabIndex,
  maxRank: number
): Map<string, VocabEntry> => {
  const out = new Map<string, VocabEntry>();
  for (const { entry, surface } of segmentText(text, index)) {
    if (
      entry === null ||
      surface !== entry.word ||
      !candidateNoun(entry, maxRank)
    ) {
      continue;
    }
    if (!out.has(entry.word)) {
      out.set(entry.word, entry);
    }
  }
  return out;
};

/**
 * The paragraphs a 統合理解 pair may be built from, in corpus order: in the
 * document band and at the level's measured coverage floor. The floor is the
 * SAME table the 中文 pipeline reads, so one difficulty claim governs both.
 */
export const prepareTougouCorpus = (
  paragraphs: readonly {
    id: string;
    pageId: string;
    pageUrl: string;
    source: string;
    text: string;
  }[],
  index: VocabIndex,
  level: string
): readonly TougouDocument[] => {
  const maxRank = LEVEL_RANKS[level] ?? 0;
  const floor = COVERAGE_FLOOR[level] ?? 1;
  const docs: TougouDocument[] = [];
  for (const paragraph of paragraphs) {
    const runes = [...paragraph.text].length;
    if (
      runes < TOUGOU_MIN_DOC_LENGTH ||
      runes > TOUGOU_MAX_DOC_LENGTH ||
      coverageOf(paragraph.text, index, maxRank) < floor
    ) {
      continue;
    }
    docs.push({
      id: paragraph.id,
      nouns: nounsOf(paragraph.text, index, maxRank),
      pageId: paragraph.pageId,
      pageUrl: paragraph.pageUrl,
      source: paragraph.source,
      text: paragraph.text,
    });
  }
  return docs;
};

/** surface -> the indices of the clearing documents that print it. */
export const nounIndex = (
  docs: readonly TougouDocument[]
): ReadonlyMap<string, readonly number[]> => {
  const byNoun = new Map<string, number[]>();
  docs.forEach((doc, at) => {
    for (const surface of doc.nouns.keys()) {
      const bucket = byNoun.get(surface);
      if (bucket === undefined) {
        byNoun.set(surface, [at]);
      } else {
        bucket.push(at);
      }
    }
  });
  return byNoun;
};

/**
 * Is a shared noun a PROVABLE key? Besides being printed by both documents
 * (which the pairing walk establishes), no third clearing document may print
 * it, so the common topic is specific to this pair rather than a word the whole
 * corpus leans on. Without this, 制度 / 対策 / 費用 would answer every item.
 */
export const keyIsPairSpecific = (
  key: string,
  byNoun: ReadonlyMap<string, readonly number[]>
): boolean => (byNoun.get(key)?.length ?? 0) === 2;

/** The key's entry for a pair, or null when the pair does not print it. */
const keyEntryOf = (pair: TougouPair): VocabEntry | undefined =>
  pair.a.nouns.get(pair.key);

/**
 * Does the document that does NOT print this distractor name the SAME thing
 * under another surface? 利用 in one text and 活用 in the other is the failure
 * the surface screens cannot see: the distractor's own kanji string never
 * appears twice, yet a learner who read both texts can defend it as
 * 挙げられている in both. The two entries share their dominant English sense, so
 * the collision is decidable from the vocabulary list alone.
 */
export const synonymPrintedByOther = (
  entry: VocabEntry,
  other: ReadonlyMap<string, VocabEntry>
): boolean => {
  for (const printed of other.values()) {
    if (collidesWithAnswer(entry, printed)) {
      return true;
    }
  }
  return false;
};

/** Whether one noun of one document may be offered as a distractor of the pair:
 * not the key, not already chosen, not a noun BOTH documents print (that would be
 * a second defensible key), not a second label for the key or for an option
 * already chosen, and not something the OTHER document paraphrases. */
const isDistractorCandidate = ({
  chosen,
  chosenEntries,
  entry,
  keyEntry,
  other,
  pair,
  readings,
  word,
}: {
  chosen: readonly string[];
  chosenEntries: readonly VocabEntry[];
  entry: VocabEntry;
  keyEntry: VocabEntry;
  other: TougouDocument;
  pair: TougouPair;
  readings: ReadonlySet<string>;
  word: string;
}): boolean => {
  if (word === pair.key || chosen.includes(word)) {
    return false;
  }
  if (pair.a.nouns.has(word) && pair.b.nouns.has(word)) {
    return false;
  }
  // Two distractors that name the same thing (高校 and 高等学校) are one
  // option printed twice, so a distractor is screened against the ones
  // already chosen as well as against the key.
  if (
    collidesWithAnswer(entry, keyEntry) ||
    readings.has(entry.reading) ||
    chosenEntries.some((chosenEntry) => collidesWithAnswer(entry, chosenEntry))
  ) {
    return false;
  }
  return !synonymPrintedByOther(entry, other.nouns);
};

/**
 * The one-sided distractors of a pair, in appearance order (every noun of the
 * first document, then every noun of the second), at most `limit` of them.
 * Excluded: the key, any noun BOTH documents print (a second defensible key),
 * any entry sharing the key's or a chosen distractor's reading, any entry whose
 * dominant English sense collides with the key's or with a distractor already
 * chosen, and any entry the OTHER document paraphrases.
 *
 * A noun printed by ONLY one document is the classic 読み比べ distractor: it is
 * true of one text, so it is wrong as the common point, and a learner who read
 * only that text has no way to rule it out.
 */
export const oneSidedNouns = (
  pair: TougouPair,
  limit: number
): readonly string[] => {
  const keyEntry = keyEntryOf(pair);
  if (keyEntry === undefined) {
    return [];
  }
  const chosen: string[] = [];
  const chosenEntries: VocabEntry[] = [];
  const readings = new Set<string>([keyEntry.reading]);
  // Both directions, because a distractor is only one-sided relative to the
  // document that does NOT print it: an option of A has to be checked against
  // B's nouns and an option of B against A's.
  const sides: readonly [TougouDocument, TougouDocument][] = [
    [pair.a, pair.b],
    [pair.b, pair.a],
  ];
  for (const [doc, other] of sides) {
    for (const [word, entry] of doc.nouns) {
      if (
        !isDistractorCandidate({
          chosen,
          chosenEntries,
          entry,
          keyEntry,
          other,
          pair,
          readings,
          word,
        })
      ) {
        continue;
      }
      readings.add(entry.reading);
      chosenEntries.push(entry);
      chosen.push(word);
      if (chosen.length >= limit) {
        return chosen;
      }
    }
  }
  return chosen;
};

/** Runes actually printed, so the pair band is measured the same way whether
 * it is screened from prepared documents or from a frozen row's passages. */
const totalRunes = (texts: readonly string[]): number =>
  texts.reduce((sum, text) => sum + [...text].length, 0);

/** The 合計600字程度 band, measured on the printed passages. The gate re-proves
 * the pair's total length here rather than trusting the generator's `runes`. */
export const pairTotalIssues = (passages: readonly string[]): string[] => {
  const total = totalRunes(passages);
  const issues: string[] = [];
  if (total < TOUGOU_MIN_TOTAL_LENGTH) {
    issues.push("pair-too-short");
  }
  if (total > TOUGOU_MAX_TOTAL_LENGTH) {
    issues.push("pair-too-long");
  }
  return issues;
};

/** The key-independent screens two paragraphs must pass to be a pair: they are
 * two different documents from two different pages, and together they sit in
 * the 合計600字程度 band. */
export const documentIssues = (
  a: TougouDocument,
  b: TougouDocument
): string[] => {
  const issues = [...pairTotalIssues([a.text, b.text])];
  if (a.id === b.id) {
    issues.push("same-document-pair");
  }
  if (a.pageId === b.pageId) {
    issues.push("same-page-pair");
  }
  return issues;
};

/** The screens a candidate key adds on top of a pairable document pair. */
export const keyIssues = ({
  a,
  b,
  byNoun,
  key,
}: {
  a: TougouDocument;
  b: TougouDocument;
  byNoun: ReadonlyMap<string, readonly number[]>;
  key: string;
}): string[] => {
  const issues: string[] = [];
  if (!(a.nouns.has(key) && b.nouns.has(key))) {
    issues.push("key-not-in-both-documents");
  }
  if (!keyIsPairSpecific(key, byNoun)) {
    issues.push("key-not-pair-specific");
  }
  return issues;
};

/** Every pair-level screen, run by the generator to skip and by the gate to
 * refuse. Empty array = the pair is admissible. */
export const pairIssues = ({
  a,
  b,
  byNoun,
  key,
}: {
  a: TougouDocument;
  b: TougouDocument;
  byNoun: ReadonlyMap<string, readonly number[]>;
  key: string;
}): string[] => [...documentIssues(a, b), ...keyIssues({ a, b, byNoun, key })];

/** The key half: non-empty and printed by both texts. */
const answerClaimIssues = ({
  answer,
  textA,
  textB,
}: {
  readonly answer: string;
  readonly textA: string;
  readonly textB: string;
}): string[] => {
  if (answer.length === 0) {
    return ["key-empty"];
  }
  if (!(textA.includes(answer) && textB.includes(answer))) {
    return ["key-not-printed-by-both"];
  }
  return [];
};

/** One distractor: no overlap with the key or an earlier option, and printed by
 * exactly one of the two texts. `seen` accumulates as the walk proceeds, so a
 * second copy of one distractor is named rather than silently deduplicated. */
const distractorClaimIssues = ({
  distractor,
  seen,
  textA,
  textB,
}: {
  readonly distractor: string;
  readonly seen: Set<string>;
  readonly textA: string;
  readonly textB: string;
}): string[] => {
  if (distractor.length === 0 || seen.has(distractor)) {
    return ["duplicate-option"];
  }
  seen.add(distractor);
  const issues: string[] = [];
  const inA = textA.includes(distractor);
  const inB = textB.includes(distractor);
  if (inA && inB) {
    issues.push("distractor-in-both-documents");
  }
  if (!(inA || inB)) {
    issues.push("distractor-in-neither-document");
  }
  return issues;
};

/**
 * The row-level screens on the PRINTED passages, against the row as it will be
 * frozen. The generator runs them on the row it is about to emit and the gate
 * runs them on the row it read back, so "the key is in both texts and every
 * distractor is in exactly one" is one test rather than two claims. Text-level
 * `includes` is deliberately stronger than the noun maps the pair was selected
 * from: an option that appears inside a longer word still counts as printed.
 */
export const rowClaimIssues = ({
  answer,
  distractors,
  passages,
}: {
  readonly answer: string;
  readonly distractors: readonly string[];
  readonly passages: readonly string[];
}): string[] => {
  const textA = passages[0] ?? "";
  const textB = passages[1] ?? "";
  const issues: string[] = [];
  if (passages.length !== 2 || textA.length === 0 || textB.length === 0) {
    issues.push("passages-not-two");
  }
  issues.push(...answerClaimIssues({ answer, textA, textB }));
  if (distractors.length !== TOUGOU_DISTRACTOR_COUNT) {
    issues.push("distractors-not-three");
  }
  const seen = new Set<string>([answer]);
  for (const distractor of distractors) {
    issues.push(...distractorClaimIssues({ distractor, seen, textA, textB }));
  }
  return issues;
};

/**
 * The paraphrase screen on an emitted row's distractors, proved against the two
 * documents rather than their printed text: a distractor the OTHER document
 * names under a synonym is defensibly 挙げられている in both, which is the defect
 * `rowClaimIssues` (a surface test) cannot see. The generator refuses such a row
 * and the gate re-proves it, so the screen is a contract, not a selection
 * preference.
 */
export const optionParaphraseIssues = ({
  a,
  b,
  distractors,
}: {
  a: TougouDocument;
  b: TougouDocument;
  distractors: readonly string[];
}): string[] => {
  const issues: string[] = [];
  for (const surface of distractors) {
    const inA = a.nouns.has(surface);
    const inB = b.nouns.has(surface);
    if (inA === inB) {
      continue;
    }
    const entry = (inA ? a.nouns : b.nouns).get(surface);
    if (entry === undefined) {
      continue;
    }
    if (synonymPrintedByOther(entry, (inA ? b : a).nouns)) {
      issues.push("distractor-paraphrased-in-other-document");
    }
  }
  return issues;
};

/** Row id for a pair. The two paragraph ids ARE the row's provenance, so a
 * regeneration of the same pair yields the same id and a judge rejection blocks
 * that pair rather than whatever replaces it. */
export const tougouIdFor = (level: string, idA: string, idB: string): string =>
  `${level.toLowerCase()}t-${idA}+${idB}`;

/** The freeze-time judge record, same shape and reason as the siblings: a
 * regeneration skips a rejected row, CI only reads the list. Missing file = no
 * rejections. */
export const readTougouRejections = (
  storeDir: string,
  level: string
): ReadonlySet<string> =>
  readRejectedIdsFrom(storeDir, `${level.toLowerCase()}-tougou-rejected.json`);

/* ---------------------------------------------------------------------------
 * THE AUTHORED ROUTE (TASK-173.9.20).
 *
 * The shared-topic-pair construction above is a lookup: its key is a noun BOTH
 * documents print, so matching surface forms answers the 小問, and LICENSE §15
 * states that as the block's weakness rather than as its design. 比較・統合 asks
 * for a relation NEITHER text states alone. A written pair can deliver that and
 * still be screened: the key is the relation sentence the two documents together
 * imply, and the distractors are each one thing the passages really say.
 * ------------------------------------------------------------------------ */

/**
 * The band ONE written document of the pair prints, per level. Only the levels
 * this block WRITES at appear; any other level is refused with
 * `authored-band-unknown` rather than measured against a borrowed band.
 *
 * 200-400 is the pair's own 合計600字程度 divided by two: the same documents
 * together still land in `TOUGOU_MIN_TOTAL_LENGTH`..`TOUGOU_MAX_TOTAL_LENGTH`,
 * which the gate re-proves on the printed pair, and the per-document floor is what
 * stops a row from padding the total with a two-sentence stub. The server budget
 * for the type is `TOUGOU_MAX_PASSAGE_LENGTH` = 802 on the JOINED stimulus
 * (`apps/server/src/services/exam-service.ts:172`), which the total band already
 * respects.
 *
 * N1 keeps the same 400 ceiling, because the ceiling is the server's budget and not
 * a level property: 300×2 plus the join is 601, still inside 802. What moves is the
 * floor, 100 runes above N2's, so an N1 document is never an N2 one by length and a
 * written N1 pair is a 600-800 rune stimulus, the register the official N1 大問11
 * pair prints (doc-26 §3.5).
 */
export const TOUGOU_AUTHORED_BAND: Readonly<Record<string, PassageBand>> = {
  N1: { max: 400, min: 300 },
  N2: { max: 400, min: 200 },
};

/** Every written document carries at least two paragraphs, so "read both and
 * relate them" is a relation between developed texts, not between two single
 * sentences. */
export const TOUGOU_AUTHORED_MIN_PARAGRAPHS = 2;

/**
 * The three 比較・統合 asks this block writes, and the ねらい name each one maps
 * to. The existing `TOUGOU_STEM` is deliberately NOT here: it is the surface
 * lookup this route replaces, and a store that kept asking it would fail
 * `stem-intent-unclassified`.
 *
 * `premise` is what both texts assume without either saying it, which is the one
 * class neither passage can answer alone; `agreement` is what both say;
 * `difference` is where the two writers part company.
 */
export const TOUGOU_AUTHORED_STEMS: Readonly<
  readonly { readonly intent: string; readonly stem: string }[]
> = [
  {
    intent: "agreement",
    stem: "二つの文章の書き手が共通して述べていることはどれか。",
  },
  {
    intent: "difference",
    stem: "二つの文章を比べて、内容が一致しないものはどれか。",
  },
  {
    intent: "premise",
    stem: "二つの文章のどちらにも共通する前提として最も適切なものはどれか。",
  },
];

/** The 比較・統合 intent a written stem asks for, or null. First match wins on
 * exact text so a near-miss stem cannot slide in under a loose substring. */
export const tougouAuthoredIntentFor = (stem: string): string | null =>
  TOUGOU_AUTHORED_STEMS.find((entry) => entry.stem === stem)?.intent ?? null;

/** The official 大問 asks its 小問 twice at N2 (`PAPER_BLOCKS.N2` 大問12), so a
 * store of 8 rows spans all three relation classes rather than printing one of
 * them repeatedly. */
export const TOUGOU_AUTHORED_MIN_INTENTS = TOUGOU_AUTHORED_STEMS.length;

/** The authored pair's own claim screen. `rowClaimIssues` above proves the
 * opposite contract (key printed by BOTH documents), so the authored branch needs
 * its own: the key is the relation and must therefore be printed by NEITHER, and
 * every distractor is one thing the texts really say and must be printed by
 * EXACTLY ONE. That is AC#3's "true in exactly one of the two passages" as far as
 * printed text can prove it; whether the lifted sentence is actually TRUE of that
 * document, and whether the relation sentence is the right one, is what the blind
 * judge passes freeze. */
export const authoredPairClaimIssues = ({
  answer,
  distractors,
  passages,
}: {
  readonly answer: string;
  readonly distractors: readonly string[];
  readonly passages: readonly string[];
}): string[] => {
  const issues: string[] = [];
  if (answer.length === 0) {
    issues.push("key-empty");
    return issues;
  }
  for (const [at, text] of passages.entries()) {
    if (text.includes(answer)) {
      issues.push(`authored-key-printed-in-document:${at}`);
    }
  }
  if (distractors.length !== TOUGOU_DISTRACTOR_COUNT) {
    issues.push("distractors-not-three");
    return issues;
  }
  for (const distractor of distractors) {
    if (distractor.length === 0) {
      issues.push("duplicate-option");
      continue;
    }
    const printedBy = passages.filter((text) => text.includes(distractor));
    if (printedBy.length === 2) {
      issues.push("distractor-in-both-documents");
    }
    if (printedBy.length === 0) {
      issues.push("distractor-in-neither-document");
    }
  }
  return issues;
};
