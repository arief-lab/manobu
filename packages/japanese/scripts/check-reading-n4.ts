/**
 * `check:reading-n4` — the deterministic CI gate for the composed N4 短文
 * store (TASK-173.9.6 AC#2). NO LLM runs here.
 *
 * This gate is the only thing that makes `validated: true` in
 * `data/reading/n4.json` mean something: the server's honesty gate
 * (`isRefused`, apps/server/src/services/exam-service.ts) trusts the flag at
 * assembly time exactly the way it trusts a licensed store row, so this
 * script re-proves offline, on every run, that each frozen row is
 *
 *   1. provenance `composed` AND `validated` AND an attributable `validatedBy`
 *      — either the authored-key contract (`opencode:<non-empty model id>`
 *      whose model is NOT the author's Gemini-family, judge independence
 *      checked rather than promised) or the masked-slot contract
 *      (`deterministic:gen-reading-n4`, a construction this gate re-proves) or the
 *      written-row contract (`authored:agent-blind-judged`, two blind passes whose
 *      verdicts this gate reads out of `n4-rejected.json`),
 *   2. sourced from EXACTLY ONE Tatoeba sentence id,
 *   3. within the short-reading passage cap (240 runes, MAX_PASSAGE_LENGTH,
 *      apps/server/src/services/exam-service.ts:153),
 *   4. structurally valid per the item-engine validator
 *      (`validateQuestionItem`, packages/item-engine/src/validation.ts:257)
 *      over a minimal corpus view: four options, index in range, options
 *      distinct (a repeated option string is the mechanically detectable
 *      form of two defensibly-correct answers), Japanese stem present.
 *
 * Two row contracts, because there are two kinds of frozen row:
 *
 *   authored key (`construction` absent) — the passage is a BYTE-EQUAL copy of
 *      its single source sentence. The old "subset of a concatenation" wording
 *      could pass a stitch-up, so equality is byte equality.
 *
 *   masked slot (`construction: "masked-slot"`) — the passage is its single
 *      source sentence with ONE content word replaced by `BLANK`, and the gate
 *      proves the whole construction rather than the shape of a signature:
 *        a. the source sentence's every word is N5+N4 vocabulary or a function
 *           word (the difficulty claim is measured, not asserted),
 *        b. putting the answer option back reproduces the source sentence byte
 *           for byte (the key comes from the source, so `restorePassage` is the
 *           proof and no model opinion is involved),
 *        c. the answer occurs exactly once in the source, so no second copy of
 *           it survives in the printed passage,
 *        d. no distractor occurs anywhere in the source sentence — a distractor
 *           already printed in the passage would be a second defensible answer,   *        e. the answer and every distractor are in-level nouns by printed form,
 *           so the four options are one category and the choice turns on
 *           meaning rather than on a form mismatch,   *        f. no distractor is corpus-plausible: no OTHER in-level sentence of
 *           the corpus fills the same context frame with that word (the
 *           frame 風が吹く does not license 冷たい into a slot the corpus
 *           shows filled by 風). Measured insurance: it fires ZERO times on
 *           the shipped batch, and 638 corpus keys hold multiple fillers,
 *           so it bites the moment a regeneration wanders into one,
 *        g. the slot is SOLVABLE from the Japanese alone (sourceEn is never
 *           served): the answer's context frame is filled by exactly ONE
 *           noun corpus-wide (`isContextSolvable`, issue
 *           `answer-context-ambiguous`). The independent-model blind judge
 *           marked 13 of the first 24 rows AMBIGUOUS/UNANSWERABLE under the
 *           served-only-Japanese condition; this clause is the
 *           deterministic form of that judge's failure mode.
 *
 * File-level: at least 4 items (one real N4 大問4 wants 4), ids and passages
 * unique (the picker spends one passage per 小問), ONE construction across the
 * whole file, and for a written store at least AUTHORED_MIN_INTENTS distinct
 * ねらい, which no single row can supply about itself.
 *
 *   authored (`construction: "authored"`, TASK-173.9.19) — a written passage and
 *      a written comprehension question, proved by the screens every 内容理解 block
 *      shares (`reading-authored-corpus.ts`): inside `TANBUN_AUTHORED_BAND.N4`, four
 *      distinct options, a stem that classifies into a known ねらい, an `evidence`
 *      sentence printed verbatim inside its own passage, no `＿＿`, and no `sourceIds`
 *      (a row that names a source while tagged authored is a corpus row buying the
 *      easier proof). What these screens cannot decide is whether the cited sentence
 *      entails the key, which is why the row's signature is the blind-judge record
 *      (`authored:agent-blind-judged`) and the verdicts are frozen data in
 *      `n4-rejected.json`, not a claim in this file.
 *
 * Run from this package: `bun run check:reading-n4`. Exit 0 = every row
 * passes; exit 1 = issues listed on stdout, or the store is not frozen yet.
 * The exported `checkReadingFile` is the test seam (fixtures live in
 * `test/check-reading-n4.test.ts`).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type EntryReport,
  readingShapeOf,
  structuralIssuesFor,
} from "./check-reading-shared";
import {
  AUTHORED_MAX_EVIDENCE_RATIO,
  AUTHORED_MIN_EVIDENCE_RUNES,
  AUTHORED_MIN_INTENTS,
  AUTHORED_SIGNER,
  type AuthoredConfig,
  authoredFileIssues,
  authoredRowIssues,
  comprehensionIntentFor,
  isAuthoredConstruction,
  mixedConstructionIssue,
} from "./reading-authored-corpus";
import {
  answerIsNamedByTranslation,
  BLANK,
  buildContextFillers,
  collidesWithAnswer,
  contentPosOf,
  countOccurrences,
  GENERATOR_SIGNER,
  isContextSolvable,
  isCorpusPlausibleDistractor,
  isInLevelSentence,
  readJudgeRejections,
  readVocabIndex,
  restorePassage,
  type SourceSentence,
  type VocabEntry,
  type VocabIndex,
} from "./reading-n4-corpus";
import { TANBUN_AUTHORED_BAND } from "./reading-tanbun-corpus";

/** Mirror of MAX_PASSAGE_LENGTH in apps/server/src/services/exam-service.ts:153. */
const MAX_PASSAGE_LENGTH = 240;

/** The 短文 block's authored configuration, the SAME one `check-reading-tanbun`
 * runs at N3, because what certifies a written 短文 is the same procedure at a
 * different band. `minParagraphs` is 0: a real 大問4 小問 prints one short
 * passage, so the screen that keeps 長文 honest would refuse the shape this block
 * is. The band comes from `TANBUN_AUTHORED_BAND`, where N4 is declared next to N3
 * and an undeclared level is refused rather than measured against a neighbour's. */
const AUTHORED_CONFIG: AuthoredConfig = {
  bandFor: (level) => TANBUN_AUTHORED_BAND[level],
  evidence: {
    maxRatio: AUTHORED_MAX_EVIDENCE_RATIO,
    minRunes: AUTHORED_MIN_EVIDENCE_RUNES,
  },
  intentFor: comprehensionIntentFor,
  minIntents: AUTHORED_MIN_INTENTS,
  minParagraphs: 0,
  optionCount: 4,
};

/** One real N4 大問4 asks 4 短文 (doc-26 §3.2 目安). */
const MIN_ITEMS = 4;

/** The only agent allowed to sign an AUTHORED-KEY freeze (TASK-173.9.6
 * judge-independence decision: author = antigravity/Gemini-family via `agy`). */
const JUDGE_AGENT = "opencode";

/** Model id fragments that belong to the AUTHOR's family. A judge signed by an
 * opencode session that resolved onto one of these is not independent of the
 * Gemini-family author, so the freeze is rejected — independence is a checked
 * fact here, not a promise in the persona. */
const AUTHOR_MODEL_FAMILY = /gemini|google|antigravity/i;

/** The reading store row shape as frozen in data/reading/n4.json. Typed
 * independently from apps/server's CorpusShortReadingEntry because
 * lib-japanese may not import the server (boundary zone). */
export interface ComposedReadingEntry {
  readonly answerIndex: number;
  readonly block: string;
  /** `masked-slot` selects the construction contract this row is judged
   * under; `authored` is a written comprehension row; absent means the
   * authored-key contract over a Tatoeba sentence. See the header. */
  readonly construction?: "authored" | "masked-slot";
  /** The deciding sentence an authored row prints verbatim inside its own
   * passage. Absent on every other construction. */
  readonly evidence?: string;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  readonly provenance?: "licensed" | "composed";
  /** The English gloss of the source sentence, carried for the human eyeball
   * pass. Not part of the proven contract and not read by the server. */
  readonly sourceEn?: string;
  readonly sourceIds?: readonly string[];
  readonly stem: string;
  readonly validated?: boolean;
  readonly validatedBy?: string;
}

export type { EntryReport } from "./check-reading-shared";

/** Is this row written rather than sourced from a corpus sentence? An untagged row
 * is NOT authored, so it falls to the corpus branch and its stricter proof: a row
 * cannot reach the easier screens by omitting the tag. */
const isAuthored = (entry: ComposedReadingEntry): boolean =>
  isAuthoredConstruction(entry.construction);

/** Parse `data/sentences/sentences.jsonl` into `id -> source sentence` (the
 * verbatim source of truth for the byte-equality and restore checks). Ids are
 * normalized to strings because the corpus stores them as JSON numbers
 * (`"id":4707`) while the store's `sourceIds` are strings; without that
 * coercion this map comes back EMPTY for the real corpus and every row fails
 * `sourceId-unknown`, which looks like a provenance problem and is not one. */
export const loadTatoebaSentences = (
  sentencesPath: string
): Map<string, SourceSentence> => {
  const byId = new Map<string, SourceSentence>();
  for (const line of readFileSync(sentencesPath, "utf8").split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const parsed = JSON.parse(line) as {
      en?: unknown;
      id?: unknown;
      jp?: unknown;
      linkedWords?: unknown;
    };
    if (
      (typeof parsed.id !== "string" && typeof parsed.id !== "number") ||
      typeof parsed.jp !== "string" ||
      typeof parsed.en !== "string" ||
      !Array.isArray(parsed.linkedWords)
    ) {
      continue;
    }
    byId.set(String(parsed.id), {
      en: parsed.en,
      id: String(parsed.id),
      jp: parsed.jp,
      linkedWords: parsed.linkedWords.filter(
        (word): word is string => typeof word === "string"
      ),
    });
  }
  return byId;
};

/** The AUTHORED-KEY signer contract: an `opencode:<model>` id whose model half
 * is not from the author's own family. Two absent codes and one present: the
 * freeze-time judge either resolved to a readable, independent model or it did
 * not certify anything. */
const judgeSignerIssues = (signer: string): string[] => {
  const judgeModel = signer.startsWith(`${JUDGE_AGENT}:`)
    ? signer.slice(JUDGE_AGENT.length + 1)
    : null;
  if (judgeModel === null || judgeModel.length === 0) {
    return ["validatedBy-missing-or-bad-form"];
  }
  if (AUTHOR_MODEL_FAMILY.test(judgeModel)) {
    return ["validatedBy-judge-model-is-author-family"];
  }
  return [];
};

/** The signature a row must carry depends only on how the row was made, so the
 * three answers live together and `checkFields` stays about identity fields. */
const signerIssues = (entry: ComposedReadingEntry): string[] => {
  const issues: string[] = [];
  const signer = entry.validatedBy ?? "";
  if (isAuthored(entry)) {
    // A written row is signed by the blind-judge record, not by the generator and
    // not by an independent model: nothing generated its key, and the human reader
    // who would have judged it independently does not exist in this repo, so the
    // only honest signature is the procedure that did run (two blind passes whose
    // verdicts freeze in `n4-rejected.json`).
    if (signer !== AUTHORED_SIGNER) {
      issues.push("validatedBy-not-authored-signer");
    }
  } else if (entry.construction === "masked-slot") {
    // A generated row is signed by the pipeline, not by a model. The
    // independence question does not arise (no model picked this key), but the
    // signature still has to be the exact string the generator writes: an
    // anonymous or hand-written signer on a row that CLAIMS to be generated
    // would let a hand-edited option pass as machine-checked.
    if (signer !== GENERATOR_SIGNER) {
      issues.push("validatedBy-missing-or-bad-form");
    }
  } else {
    return judgeSignerIssues(signer);
  }
  return issues;
};

const checkFields = (entry: ComposedReadingEntry): string[] => {
  const issues: string[] = [];
  if (entry.provenance !== "composed") {
    issues.push("provenance-not-composed");
  }
  if (entry.validated !== true) {
    issues.push("not-validated");
  }
  issues.push(...signerIssues(entry));
  if (typeof entry.id !== "string" || entry.id.length === 0) {
    issues.push("id-empty");
  }
  if (entry.level !== "N4") {
    issues.push("level-not-N4");
  }
  if (entry.block !== "naiyou-rikai-tanbun") {
    issues.push("block-not-tanbun");
  }
  if (typeof entry.stem !== "string" || entry.stem.length === 0) {
    issues.push("stem-empty");
  }
  return issues;
};

/** The single source sentence, or null with the issue already recorded. */
const singleSourceOf = (
  entry: ComposedReadingEntry,
  sentences: ReadonlyMap<string, SourceSentence>,
  issues: string[]
): SourceSentence | null => {
  const sourceIds = entry.sourceIds ?? [];
  if (sourceIds.length !== 1) {
    issues.push("sourceIds-not-single");
    return null;
  }
  const source = sentences.get(sourceIds[0] as string);
  if (source === undefined) {
    issues.push("sourceId-unknown");
    return null;
  }
  return source;
};

/** AUTHORED-KEY rows: the passage is a byte-equal copy of the source. The old
 * "subset of a concatenation" wording could pass a stitch-up. */
const checkAuthoredKey = (
  entry: ComposedReadingEntry,
  source: SourceSentence
): string[] => {
  const issues: string[] = [];
  if (entry.passage !== source.jp) {
    issues.push("passage-not-verbatim");
  }
  return issues;
};

/** Is this option an in-level noun? The gate re-derives it from the vocabulary
 * files rather than trusting a flag, so an option hand-swapped for a verb or an
 * out-of-level word cannot pass as same-category.
 *
 * Reading-index resolution is deliberate HERE and absent from the slot lookup:
 * an option is the printed form of a word the pipeline already knows, and the
 * corpus prints 君 as きみ, 込む as 込む/込む. (The blank position is the case
 * where reading-resolution is unsafe: は would resolve to 葉.) */
const isInLevelNoun = (word: string, vocab: VocabIndex): boolean => {
  const entry = vocab.byWord.get(word) ?? vocab.byReading.get(word);
  return entry !== undefined && contentPosOf(entry) === "noun";
};

const vocabEntryFor = (
  word: string,
  vocab: VocabIndex
): VocabEntry | undefined =>
  vocab.byWord.get(word) ?? vocab.byReading.get(word);

/**
 * The three distractors, screened one clause each: printed in the passage (a
 * distractor the learner can READ is a second defensible answer), in-level noun
 * (same category as the answer), and not another English label for it (the
 * mechanically detectable form of the TASK-173.9.5 defect).
 */
/** Type of the corpus-context index (see `buildContextFillers`). */
export type ContextFillers = ReadonlyMap<string, ReadonlySet<string>>;

const EMPTY_FILLERS: ContextFillers = new Map();

/** The three distractors: every option that is not the printed key. */
const distractorsOf = (entry: ComposedReadingEntry): readonly string[] =>
  entry.options.filter((_, index) => index !== entry.answerIndex);

/** A distractor the learner can READ in the source is a second defensible
 * answer, so the first one named ends the screen. */
const distractorInSourceIssues = (
  distractors: readonly string[],
  source: SourceSentence
): string[] => {
  const issues: string[] = [];
  for (const option of distractors) {
    if (source.jp.includes(option)) {
      issues.push("distractor-occurs-in-source");
      break;
    }
  }
  return issues;
};

/** Two forms of the TASK-173.9.5 defect: an option that is not even the
 * answer's word class at this level, and an option that is another English
 * label for the answer itself (警察 / 警官). */
const distractorCategoryIssues = (
  answerEntry: VocabEntry | undefined,
  distractors: readonly string[],
  vocab: VocabIndex
): string[] => {
  const issues: string[] = [];
  for (const option of distractors) {
    if (!isInLevelNoun(option, vocab)) {
      issues.push("distractor-not-in-level-noun");
      break;
    }
    const optionEntry = vocabEntryFor(option, vocab);
    if (
      answerEntry !== undefined &&
      optionEntry !== undefined &&
      collidesWithAnswer(optionEntry, answerEntry)
    ) {
      issues.push("distractor-collides-with-answer");
      break;
    }
  }
  return issues;
};

/** The corpus itself demonstrating the blank accepting another in-level noun:
 * a frame the corpus fills with this option leaves the item under-determined
 * (TASK-173.9.6 limitation #1). */
const distractorPlausibilityIssues = (
  answer: string | undefined,
  distractors: readonly string[],
  fillers: ContextFillers,
  source: SourceSentence
): string[] => {
  const issues: string[] = [];
  if (answer !== undefined) {
    for (const option of distractors) {
      if (isCorpusPlausibleDistractor(source, answer, option, fillers)) {
        issues.push("distractor-corpus-plausible");
        break;
      }
    }
  }
  return issues;
};

const checkDistractors = (
  entry: ComposedReadingEntry,
  answerEntry: VocabEntry | undefined,
  source: SourceSentence,
  vocab: VocabIndex,
  fillers: ContextFillers
): string[] => {
  const distractors = distractorsOf(entry);
  return [
    ...distractorInSourceIssues(distractors, source),
    ...distractorCategoryIssues(answerEntry, distractors, vocab),
    ...distractorPlausibilityIssues(
      entry.options[entry.answerIndex],
      distractors,
      fillers,
      source
    ),
  ];
};

/** The answer's own contract: it occurs exactly once in the source, restoring
 * the blank reproduces the source byte for byte, and the key is an in-level
 * noun the sentence's own English translation names. */
const maskedAnswerIssues = (
  answer: string,
  answerEntry: VocabEntry | undefined,
  entry: ComposedReadingEntry,
  source: SourceSentence
): string[] => {
  const issues: string[] = [];
  if (countOccurrences(source.jp, answer) !== 1) {
    issues.push("answer-not-single-in-source");
  }
  if (restorePassage(entry.passage, answer) !== source.jp) {
    issues.push("passage-not-restorable-to-source");
  }
  if (answerEntry === undefined || contentPosOf(answerEntry) !== "noun") {
    issues.push("answer-not-in-level-noun");
  } else if (!answerIsNamedByTranslation(answerEntry, source.en)) {
    // The answer must be named by the sentence's own English translation. This
    // is the screen that keeps an item measurable: a key no English word points
    // at tests whether the reader guesses, not whether they read.
    issues.push("answer-not-named-by-translation");
  }
  return issues;
};

/**
 * MASKED-SLOT rows: the passage is the source sentence with one word blanked, so
 * the gate proves the construction rather than the shape of a signature. See
 * the header for why each clause exists; each one is a defect the pipeline
 * claims to have removed.
 */
const checkMaskedSlot = (
  entry: ComposedReadingEntry,
  source: SourceSentence,
  vocab: VocabIndex,
  fillers: ContextFillers,
  rejections: ReadonlySet<string>
): string[] => {
  const issues: string[] = [];
  if (countOccurrences(entry.passage, BLANK) !== 1) {
    issues.push("passage-blank-not-single");
  }
  const answer = entry.options[entry.answerIndex];
  if (answer === undefined) {
    // The item-engine check names the bad index; nothing to prove here.
    return issues;
  }
  const answerEntry = vocabEntryFor(answer, vocab);
  issues.push(...maskedAnswerIssues(answer, answerEntry, entry, source));
  // SOLVABILITY: the passage must decide the answer from the Japanese the
  // learner actually sees (sourceEn is never served). A frame the corpus shows
  // accepting other nouns leaves the item under-determined - the independent
  // blind-judge run marked 13 of the first 24 rows exactly this way.
  if (
    answerEntry !== undefined &&
    !isContextSolvable(source, answer, vocab, fillers)
  ) {
    issues.push("answer-context-ambiguous");
  }
  if (rejections.has(entry.id)) {
    issues.push("row-judge-rejected");
  }
  issues.push(...checkDistractors(entry, answerEntry, source, vocab, fillers));
  if (!isInLevelSentence(source, vocab)) {
    issues.push("source-not-in-level");
  }
  return issues;
};

const checkProvenanceAgainstSource = (
  entry: ComposedReadingEntry,
  sentences: ReadonlyMap<string, SourceSentence>,
  vocab: VocabIndex,
  fillers: ContextFillers,
  rejections: ReadonlySet<string>
): string[] => {
  const issues: string[] = [];
  if (isAuthored(entry)) {
    // A written passage is not a copy of anything, so the restore-to-source proof
    // has no target and the authored screens are the whole row-level argument. They
    // refuse `sourceIds` for exactly that reason: a row that names a source while
    // tagged authored is a corpus row buying the easier proof.
    return [
      ...authoredRowIssues(entry, "N4", AUTHORED_CONFIG, rejections),
      ...issues,
    ];
  }
  const source = singleSourceOf(entry, sentences, issues);
  if (source === null) {
    return issues;
  }
  issues.push(
    ...(entry.construction === "masked-slot"
      ? checkMaskedSlot(entry, source, vocab, fillers, rejections)
      : checkAuthoredKey(entry, source))
  );
  if ([...entry.passage].length > MAX_PASSAGE_LENGTH) {
    issues.push("passage-too-long");
  }
  return issues;
};

/** One frozen row: identity + provenance fields, byte-equal sourcing, then
 * the item-engine structural validator. Returns the issue codes; empty = ok. */
export const checkEntry = (
  entry: ComposedReadingEntry,
  sentences: ReadonlyMap<string, SourceSentence>,
  vocab: VocabIndex,
  fillers: ContextFillers = EMPTY_FILLERS,
  rejections: ReadonlySet<string> = new Set()
): string[] => [
  ...checkFields(entry),
  ...checkProvenanceAgainstSource(entry, sentences, vocab, fillers, rejections),
  ...structuralIssuesFor({
    itemType: "short-reading",
    maxPassageLength: MAX_PASSAGE_LENGTH,
    row: readingShapeOf(entry),
  }),
];

/** Cross-row checks the file can only make by remembering the rows already read:
 * one 大問 must print distinct ids, distinct passages and distinct ANSWERS, and a
 * written store must spread its ねらい across the file. Mutates `seen`, returns the
 * issue codes this row contributes. */
const crossRowIssues = (
  entry: ComposedReadingEntry,
  seen: {
    answers: Set<string>;
    ids: Set<string>;
    intents: Set<string>;
    passages: Set<string>;
  }
): string[] => {
  const issues: string[] = [];
  if (seen.ids.has(entry.id)) {
    issues.push("duplicate-id");
  }
  seen.ids.add(entry.id);
  if (seen.passages.has(entry.passage)) {
    issues.push("duplicate-passage");
  }
  seen.passages.add(entry.passage);
  // Distinct passages are not distinct QUESTIONS: Tatoeba holds several
  // sentences about the same 部屋, and a 大問4 that printed three of them
  // would ask the same question three times wearing different clothes.
  const answer = entry.options[entry.answerIndex];
  if (answer !== undefined) {
    if (seen.answers.has(answer)) {
      issues.push("duplicate-answer");
    }
    seen.answers.add(answer);
  }
  if (isAuthored(entry)) {
    const intent = comprehensionIntentFor(entry.stem);
    if (intent !== null) {
      seen.intents.add(intent);
    }
  }
  return issues;
};

/** The whole gate over one store file. File-level: >= MIN_ITEMS rows, unique
 * ids, unique passages (the picker spends one passage per 小問), ONE construction
 * across the file, and for a written store a ねらい spread no single row can supply. */
export const checkReadingFile = (
  storePath: string,
  sentencesPath: string,
  vocab: VocabIndex
): EntryReport[] => {
  const entries = JSON.parse(
    readFileSync(storePath, "utf8")
  ) as readonly ComposedReadingEntry[];
  // The Tatoeba frame-filler index is only a proof for a row that masks a corpus
  // sentence, and reading that corpus is the expensive part of this gate. An
  // authored store never asks for it, so it is not paid for.
  const windowed = entries.some((entry) => !isAuthored(entry));
  const sentences = windowed ? loadTatoebaSentences(sentencesPath) : new Map();
  const fillers = windowed
    ? buildContextFillers([...sentences.values()], vocab)
    : EMPTY_FILLERS;
  const rejections = readJudgeRejections(join(storePath, ".."));
  const reports: EntryReport[] = [];

  const seen = {
    answers: new Set<string>(),
    ids: new Set<string>(),
    intents: new Set<string>(),
    passages: new Set<string>(),
  };
  for (const entry of entries) {
    reports.push({
      entryId: entry.id,
      issues: [
        ...checkEntry(entry, sentences, vocab, fillers, rejections),
        ...crossRowIssues(entry, seen),
      ],
    });
  }
  if (entries.length < MIN_ITEMS) {
    reports.push({
      entryId: "(file)",
      issues: [`too-few-items:${entries.length}<${MIN_ITEMS}`],
    });
  }
  const fileIssues: string[] = [];
  // Two constructions in one file would let a corpus row take the authored
  // branch's easier proof, since neither branch can prove the other's property.
  const mixed = mixedConstructionIssue(entries);
  if (mixed !== null) {
    fileIssues.push(mixed);
  }
  if (entries.some(isAuthored)) {
    fileIssues.push(...authoredFileIssues(seen.intents, AUTHORED_CONFIG));
  }
  if (fileIssues.length > 0) {
    reports.push({ entryId: "(file)", issues: fileIssues });
  }
  return reports;
};

const packageDataDir = (): string => join(import.meta.dir, "..", "data");

if (import.meta.main) {
  const storePath = join(packageDataDir(), "reading", "n4.json");
  const sentencesPath = join(packageDataDir(), "sentences", "sentences.jsonl");
  let reports: EntryReport[];
  try {
    reports = checkReadingFile(
      storePath,
      sentencesPath,
      readVocabIndex(packageDataDir())
    );
  } catch (error) {
    console.error(
      `check:reading-n4 cannot read the store: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
  const failing = reports.filter((report) => report.issues.length > 0);
  if (failing.length === 0) {
    console.log(`check:reading-n4: all ${reports.length} rows pass`);
    process.exit(0);
  }
  for (const report of failing) {
    for (const issue of report.issues) {
      console.log(`${report.entryId}: ${issue}`);
    }
  }
  process.exit(1);
}
