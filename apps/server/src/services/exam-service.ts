import { createHash, randomUUID } from "node:crypto";

import {
  type ChatFrame,
  type ExamAnswerOutput,
  type ExamBuildReceipt,
  type ExamDebrief,
  type ExamDisputeOutput,
  type ExamItem,
  type ExamProgress,
  type ExamRequest,
  type ExamResult,
  ExamResultSchema,
  type ExamScoringSectionId,
  type ExamSectionId,
  type ExamSectionMetadata,
  type ExamState,
  examSectionLabelForMode,
} from "@manobu/api-contract";
import {
  createItemStore,
  type ItemForClient,
  type ItemResolution,
  type ItemStore,
  itemStimuliForClient,
  SPEAKING_ITEM_TYPES,
  type StoredExamAnswer,
  type ExamState as StoredExamState,
  type UserDatabase,
} from "@manobu/db/item-store";
import { conversations, messages } from "@manobu/db/schema/user";
import {
  type AllocatedPaperBlock,
  allocatePaperMix,
  assemblePaper,
  PAPER_LEVELS,
  PAPER_SECTION_IDS,
  type PaperAssemblyResult,
  type PaperCandidate,
  type PaperItemTypeCounts,
  type PaperRequest,
  type PaperSectionId,
  paperBlockInstruction,
  paperBlocksForLandedItems,
  paperBlueprintFor,
  paperModeLabel,
  paperScoringFloorStatus,
  paperUnfillableBlocks,
  validatePaperRequest,
} from "@manobu/item-engine/paper";
import {
  ITEM_TYPES,
  type ItemCorpusView,
  type ItemSurface,
  type ItemType,
  type QuestionItem,
  type Stimulus,
} from "@manobu/item-engine/types";
import { and, eq, sql } from "drizzle-orm";
import { type ChatContext, hubFor, publishFrame, resetHub } from "../chat-hub";
import { examTokenSplitter } from "./content-tokenizer";
import {
  anchorLabelsFor,
  bunshouStoreFor,
  type CorpusGrammarEntry,
  type CorpusShortReadingEntry,
  type CorpusVocabEntry,
  choubunStoreFor,
  claimUnderstandingStoreFor,
  type ExamCorpus,
  examCorpus,
  fullSensesOf,
  goseikeiStoreFor,
  grammarAnchorFor,
  hyoukiStoreFor,
  iikaeSentenceStoreFor,
  iikaeStoreFor,
  isDistinctSurfaceEntry,
  isVerbEntry,
  jouhouStoreFor,
  kiteiStoreFor,
  listeningChoukaiStoreFor,
  listeningGaiyouStoreFor,
  listeningHatsuwaStoreFor,
  listeningKadaiStoreFor,
  listeningPointStoreFor,
  listeningSokujiStoreFor,
  mediumReadingStoreFor,
  partsOfSpeechOf,
  senseGroupsOf,
  shortReadingStoreFor,
  synonymsOf,
  tougouStoreFor,
  usageStoreFor,
  vocabAnchorFor,
} from "./exam-corpus";
import {
  type MaskResult,
  maskFragmentSpan,
  maskRealization,
  maskWord,
  type TokenSplitter,
} from "./exam-mask";

export type ExamServiceErrorCode =
  | "CONFLICT"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "NOT_READY";

export class ExamServiceError extends Error {
  readonly code: ExamServiceErrorCode;

  constructor(
    code: ExamServiceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ExamServiceError";
    this.code = code;
  }
}

export type ExamGetUserDb = () => Promise<UserDatabase>;

type PaperFrameData = Extract<ChatFrame, { type: "paper" }>["data"];

export interface ExamService {
  abandon: (examId: string, context?: ChatContext) => Promise<ExamState>;
  advanceSection: (input: {
    examId: string;
    section?: ExamSectionId;
  }) => Promise<ExamState>;
  answer: (input: {
    examId: string;
    itemId: string;
    selectedIndex: number;
  }) => Promise<ExamAnswerOutput>;
  assemble: (
    examId: string,
    context?: ChatContext
  ) => Promise<ExamBuildReceipt>;
  debrief: (examId: string) => Promise<ExamDebrief>;
  dispute: (input: {
    examId: string;
    itemId: string;
  }) => Promise<ExamDisputeOutput>;
  get: (examId: string) => Promise<ExamState>;
  pause: (examId: string) => Promise<ExamState>;
  request: (input: unknown) => Promise<ExamBuildReceipt>;
  result: (examId: string) => Promise<ExamResult>;
  resume: (examId: string) => Promise<ExamState>;
  review: (examId: string) => Promise<ExamDebrief>;
  start: (examId: string, context?: ChatContext) => Promise<ExamState>;
  status: (examId: string) => Promise<ExamProgress>;
  submit: (examId: string, context?: ChatContext) => Promise<ExamState>;
}

export interface ExamServiceOptions {
  now?: () => Date;
}

const MAX_TOTAL_SLOTS = 240;
const MAX_CANDIDATES_PER_TYPE = 64;
/** Slots a type asks for beyond its allocation, to absorb candidates the
 * validator rejects before the paper is assembled. See `candidateCountFor`. */
const REJECTED_CANDIDATE_RESERVE = 2;
/** How many times `assemble` will rebuild the candidate catalog for one paper,
 * doubling the reserve each time, before it reports the shortfall it could not
 * fill. */
const MAX_FILL_ATTEMPTS = 3;
const MAX_PASSAGE_LENGTH = 240;
const LONG_READING_MAX_PASSAGE_LENGTH = 1200;
/** TASK-173.9.2: a 中文 passage is multi-sentence (白書 excerpt), so it uses the
 * long-reading length budget while filling its own 大問. */
const MEDIUM_READING_MAX_PASSAGE_LENGTH = 1200;
const LONG_READING_PASSAGE =
  "長い文章を通して、出来事の順番や関係を確認します。段落の意図を捉え、質問に合わせて根拠を整理してください。";
// TASK-132: an N1 integrated reading item depends on several passages around one
// theme, and the budget covers the whole set.
const INTEGRATED_READING_MAX_PASSAGE_LENGTH = 2400;
/** TASK-173.9.3: a 統合理解 item prints a PAIR of 白書 documents whose official
 * budget is 合計600字程度. The store's own gate caps the pair at 800 runes, and
 * the engine measures the JOINED stimulus (`stimulusPassageText`), so this budget
 * is that cap plus the blank line between the two documents. */
const TOUGOU_MAX_PASSAGE_LENGTH = 802;
/**
 * TASK-173.9.13: 情報検索 prints ONE 情報素材, and the official N2/N1 ねらい
 * budgets it at 700字程度, so the block cannot live under `MAX_PASSAGE_LENGTH`.
 * It had no entry here at all before this, which means every 素材 was measured
 * against the 240-rune default: the licensed N5 notices (which N4 and N3 used to
 * copy) carry two rows of 243 and two of 245 runes, and
 * `validateStimulusLength` refused those four silently, so a paper could only ever
 * draw on 8 of the 12 notices it had. The new sourced N2/N1 rows sit in the
 * 600-800 band their gate freezes them to.
 */
const JOUHOU_MAX_PASSAGE_LENGTH = 800;
/**
 * TASK-173.9.24: 文章の文法 prints ONE short 文章, and the official sample papers
 * run it to ~320 runes at N1. The budget is the TOP of the band `check:bunshou`
 * freezes the shipped rows to, so a row inside the official shape is always
 * servable: measured against the 240-rune default, `validateStimulusLength` would
 * refuse the longer ones SILENTLY, which is exactly the trap 情報検索 fell into
 * (four of its twelve licensed notices were invisible to the walk for a 3-rune
 * overhang). The rows shipped today top out at 221 runes, so the default happens
 * to cover them; this constant is what stops that from being an accident the next
 * time the store is topped up.
 */
const BUNSHOU_MAX_PASSAGE_LENGTH = 320;
const INTEGRATED_READING_PASSAGES = [
  "港の東には、かつて印刷所だった古い建物が残っている。今は作業場として使われている。",
  "一階には喫茶店があり、店主は港の古い写真を見せてくれる。",
  "その写真に写っているのは、十年も前の港である。現在の景色とは少し違う。",
] as const;
const INTEGRATED_LISTENING_SCRIPT =
  "特別講演の録音です。講演者は、社会人向けの学び直しが、まだ必要だと話しています。";
const INTEGRATED_LISTENING_PASSAGE =
  "講演の要点をまとめた資料が、参加者に配布されました。";
const MAX_REQUEST_CACHE = 128;
const NOT_FOUND_ERROR = /does not exist|not found/i;
const INVALID_REQUEST_ERROR =
  /must|requires|invalid|select one|not in exam|unsupported|only compose/i;
const NOT_READY_ERROR = /not ready|not in progress|still a draft/i;
const CONFLICT_ERROR =
  /not in draft|submitted|abandoned|active section|already|cannot|paused|time is up/i;

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);

const isLevel = (value: string): value is (typeof PAPER_LEVELS)[number] =>
  PAPER_LEVELS.some((level) => level === value);

const isSection = (value: string): value is PaperSectionId =>
  PAPER_SECTION_IDS.some((section) => section === value);

const isExamSurface = (value: ItemSurface): value is "exam" | "checkpoint" =>
  value === "exam" || value === "checkpoint";

const totalSlots = (request: PaperRequest): number =>
  Object.values(request.budget).reduce((total, count) => total + count, 0);

const REQUEST_KEYS = new Set([
  "budget",
  "conversationId",
  "focus",
  "level",
  "mode",
  "sections",
  "seed",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rejectUnknownRequestKeys = (input: unknown): void => {
  if (!isRecord(input)) {
    return;
  }
  for (const key of Object.keys(input)) {
    if (!REQUEST_KEYS.has(key)) {
      throw new ExamServiceError(
        "INVALID_REQUEST",
        `unknown paper request field: ${key}`
      );
    }
  }
};

const requestedConversationId = (input: unknown): string | null => {
  if (!isRecord(input) || typeof input.conversationId !== "string") {
    return null;
  }
  return input.conversationId.trim() || null;
};

const parseRequest = (input: unknown): PaperRequest => {
  rejectUnknownRequestKeys(input);
  const requestInput =
    isRecord(input) && input.seed === undefined
      ? { ...input, seed: `generated-${randomUUID()}` }
      : input;
  const parsed = validatePaperRequest(requestInput);
  if (!parsed.ok) {
    throw new ExamServiceError(
      "INVALID_REQUEST",
      parsed.errors.join("; ") || "invalid paper request"
    );
  }
  const { request } = parsed;
  if (totalSlots(request) > MAX_TOTAL_SLOTS) {
    throw new ExamServiceError(
      "INVALID_REQUEST",
      `paper requests may contain at most ${MAX_TOTAL_SLOTS} slots`
    );
  }
  return request;
};

const toContractRequest = (request: PaperRequest): ExamRequest => ({
  budget: { ...request.budget },
  focus: [...request.focus],
  level: request.level,
  mode: request.mode,
  sections: [...request.sections],
  seed: request.seed,
});

const contractFloor = (request: PaperRequest) => {
  const floor = paperScoringFloorStatus(request);
  return {
    floors: floor.floors.map((entry) => ({ ...entry })),
    scoring: floor.scoring,
  };
};

const toLevel = (value: string): (typeof PAPER_LEVELS)[number] => {
  if (!isLevel(value)) {
    throw new ExamServiceError(
      "INVALID_REQUEST",
      `stored exam has an unsupported level: ${value}`
    );
  }
  return value;
};

const toSection = (value: string): PaperSectionId => {
  if (!isSection(value)) {
    throw new ExamServiceError(
      "INVALID_REQUEST",
      `stored exam has an unsupported section: ${value}`
    );
  }
  return value;
};

const toSectionOrNull = (value: string | null): PaperSectionId | null =>
  value === null ? null : toSection(value);

const readyForStatus = (status: StoredExamState["status"]): boolean =>
  status === "ready" || status === "in_progress" || status === "submitted";

const elapsedMs = (from: string | null, to: string): number =>
  from === null ? 0 : Math.max(0, Date.parse(to) - Date.parse(from));

const sectionTiming = (
  section: StoredExamState["sections"][number],
  at: string
) => {
  if (section.status !== "in_progress") {
    return {
      paused: false,
      pausedMs: section.pausedMs,
      remainingSeconds: null,
    };
  }
  const activeMs = section.activeMs + elapsedMs(section.timerStartedAt, at);
  const remainingSeconds =
    section.timeLimitSeconds === null
      ? null
      : Math.max(
          0,
          Math.ceil((section.timeLimitSeconds * 1000 - activeMs) / 1000)
        );
  return {
    paused: section.pausedAt !== null,
    pausedMs: section.pausedMs + elapsedMs(section.pausedAt, at),
    remainingSeconds,
  };
};

const uniqueStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
};

/** TASK-138: one sourced candidate, ready to assemble. Every field comes
 * from the corpus: `anchorId` is a canonical anchor that the corpus view
 * can resolve, and `distractors` are same-family surfaces rather than a
 * hand-picked triple. */
/**
 * TASK-138 AC#10: how a bare-gloss item got its wrong options. This exists
 * because AC#10 was being CLOSED BY ASSERTION when it is only closed for part of
 * the corpus.
 *
 * A word is one word. ~56% of entries have a single sense group, and for those
 * there is no other group to draw a real distractor from - manufacturing one with
 * SENZA/TAWA/WordNet would reconstruct ambiguity that the reading filter
 * correctly deleted. The picker therefore DECLINES those anchors and emits a
 * different item type instead.
 *
 * But a declined anchor leaves no trace in the assembled paper - it simply is
 * not there. So "how much of the corpus can actually produce a testable item" is
 * unanswerable from the paper alone, and the only record that can answer it is
 * written at sourcing time. Per item, the way TASK-142 records an unverified
 * mask rather than claiming a verification that did not happen.
 */
type SourcingCase =
  /** A distractor came from another sense group of the same entry. Testable. */
  | "from-own-group"
  /** No other group existed, so the same-POS pool filled the slots. This is the
   * 入口:いりぐち -> "entrance | salt | yellow" shape, and the case declining
   *   single-group anchors was built to eliminate. */
  | "same-pos-pool"
  /** A single-group anchor admitted by the exhaustion fallback, so the paper
   * still fills its budget. The honest third case: better one weak item than a
   * short paper. */
  | "single-group-fallback";

/** The two degenerate cases that fill a slot only by widening away from the
 * entry's own sense group. TASK-173.1 AC#3: the real mode refuses to fabricate,
 * so a distractor set that needed one of these does not count as authentic
 * content. `from-own-group` is the testable case and stays. */
const isFallbackSourcing = (sourcingCase: SourcingCase | undefined): boolean =>
  sourcingCase === "same-pos-pool" || sourcingCase === "single-group-fallback";

interface CandidateSource {
  readonly anchorId: string;
  /** The text that identifies WHICH entry is being asked about. Without it
   * every item is unanswerable: a prompt reading "choose the correct
   * reading" over four words names no word. The first assembled corpus items
   * had exactly that bug, and the validator could not see it, because
   * single-correct-answer is not answerability. */
  readonly cue: string;
  readonly distractors: readonly string[];
  /** TASK-173.6: the four sentence fragments in SLOT order (the order they
   * occupy in the original example, not the scrambled option order), for a
   * star-ordering item. The region they cover is the span the passage blanks.
   * Absent for every other type. */
  readonly fragments?: readonly string[];
  readonly level: string;
  /** The reading passage the item is answered from, verbatim from its reading
   * store: a 短文 (`TASK-173.7`), a 中文 (173.9.2), a 主張理解 (173.9.2 slice 2), a
   * 情報検索 notice (173.9.7) or a 長文 window (173.9.12). Absent for every other
   * type, whose context is either masked from a sentence (`passage` is derived) or
   * a stimulus example, and that absence is what keeps a flat `long-reading` item
   * on `LONG_READING_PASSAGE`. */
  readonly passage?: string;
  /** TASK-173.9.3: the TWO documents a `text-comparison` item is answered from,
   * verbatim from the 統合理解 store, in pair order. A 統合理解 小問 has no single
   * passage: the comparison IS the pair, so both texts travel together and the
   * singular `passage` column stays unused. Absent for every other type. */
  readonly passages?: readonly string[];
  /** The grammar pattern, for a grammar-backed source. TASK-142 masks its
   * trailing literal out of the stimulus; null for a vocabulary source. */
  readonly pattern: string | null;
  /** TASK-173.9.5: how a reading item's unit was obtained. `licensed` is verbatim
   * from a third-party item corpus (the N5 stores) and is trusted unconditionally;
   * `composed` is Japanese this repo assembled itself, either an AUTHORED passage
   * written for the block with its ねらい in the stem or a masked slot blanked out
   * of a pinned source paragraph. Either way its answer key has NOT been proven by
   * the corpus, so `real` mode must refuse it unless `validated`, exactly as it
   * refuses a fallback-sourced distractor. Absent (undefined) for every other
   * type, whose honesty is carried by `sourcingCase` instead. */
  readonly provenance?: "licensed" | "composed";
  /** Which distractor strategy produced this item's wrong options. Only
   *  meaningful for gloss-family items. */
  readonly sourcingCase?: SourcingCase;
  /** TASK-173.6: the index into `fragments` whose surface the ★ marks, so the
   * item's answer is `fragments[starSlot]`. Absent for every other type. */
  readonly starSlot?: number;
  /** A real example sentence from the grammar entry, when the source is a
   * grammar point. Listening scripts and grammar contexts come from here. */
  readonly stimulus: CorpusGrammarEntry["examples"][number] | null;
  readonly target: string;
  /** TASK-173.9.5 AC#2: a `composed` short-reading whose answer key passed the
   * offline distractor-falsification pass. Only `composed` + `validated` serves
   * a real paper; a composed-but-unvalidated one is refused exactly as an
   * unproven distractor is. Absent (undefined) for every other type. */
  readonly validated?: boolean;
}

const candidateItem = async ({
  anchorId,
  examId,
  index,
  itemType,
  request,
  section,
  source,
  split,
}: {
  anchorId: string;
  examId: string;
  index: number;
  itemType: QuestionItem["itemType"];
  request: PaperRequest;
  section: PaperSectionId;
  source: CandidateSource;
  split: TokenSplitter;
}): Promise<QuestionItem> => {
  const options = [source.target, ...source.distractors];
  const presentation = await candidatePresentationFor({
    itemType,
    section,
    source,
    split,
  });
  return {
    anchors: [anchorId],
    answerIndex: 0,
    // No exam item carries an explanation: nothing in this repo authors exam
    // prose (TASK-145 is parked), so a stub here reached the learner as the
    // review row's "Generated from {anchor}" text and as the replayed drill's
    // why-answer panel (TASK-137). `explanationGenerated` derives from this
    // column, so null is also the honest false on both surfaces.
    explanation: null,
    fsrsVocabId: null,
    id: `paper-${digest(
      `${examId}:${request.seed}:${anchorId}:${section}:${itemType}:${index}`
    )}`,
    itemType,
    level: request.level,
    // TASK-142: the masking record travels with the item, so a reviewer can
    // see WHICH items could not be masked rather than inferring it from a
    // passage that happens to show the answer.
    mask: presentation.mask,
    options,
    passage: presentation.passage,
    prompt: candidatePromptFor(itemType, source.cue),
    script: presentation.script,
    seedPart: request.seed,
    stem: candidateStemFor({
      cue: source.cue,
      itemType,
      mode: request.mode,
    }),
    stimuli: presentation.stimuli,
    surface: "exam",
  };
};

/** What the learner is shown alongside the options, by section and type. A
 * grammar-backed item in a reading section carries the example sentence as its
 * context, and a listening item carries it as the spoken script - a real
 * sentence from the corpus in both cases. The placeholder string that used to
 * stand in for the context shipped for months precisely because nothing
 * sourced one (doc-21 §2). */
/**
 * TASK-173.6: the 文の組み立て mask — the whole four-fragment region blanked
 * with the ★ slot marked. The region is the joined fragments and its context
 * is read back off the example, which the source's reconstruction gate
 * guarantees sits inside it; null when no context reads back, the same decline
 * the inline branch carried. Split out of `candidatePresentationFor` to keep
 * that chain inside the cognitive-complexity gate; the branch decides only
 * WHETHER to ask for this mask.
 */
const starOrderingMaskFor = async ({
  example,
  fragments,
  split,
  starSlot,
}: {
  example: string;
  fragments: readonly string[];
  split: TokenSplitter;
  starSlot: number | undefined;
}): Promise<MaskResult | null> => {
  const context = spanContextOf(example, fragments.join(""));
  if (context === null) {
    return null;
  }
  return await maskFragmentSpan({
    fragments,
    prefix: context.prefix,
    sentence: example,
    split,
    starSlot: starSlot ?? 0,
    suffix: context.suffix,
  });
};

/** TASK-173.9.3: 統合理解 prints its pair as two `stimuli` and nothing else: no
 * singular passage, no mask, no script. `candidateStimuli` returns an empty array
 * for a source that lost its pair, and an empty array would render as a 小問 with
 * no text to read, so it is reported as `null` instead. */
const textComparisonPresentationFor = (
  stimuli: readonly Stimulus[]
): {
  mask: null;
  passage: null;
  script: null;
  stimuli: readonly Stimulus[] | null;
} => ({
  mask: null,
  passage: null,
  script: null,
  stimuli: stimuli.length > 0 ? stimuli : null,
});

/** The four columns one candidate prints. Extracted from
 * `candidatePresentationFor` so the per-family chain in that function stays the
 * only thing it holds: the listening script and the stimulus list are a property
 * of the item type, not of which source backed the item. */
const presentationFor = ({
  example,
  isListening,
  mask,
  passage,
  stimuli,
}: {
  example: string | null;
  isListening: boolean;
  mask: MaskResult | null;
  passage: string | null;
  stimuli: readonly Stimulus[];
}): {
  mask: MaskResult | null;
  passage: string | null;
  script: string | null;
  stimuli: readonly Stimulus[] | null;
} => ({
  mask,
  passage,
  script: isListening ? example : null,
  stimuli: stimuli.length > 0 ? stimuli : null,
});

/** The item types whose passage is the source's own store text, printed whole
 * with no masking. The 情報検索, 用法, 文章の文法, 表記, 語形成, 言い換え類義,
 * 中文, and 短文 stores all
 * carry their passage as the item's material, so this branch keeps each one off
 * `LONG_READING_PASSAGE` and the complexity stays one branch per store-passage
 * type. `short-reading` and `medium-reading` use destructuring because their
 * mutation anchors pin that shape; `info-search`, `usage`, `discourse-cloze` and
 * `word-spelling` use plain property reads because theirs do the same. */
const STORE_PASSAGE_TYPES: ReadonlySet<QuestionItem["itemType"]> = new Set([
  // TASK-173.9.26: 語形成 prints its authored sentence (the compound's fragment
  // beside the （　） blank) as the 小問's material, exactly as 表記 prints its
  // kana sentence. Omit it here and the passage stays null, `validateStimuli`
  // rejects the candidate against `compound-completion`'s minPassages 1, and the
  // whole 大問 lands as a silent shortfall rather than filling.
  "compound-completion",
  // TASK-173.9.29: 文脈規定 at N3/N2/N1 prints its authored sentence with its
  // （　） blank as the 小問's material, exactly as 語形成 prints its sentence.
  // The DERIVED N4/N5 cloze is unaffected: its source carries no `passage` at
  // all, `wholePassageFor` returns null for it, and it keeps taking the
  // `maskWord` route; the two paths cannot meet in this set.
  "context-cloze",
  "discourse-cloze",
  "info-search",
  // TASK-173.9.28: 言い換え類義 at N4/N5 prints its authored sentence (the whole
  // ぶん the paper underlines) as the 小問's material, exactly as 表記 prints its
  // kana sentence. Omit it here and the passage stays null, `validateStimuli`
  // rejects the candidate against `sentence-paraphrase`'s minPassages 1, and the
  // whole 大問 lands as a silent shortfall rather than filling.
  "sentence-paraphrase",
  // TASK-173.9.27: 言い換え類義 prints its authored sentence (one word quoted
  // inside 「」) as the 小問's material, exactly as 語形成 prints its compound
  // sentence. Omit it here and the passage stays null, `validateStimuli`
  // rejects the candidate against `synonym-paraphrase`'s minPassages 1, and the
  // whole 大問 lands as a silent shortfall rather than filling.
  "synonym-paraphrase",
  // TASK-173.9.25: 表記 prints its authored sentence (the kana word quoted inside
  // 「」) as the 小問's material, exactly as 文章の文法 prints its 文章. Omit it here
  // and the passage stays null, `validateStimuli` rejects the candidate against
  // `word-spelling`'s minPassages 1, and the whole 大問 lands as a silent
  // shortfall rather than filling.
  "usage",
  "word-spelling",
]);

const candidatePresentationFor = async ({
  itemType,
  section,
  source,
  split,
}: {
  itemType: QuestionItem["itemType"];
  section: PaperSectionId;
  source: CandidateSource;
  split: TokenSplitter;
}): Promise<{
  mask: MaskResult | null;
  passage: string | null;
  script: string | null;
  stimuli: readonly Stimulus[] | null;
}> => {
  const isListening = LISTENING_ITEM_TYPES.has(itemType);
  const stimuli = candidateStimuli(itemType, source);
  const example = source.stimulus?.japanese ?? null;
  if (itemType === "text-comparison") {
    // TASK-173.9.3: 統合理解 has no singular passage. The pair travels as the TWO
    // `stimuli` passages, and one document is not the reading a 比較・統合 小問 can
    // be answered from, so this branch prints the pair, masks nothing, and never
    // falls through to `LONG_READING_PASSAGE` (AC#3). Returning here rather than
    // leaving the two columns untouched keeps the fall-through impossible.
    return textComparisonPresentationFor(stimuli);
  }
  const passage = wholePassageFor(itemType, source);
  if (passage !== null) {
    return presentationFor({
      example,
      isListening,
      mask: null,
      passage,
      stimuli,
    });
  }
  const mask = await maskFor({ example, itemType, section, source, split });
  return presentationFor({
    example,
    isListening,
    mask,
    passage: mask?.masked ?? null,
    stimuli,
  });
};

/** The 読解 types whose printed material is the source's own passage, whole and
 * unmasked, with the comprehension question riding in `stem`: 短文
 * (TASK-173.7 AC#3 - the branch that keeps a real 短文 off
 * `LONG_READING_PASSAGE`), 主張理解 (TASK-173.9.x slice 2 AC#3), printed whole,
 * and 中文 (TASK-173.9.2 AC#3), printed with a masked slot. The 情報検索 and
 * 用法 素材 get the same guarantee from `STORE_PASSAGE_TYPES` (TASK-173.9.7 /
 * TASK-173.9.23): the lookup question rides in `stem`, and neither family ever
 * falls through to the canned text. */
const PRINTED_WHOLE_TYPES: ReadonlySet<QuestionItem["itemType"]> = new Set([
  "claim-understanding",
  "medium-reading",
  "short-reading",
]);

/** The whole-text passage this item type prints, or null when the item is not
 * store-backed and its passage comes from a mask (or from nothing).
 * `long-reading` is the one type that ALWAYS prints a passage: a REAL-mode 長文
 * prints its own sourced 白書 window, verbatim from
 * `data/reading/n1-choubun.json`, exactly as a 中文 or a 短文 does, and the
 * `??` is what keeps a FLAT paper on the canned text: a flat mix weights
 * `long-reading` 20 and sources it from the grammar pool, whose candidate
 * carries no `passage` at all, so the fallback is the flat path itself and the
 * two modes cannot be confused from here (TASK-173.9.12 AC#6). */
const wholePassageFor = (
  itemType: QuestionItem["itemType"],
  source: CandidateSource
): string | null => {
  if (itemType === "long-reading") {
    // This return is the `long-reading-falls-back-to-canned-passage` anchor.
    return source.passage ?? LONG_READING_PASSAGE;
  }
  if (source.passage === undefined) {
    return null;
  }
  return PRINTED_WHOLE_TYPES.has(itemType) || STORE_PASSAGE_TYPES.has(itemType)
    ? source.passage
    : null;
};

/** The blank this item prints, or null when nothing is masked. The mask
 * branches keep their historical order and guards: the 文脈規定 blank is the
 * answer word and gates on the ITEM TYPE, not the section (TASK-173.5: it
 * lives in the VOCABULARY section at N3-N5, where the grammar-reading mask
 * below would never fire); the star blanks the WHOLE four-fragment region and
 * marks the ★ slot, and its helper owns the region/context read-back,
 * returning null when no context reads back and leaving the item unmasked
 * exactly as before (TASK-173.6); and the grammar-reading mask fires only in
 * the reading context, the only place a learner can read the answer off the
 * page - a listening script is never sent to the client (TASK-132), so
 * masking it would cost the audio its meaning and buy nothing. */
const maskFor = async ({
  example,
  itemType,
  section,
  source,
  split,
}: {
  example: string | null;
  itemType: QuestionItem["itemType"];
  section: PaperSectionId;
  source: CandidateSource;
  split: TokenSplitter;
}): Promise<MaskResult | null> => {
  if (example === null) {
    return null;
  }
  const { fragments } = source;
  if (itemType === "context-cloze" && source.target) {
    return await maskWord({ sentence: example, split, word: source.target });
  }
  if (itemType === "star-ordering" && fragments && fragments.length > 0) {
    return await starOrderingMaskFor({
      example,
      fragments,
      split,
      starSlot: source.starSlot,
    });
  }
  if (section === "grammar-reading" && source.pattern) {
    return await maskRealization({
      pattern: source.pattern,
      sentence: example,
      split,
    });
  }
  return null;
};

/**
 * TASK-173.2 AC#2: the Japanese line a real paper prints for this 小問, or null
 * when the paper prints no line this item does not already carry.
 *
 * The paper's own division of labour decides the shape: the instruction
 * sentence is printed once per 大問 (`paperBlockInstruction`), and a 小問 is
 * material rather than a question. So this returns the material, and only where
 * no other column already shows it. A 漢字読み item's material is the word
 * whose reading is asked for, and nothing else on the row carries it (`prompt`
 * buries it in English), so it is quoted the way the paper quotes a cited word.
 * A grammar item's material is the sentence with its （ ）, which is already
 * `passage`, and a listening item's material is a recording that never reaches
 * the page.
 *
 * The daily modes get null deliberately: they ask in `prompt`, and a bare
 * quoted word with no instruction above it would leave a learner guessing.
 */
/**
 * The item types whose cue is a real 小問's own printed Japanese line.
 *
 * TASK-173.7/173.9.2/173.9.x/173.9.7/173.9.3/173.9.12/173.9.23/173.9.24: the
 * reading item's comprehension question is already the item's own Japanese
 * line, sourced verbatim, so a real 小問 prints it as-is (not quoted the way
 * a 漢字読み cites its word). The passage is the material above it; the
 * question is this line. `long-reading` is in this set because it stopped
 * being a canned-passage type the moment its store froze: with no stem a
 * 長文 小問 would print four nouns and no question to answer. `usage` is in
 * this set because a real 用法 小問 prints the stem sentence and its own
 * Japanese question, so the cue IS the printed line (TASK-173.9.23).
 * `discourse-cloze` prints the official 文章の文法 instruction line, which is
 * the whole question: the four candidate sentences are the options and the
 * blank sits in the passage. `word-spelling` prints the official 表記
 * instruction line the same way: the four spellings are the options and
 * the kana word sits in the sentence (TASK-173.9.25). `compound-completion`
 * prints the official 語形成 instruction line the same way again: the four
 * single kanji are the options and the compound's fragment sits beside the
 * （　） in the sentence (TASK-173.9.26). `synonym-paraphrase` prints the
 * official 言い換え類義 instruction line the same way once more: the four
 * paraphrases are the options and the 「　」-bracketed word sits in the
 * sentence (TASK-173.9.27). `sentence-paraphrase` prints that line's N4/N5
 * whole-ぶん form (TASK-173.9.28). `text-comparison` prints the pair's own
 * comparison question (TASK-173.9.3), `claim-understanding` its argument
 * question, `medium-reading` and `short-reading` theirs.
 * `listening-kadai/point/hatsuwa/sokuji/choukai/gaiyou` print the row's own
 * Japanese question the same way (TASK-173.8.1): the scenario
 * is heard, never printed, and this line is what the page carries.
 * `context-cloze` prints the official 文脈規定 instruction line from its store
 * row at N3/N2/N1 (TASK-173.9.29); the derived N4/N5 cloze carries an empty cue
 * and `candidateStemFor` drops it, so that path is unchanged by this set.
 */
const STEM_CUE_ITEM_TYPES: ReadonlySet<QuestionItem["itemType"]> = new Set([
  "claim-understanding",
  "compound-completion",
  "context-cloze",
  "discourse-cloze",
  "info-search",
  "listening-choukai",
  "listening-gaiyou",
  "listening-hatsuwa",
  "listening-kadai",
  "listening-point",
  "listening-sokuji",
  "long-reading",
  "medium-reading",
  "sentence-paraphrase",
  "short-reading",
  "synonym-paraphrase",
  "text-comparison",
  "usage",
  "word-spelling",
]);

const candidateStemFor = ({
  cue,
  itemType,
  mode,
}: {
  cue: string;
  itemType: QuestionItem["itemType"];
  mode: PaperRequest["mode"];
}): string | null => {
  if (mode !== "real" || cue.length === 0) {
    return null;
  }
  if (itemType === "kanji-reading") {
    return `「${cue}」`;
  }
  return STEM_CUE_ITEM_TYPES.has(itemType) ? cue : null;
};

/** TASK-138 AC#2: the item type decides what is being asked, therefore
 * which half of the entry is the answer, therefore what the prompt must name.
 * A reading question's answer is a gloss, a kana question's answer is a word;
 * asking the same question of both is what made the old items
 * interchangeable, and leaving the cue out of the prompt is what made them
 * unanswerable. */
/** The English prompt line one item type prints. A cue-taking builder quotes
 * the word or pattern being asked about; a cue-less one names the task,
 * because for those types the cue would repeat material already on the row. */
type PromptBuilder = (cue: string) => string;

/** One prompt per item type, the answerability rule of TASK-138 AC#2 written
 * once per family instead of one switch arm per type. A type with no entry
 * falls to the gloss prompt below. */
const PROMPT_BUILDERS = new Map<QuestionItem["itemType"], PromptBuilder>([
  ["kanji-reading", (cue) => `Choose the correct reading of ${cue}.`],
  ["conjugation", (cue) => `Choose the word written as ${cue}.`],
  // No cue: the sentence travels as `passage` with the word blanked, and a
  // prompt that echoed it would put the answer back on the page.
  ["context-cloze", () => "Choose the word that best completes the sentence."],
  // No cue either: the four fragments ARE the options, the blanked sentence
  // is the `passage`, and the ★ over one cell is the only thing naming which
  // slot is asked. Restating any of that in the prompt would leak it.
  [
    "star-ordering",
    () =>
      "Put the fragments in order to build the sentence. Choose the one that fits ★.",
  ],
  // TASK-173.9.3: a real 統合理解 小問 prints BOTH documents and its own
  // Japanese question (`stem`), so this English line never reaches a real
  // paper. A stored row still carries a prompt, and it names the comparison
  // the 小問 actually asks rather than echoing the Japanese question into it.
  [
    "text-comparison",
    () => "Read both texts and choose the one that appears in both.",
  ],
  // A real reading item prints the passage and its Japanese comprehension
  // question (`stem`), so this English line never reaches a real 小問. A
  // stored item still carries a prompt, and echoing the whole Japanese
  // question into it would be noise, so it names the task once, no cue.
  [
    "claim-understanding",
    () => "Read the passage and choose the answer that matches its content.",
  ],
  [
    "info-search",
    () => "Read the passage and choose the answer that matches its content.",
  ],
  [
    "medium-reading",
    () => "Read the passage and choose the answer that matches its content.",
  ],
  [
    "short-reading",
    () => "Read the passage and choose the answer that matches its content.",
  ],
  // TASK-173.9.24: a real 文章の文法 小問 prints the passage with its ＿＿ and
  // the official Japanese instruction line, so this English line never reaches
  // a real paper. The ねらい is 文章の流れに合った文 (which SENTENCE fits the flow
  // of the passage), so the daily-mode prompt names that and nothing more.
  [
    "discourse-cloze",
    () => "Read the passage and choose the sentence that fits the blank.",
  ],
  // TASK-173.9.23: a real 用法 小問 prints the stem sentence (`passage`)
  // and its own Japanese question (`stem`), so this English line never
  // reaches a real paper. A stored item still carries a prompt; the 用法
  // ねらい is どの用いが正しい (which usage is correct), so the daily-mode
  // prompt names the task without echoing the Japanese.
  ["usage", () => "Choose the grammatical form that completes the sentence."],
  // TASK-173.9.25: a real 表記 小問 prints the authored sentence with its
  // kana word and the official Japanese instruction line (`stem`), so this
  // English line never reaches a real paper. The ねらい is 記号で表された
  // 語の正しい表記 (how the printed word is written), so the daily-mode
  // prompt names that without echoing the Japanese.
  ["word-spelling", () => "Choose how the word printed in kana is written."],
  // TASK-173.9.26: a real 語形成 小問 prints the authored sentence with the
  // compound's fragment beside the （　） and the official Japanese
  // instruction line (`stem`), so this English line never reaches a real
  // paper. The ねらい is 文脈に合った复合語を完成させる漢字 (which kanji
  // completes the compound), so the daily-mode prompt names that without
  // echoing the Japanese.
  ["compound-completion", () => "Choose the kanji that completes the word."],
  // TASK-173.9.27: a real 言い換え類義 小問 prints the authored sentence
  // with its 「　」-bracketed word and the official Japanese instruction
  // line (`stem`), so this English line never reaches a real paper. The
  // ねらい is 出題される語や表現と意味的に近い語や表現を問う (which offered
  // expression is meaning-close to the printed one), so the daily-mode
  // prompt names that without echoing the Japanese.
  [
    "synonym-paraphrase",
    () => "Choose the meaning closest to the word in brackets.",
  ],
  // TASK-173.9.28: the same ねらい printed at a shorter length. A real N4/N5
  // 言い換え類義 小問 underlines the WHOLE ぶん and offers four complete
  // sentences, so the paper's own Japanese instruction line (`stem`) is
  // again the whole question and this English line never reaches one. The
  // daily-mode prompt names what is asked (which offered SENTENCE says the
  // same thing) without echoing the Japanese.
  [
    "sentence-paraphrase",
    () =>
      "Choose the sentence that means about the same as the one underlined.",
  ],
  ["grammar-form", (cue) => `Choose the pattern that completes: ${cue}`],
  ["particle", (cue) => `Choose the pattern that completes: ${cue}`],
  ["reading-info", (cue) => `Choose the pattern that completes: ${cue}`],
  ["listening-detail", () => "Choose the phrase heard in the recording."],
  ["integrated-listening", () => "Choose the phrase heard in the recording."],
  // TASK-173.8.1: a real 聴解 小問 prints the row's Japanese question
  // (`stem`) and plays the scenario, so this English line never reaches a
  // real paper. A stored item still carries a prompt, and it names the
  // listening task without echoing the Japanese question.
  [
    "listening-choukai",
    () => "Listen to the recording and choose the correct answer.",
  ],
  [
    "listening-gaiyou",
    () => "Listen to the recording and choose the correct answer.",
  ],
  [
    "listening-hatsuwa",
    () => "Listen to the recording and choose the correct answer.",
  ],
  [
    "listening-kadai",
    () => "Listen to the recording and choose the correct answer.",
  ],
  [
    "listening-point",
    () => "Listen to the recording and choose the correct answer.",
  ],
  [
    "listening-sokuji",
    () => "Listen to the recording and choose the correct answer.",
  ],
]);

/** The default: a vocabulary gloss item asks WHICH MEANING, with the cited
 * word named. Leaving the cue out of the prompt is what made the old items
 * unanswerable (TASK-138 AC#2). */
const glossPromptFor: PromptBuilder = (cue) => `Choose the meaning of ${cue}.`;

const candidatePromptFor = (
  itemType: QuestionItem["itemType"],
  cue: string
): string => (PROMPT_BUILDERS.get(itemType) ?? glossPromptFor)(cue);

/**
 * TASK-132: the integrated types declare the stimulus set they owe, and the
 * single-stimulus types keep using the singular columns.
 *
 * TASK-173.9.3: 統合理解 is the first REAL item type with a stimulus set, and it
 * comes from the source rather than from a constant. `text-comparison` prints
 * the pair's two documents verbatim, so a level with no sourced pair returns an
 * empty list here and the block comes up short; reusing
 * `INTEGRATED_READING_PASSAGES` would put canned text behind a 比較・統合
 * question, which is the fabrication AC#2 forbids.
 */
const candidateStimuli = (
  itemType: QuestionItem["itemType"],
  source: CandidateSource
): readonly Stimulus[] => {
  if (itemType === "text-comparison") {
    const { passages } = source;
    if (passages === undefined || passages.length !== 2) {
      return [];
    }
    return passages.map((text) => ({ kind: "passage", text }));
  }
  if (itemType === "integrated-reading") {
    return INTEGRATED_READING_PASSAGES.map((text) => ({
      kind: "passage",
      text,
    }));
  }
  if (itemType === "integrated-listening") {
    return [
      { kind: "script", text: INTEGRATED_LISTENING_SCRIPT },
      { kind: "passage", text: INTEGRATED_LISTENING_PASSAGE },
    ];
  }
  return [];
};

type PaperBlueprintSection = ReturnType<
  typeof paperBlueprintFor
>["sections"][number];

/** TASK-173.6: what a star item needs to prove its answer is unique. The four
 * fragments in SLOT order, the example sentence they reconstruct, and the index
 * the ★ marks. Kept in the catalog so the write-time `satisfies` seam can test
 * whether another fragment could also fill the blank (AC#4). */
interface StarFragmentRecord {
  readonly fragments: readonly string[];
  readonly sentence: string;
  readonly starSlot: number;
}

interface CandidateCatalogState {
  anchorLevels: Map<string, string>;
  candidates: PaperCandidate[];
  /** TASK-173.9.4.2: 聴解統合理解's ordinal cursor within one 大問. The walk
   * builds this 大問's slots in index order and the picker runs synchronously
   * in that order, so the cursor records how many of the block's 小問 have been
   * served; the next slot is the next 小問 of the open script (二つの質問),
   * advancing to the next unspent script when the group is done. Optional so
   * the fourteen other catalog stubs stay untouched. */
  choukaiCursor?: number;
  /** Anchors the walk DECLINED for bare-gloss items, keyed by anchor id. A
   * declined anchor leaves no trace in the assembled paper - it simply is not
   * there - so without this record "how much of the corpus can actually produce
   * a testable item" is unanswerable from the paper alone. */
  declinedAnchors: Set<string>;
  /** TASK-148 AC#4: a family whose UNSEEN pool was empty while this paper still
   * wanted items from it. The paper is short because the level has nothing new
   * left to ask, which is a different fact from "unseen content exists but could
   * not be made into a testable item" - the old failure mode - and only the
   * first one is worth telling the learner about. */
  exhaustedFamilies: Set<SourceFamily>;
  /** TASK-173.6: the fragments and ★ slot behind each star item, so `satisfies`
   * can refuse an item whose fragments admit a second valid reassembly. Keyed by
   * item id; only star items have an entry. */
  fragmentRecords: Map<string, StarFragmentRecord>;
  /** TASK-173.1 AC#3/#4: sections where a REAL paper had a candidate it refused
   * to use. A refusal is the opposite diagnosis from `exhaustedFamilies`: the
   * content was there and the mode turned it down, while exhaustion says the level
   * has nothing new left. The two must not share a flag, or a real paper tells the
   * learner they have run the level dry when what happened is that the paper
   * declined to fabricate. */
  refusedSections: Set<PaperSectionId>;
  /** TASK-148 AC#1: the anchors this learner's level has already been SHOWN,
   * loaded once per build from the exam rows. `usedVocabWords` and
   * `usedGrammarIds` above spend within one paper; this spends across them, and
   * it is what makes a retry ask something new. Keyed by anchor, so a second
   * reading of a word the learner already met under another reading can still
   * back an item - the within-paper rule is word-level because variety inside
   * one section is the point, and the across-paper rule is anchor-level because
   * that is what the durable record actually says was served. */
  seenAnchors: ReadonlySet<string>;
  /** Per-item distractor provenance for gloss items, keyed by item id. See
   * `SourcingCase`. In-memory for now; persisting it onto the stored exam is a
   * migration and should be decided on its own. */
  sourcingCases: Map<string, SourcingCase>;
  targetByItemId: Map<string, string>;
  /** TASK-173.9.24: 文章の文法 passages already spent in this paper. Same rule as
   * `usedUsagePassages`: a real 文章の文法 大問 prints one cloze passage per 小問,
   * so spending the PASSAGE text (not the row id) is what stops the same short
   * 文章 backing two 小問 of one paper. Keyed by text because a learner recognises
   * the passage, not the id. */
  usedBunshouPassages: Set<string>;
  /** TASK-173.9.12: 長文 windows already spent in this paper. Same rule as
   * `usedMediumReadingPassages`: a real 内容理解（長文） 大問 prints one window per
   * 小問, so spending the window is what stops the same text backing two 小問.
   * Keyed by the window TEXT rather than the row id, because the window is what a
   * learner would recognise as the same reading. */
  usedChoubunPassages: Set<string>;
  /** TASK-173.9.x slice 2: 主張理解 passages already spent in this paper. Same rule
   * as `usedMediumReadingPassages`: a real 主張理解 大問 prints one passage per
   * 小問, so spending the passage is what stops the same text backing two. */
  usedClaimUnderstandingPassages: Set<string>;
  /** TASK-138 AC#4: vocabulary entries already spent in this paper. A
   * reading item and a meaning item draw from differently filtered pools, so
   * without this the same word can back both and a short section shows it
   * twice. Keyed by WORD, not by anchor: N5 carries 698 entries for 638
   * distinct words, so 行く arrives under both いく and ゆく, and an
   * anchor-keyed spend would let one word back two items with different
   * readings. Variety inside one section is the point, and the pools are
   * 600-odd entries, so spending is never scarce. */
  /** TASK-140: grammar focus anchors already spent in this paper. */
  usedFocusAnchors: Set<string>;
  /** TASK-173.9.26: 語形成 sentences already spent in this paper. Same rule as
   * `usedHyoukiSentences`: a real 語形成 大問 prints one authored sentence per
   * 小問, so spending the SENTENCE text is what stops the same 文 backing two
   * 小問 of one paper. Keyed by text because a learner recognises the sentence,
   * not the id. */
  usedGoseikeiSentences: Set<string>;
  /** TASK-138 AC#9: grammar points already spent in this paper. A WORD is
   * spent once by AC#4, but nothing stopped two ITEM TYPES from spending the
   * same grammar POINT: in the TASK-144 baseline the `particle` and
   * `reading-info` items shared `grammar:masu-polite-verb`, the same sentence
   * and the same answer, so the paper asked one question twice. Same shape as
   * the word set, and it is also what lets TASK-140's focus prior track a
   * grammar anchor without a special case. */
  usedGrammarIds: Set<string>;
  /** TASK-173.9.25: 表記 sentences already spent in this paper. Same rule as
   * `usedBunshouPassages`: a real 表記 大問 prints one authored sentence per
   * 小問, so spending the SENTENCE text is what stops the same 文 backing two
   * 小問 of one paper. Keyed by text because a learner recognises the sentence,
   * not the id. */
  usedHyoukiSentences: Set<string>;
  /** TASK-173.9.28: 言い換え類義 whole sentences already spent in this paper. Same
   * rule as `usedIikaeSentences`: a real N4/N5 言い換え類義 大問 prints one authored
   * ぶん per 小問, so spending the SENTENCE text is what stops the same ぶん
   * backing two 小問 of one paper. Keyed by text because a learner recognises
   * the sentence, not the id. */
  usedIikaeSentenceSentences: Set<string>;
  /** TASK-173.9.27: 言い換え類義 sentences already spent in this paper. Same
   * rule as `usedGoseikeiSentences`: a real 言い換え類義 大問 prints one authored
   * sentence per 小問, so spending the SENTENCE text is what stops the same 文
   * backing two 小問 of one paper. Keyed by text because a learner recognises
   * the sentence, not the id. */
  usedIikaeSentences: Set<string>;
  /** TASK-173.9.7: 情報検索 documents already spent in this paper. Same rule as
   * `usedShortReadingPassages`: one document backs the 小問 asked against it, and
   * every store holds two questions per document, so an unspent 素材 would
   * let the same timetable back two 小問 of one 大問. */
  usedJouhouPassages: Set<string>;
  /** TASK-173.9.29: 文脈規定 sentences already spent in this paper. Same rule as
   * `usedIikaeSentences`: a real 文脈規定 大問 prints one authored sentence per
   * 小問, so spending the SENTENCE text is what stops the same 文 backing two
   * 小問 of one paper. Keyed by text because a learner recognises the sentence,
   * not the id. */
  usedKiteiPassages: Set<string>;
  /** TASK-173.8.1: 聴解 scenarios already spent in this paper, shared across the
   * five 大問 (TASK-173.9.4.1 adds 概要理解). Same rule as
   * `usedShortReadingPassages`: one heard script backs
   * the 小問 asked on it, so spending the SCENARIO text is what stops the same
   * dialogue backing two 小問 of one paper — even in different blocks, because
   * a learner who heard it once has already answered it. */
  usedListeningScenarios: Set<string>;
  /** TASK-173.9.2: 中文 passages already spent in this paper. Same rule as
   * `usedShortReadingPassages`: a real 内容理解（中文） 大問 prints one passage
   * per 小問, so spending the passage is what stops the same text backing two. */
  usedMediumReadingPassages: Set<string>;
  /** TASK-173.7: 短文 passages already spent in this paper. Keyed by PASSAGE
   * text, not by entry id: the store holds two questions per passage, and a real
   * 内容理解（短文） 大問 prints one passage per 小問, so spending the passage is
   * what stops the same reading text backing two 小問 in one paper. */
  usedShortReadingPassages: Set<string>;
  /** TASK-173.9.3: 統合理解 pairs already spent in this paper. Keyed by BOTH
   * document texts, because the unit of a 比較・統合 小問 is the pair: two slots
   * may print the same two documents in either order, and may not print them at
   * all once spent. */
  usedTougouPairs: Set<string>;
  /** TASK-173.9.23: 用法 stem sentences already spent in this paper. One usage
   * stem must not back two 小問 of one 大問, and the spend keys on the stem
   * sentence, which is the unit the 大問 prints. */
  usedUsagePassages: Set<string>;
  usedVocabWords: Set<string>;
}

/** TASK-138 AC#2: which corpus family an item type draws from, and which
 * half of the entry is the answer.
 *
 * `word` families are answered by a gloss (sense[0]); `reading` families by
 * the word itself, given the reading; `grammar` families by the pattern,
 * with a real example sentence as the context or the spoken script. A
 * conjugation item is a RECOGNITION item (given the reading, choose the
 * word), because producing conjugated forms needs a conjugator that only the
 * jlpt-mcp crate has (doc-21 §8) and inventing forms here would put wrong
 * Japanese in a learner's hands. */
type SourceFamily =
  | "bunshou"
  | "chuushou"
  | "cloze"
  | "gloss"
  | "goseikei"
  | "grammar"
  | "hyouki"
  | "iikae"
  | "iikae-sentence"
  | "kensaku"
  | "listening-choukai"
  | "listening-gaiyou"
  | "listening-hatsuwa"
  | "listening-kadai"
  | "listening-point"
  | "listening-sokuji"
  | "medium"
  | "reading"
  | "short"
  | "star"
  | "tougou"
  | "usage"
  | "verb";

const SOURCE_FAMILY_BY_ITEM_TYPE: Readonly<
  Record<QuestionItem["itemType"], SourceFamily>
> = {
  "claim-understanding": "chuushou",
  // TASK-173.9.26: 語形成 is served whole-row from the N2 語形成 store, like
  // 表記, never derived from a vocab surface.
  "compound-completion": "goseikei",
  conjugation: "verb",
  "context-cloze": "cloze",
  "discourse-cloze": "bunshou",
  "grammar-form": "grammar",
  "info-search": "kensaku",
  "integrated-listening": "grammar",
  "integrated-reading": "grammar",
  "kana-cell": "reading",
  "kanji-reading": "reading",
  // TASK-173.9.4.2: 聴解統合理解 is served whole-row from its own N2 store,
  // like the other 聴解 blocks, never derived from a vocab/grammar surface.
  "listening-choukai": "listening-choukai",
  "listening-detail": "grammar",
  // TASK-173.9.4.1: 概要理解 is served whole-row from its own N3 store, like the
  // other four 聴解 blocks, never derived from a vocab/grammar surface.
  "listening-gaiyou": "listening-gaiyou",
  "listening-hatsuwa": "listening-hatsuwa",
  // TASK-173.8.1: the four N4/N5 聴解 blocks are served whole-row from their own
  // per-level spoken-scenario stores, like the reading blocks above, never derived
  // from a vocab/grammar surface. Each block is its own family so the walk can
  // spend one scenario per 大問 without crossing one into another.
  "listening-kadai": "listening-kadai",
  "listening-point": "listening-point",
  "listening-sokuji": "listening-sokuji",
  "long-reading": "grammar",
  "medium-reading": "medium",
  particle: "grammar",
  "reading-info": "grammar",
  // TASK-173.9.28: the 言い換え類義 sentence form at N4/N5 is served whole-row
  // from its own store, like the word form at N1/N2/N3, never derived from a
  // vocab surface.
  "sentence-paraphrase": "iikae-sentence",
  "short-reading": "short",
  "star-ordering": "star",
  // TASK-173.9.27: 言い換え類義 is served whole-row from the per-level 言い換え
  // store, like 語形成, never derived from a vocab surface.
  "synonym-paraphrase": "iikae",
  "text-comparison": "tougou",
  usage: "usage",
  "word-in-context": "gloss",
  // TASK-173.9.25: 表記 is served whole-row from the per-level 表記 store, like
  // 文章の文法, never derived from a vocab surface.
  "word-spelling": "hyouki",
};

/** Which half of an entry each family offers as its answer, and which
 * entries can supply it. Tables rather than nested ternaries, so a new family
 * is one row in each. `grammar` has no vocabulary surface: it is served by
 * grammarPoolFor instead. `star` likewise: its answer is a corpus example's
 * fragment, served by starSourceFor. */
const SURFACE_BY_FAMILY: Readonly<
  Record<SourceFamily, (entry: CorpusVocabEntry) => string | undefined>
> = {
  // A 文章の文法 answer is the option drawn from the discourse-cloze store, never
  // a vocab surface: `discourseClozeSourceFor` picks it directly.
  bunshou: () => undefined,
  // A 主張理解（長文） item is a whole sourced passage+question, never derived
  // from a vocabulary entry, so no vocab entry passes this filter.
  chuushou: () => undefined,
  // A cloze's answer is the WORD itself: the sentence holds it, the learner
  // picks it back out. `word` is byte-exact against the recorded target, so the
  // answer oracle needs no gloss logic and never reads English.
  cloze: (entry) => entry.word,
  // The answer is a RENDERING of the first sense group, read from `senses` and
  // never from the summary. `meaning` is a ";"-joined string, and JMdict glosses
  // contain ";" inside parentheses, so parsing it mangles the primary gloss:
  // アウト is "out (of a ball; in tennis, etc.)" and the summary parse yields
  // "out (of a ball" - a wrong ANSWER, not a wrong distractor. Reading group 0
  // also makes the answer independent of the summary's cap.
  gloss: (entry) => entry.senses?.[0]?.[0] ?? fullSensesOf(entry)[0],
  // A 語形成 answer is the single kanji drawn from the 語形成 store, never a
  // vocab surface: `goseikeiSourceFor` picks it directly.
  goseikei: () => undefined,
  grammar: () => undefined,
  // A 表記 answer is the spelling drawn from the 表記 store, never a vocab
  // surface: `hyoukiSourceFor` picks it directly.
  hyouki: () => undefined,
  // A 言い換え類義 answer is the paraphrase drawn from the 言い換え store, never
  // a vocab surface: `iikaeSourceFor` picks it directly.
  iikae: () => undefined,
  // A 言い換え類義 sentence-form answer is one of the four whole sentences drawn
  // from its own store, never a vocab surface: `iikaeSentenceSourceFor` picks it
  // directly.
  "iikae-sentence": () => undefined,
  // A 情報検索 answer is the option drawn from the licensed notice store, never a
  // vocab surface: `infoSearchSourceFor` picks it directly.
  kensaku: () => undefined,
  // A 聴解統合理解 answer is the option drawn from the N2 long-dialogue store,
  // never a vocab surface: `listeningChoukaiSourceFor` picks it directly.
  "listening-choukai": () => undefined,
  // A 概要理解 answer is the option drawn from the N3 monologue store, never a
  // vocab surface: `listeningGaiyouSourceFor` picks it directly.
  "listening-gaiyou": () => undefined,
  "listening-hatsuwa": () => undefined,
  // TASK-173.8.1: a 聴解 answer is one of the four options drawn from the
  // per-level spoken-scenario store, never a vocab surface: each block's
  // `listeningKadaiSourceFor` / `listeningPointSourceFor` /
  // `listeningHatsuwaSourceFor` / `listeningSokujiSourceFor` /
  // `listeningGaiyouSourceFor` picks it directly.
  "listening-kadai": () => undefined,
  "listening-point": () => undefined,
  "listening-sokuji": () => undefined,
  // A 中文 answer is the option drawn from the reading store, never a vocab
  // surface: `mediumReadingSourceFor` picks it directly.
  medium: () => undefined,
  reading: (entry) => entry.reading,
  // The short-reading answer is the option drawn from the reading store, never a
  // vocab surface: `shortSourceFor` picks it directly, so this family has no entry
  // half to render.
  short: () => undefined,
  star: () => undefined,
  // A 統合理解 answer is the option drawn from the pair store, never a vocab
  // surface: `tougouSourceFor` picks it directly.
  tougou: () => undefined,
  // A 用法 answer is the target grammatical form drawn from the licensed usage
  // store, never a vocab surface: `usageSourceFor` picks it directly.
  usage: () => undefined,
  verb: (entry) => entry.word,
};

/** A reading question names the word and offers readings, so the word must be
 * written in kanji and differ from its own reading; a conjugation needs a verb
 * as well (see `isDistinctSurfaceEntry`). */
const POOL_FILTER_BY_FAMILY: Readonly<
  Record<SourceFamily, (entry: CorpusVocabEntry) => boolean>
> = {
  // A 文章の文法 item is a whole authored passage plus its four candidate
  // sentences, never derived from a vocabulary entry, so no vocab entry passes
  // this filter. The walk declines it until `discourseClozeSourceFor` owns the
  // source (TASK-173.9.24).
  bunshou: () => false,
  // A 主張理解（長文） item is a whole authored passage+question from the reading
  // store, never derived from a vocabulary entry, so no vocab entry passes this
  // filter. The walk declines it until `claimUnderstandingSourceFor` owns the
  // source.
  chuushou: () => false,
  // A cloze needs a part of speech to draw same-POS distractors from; an
  // entry with no tag cannot tell a noun blank from a verb blank.
  cloze: (entry) => partsOfSpeechOf(entry).length > 0,
  gloss: (entry) => fullSensesOf(entry).length > 0,
  // A 語形成 item is a whole authored sentence plus its four single-kanji
  // options from the 語形成 store, never derived from a vocabulary entry, so no
  // vocab entry passes this filter. The walk declines it until
  // `goseikeiSourceFor` owns the source (TASK-173.9.26).
  goseikei: () => false,
  grammar: () => false,
  // A 表記 item is a whole authored sentence plus its four spellings from the
  // 表記 store, never derived from a vocabulary entry, so no vocab entry passes
  // this filter. The walk declines it until `hyoukiSourceFor` owns the source
  // (TASK-173.9.25).
  hyouki: () => false,
  // A 言い換え類義 item is a whole authored sentence plus its four paraphrases
  // from the 言い換え store, never derived from a vocabulary entry, so no vocab
  // entry passes this filter. The walk declines it until `iikaeSourceFor` owns
  // the source (TASK-173.9.27).
  iikae: () => false,
  // A 言い換え類義 sentence item is a whole authored ぶん plus its four
  // re-said ぶん from its own store, never derived from a vocabulary entry, so no
  // vocab entry passes this filter. The walk declines it until
  // `iikaeSentenceSourceFor` owns the source (TASK-173.9.28).
  "iikae-sentence": () => false,
  // A 情報検索 item is a whole sourced notice plus one lookup question from the
  // licensed store, never derived from a vocabulary entry, so no vocab entry
  // passes this filter. The walk declines it until `infoSearchSourceFor` owns the
  // source (TASK-173.9.7).
  kensaku: () => false,
  // A 聴解統合理解 item is a whole heard long dialogue plus its four options
  // from the N2 store, never derived from a vocabulary entry. The walk declines
  // it until `listeningChoukaiSourceFor` owns the source.
  "listening-choukai": () => false,
  // A 概要理解 item is a whole heard monologue plus its four options from the N3
  // store, never derived from a vocabulary entry, so no vocab entry passes this
  // filter. The walk declines it until `listeningGaiyouSourceFor` owns the source.
  "listening-gaiyou": () => false,
  "listening-hatsuwa": () => false,
  // TASK-173.8.1: a 聴解 item is a whole spoken scenario plus its four options
  // from the per-level store, never derived from a vocabulary entry, so no vocab
  // entry passes this filter. The walk declines it until each block's
  // `listeningKadaiSourceFor` / `listeningPointSourceFor` /
  // `listeningHatsuwaSourceFor` / `listeningSokujiSourceFor` /
  // `listeningGaiyouSourceFor` owns the source.
  "listening-kadai": () => false,
  "listening-point": () => false,
  "listening-sokuji": () => false,
  // A 中文 item is a whole sourced passage+question, never derived from a
  // vocabulary entry, so no vocab entry passes this filter.
  medium: () => false,
  reading: (entry) => isDistinctSurfaceEntry(entry),
  // A short-reading item is a whole authored passage+question from the reading
  // store, never derived from a vocabulary entry, so no vocab entry passes this
  // filter. The walk declines it until `shortReadingSourceFor` owns the source
  // (TASK-173.7).
  short: () => false,
  // A star item is built from a grammar example sentence, never a vocabulary
  // entry, so no vocab entry passes this filter. The walk declines it until
  // starSourceFor owns the source (TASK-173.6).
  star: () => false,
  // A 統合理解 item is a whole sourced PAIR plus its comparison question, never
  // derived from a vocabulary entry, so no vocab entry passes this filter. The
  // walk declines it until `tougouSourceFor` owns the source (TASK-173.9.3).
  tougou: () => false,
  // A 用法 item is a whole licensed pattern row plus its three authored wrong
  // forms, never derived from a vocabulary entry, so no vocab entry passes this
  // filter. The walk declines it until `usageSourceFor` owns the source
  // (TASK-173.9.23).
  usage: () => false,
  verb: (entry) => isVerbEntry(entry) && isDistinctSurfaceEntry(entry),
};

const MAX_DISTRACTORS = 3;

/** TASK-173.6: the 文の組み立て shape asks for exactly four fragments, and a
 * fragment longer than three tokens stops being a "fragment" and reads as a
 * clause, so a sentence whose middle will not divide into four ≤3-token pieces
 * is declined rather than forced. */
const STAR_FRAGMENT_COUNT = MAX_DISTRACTORS + 1;
const STAR_MAX_FRAGMENT_TOKENS = 3;

/** The sentence-ending tokens. A star fragment may never carry one into a
 * non-final slot (guidebook rule ②), and the whole blank region may never
 * contain one, so these are the glyphs the split refuses to move. */
const STAR_PERIOD_TOKENS: readonly string[] = ["。", "．"];

/** Read a blanked region back out of its sentence: where the joined fragments
 * sit, and the printed context on either side of them. Null when the region is
 * not a substring at all, which the source's reconstruction gate makes
 * impossible for a valid candidate, so a null here is a caller bug, never a
 * content case that ships. */
const spanContextOf = (
  sentence: string,
  span: string
): { prefix: string; suffix: string } | null => {
  if (span.length === 0) {
    return null;
  }
  const index = sentence.indexOf(span);
  if (index === -1) {
    return null;
  }
  return {
    prefix: sentence.slice(0, index),
    suffix: sentence.slice(index + span.length),
  };
};

/** The types whose answer is heard rather than read, so their options are
 * spoken sentences and their prompt names nothing. TASK-173.8.1 adds the four
 * 聴解 大問 types whose scenario is the store row's `passage`, served as the
 * `script` stimulus. */
const LISTENING_ITEM_TYPES: ReadonlySet<QuestionItem["itemType"]> = new Set([
  "integrated-listening",
  "listening-choukai",
  "listening-gaiyou",
  "listening-hatsuwa",
  "listening-kadai",
  "listening-point",
  "listening-sokuji",
  "listening-detail",
]);

/** TASK-138 AC#3 + AC#7: distractors are same-family surfaces drawn from
 * the corpus, never hand-picked. `surfaceOf` decides which half of a
 * candidate is offered, so a gloss question is answered with glosses and a
 * reading question with words. The pool is tried in order of how strongly it
 * satisfies "same part of speech, same form class":
 *
 *  1. the entry's OWN other senses, which cannot be wrong about part of
 *     speech because they are the same word, and which is the most plausible
 *     wrong answer available (doc-21 §7 approach 4);
 *  2. the surface of other entries sharing a part-of-speech tag.
 *
 * The shipped tags mix granularities ("noun, pref"), so a tag match is a
 * filter over a pool, never a form-class guarantee. */
const distractorsFor = ({
  entry,
  family,
  pool,
  scanFrom,
  target,
}: {
  entry: CorpusVocabEntry;
  family: SourceFamily;
  pool: readonly CorpusVocabEntry[];
  scanFrom: number;
  target: string;
}): {
  distractors: readonly string[];
  sourcingCase: SourcingCase | undefined;
} => {
  const surfaceOf = SURFACE_BY_FAMILY[family];
  const tags = new Set(partsOfSpeechOf(entry));
  // TASK-138 AC#8 withdrew the same-entry-senses family wholesale, because the
  // entry's own other glosses are other CORRECT answers: 暇 offered
  // "spare time / leisure / free time" and marked a learner who said "leisure"
  // wrong. AC#8 fixed that and exposed AC#10 - the same-POS pool then filled
  // the slots and 入口 came out as "entrance / yellow / salt / skillful",
  // unambiguous but untestable.
  //
  // AC#10 closes it with the structure that was in the corpus all along and
  // thrown away at the join: JMdict's SENSE GROUPS. A group is one meaning and
  // every member of it is a correct answer, so the answer's own group is
  // untouchable and every OTHER group is a real distractor. 黄色 has ONE group
  // (yellow | amber) and so contributes nothing; 暇 has eight and contributes
  // seven; 入口 has one, which is why all five of its glosses are untouchable.
  //
  // The WordNet experiment approximated this downstream and got 1,196
  // single-sense entries wrong, because it read `meaning`'s semicolons as sense
  // boundaries when they are JMdict RENDERINGS. Reverted in c75cd5b.
  const ownSynonyms =
    family === "gloss" ? new Set(synonymsOf(entry, target)) : new Set<string>();
  const ownConfirmed =
    family === "gloss"
      ? senseGroupsOf(entry)
          .filter((group) => !group.includes(target))
          .flat()
          .filter((gloss) => !ownSynonyms.has(gloss))
      : [];
  const others = rotateDistractors({
    isTaken: (surface) => surface === target,
    pool,
    scanFrom,
    size: pool.length,
    surfaceOf: (candidate) =>
      sharesTag(candidate, tags) && !isSameEntry(candidate, entry)
        ? surfaceOf(candidate)
        : undefined,
  });
  // The answer's own group is excluded even where a rendering also appears in
  // another group: a gloss that is correct for this answer is correct whatever
  // else it also is.
  const seen = new Set<string>([target, ...ownSynonyms]);
  const distractors = [...ownConfirmed, ...others]
    .filter((surface) => {
      if (surface.length === 0 || seen.has(surface)) {
        return false;
      }
      seen.add(surface);
      return true;
    })
    .slice(0, MAX_DISTRACTORS);
  // The case is derived at the fork itself, from the counts that actually
  // decided it, rather than from a flag threaded through. `ownConfirmed` is
  // "renderings from ANOTHER sense group of this entry" - non-empty means the
  // item is answerable. Empty means either the entry has no other group (and
  // the picker should have declined it, so this is the fallback) or another
  // entry of the same POS supplied the wrong options.
  // Only gloss items have a distractor case. `ownConfirmed` is gloss-only, so
  // for a reading or verb item it is always empty and the branch below would
  // mislabel the item as "same-pos-pool" - a reading item's wrong options are
  // other READINGS, which is a different question with a different answer.
  let sourcingCase: SourcingCase | undefined;
  if (family !== "gloss") {
    sourcingCase = undefined;
  } else if (ownConfirmed.length > 0) {
    sourcingCase = "from-own-group";
  } else if (senseGroupsOf(entry).length < 2) {
    sourcingCase = "single-group-fallback";
  } else {
    sourcingCase = "same-pos-pool";
  }
  return { distractors, sourcingCase };
};

const isSameEntry = (
  candidate: CorpusVocabEntry,
  entry: CorpusVocabEntry
): boolean =>
  candidate.word === entry.word && candidate.reading === entry.reading;

const sharesTag = (
  candidate: CorpusVocabEntry,
  tags: ReadonlySet<string>
): boolean => partsOfSpeechOf(candidate).some((tag) => tags.has(tag));

/** The example sentence a grammar-backed item is built around. A grammar
 * point with no example cannot carry a context or a script, so it is
 * skipped rather than assembled with a null stimulus. */
const exampleFor = (
  entry: CorpusGrammarEntry,
  index: number
): CorpusGrammarEntry["examples"][number] | null => {
  const { examples } = entry;
  if (examples.length === 0) {
    return null;
  }
  return examples[index % examples.length] ?? null;
};

const vocabSourceFor = ({
  entry,
  family,
  pool,
  scanFrom,
}: {
  entry: CorpusVocabEntry;
  family: SourceFamily;
  pool: readonly CorpusVocabEntry[];
  scanFrom: number;
}): CandidateSource => {
  const surfaceOf = SURFACE_BY_FAMILY[family];
  const target = surfaceOf(entry) ?? "";
  return {
    anchorId: vocabAnchorFor(entry),
    // A reading question names the word; a verb question names the reading,
    // because that is what the learner is asked to identify the word from.
    cue: family === "verb" ? entry.reading : entry.word,
    ...distractorsFor({ entry, family, pool, scanFrom, target }),
    level: entry.level,
    pattern: null,
    stimulus: null,
    target,
  };
};

/** A grammar-backed item. `itemType` decides which half of the grammar point
 * is offered: a LISTENING item's options are sentences, because its prompt
 * asks which phrase was heard, and offering it four copula patterns is a
 * family mismatch the answer key cannot rescue. Every other grammar-backed
 * type offers the pattern, with the example sentence as the context. */
const grammarSourceFor = ({
  entry,
  index,
  itemType,
  pool,
  scanFrom,
}: {
  entry: CorpusGrammarEntry;
  index: number;
  itemType: QuestionItem["itemType"];
  pool: readonly CorpusGrammarEntry[];
  scanFrom: number;
}): CandidateSource | null => {
  const stimulus = exampleFor(entry, index);
  if (!stimulus) {
    return null;
  }
  const isListening = LISTENING_ITEM_TYPES.has(itemType);
  const target = isListening ? stimulus.japanese : entry.pattern;
  return {
    anchorId: grammarAnchorFor(entry),
    cue: isListening ? "" : stimulus.japanese,
    distractors: rotateDistractors({
      isTaken: (surface) => surface === target,
      pool,
      scanFrom,
      size: pool.length,
      surfaceOf: (candidate) =>
        isListening ? candidate.examples[0]?.japanese : candidate.pattern,
    }),
    level: entry.level,
    pattern: entry.pattern,
    stimulus,
    target,
  };
};

/**
 * TASK-173.9.17 AC#4: the one rule that decides whether a store row may serve a
 * 読解 slot, called from all six real-mode reading pickers (短文, 中文, 長文,
 * 主張理解, 情報検索, 統合理解). It refuses a row whose own `level` is not the level
 * the paper was asked to print.
 *
 * This is the third leg of a no-fallback policy that the store shape already
 * states twice and this rule completes. (1) A level with no file returns the empty
 * store, and each picker answers null before the walk, so its 大問 comes up short.
 * (2) A composed row is refused in real mode unless `validated`
 * (`isRefused`), so an unfalsified authored key never reaches a learner. (3) Until
 * now, a row that is IN the file but stamped with another level was still served:
 * the loader keys on the filename, not on the row, so `n3-choubun.json` holding one
 * N1-stamped window would print an N1 白書 長文 under N3's 大問6 heading and pass
 * `validateAnchors`, because the item would honestly carry the row's own level.
 * That is the exact failure the conversion tasks make reachable: TASK-173.9.18 and
 * TASK-173.9.19 drained the N3 and N4 masked-slot, stitched and borrowed stores and
 * refilled the same files with authored rows (TASK-173.9.20 and TASK-173.9.21 do
 * the same at N2 and N1), and a leftover borrowed row would then wear a ねらい it
 * cannot answer.
 *
 * Refusing means skipping this row and continuing the walk, not ending it: a single
 * mis-stamped entry must not blindside the rest of an honest store. If every row
 * mismatches, the loop exits and the picker returns null, which is the shortfall
 * report the block is designed to make (TASK-173.1) rather than a substitution.
 *
 * Behaviour-preserving on shipped data: every `packages/japanese/data/reading/*.json`
 * store self-labels the level of its own filename. That held even while N3 and N4
 * 情報検索 borrowed the licensed N5 notices (`jouhouStoreFor`), because those rows
 * were re-stamped in the file precisely so their anchor level matched the item;
 * TASK-173.9.18 and TASK-173.9.19 ended that borrow, so nothing shipped crosses a
 * level any more. The rule therefore fires only on the defect it exists to catch.
 */
const servableReadingRow = <T extends { readonly level: string }>({
  entry,
  level,
}: {
  readonly entry: T | undefined;
  readonly level: string;
}): T | null => {
  if (entry === undefined || entry.level !== level) {
    return null;
  }
  return entry;
};

/**
 * The walk shared by every whole-row store picker. Cycle the level's store from
 * the seeded position, skip a row whose level stamp is not the requested one
 * (`servableReadingRow`), a text this paper already spent in its block's ledger,
 * and an anchor this learner has already seen; on the first servable row spend
 * the text and print the candidate: `cue` is the row's own stem, `target` the
 * option at `answerIndex`, the rest the distractors. The spend is applied as
 * the walk decides, synchronously, so two slots in one paper cannot pick the
 * same text and the seeded order stays deterministic. A row never serves
 * twice; if every row is spent the walk returns null, which is the shortfall
 * report the block is designed to make (TASK-173.1) rather than a substitution.
 *
 * `asStimulus` is the 聴解 shape: the heard scenario travels as the item's
 * STIMULUS (the script), never as the printed passage, because a learner who
 * could read the dialogue would not be doing 聴解; `presentationFor` puts
 * `stimulus.japanese` into the `script` column and `passage` is absent from
 * the source. With it off the verbatim row text IS the printed `passage`,
 * which is what every 読解 block owes.
 *
 * `provenanceDefault` is the row's own trust when it carries no stamp: the
 * licensed stores predate the field, so an absent stamp there means
 * `licensed`; an authored store's rows are `composed` by definition. The
 * composed-rows-without-`validated` half is handled by `isRefused` like every
 * other store: an unjudged authored row never reaches a real paper.
 */
/** Print one servable store row as a candidate: the row's stem is the cue, the
 * option at `answerIndex` is the target, the rest are the distractors, and
 * `asStimulus` decides whether the verbatim text is heard (聴解) or read (読解). */
const rowSourceFromEntry = ({
  anchorId,
  asStimulus,
  entry,
  provenanceDefault,
  target,
}: {
  anchorId: string;
  asStimulus: boolean;
  entry: CorpusShortReadingEntry;
  provenanceDefault: "licensed" | "composed";
  target: string;
}): CandidateSource => {
  const source: CandidateSource = {
    anchorId,
    cue: entry.stem,
    distractors: entry.options.filter(
      (_, optionIndex) => optionIndex !== entry.answerIndex
    ),
    level: entry.level,
    pattern: null,
    provenance: entry.provenance ?? provenanceDefault,
    sourcingCase: undefined,
    stimulus: asStimulus ? { english: "", japanese: entry.passage } : null,
    target,
    validated: entry.validated ?? false,
  };
  return asStimulus ? source : { ...source, passage: entry.passage };
};

const storeRowSourceFor =
  ({
    anchorPrefix,
    asStimulus = false,
    provenanceDefault,
    spent,
    storeFor,
  }: {
    anchorPrefix: string;
    asStimulus?: boolean;
    provenanceDefault: "licensed" | "composed";
    spent: (catalog: CandidateCatalogState) => Set<string>;
    storeFor: (level: string) => readonly CorpusShortReadingEntry[];
  }): StoreSourcePicker =>
  ({ catalog, index, level, offset }) => {
    const store = storeFor(level);
    if (store.length === 0) {
      return null;
    }
    const used = spent(catalog);
    for (let step = 0; step < store.length; step += 1) {
      const entry = servableReadingRow({
        entry: store[(offset + index + step) % store.length],
        level,
      });
      if (entry === null || used.has(entry.passage)) {
        continue;
      }
      const anchorId = `${anchorPrefix}:${entry.id}`;
      if (catalog.seenAnchors.has(anchorId)) {
        continue;
      }
      // The store loaders already dropped entries whose answerIndex is out of
      // range, so this cannot be undefined for a store entry; the guard only
      // satisfies noUncheckedIndexedAccess. Checked before the spend so a
      // hypothetical bad row is skipped, not burned.
      const target = entry.options[entry.answerIndex];
      if (target === undefined) {
        continue;
      }
      used.add(entry.passage);
      return rowSourceFromEntry({
        anchorId,
        asStimulus,
        entry,
        provenanceDefault,
        target,
      });
    }
    return null;
  };

/**
 * TASK-173.7: one 内容理解（短文） candidate, or null when the level has no
 * 短文 store. This is the whole real-mode reading supply: a passage drawn
 * VERBATIM from the store (`packages/japanese/data/reading/{level}.json`),
 * carrying its own Japanese comprehension stem and four Japanese options.
 *
 * It never touches a corpus sentence and NEVER falls back to `LONG_READING_PASSAGE`:
 * a level with no reading file returns null for every slot (every level N5-N1
 * ships one now, so the path is reached by a missing or emptied store), so the
 * 短文 block comes up short and the real paper refuses it rather than fabricate
 * one (TASK-173.1). `sourcingCase` is undefined, so the 173.1 fabricated-candidate
 * guard stays dormant for a sourced passage exactly as it does for a cloze or star.
 *
 * Synchronous and single-threaded on purpose: the passage spend is applied as
 * the walk decides (a 短文 大問 prints one passage per 小問), and a passage
 * already served to this learner across papers (`seenAnchors`) is skipped, so
 * a retry asks a new reading. The walk itself is `storeRowSourceFor`.
 */
const shortReadingSourceFor = storeRowSourceFor({
  anchorPrefix: "reading",
  provenanceDefault: "licensed",
  spent: (catalog) => catalog.usedShortReadingPassages,
  storeFor: shortReadingStoreFor,
});

/**
 * TASK-173.9.2: one 内容理解（中文） candidate, or null when the level has no
 * 中文 store. Same contract as `shortReadingSourceFor` (TASK-173.7):
 * the passage is printed VERBATIM from the store
 * (`packages/japanese/data/reading/{level}-chuubun.json`), carrying its own
 * Japanese stem and four Japanese options, and it NEVER falls back to the
 * hardcoded `LONG_READING_PASSAGE`. A level with no 中文 store returns null for
 * every slot so the block comes up short and the real paper refuses rather than
 * fabricate one (TASK-173.1). The two shapes that file holds are this package's
 * business, not the picker's: a masked slot blanked out of a 白書 paragraph at
 * N2/N1, an authored whole passage at N3/N4.
 *
 * Synchronous and single-threaded for the same reason as the 短文 walk, and a
 * composed 中文 row is refused in real mode unless `validated`, by the same
 * `isRefused` rule a composed 短文 uses. The walk itself is
 * `storeRowSourceFor`.
 */
const mediumReadingSourceFor = storeRowSourceFor({
  anchorPrefix: "reading",
  provenanceDefault: "licensed",
  spent: (catalog) => catalog.usedMediumReadingPassages,
  storeFor: mediumReadingStoreFor,
});

/**
 * TASK-173.9.12 AC#6: only a REAL paper sources its 長文 from the window store.
 * `long-reading` is the one reading type the flat mixes still weight 20 (N1
 * `language-knowledge-reading` and N3 `grammar-reading`), and those papers draw
 * from the grammar pool, which carries no passage, so they keep the canned text
 * they always printed. Moving the flat weights is a standing decision this gate
 * must not pre-empt.
 */
const choubunWindowSourced = (
  itemType: QuestionItem["itemType"],
  mode: PaperRequest["mode"]
): boolean => itemType === "long-reading" && mode === "real";

/**
 * TASK-173.9.12: one 内容理解（長文） candidate, or null when the level has no
 * 長文 store. Same contract as `mediumReadingSourceFor` (and, before it,
 * `shortReadingSourceFor`): the passage is printed VERBATIM from the reading store
 * (`packages/japanese/data/reading/{level}-choubun.json`), and a REAL paper never
 * falls back to the hardcoded `LONG_READING_PASSAGE`. A level with no 長文 store
 * returns null for every slot, so the block comes up short and the paper reports
 * its 大問 hole rather than printing canned text under a 長文 ねらい (TASK-173.1).
 * N3 大問6 was that case until TASK-173.9.16: this picker does not care WHICH of
 * the block's two constructions a row carries, only that the file has one for the
 * level, so N1 serves masked 白書 windows and N3 serves authored comprehension
 * rows through the same path (doc-27 §10).
 *
 * Synchronous and single-threaded for the same reason as the 中文 walk, and a
 * composed row is refused in real mode unless `validated`, by the same
 * `isRefused` rule a composed 中文 uses. The walk itself is
 * `storeRowSourceFor`.
 *
 * The picker is reached from real mode only (see `appendItemTypeCandidates`): a
 * flat mix keeps its `long-reading` weight 20 and its grammar-pool source, whose
 * candidate carries no `passage`, so it still prints the canned text.
 */
const choubunSourceFor = storeRowSourceFor({
  anchorPrefix: "reading",
  provenanceDefault: "licensed",
  spent: (catalog) => catalog.usedChoubunPassages,
  storeFor: choubunStoreFor,
});

/**
 * TASK-173.9.2 slice 2: one 主張理解（長文） candidate, or null when the level
 * has no sourced 白書 passage. Same contract as `mediumReadingSourceFor` (and,
 * before it, `shortReadingSourceFor`): the passage is printed VERBATIM from the
 * reading store (`packages/japanese/data/reading/{level}-chuushou.json`), and it
 * NEVER falls back to the hardcoded `LONG_READING_PASSAGE`. A level with no
 * 主張理解 store returns null for every slot, so the 大問13 (N2) / 大問12 (N1)
 * block comes up short and the real paper refuses rather than fabricate (TASK-173.1).
 *
 * Synchronous and single-threaded for the same reason as the 中文 walk, and a
 * composed row is refused in real mode unless `validated`, by the same
 * `isRefused` rule a composed 中文 uses. The walk itself is
 * `storeRowSourceFor`.
 */
const claimUnderstandingSourceFor = storeRowSourceFor({
  anchorPrefix: "reading",
  provenanceDefault: "licensed",
  spent: (catalog) => catalog.usedClaimUnderstandingPassages,
  storeFor: claimUnderstandingStoreFor,
});

/**
 * TASK-173.9.7: one 情報検索 candidate, or null when the level has no store.
 * Same contract as `shortReadingSourceFor` (TASK-173.7): the 案内 or 情報素材
 * document is printed VERBATIM from the store
 * (`packages/japanese/data/reading/{level}-jouhou.json`), carrying its own
 * Japanese lookup question and four Japanese options, and it NEVER falls back to
 * the hardcoded `LONG_READING_PASSAGE`. A level with no store returns null for
 * every slot, so the block comes up short and the real paper reports the hole
 * rather than invent a timetable (TASK-173.1). All five levels have a store since
 * TASK-173.9.13 gave N2 and N1 their own, so that path is now only the missing or
 * emptied file.
 *
 * Synchronous and single-threaded for the same reason as the 短文 walk: the
 * passage spend is applied as the walk decides, so the two questions asked of one
 * notice cannot both fill one 大問. The walk itself is `storeRowSourceFor`.
 */
const infoSearchSourceFor = storeRowSourceFor({
  anchorPrefix: "reading",
  provenanceDefault: "licensed",
  spent: (catalog) => catalog.usedJouhouPassages,
  storeFor: jouhouStoreFor,
});

/**
 * TASK-173.9.3: one 統合理解 candidate, or null when the level has no sourced
 * pair. Same contract as `infoSearchSourceFor` (TASK-173.9.7): BOTH documents are
 * printed VERBATIM from the store
 * (`packages/japanese/data/reading/{level}-tougou.json`) in reading order, with
 * their own Japanese comparison question and four Japanese options, and the pair
 * NEVER falls back to the hardcoded `LONG_READING_PASSAGE`. A level with no
 * sourced pair (N5/N4/N3 today) returns null for every slot, so the 大問11 (N1) /
 * 大問12 (N2) block comes up short and the real paper refuses rather than
 * fabricate a comparison (TASK-173.1).
 *
 * Synchronous and single-threaded for the same reason as the 情報検索 walk: the
 * pair spend is applied as the walk decides, so one pair cannot back two 小問 of
 * one 大問, and the seeded order stays deterministic. A composed row is refused
 * in real mode unless `validated`, by the same `isRefused` rule 主張理解 uses.
 */
const tougouSourceFor = ({
  catalog,
  index,
  level,
  offset,
}: {
  catalog: CandidateCatalogState;
  index: number;
  level: string;
  offset: number;
}): CandidateSource | null => {
  const store = tougouStoreFor(level);
  if (store.length === 0) {
    return null;
  }
  for (let step = 0; step < store.length; step += 1) {
    const entry = servableReadingRow({
      entry: store[(offset + index + step) % store.length],
      level,
    });
    if (entry === null) {
      continue;
    }
    // The unit of a 比較・統合 小問 is the PAIR, so the spend keys on the two
    // document texts rather than on one passage. Order-insensitive: the same two
    // paragraphs in either order are still the same pair.
    const pairKey = [...entry.passages].sort().join("\n");
    if (catalog.usedTougouPairs.has(pairKey)) {
      continue;
    }
    const anchorId = `reading:${entry.id}`;
    if (catalog.seenAnchors.has(anchorId)) {
      continue;
    }
    const target = entry.options[entry.answerIndex];
    if (target === undefined) {
      continue;
    }
    catalog.usedTougouPairs.add(pairKey);
    const distractors = entry.options.filter(
      (_, optionIndex) => optionIndex !== entry.answerIndex
    );
    return {
      anchorId,
      cue: entry.stem,
      distractors,
      level: entry.level,
      passages: entry.passages,
      pattern: null,
      provenance: entry.provenance ?? "composed",
      sourcingCase: undefined,
      stimulus: null,
      target,
      validated: entry.validated ?? false,
    };
  }
  return null;
};

/**
 * TASK-173.9.23: one 用法 candidate, or null when the level has no usage store. store.
 * Same contract as `infoSearchSourceFor` (TASK-173.9.7): the row is a whole
 * authored 用法 item written for the block (stem = the Japanese sentence with the
 * target form blanked; four options = the target form plus three authored wrong
 * forms; the target form is drawn from the licensed `grammar/{level}.json`
 * pattern store, and the item's key is blind-judged offline and frozen in
 * `{level}-usage-rejected.json`). No vocab surface is derived; the walk declines
 * the candidate until this picker owns the source. A level with no usage store
 * file returns null, which names the 用法 大問 as a hole rather than fabricate.
 */
const usageSourceFor = storeRowSourceFor({
  anchorPrefix: "usage",
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedUsagePassages,
  storeFor: usageStoreFor,
});

/**
 * TASK-173.9.24: one 文章の文法 candidate, or null when the level has no
 * discourse-cloze store.
 *
 * Same contract as `usageSourceFor` (TASK-173.9.23): the row is a whole authored
 * 文章の文法 item written for the block. `passage` is the short 文章 with exactly
 * one ＿＿ in it, `stem` is the official 大問 instruction line, the four options are
 * the candidate SENTENCES, and `answerIndex` marks the one that restores the
 * discourse. The ねらい is 文章の流れに合った文かどうかを判断する (doc-26 §3), so the key
 * is not derivable from any licensed corpus - no source pairs a passage with its
 * own removed sentence - which is why the two blind judge passes ARE the
 * solvability proof and `check:bunshou` only re-proves the shape. A level with no
 * store file returns null, which names 文章の文法 as a hole rather than invent one
 * (TASK-173.1).
 */
const discourseClozeSourceFor = storeRowSourceFor({
  anchorPrefix: "bunshou",
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedBunshouPassages,
  storeFor: bunshouStoreFor,
});

/**
 * TASK-173.9.25: one 表記 candidate, whole row from the per-level store
 * (`packages/japanese/data/reading/{level}-hyouki.json`), or null when the
 * store cannot serve here.
 *
 * The row is a sentence printing one word in kana plus the four spellings,
 * exactly one of which writes that word (the official shape measured from the
 * 2018 sample papers: N5V/N4V もんだい２, N3V/N2V 問題２). Unlike 用法, the key
 * spelling IS re-derivable offline - it must be a word+reading pair the licensed
 * vocab corpus attests - and the wrong spellings are the official classes a
 * mangled component or a different-reading real word, which the same corpus
 * mechanically falsifies. `check:hyouki` re-proves that contract; the two blind
 * judge passes certify what no corpus can: that the authored sentence makes
 * exactly one spelling defensible in context. A level with no store file
 * returns null, which names 表記 as a hole rather than invent one (TASK-173.1).
 */
const hyoukiSourceFor = storeRowSourceFor({
  anchorPrefix: "hyouki",
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedHyoukiSentences,
  storeFor: hyoukiStoreFor,
});

/**
 * TASK-173.9.26: one 語形成 candidate, whole row from the N2 store
 * (`packages/japanese/data/reading/n2-goseikei.json`), or null when the store
 * cannot serve here.
 *
 * The row is a sentence printing a compound's fragment beside a （　） blank
 * plus the four single kanji, exactly one of which completes the compound (the
 * official shape measured from the 2018 語彙 sample: N2V 問題３). Like 表記, the
 * key IS re-derivable offline - the completed compound must be a pure-kanji word
 * the licensed vocab corpus attests - and every distractor completion is
 * mechanically falsified as unattested at N5-N1. `check:goseikei` re-proves that
 * contract; the two blind judge passes certify what no corpus can: that the
 * authored sentence makes exactly one completion defensible in context, which
 * also catches real-but-unlisted completions a screen cannot see. A level with
 * no store file returns null, which names 語形成 as a hole rather than invent
 * one (TASK-173.1).
 */
const goseikeiSourceFor = storeRowSourceFor({
  anchorPrefix: "goseikei",
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedGoseikeiSentences,
  storeFor: goseikeiStoreFor,
});

/**
 * TASK-173.9.27: one 言い換え類義 candidate, whole row from the level's store
 * (`packages/japanese/data/reading/{n1,n2,n3}-iikae.json`), or null when the
 * store cannot serve here.
 *
 * The row is a sentence printing one 「　」-bracketed word plus the four
 * paraphrases, exactly one of which keeps the sentence's meaning (the official
 * shape measured from the 2018 語彙 samples: N1V 問題３, N2V 問題５, N3V 問題４).
 * Like 表記 and 語形成, the row is mechanically falsifiable where meaning alone
 * is not: the bracketed word must be the exact headword of that level's band
 * file, the key must not appear in the sentence, and the options must be four
 * distinct paraphrases - `check:iikae` re-proves that contract. What no corpus
 * can prove is that exactly one option keeps the sentence's meaning, and that
 * is what the two blind judge passes certify. N4/N5 print the whole-SENTENCE
 * paraphrase instead, which is served by `iikaeSentenceSourceFor` from its own
 * store (TASK-173.9.28), so this picker returns null at those levels.
 */
const iikaeSourceFor = storeRowSourceFor({
  anchorPrefix: "iikae",
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedIikaeSentences,
  storeFor: iikaeStoreFor,
});

/**
 * TASK-173.9.28: one 言い換え類義 whole-SENTENCE candidate, whole row from the
 * level's store (`packages/japanese/data/reading/{n4,n5}-iikae-sentence.json`),
 * or null when the store cannot serve here.
 *
 * The row is one everyday ぶん plus the four whole ぶん that re-say it, exactly
 * one of which keeps what the underlined sentence says (the official shape
 * measured from the 2018 語彙 samples: N4V もんだい４, N5V もんだい４, both printing
 * 「＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。…」). Like the word form
 * it serves from, the row is mechanically falsifiable where meaning alone is
 * not: every option is the same sentence with ONE piece swapped inside a shared
 * frame of at least six runes, the answer's piece never appears in the
 * sentence, and the four options are distinct whole sentences -
 * `check:iikae-sentence` re-proves that contract. What no corpus can prove is
 * that the swapped-in sentence MEANS the underlined one, and that is what the
 * two blind judge passes certify. N1/N2/N3 print the WORD form instead, served
 * by `iikaeSourceFor` from its own store (TASK-173.9.27), so this picker returns
 * null at those levels.
 */
const iikaeSentenceSourceFor = storeRowSourceFor({
  anchorPrefix: "iikae-sentence",
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedIikaeSentenceSentences,
  storeFor: iikaeSentenceStoreFor,
});

/**
 * TASK-173.9.29: one 文脈規定 candidate, whole row from the level's store
 * (`packages/japanese/data/reading/{n3,n2,n1}-kitei.json`), or null when the
 * store cannot serve here.
 *
 * The row is one authored sentence printing a ＿＿ blank plus the four
 * same-part-of-speech words, exactly one of which the sentence's context
 * admits (the official shape measured from the 2018 語彙 samples: N3V 問題３,
 * N2V 問題４, N1V 問題２). Like the other vocab stores the row is
 * mechanically falsifiable where fit alone is not: every option is an attested
 * word of one POS family, the key never prints in the passage, and `evidence`
 * is the passage with the key restored - `check:kitei` re-proves that
 * contract. Which of four grammatical fits the context singles out is a
 * judgement, and that is what the two blind judge passes certify. This store
 * REPLACES the derived grammar-example join at N3/N2/N1 with no fallback
 * between the two paths: the join filled 2/11, 1/7 and 0/7 of a real paper
 * measured 2026-10-13 because the corpus's ~400 grammar examples barely contain
 * the level's words, and a store-exhausted paper must name its hole
 * (TASK-173.1) rather than silently resume fabricating fit out of whatever
 * example a seed happens to reach. N4/N5 keep the join, where it fills
 * (`clozeSourceFor`, the dispatch's derived arm).
 */
const kiteiSourceFor = storeRowSourceFor({
  anchorPrefix: "kitei",
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedKiteiPassages,
  storeFor: kiteiStoreFor,
});

/** The levels whose 文脈規定 大問 is served by the authored kitei store; the
 * derived grammar-example join serves N4/N5 (TASK-173.9.29). Dispatch, pool
 * sizing, and the store loader's level loop must agree on exactly this set. */
const KITEI_STORE_LEVELS: ReadonlySet<string> = new Set(["N1", "N2", "N3"]);

/**
 * TASK-173.8.1: the 聴解 pickers, one per 大問 block. Each row of
 * `{level}-{kadai,point,gaiyou,hatsuwa,sokuji}.json` is a whole 小問: the heard
 * scenario, the printed question (`stem`), four options and the frozen key.
 * They all walk through `storeRowSourceFor` with `asStimulus`, because the
 * scenario is the item's `script`, NOT its `passage`: `presentationFor` puts
 * `source.stimulus.japanese` into the `script` column, and the five types are
 * members of `LISTENING_ITEM_TYPES`, so what the learner gets is the audio
 * material, never printed dialogue text. The answer may legitimately be SPOKEN
 * inside the scenario (a 課題理解 whose options include カフェの 前, a dialogue
 * that says カフェの 前で 会いましょう) — that is the 大問 working, and
 * `STIMULUS_ANSWER_TYPES` in the engine exempts exactly this case; the offline
 * `check:listening-*` gate screens only the PROMPT against printing the answer.
 * `usedListeningScenarios` is shared across the five blocks and so are the
 * gate's per-store reuse rules: a scenario this paper already spent is not a
 * new 小問 even if it would fit another 大問. The composed-rows-without-
 * `validated` half is handled by `isRefused` like every other store: an
 * unjudged authored row never reaches a real paper, and a licensed row serves
 * on its own license tag.
 */
/** 課題理解: the heard dialogue asks one task point (where to meet, what to
 * buy, what time). `check:listening-kadai` freezes the rows; the anchors live
 * in their own namespace so a kadai id can never collide with another block. */
const listeningKadaiSourceFor = storeRowSourceFor({
  anchorPrefix: "listening-kadai",
  asStimulus: true,
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedListeningScenarios,
  storeFor: listeningKadaiStoreFor,
});
/** ポイント理解: the heard dialogue asks for one reason or detail. */
const listeningPointSourceFor = storeRowSourceFor({
  anchorPrefix: "listening-point",
  asStimulus: true,
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedListeningScenarios,
  storeFor: listeningPointStoreFor,
});
/** 場面対応: the learner hears a SITUATION and chooses what to SAY. */
const listeningHatsuwaSourceFor = storeRowSourceFor({
  anchorPrefix: "listening-hatsuwa",
  asStimulus: true,
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedListeningScenarios,
  storeFor: listeningHatsuwaStoreFor,
});
/** 即時応答: the learner hears ONE phrase and answers instantly. Fully
 * authored, so `isRefused` leans entirely on the two blind passes' `validated`. */
const listeningSokujiSourceFor = storeRowSourceFor({
  anchorPrefix: "listening-sokuji",
  asStimulus: true,
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedListeningScenarios,
  storeFor: listeningSokujiStoreFor,
});
/** 概要理解 (TASK-173.9.4.1): the learner hears ONE monologue and answers what
 * the whole talk says. N3-only store, so N4/N5 papers come up with the 大問 a
 * named hole (TASK-173.1). */
const listeningGaiyouSourceFor = storeRowSourceFor({
  anchorPrefix: "listening-gaiyou",
  asStimulus: true,
  provenanceDefault: "composed",
  spent: (catalog) => catalog.usedListeningScenarios,
  storeFor: listeningGaiyouStoreFor,
});

/** The official grouping of 聴解統合理解: ONE long dialogue backs TWO 小問
 * (二つの質問, N2L.pdf 問題5). */
const CHOUKAI_GROUP_SIZE = 2;

/** The store's printable unit is the PAIR: rows grouped by the script they
 * share, only complete groups (CHOUKAI_GROUP_SIZE servable rows) admitted. */
const choukaiGroupsOrdered = (level: string): CorpusShortReadingEntry[][] => {
  const groups = new Map<string, CorpusShortReadingEntry[]>();
  for (const row of listeningChoukaiStoreFor(level)) {
    const servable = servableReadingRow({ entry: row, level });
    if (servable === null) {
      continue;
    }
    const group = groups.get(servable.passage) ?? [];
    group.push(servable);
    groups.set(servable.passage, group);
  }
  return [...groups.values()].filter(
    (group) => group.length === CHOUKAI_GROUP_SIZE
  );
};

/** Resolves one ordinal of this 大問's slot sequence to its group row: the
 * (ordinal div GROUP_SIZE)-th unspent script, rotated by the seeded offset,
 * and its (ordinal mod GROUP_SIZE)-th question. Null walks the picker off the
 * end of the ordered groups. */
const choukaiSlotAt = (
  groupNumber: number,
  offset: number,
  ordered: readonly CorpusShortReadingEntry[][],
  position: number
): { row: CorpusShortReadingEntry; script: string } | null => {
  if (groupNumber >= ordered.length) {
    return null;
  }
  const group = ordered[(groupNumber + offset) % ordered.length];
  const row = group?.[position];
  if (group === undefined || row === undefined) {
    return null;
  }
  return { row, script: group[0]?.passage ?? "" };
};

/** 聴解統合理解 (TASK-173.9.4.2): the block that lawfully re-airs a script.
 * The store is one row per 小問 grouped by a byte-identical shared `passage`
 * (`check:listening-choukai` proves every script carries exactly
 * `CHOUKAI_GROUP_SIZE` rows), and the walk builds this 大問's slots in index
 * order with this picker running synchronously in that order. Slot i is the
 * (i mod GROUP_SIZE)-th question of the (i div GROUP_SIZE)-th unspent script,
 * rotated by the seeded offset so two papers start at different dialogues; a
 * script already spent by an earlier 大問 (the shared scenario spend) or a row
 * this learner has already seen advances the window instead of re-airing it,
 * and the SCRIPT - not the row - is what lands in `usedListeningScenarios` on
 * the group's first 小問. */
const listeningChoukaiSourceFor: StoreSourcePicker = ({
  catalog,
  index,
  level,
  offset,
}) => {
  const ordered = choukaiGroupsOrdered(level);
  if (ordered.length === 0) {
    return null;
  }
  let ordinal = catalog.choukaiCursor ?? index;
  for (
    let attempt = 0;
    attempt < ordered.length * CHOUKAI_GROUP_SIZE;
    attempt += 1
  ) {
    const groupNumber = Math.floor(ordinal / CHOUKAI_GROUP_SIZE);
    const slot = choukaiSlotAt(
      groupNumber,
      offset,
      ordered,
      ordinal % CHOUKAI_GROUP_SIZE
    );
    if (slot === null) {
      return null;
    }
    const { row, script } = slot;
    const position = ordinal % CHOUKAI_GROUP_SIZE;
    // A script spent BEFORE this group opened (by an earlier 大問) is off
    // limits; a spend this group itself made is exactly the position>0 case.
    if (position === 0 && catalog.usedListeningScenarios.has(script)) {
      ordinal = (groupNumber + 1) * CHOUKAI_GROUP_SIZE;
      continue;
    }
    const anchorId = `listening-choukai:${row.id}`;
    if (catalog.seenAnchors.has(anchorId)) {
      ordinal += 1;
      continue;
    }
    const target = row.options[row.answerIndex];
    if (target === undefined) {
      ordinal += 1;
      continue;
    }
    catalog.choukaiCursor = ordinal + 1;
    catalog.usedListeningScenarios.add(script);
    return rowSourceFromEntry({
      anchorId,
      asStimulus: true,
      entry: row,
      provenanceDefault: "composed",
      target,
    });
  }
  return null;
};

/** The one argument shape every store-backed 読解 picker takes. */
type StoreSourcePicker = (args: {
  catalog: CandidateCatalogState;
  index: number;
  level: string;
  offset: number;
}) => CandidateSource | null;

/** A family whose candidate is a whole row of a reading store: the passage is the
 * item's material, so only the store can print it and neither the focus prior nor
 * the vocab/grammar pool walkers are consulted. Each picker's own docblock states
 * what its level's empty store does (TASK-173.7 短文, TASK-173.9.2 中文,
 * TASK-173.9.x slice 2 主張理解, TASK-173.9.7 情報検索, TASK-173.9.3 統合理解).
 * `long-reading` is absent here because it is the one reading type the flat mixes
 * still weight, so its walk branch stays keyed on the paper's mode
 * (TASK-173.9.12 AC#6). */
const STORE_SOURCE_PICKER_BY_FAMILY: Readonly<
  Partial<Record<SourceFamily, StoreSourcePicker>>
> = {
  // TASK-173.9.24: 文章の文法 is answered from the per-level discourse-cloze
  // store, whole row, same contract as 用法.
  bunshou: discourseClozeSourceFor,
  chuushou: claimUnderstandingSourceFor,
  // TASK-173.9.26: 語形成 is answered from the per-level 語形成 store, whole row,
  // same contract as 表記.
  goseikei: goseikeiSourceFor,
  // TASK-173.9.25: 表記 is answered from the per-level 表記 store, whole row,
  // same contract as 文章の文法.
  hyouki: hyoukiSourceFor,
  // TASK-173.9.27: 言い換え類義 is answered from the per-level 言い換え store,
  // whole row, same contract as 語形成.
  iikae: iikaeSourceFor,
  // TASK-173.9.28: the 言い換え類義 sentence form is answered from its own
  // per-level store, whole row, same contract as the word form.
  "iikae-sentence": iikaeSentenceSourceFor,
  kensaku: infoSearchSourceFor,
  // TASK-173.8.1: each 聴解 大問 is answered from its own per-level store, whole
  // row, with the scenario travelling as the `script` stimulus rather than the
  // printed passage.
  "listening-choukai": listeningChoukaiSourceFor,
  "listening-gaiyou": listeningGaiyouSourceFor,
  "listening-hatsuwa": listeningHatsuwaSourceFor,
  "listening-kadai": listeningKadaiSourceFor,
  "listening-point": listeningPointSourceFor,
  "listening-sokuji": listeningSokujiSourceFor,
  medium: mediumReadingSourceFor,
  short: shortReadingSourceFor,
  tougou: tougouSourceFor,
  // TASK-173.9.23: 用法 is answered from the per-level usage store, whole row,
  // same contract as 情報検索.
  usage: usageSourceFor,
};

/** Walks one grammar entry's examples in order, segmenting each with the
 * tokenizer and handing the pair to `build`, stopping at the first candidate
 * `build` accepts. `abort: true` is the tokenizer's refusal (no tokenization
 * means no verified mask for ANY example), which stops the whole grammar run,
 * while a null source with `abort: false` only declines this entry. Shared by
 * the cloze and star pickers, which both need a verified tokenization before
 * they will build anything. */
const scanGrammarExamples = async (
  entry: CorpusGrammarEntry,
  build: (
    example: CorpusGrammarEntry["examples"][number],
    tokens: readonly string[]
  ) => CandidateSource | null,
  split: TokenSplitter
): Promise<{ abort: boolean; source: CandidateSource | null }> => {
  for (const example of entry.examples) {
    if (example.japanese.length === 0) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a verified mask needs a tokenization to split on, and the walk must stop at the first example that yields a legal item, so examples are segmented one at a time in seeded order rather than all up front.
    const tokens = await split(example.japanese);
    if (!tokens) {
      return { abort: true, source: null };
    }
    const source = build(example, tokens);
    if (source) {
      return { abort: false, source };
    }
  }
  return { abort: false, source: null };
};

/** Resolve a token to its dictionary entry by surface. `entryByWord` is built
 * once per walk, so scanning a sentence's tokens costs a lookup each rather than
 * a sweep of the level each. */
const vocabIndexByWord = (
  vocabPool: readonly CorpusVocabEntry[]
): Map<string, CorpusVocabEntry> => {
  const entryByWord = new Map<string, CorpusVocabEntry>();
  for (const entry of vocabPool) {
    if (!entryByWord.has(entry.word)) {
      entryByWord.set(entry.word, entry);
    }
  }
  return entryByWord;
};

/**
 * TASK-173.5: one 文脈規定 cloze candidate, or null when the corpus cannot back
 * one here.
 *
 * The exam's only real Japanese sentences are grammar examples - a
 * `CorpusVocabEntry` carries none - so a cloze pairs a grammar example with a
 * WORD found inside it. That word is the answer; the other three options are
 * same-part-of-speech vocabulary at the same level. This is the whole join, and
 * it is why the block ships disabled until the per-level fill rate is measured.
 *
 * The word has to survive `maskWord`, which is what makes it a real cloze
 * instead of a giveaway: it must be a standalone token whose substring
 * occurrences equal its token occurrences, so blanking it neither cuts a
 * neighbour in half nor leaves the answer visible. That is re-checked here from
 * the same tokenize call before any distractor work, so an unblankable word is
 * skipped rather than shipped; and if one ever slipped past, `hasStemLeak`
 * rejects a passage that still contains the answer.
 *
 * A cross-lemma near-synonym (始める offered for a 始まる blank that also fits)
 * is not detectable offline and the corpus has no Japanese-synonym field, so
 * byte-equality marks it simply "wrong" and it survives into the paper. That is
 * the documented residual limitation, not a bug; Slice 3.5 measures how often
 * it bites.
 */
const clozeSourceFor = async ({
  catalog,
  grammarPool,
  index,
  offset,
  split,
  vocabPool,
}: {
  catalog: CandidateCatalogState;
  grammarPool: readonly CorpusGrammarEntry[];
  index: number;
  offset: number;
  split: TokenSplitter;
  vocabPool: readonly CorpusVocabEntry[];
}): Promise<CandidateSource | null> => {
  if (grammarPool.length === 0 || vocabPool.length === 0) {
    return null;
  }
  const entryByWord = vocabIndexByWord(vocabPool);
  for (let step = 0; step < grammarPool.length; step += 1) {
    const grammarEntry =
      grammarPool[(offset + index + step) % grammarPool.length];
    if (!grammarEntry || catalog.usedGrammarIds.has(grammarEntry.id)) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: the walk must stop at the first entry whose example yields a blankable word, so grammar entries are scanned one at a time in seeded order.
    const { abort, source } = await scanGrammarExamples(
      grammarEntry,
      (example, tokens) =>
        clozeTargetForExample({
          catalog,
          entryByWord,
          example,
          grammarEntry,
          scanFrom: offset + index + step + 1,
          tokens,
          vocabPool,
        }),
      split
    );
    // No tokenizer means no verified mask, and an unverified cloze prints the
    // answer in its own sentence. Decline rather than mask blind.
    if (abort) {
      return null;
    }
    if (source) {
      return source;
    }
  }
  return null;
};

/** Scan the pool from a per-item offset and take the first MAX_DISTRACTORS
 * distinct surfaces, so two items of the same type do not ship an identical
 * distractor set. Deterministic, because scanFrom derives from the same seeded
 * digest as the entry choice. Shared by the vocabulary and grammar pickers so
 * both obey the same variety rule. */
const rotateDistractors = <T>({
  isTaken,
  pool,
  scanFrom,
  size,
  surfaceOf,
}: {
  isTaken: (surface: string) => boolean;
  pool: readonly T[];
  scanFrom: number;
  size: number;
  surfaceOf: (entry: T) => string | undefined;
}): readonly string[] => {
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (
    let step = 0;
    step < size && chosen.length < MAX_DISTRACTORS;
    step += 1
  ) {
    const candidate = pool[(scanFrom + step) % size];
    if (!candidate) {
      continue;
    }
    const surface = surfaceOf(candidate);
    if (!surface || surface.length === 0 || seen.has(surface)) {
      continue;
    }
    seen.add(surface);
    if (!isTaken(surface)) {
      chosen.push(surface);
    }
  }
  return chosen;
};

/** Pick the blankable word one example sentence can carry: the first distinct
 * token that is a same-level vocab surface, survives the token-vs-substring
 * count, and has three same-part-of-speech siblings to fill the four options.
 * On success it spends the grammar example AND the vocab word, so neither the
 * sentence nor the answer repeats. A word whose substring occurrences exceed
 * its token occurrences sits inside a longer token, so `replaceAll` would cut
 * that neighbour in half; it is withheld, not shipped. */
const clozeTargetForExample = ({
  catalog,
  entryByWord,
  example,
  grammarEntry,
  scanFrom,
  tokens,
  vocabPool,
}: {
  catalog: CandidateCatalogState;
  entryByWord: ReadonlyMap<string, CorpusVocabEntry>;
  example: CorpusGrammarEntry["examples"][number];
  grammarEntry: CorpusGrammarEntry;
  scanFrom: number;
  tokens: readonly string[];
  vocabPool: readonly CorpusVocabEntry[];
}): CandidateSource | null => {
  const sentence = example.japanese;
  for (const word of new Set(tokens)) {
    const targetEntry = entryByWord.get(word);
    if (!targetEntry || catalog.usedVocabWords.has(targetEntry.word)) {
      continue;
    }
    const tokenCount = tokens.reduce(
      (seen, token) => (token === word ? seen + 1 : seen),
      0
    );
    const substringCount = sentence.split(word).length - 1;
    if (tokenCount === 0 || tokenCount !== substringCount) {
      continue;
    }
    const tags = new Set(partsOfSpeechOf(targetEntry));
    const distractors = rotateDistractors({
      isTaken: (surface) => surface === word,
      pool: vocabPool,
      scanFrom,
      size: vocabPool.length,
      surfaceOf: (candidate) =>
        sharesTag(candidate, tags) && !isSameEntry(candidate, targetEntry)
          ? candidate.word
          : undefined,
    });
    // Four options or no item: `validateShape` requires exactly four, so a
    // level too thin for three same-POS siblings declines this word and keeps
    // walking.
    if (distractors.length < MAX_DISTRACTORS) {
      continue;
    }
    // Spend once on BOTH dimensions: the answer word (so the paper never re-asks
    // it) and the grammar example (so one sentence never backs two cloze items).
    catalog.usedGrammarIds.add(grammarEntry.id);
    catalog.usedVocabWords.add(targetEntry.word);
    return {
      anchorId: vocabAnchorFor(targetEntry),
      cue: "",
      distractors,
      level: targetEntry.level,
      pattern: null,
      // A cloze is not a gloss item and never trips the real-mode fallback
      // refusal, so it stays out of the sourcing ledger.
      sourcingCase: undefined,
      stimulus: example,
      target: word,
    };
  }
  return null;
};

/** Every way to cut `total` tokens into STAR_FRAGMENT_COUNT contiguous
 * fragments of 1..STAR_MAX_FRAGMENT_TOKENS each, in a fixed order so a digest
 * index picks the same split every run. Empty when `total` cannot divide. */
const validStarSplits = (total: number): readonly (readonly number[])[] => {
  const found: (readonly number[])[] = [];
  const walk = (parts: readonly number[], used: number): void => {
    if (parts.length === STAR_FRAGMENT_COUNT) {
      if (used === total) {
        found.push(parts);
      }
      return;
    }
    const slotsLeft = STAR_FRAGMENT_COUNT - parts.length - 1;
    for (let size = 1; size <= STAR_MAX_FRAGMENT_TOKENS; size += 1) {
      const next = used + size;
      // Prune to what the remaining slots can still reach: at minimum one
      // token each, at most STAR_MAX_FRAGMENT_TOKENS each.
      if (next + slotsLeft > total) {
        break;
      }
      if (next + slotsLeft * STAR_MAX_FRAGMENT_TOKENS < total) {
        continue;
      }
      walk([...parts, size], next);
    }
  };
  walk([], 0);
  return found;
};

/**
 * TASK-173.6: cut one example sentence into the four fragments of a 文の組み立て
 * item, or null when this sentence cannot carry one.
 *
 * The exam's only real sentences are grammar examples, so a star item reuses the
 * grammar pool `clozeSourceFor` and the grammar picker walk already share: one
 * example backs one item, spent in the same `usedGrammarIds` ledger.
 *
 * The split is the whole construction. A leading context (up to the first 、)
 * is printed outside the blank only when it leaves at least one token per
 * fragment to reorder; a sentence-final 。 is always the printed suffix, never a
 * fragment, because the format forbids a period inside the blank (guidebook
 * rule ②). The middle must then divide into four contiguous fragments of at
 * most three tokens each, all distinct on the surface, and the three cut points
 * plus the ★ slot come from a digest of the seed (never the examId) so the same
 * request rebuilds the same item.
 *
 * AC#2's gate is the last step: `prefix + fragments.join("") + suffix` must
 * reproduce the example byte-for-byte. Tokens join losslessly for almost every
 * Japanese sentence, but a tokenizer that dropped or rewrote a character would
 * silently fail here, so the reconstruction is the proof the fragments really
 * were the sentence, and a candidate is declined rather than shipped on a
 * non-exact reconstruction.
 */
/** The printed head of a star sentence: everything up to and including the
 * first 、, kept only when what follows it is still long enough to reorder
 * into four fragments. Without that length the whole sentence is the region. */
const starHeadSplit = (
  tokens: readonly string[]
): { head: readonly string[]; middle: readonly string[] } => {
  let contextEnd = -1;
  for (let position = 0; position < tokens.length; position += 1) {
    if (tokens[position] === "、") {
      contextEnd = position;
      break;
    }
  }
  const useHead =
    contextEnd !== -1 &&
    tokens.length - (contextEnd + 1) >= STAR_FRAGMENT_COUNT;
  return useHead
    ? {
        head: tokens.slice(0, contextEnd + 1),
        middle: tokens.slice(contextEnd + 1),
      }
    : { head: [], middle: tokens };
};

/** The region with its sentence-final 。 taken out, plus that 。 as the
 * printed suffix: it goes after the cells, never blanked inside them. */
const starTailSplit = (
  middle: readonly string[]
): { body: readonly string[]; suffix: string } => {
  const tailToken = middle.at(-1);
  if (tailToken !== undefined && STAR_PERIOD_TOKENS.includes(tailToken)) {
    return { body: middle.slice(0, -1), suffix: tailToken };
  }
  return { body: middle, suffix: "" };
};

/** Is the reorderable region legal: no period left inside it (one would put 。
 * in a blank, so the whole example is declined rather than building an illegal
 * item), and between four cells and four cells' worth of tokens? */
const starRegionIsLegal = (middle: readonly string[]): boolean =>
  !middle.some((token) => STAR_PERIOD_TOKENS.includes(token)) &&
  middle.length >= STAR_FRAGMENT_COUNT &&
  middle.length <= STAR_FRAGMENT_COUNT * STAR_MAX_FRAGMENT_TOKENS;

/** The four fragment surfaces, contiguous slices of the region in `sizes`
 * order (AC#2: they re-build the region byte for byte). */
const starFragmentsFromSizes = (
  middle: readonly string[],
  sizes: readonly number[]
): string[] => {
  const fragments: string[] = [];
  let cursor = 0;
  for (const size of sizes) {
    fragments.push(middle.slice(cursor, cursor + size).join(""));
    cursor += size;
  }
  return fragments;
};

const starSourceForExample = ({
  catalog,
  entry,
  example,
  index,
  itemType,
  request,
  section,
  tokens,
}: {
  catalog: CandidateCatalogState;
  entry: CorpusGrammarEntry;
  example: CorpusGrammarEntry["examples"][number];
  index: number;
  itemType: QuestionItem["itemType"];
  request: PaperRequest;
  section: PaperSectionId;
  tokens: readonly string[];
}): CandidateSource | null => {
  const sentence = example.japanese;

  // Printed context, if the first 、 leaves enough behind to reorder.
  const { head, middle: region } = starHeadSplit(tokens);
  // A sentence-final 。 is printed after the cells, never blanked inside them.
  const { body: middle, suffix } = starTailSplit(region);

  // Any period still inside the region would put 。 in the blank: decline the
  // whole example rather than build an illegal item.
  if (!starRegionIsLegal(middle)) {
    return null;
  }

  const splits = validStarSplits(middle.length);
  if (splits.length === 0) {
    return null;
  }
  // Seed-only digest, exactly like the cloze walk: `request.seed` and never
  // `examId`, so a resumed exam rebuilds the same item.
  const choice = Number.parseInt(
    digest(
      `${request.seed}:${section}:${itemType}:${index}:${entry.id}:star`
    ).slice(0, 8),
    16
  );
  const sizes = splits[choice % splits.length] as readonly number[];
  const starSlot = Math.floor(choice / splits.length) % STAR_FRAGMENT_COUNT;

  const fragments = starFragmentsFromSizes(middle, sizes);
  // Four distinct surfaces or the 4-option item has a duplicate, which
  // `validateShape` would reject anyway; decline and let the walk keep going.
  if (new Set(fragments).size !== STAR_FRAGMENT_COUNT) {
    return null;
  }

  // AC#2: the fragments are the sentence, verbatim and contiguous.
  if (head.join("") + fragments.join("") + suffix !== sentence) {
    return null;
  }

  // Spend the grammar example on success, sharing the ledger with the cloze and
  // the grammar picker so one sentence never backs two items.
  catalog.usedGrammarIds.add(entry.id);
  return {
    anchorId: grammarAnchorFor(entry),
    cue: "",
    distractors: fragments.filter((_, position) => position !== starSlot),
    fragments,
    level: entry.level,
    pattern: null,
    // A star item never fabricates a distractor and never trips the real-mode
    // fallback refusal, so it stays out of the sourcing ledger.
    sourcingCase: undefined,
    starSlot,
    stimulus: example,
    target: fragments[starSlot] as string,
  };
};

/**
 * TASK-173.6: one 文の組み立て star candidate, or null when the grammar pool
 * cannot back one here. Walks the same seeded grammar pool as the cloze and
 * declines the whole run when no tokenizer is available: an unverified fragment
 * mask prints every fragment in the passage, which is not a reordering question
 * at all.
 */
const starSourceFor = async ({
  catalog,
  grammarPool,
  index,
  itemType,
  offset,
  request,
  section,
  split,
}: {
  catalog: CandidateCatalogState;
  grammarPool: readonly CorpusGrammarEntry[];
  index: number;
  itemType: QuestionItem["itemType"];
  offset: number;
  request: PaperRequest;
  section: PaperSectionId;
  split: TokenSplitter;
}): Promise<CandidateSource | null> => {
  if (grammarPool.length === 0) {
    return null;
  }
  for (let step = 0; step < grammarPool.length; step += 1) {
    const entry = grammarPool[(offset + index + step) % grammarPool.length];
    if (!entry || catalog.usedGrammarIds.has(entry.id)) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: the walk must stop at the first entry whose example yields a reconstructable split, so entries are tokenized one at a time in seeded order.
    const { abort, source } = await scanGrammarExamples(
      entry,
      (example, tokens) =>
        starSourceForExample({
          catalog,
          entry,
          example,
          index,
          itemType,
          request,
          section,
          tokens,
        }),
      split
    );
    if (abort) {
      return null;
    }
    if (source) {
      return source;
    }
  }
  return null;
};

/** The pool an item type draws from, already filtered to what can actually
 * support it: a verb for a conjugation, an entry with a gloss for a gloss
 * question. `poolSize` keeps a small paper from walking the whole level.
 *
 * TASK-148 AC#1: `seenAnchors` is removed BEFORE the `poolSize` slice, not after
 * it. The walk is bounded by the length of the slice it was given, so filtering
 * afterwards would strand every unseen entry past the first `poolSize` and turn
 * a level with plenty of new content into a reported exhaustion. */
const poolFor = (
  corpus: ExamCorpus,
  level: string,
  family: SourceFamily,
  poolSize: number,
  seenAnchors: ReadonlySet<string>
): readonly CorpusVocabEntry[] => {
  const all = corpus.vocabByLevel.get(level) ?? [];
  const canServe = POOL_FILTER_BY_FAMILY[family];
  const filtered = all.filter(
    (entry) => canServe(entry) && !seenAnchors.has(vocabAnchorFor(entry))
  );
  return filtered.slice(0, Math.max(poolSize, MAX_DISTRACTORS + 1));
};

/** The vocabulary pool a DRAW does not use: a distractor scan may walk entries
 * the learner has already answered, because an option is not a question. */
const NO_SEEN_ANCHORS: ReadonlySet<string> = new Set();

/** How many candidates one item type asks the pool for: its allocation plus the
 * reserve for candidates the validator later rejects. One definition, so the
 * paper-wide pool size below and the per-type run cannot disagree about what a
 * type is going to ask for.
 *
 * TASK-148: `reserve` is a parameter because two slots of insurance is not
 * enough on its own. Removing the repeat fallback made a type's own run the only
 * thing between its slots and a hole, and a default N5 paper came up 29/30 on 2
 * of 40 builds: the vocabulary run loses candidates to `duplicate-option` and
 * `stem-leak` rejections often enough to spend both slots. Widening the reserve
 * on a retry rather than shipping a paper the learner cannot start is the fix
 * (`MAX_FILL_ATTEMPTS`), and the walk is deterministic for a given seed, so a
 * wider run is a superset of the narrow one rather than a different paper. */
const candidateCountFor = (required: number, reserve: number): number =>
  Math.min(required + reserve, MAX_CANDIDATES_PER_TYPE);

/** What ONE section's allocation asks of the shared grammar pool, per the
 * same per-type rule `paperGrammarDemand` sums over the paper: a grammar or
 * (join-side) cloze slot always spends an anchor, a star slot only when the
 * real-mode walk actually allocated it. */
const sectionGrammarDemand = (
  allocation: PaperItemTypeCounts,
  request: PaperRequest,
  reserve: number
): number => {
  let total = 0;
  for (const itemType of ITEM_TYPES) {
    const family = SOURCE_FAMILY_BY_ITEM_TYPE[itemType];
    // A cloze is grammar-backed too: `clozeSourceFor` walks this same grammar
    // pool for the example sentence to blank, so every 文脈規定 slot spends
    // one grammar anchor and the pool has to be sized for it. Counting only
    // the `grammar` family left that demand out, and a thin level like N2
    // (measured at 3.9x its 7-slot block) came up short on a repeated paper
    // once `seenAnchors` had spent the shared pool. TASK-173.9.29 moves the
    // demand for exactly those thin levels: an N3/N2/N1 文脈規定 slot is now
    // served whole-row from the kitei store and spends NO grammar anchor, so
    // counting it here would prepend anchors to a pool the walk never draws
    // from and shift the seed's grammar pick ordering.
    const spendsGrammarAnchor =
      family === "grammar" ||
      (family === "cloze" && !KITEI_STORE_LEVELS.has(request.level));
    if (spendsGrammarAnchor) {
      total += candidateCountFor(allocation[itemType], reserve);
    } else if (family === "star" && allocation[itemType] > 0) {
      // TASK-173.6: a star item draws its sentence from this same pool, so a
      // real-mode 文の組み立て slot spends one grammar anchor and belongs in
      // this number. It is gated on a nonzero allocation because the star type
      // is asked ONLY through the real-mode block walk: a shortened paper gives
      // it 0 slots and its picker loop skips it, so counting a zero slot's
      // reserve here would prepend an anchor to a pool that paper never draws
      // from and shift that seed's walk. The grammar and cloze families above
      // keep their zero-slot reserve untouched - that over-provisioning is
      // pre-existing and every shortened pool already sizes for it.
      total += candidateCountFor(allocation[itemType], reserve);
    }
  }
  return total;
};

/** How many grammar points this whole paper will ask the pool for, summed over
 * every section the request actually includes. The per-type allocation is not
 * enough: the spent-once rule is per PAPER, so the pool has to serve the paper.
 *
 * TASK-148: the ask is measured in CANDIDATES rather than in accepted items,
 * because removing the repeat fallback made the pool the only thing standing
 * between a full paper and a hole. Each type asks for `required` plus the
 * rejected-candidate reserve, so a pool sized for the items alone starves the last types of a large paper: on a clean
 * database N1 exam-conditions wants 35 grammar items but 63 candidates, and the
 * old per-type `max(candidateCount * 4, …)` gave it 42 points. That shortage was
 * invisible while exhaustion degraded to a repeat; with no repeat available it
 * is a hole in the first paper a learner ever asks for. */
const paperGrammarDemand = (request: PaperRequest, reserve: number): number => {
  const blueprint = paperBlueprintFor(request.level);
  let total = 0;
  for (const section of blueprint.sections) {
    if (!request.sections.includes(section.id)) {
      continue;
    }
    // The same allocator the picker uses, so the demand is the paper's real
    // demand rather than an item-type count that ignores the budget split. In
    // real mode that is the 大問 walk, whose mix is not the flat one.
    total += sectionGrammarDemand(
      allocatePaperMix({
        budget: request.budget[section.id] ?? 0,
        level: request.level,
        mode: request.mode,
        section: section.id,
      }),
      request,
      reserve
    );
  }
  return total;
};

/** TASK-148: like `poolFor`, the unseen filter runs before the slice, so a level
 * whose head is already spent widens into its tail instead of reporting
 * exhaustion early. The cap matters here: N5 has 77 grammar points and N1 150,
 * so a large paper's pool ask can reach past them and the pool is then simply
 * "everything unseen at this level". */
const grammarPoolFor = (
  corpus: ExamCorpus,
  level: string,
  poolSize: number,
  seenAnchors: ReadonlySet<string>
): readonly CorpusGrammarEntry[] =>
  (corpus.grammarByLevel.get(level) ?? [])
    .filter(
      (entry) =>
        entry.examples.length > 0 && !seenAnchors.has(grammarAnchorFor(entry))
    )
    .slice(0, Math.max(poolSize, MAX_DISTRACTORS + 1));

/** One sourced candidate for a slot, or null when the family's pool cannot
 * supply one. Split out of `appendItemTypeCandidates` so the run loop reads as
 * a loop and the two family policies sit side by side. */
/**
 * TASK-140: the focus prior.
 *
 * `request.focus` is the learner's weak anchors (doc-14 §3), and it is a PRIOR,
 * not a filter. For each slot the picker first offers the focus anchor at that
 * position, when it is the right family for the item type and has not already
 * been spent in this paper; otherwise it falls through to the seeded pool walk
 * unchanged. Three properties fall out of that shape:
 *
 *  - a two-id focus still yields a full paper, because exhaustion falls back
 *    rather than filtering the pool down to nothing (AC#2);
 *  - an unknown or wrong-family id is a no-op rather than a throw (AC#2);
 *  - the order is the caller's, and the request is persisted (TASK-139), so the
 *    same request and seed produce the same paper (AC#3).
 *
 * A focus anchor of the wrong family is skipped rather than coerced: a
 * grammar id cannot become a vocabulary item, and an item type that cannot
 * express a grammar point should not be forced to.
 *
 * TASK-148: the prior is also exempt from the seen-anchor exclusion, and
 * deliberately so. It resolves its entry straight out of `grammarByAnchor` /
 * `vocabByAnchor` rather than through the filtered pool walk, so a weak anchor
 * the learner has already been asked stays askable. Excluding it would make the
 * debrief-to-focus loop (doc-14 §3) unable to ever re-ask the thing it exists to
 * re-ask. Its distractor scan passes `NO_SEEN_ANCHORS` for the same reason: an
 * option is not a question.
 */
const focusSourceFor = ({
  catalog,
  corpus,
  family,
  index,
  itemType,
  request,
}: {
  catalog: CandidateCatalogState;
  corpus: ExamCorpus;
  family: SourceFamily;
  index: number;
  itemType: QuestionItem["itemType"];
  request: PaperRequest;
}): CandidateSource | null => {
  const anchorId = request.focus[index];
  if (!anchorId) {
    return null;
  }
  if (family === "grammar") {
    const entry = corpus.grammarByAnchor.get(anchorId);
    if (!entry) {
      return null;
    }
    // The same spent-once discipline as the pool walk, so a focus anchor cannot
    // fill two slots of the same paper.
    if (catalog.usedFocusAnchors.has(anchorId)) {
      return null;
    }
    const source = grammarSourceFor({
      entry,
      index,
      itemType,
      pool: grammarPoolFor(corpus, request.level, 400, NO_SEEN_ANCHORS),
      scanFrom: index + 1,
    });
    if (source) {
      catalog.usedFocusAnchors.add(anchorId);
    }
    return source;
  }
  const entry = corpus.vocabByAnchor.get(anchorId);
  if (!entry) {
    return null;
  }
  if (catalog.usedVocabWords.has(entry.word)) {
    return null;
  }
  const source = vocabSourceFor({
    entry,
    family,
    pool: poolFor(corpus, request.level, family, 400, NO_SEEN_ANCHORS),
    scanFrom: index + 1,
  });
  if (source) {
    catalog.usedVocabWords.add(entry.word);
  }
  return source;
};

const nextVocabSource = ({
  catalog,
  family,
  index,
  offset,
  pool,
}: {
  catalog: CandidateCatalogState;
  family: SourceFamily;
  index: number;
  offset: number;
  pool: readonly CorpusVocabEntry[];
}): CandidateSource | null => {
  // TASK-138 AC#10: a bare-gloss item for a SINGLE-GROUP entry is unanswerable,
  // because there is no other sense group to draw a distractor from. Offering the
  // same-POS pool instead produces exactly the items three commits and d2ca745
  // call untestable - 入口:いりぐち became "entrance | salt | yellow | skillful",
  // where the wrong options are not wrong MEANINGS of the word at all.
  //
  // So the walk declines those anchors and keeps looking. The right answer for
  // such an anchor is a different ITEM TYPE, not a weaker distractor, and
  // declining it here is what lets another anchor take the bare-gloss slot.
  //
  // Declining is not the same as giving up: if the walk exhausts the pool with
  // every multi-group entry already spent, single-group entries are admitted
  // rather than returning null. TASK-148 makes that the RIGHT trade rather than
  // merely the convenient one: a single-group item is still a question the
  // learner has never seen, only with a weaker set of wrong options, while the
  // alternative was to re-serve an anchor they have already answered. A short
  // paper is a worse outcome than one weak item, and the honest ordering is:
  // new content first, filled paper second.
  // "Has a second group" is not the same as "can produce a distractor from
  // another group". The check must mirror `ownConfirmed` exactly, because the
  // two diverged: `ownConfirmed` drops every group CONTAINING the target and
  // then drops renderings that are in the target's own group, while the old
  // check only compared against group 0. When a rendering appears in two
  // groups the target is in, the old check passed and `ownConfirmed` came back
  // empty - the item fell through to the same-POS pool, which is the untestable
  // shape the whole design exists to remove.
  const serves = (candidate: CorpusVocabEntry): boolean => {
    if (family !== "gloss") {
      return true;
    }
    const groups = senseGroupsOf(candidate);
    if (groups.length < 2) {
      return false;
    }
    const target = candidate.senses?.[0]?.[0] ?? "";
    const ownGroup = groups.find((group) => group.includes(target));
    if (ownGroup === undefined) {
      return false;
    }
    return groups
      .filter((group) => !group.includes(target))
      .flat()
      .some((gloss) => !ownGroup.includes(gloss));
  };

  for (let pass = 0; pass < 2; pass += 1) {
    // Pass 0 declines single-group entries; pass 1 is the exhaustion fallback
    // that admits them so the section still meets its budget.
    for (let step = 0; step < pool.length; step += 1) {
      const entry = pool[(offset + index + step) % pool.length];
      if (!entry || catalog.usedVocabWords.has(entry.word)) {
        continue;
      }
      if (pass === 0 && !serves(entry)) {
        catalog.declinedAnchors.add(vocabAnchorFor(entry));
        continue;
      }
      const sourced = vocabSourceFor({
        entry,
        family,
        pool,
        scanFrom: offset + index + step + 1,
      });
      if (sourced) {
        catalog.usedVocabWords.add(entry.word);
      }
      return sourced;
    }
  }
  return null;
};

/** The grammar pool's turn in the fallback: the item reads its seeded slot and,
 * when the pool still has one, walks the pool for a point this paper has not
 * used. An empty pool returns null, which the caller counts as a shortfall. */
const grammarPoolSourceFor = ({
  catalog,
  index,
  itemType,
  offset,
  pool,
}: {
  catalog: CandidateCatalogState;
  index: number;
  itemType: QuestionItem["itemType"];
  offset: number;
  pool: readonly CorpusGrammarEntry[];
}): CandidateSource | null => {
  const entry = pool[(offset + index) % pool.length];
  return entry
    ? nextGrammarSource({ catalog, index, itemType, offset, pool })
    : null;
};

const nextGrammarSource = ({
  catalog,
  index,
  itemType,
  offset,
  pool,
}: {
  catalog: CandidateCatalogState;
  index: number;
  itemType: QuestionItem["itemType"];
  offset: number;
  pool: readonly CorpusGrammarEntry[];
}): CandidateSource | null => {
  // TASK-138 AC#9: walk past grammar points this paper has already used, so a
  // second item type cannot re-ask a question the paper already contains. The
  // walk is bounded by the pool and returns null when the level's grammar is
  // exhausted, which the caller already handles as a shortfall.
  for (let step = 0; step < pool.length; step += 1) {
    const candidate = pool[(offset + index + step) % pool.length];
    if (!candidate || catalog.usedGrammarIds.has(candidate.id)) {
      continue;
    }
    const source = grammarSourceFor({
      entry: candidate,
      index,
      itemType,
      pool,
      scanFrom: offset + index + step + 1,
    });
    if (source) {
      catalog.usedGrammarIds.add(candidate.id);
      return source;
    }
  }
  // Pool exhausted. TASK-148 reverses TASK-138's choice here: the first version
  // of this fix returned null and N1 exam-conditions lost 9 of its 10 listening
  // items, because the walk spent a point at SOURCING time and a candidate the
  // validator later rejected had still consumed one. That is fixed by sizing the
  // pool from the whole paper's grammar demand (see `paperGrammarDemand`), and
  // the hole it was papering over is now the property: a repeated question is
  // worse than a hole, because the hole is reportable and the repeat is a lie
  // about how much of the level the learner has seen. The null is what makes
  // `assemble` report a shortfall instead of filling it.
  return null;
};

/** Route one slot's candidate request to its source picker. The store-backed
 * families and the cloze/star joins bypass the focus prior entirely: a 長文
 * window, a 中文, or a 聴解 row is sourced whole from its own store, so the
 * prior would only hand back a vocab/grammar anchor the store picker then
 * ignores. Everything else takes the focus prior FIRST and falls back to the
 * seeded pool walk, so a request with no focus produces exactly the paper it
 * did before the focus feature (TASK-173.5/173.6: a cloze is neither a gloss
 * nor a grammar point, and a star item is the same story, so both route past
 * the prior straight to their own seeded join). Empty store => null => block
 * short => the real paper names its 大問 hole instead of inventing the text;
 * store picks are synchronous because the spend is applied as the walk
 * decides, which is what keeps two 小問 off one passage or pair. */
const pickItemTypeSource = async ({
  catalog,
  corpus,
  family,
  grammarPool,
  index,
  itemType,
  offset,
  request,
  section,
  split,
  vocabPool,
}: {
  catalog: CandidateCatalogState;
  corpus: ExamCorpus;
  family: SourceFamily;
  grammarPool: readonly CorpusGrammarEntry[];
  index: number;
  itemType: QuestionItem["itemType"];
  offset: number;
  request: PaperRequest;
  section: PaperBlueprintSection["id"];
  split: TokenSplitter;
  vocabPool: readonly CorpusVocabEntry[];
}): Promise<CandidateSource | null> => {
  if (choubunWindowSourced(itemType, request.mode)) {
    // TASK-173.9.12: a 長文 window is sourced whole from its reading store, so
    // it bypasses the focus prior and the vocab/grammar pool walkers exactly
    // as a 中文 does.
    return choubunSourceFor({ catalog, index, level: request.level, offset });
  }
  if (family === "cloze") {
    // TASK-173.9.29: at N3/N2/N1 文脈規定 is served whole-row from the authored
    // kitei store, and there is NO fallback between the two paths: an exhausted
    // store must name the hole (TASK-173.1), not silently resume the derived
    // join that filled 2/11, 1/7 and 0/7 (measured 2026-10-13). N4/N5 keep the
    // join, where it fills.
    if (KITEI_STORE_LEVELS.has(request.level)) {
      return kiteiSourceFor({ catalog, index, level: request.level, offset });
    }
    return await clozeSourceFor({
      catalog,
      grammarPool,
      index,
      offset,
      split,
      vocabPool,
    });
  }
  if (family === "star") {
    return await starSourceFor({
      catalog,
      grammarPool,
      index,
      itemType,
      offset,
      request,
      section,
      split,
    });
  }
  const storePicker = STORE_SOURCE_PICKER_BY_FAMILY[family];
  if (storePicker) {
    // TASK-173.7 短文, TASK-173.9.2 中文, TASK-173.9.x slice 2 主張理解,
    // TASK-173.9.7 情報検索, TASK-173.9.3 統合理解: a store-backed reading
    // family is sourced whole from its own store.
    return storePicker({ catalog, index, level: request.level, offset });
  }
  return (
    focusSourceFor({ catalog, corpus, family, index, itemType, request }) ??
    (family === "grammar"
      ? grammarPoolSourceFor({
          catalog,
          index,
          itemType,
          offset,
          pool: grammarPool,
        })
      : nextVocabSource({
          catalog,
          family,
          index,
          offset,
          pool: vocabPool,
        }))
  );
};

/** One built candidate before the refusal filter drops it out of the push. */
interface UsableCandidate {
  readonly item: QuestionItem;
  readonly source: CandidateSource;
}

/** TASK-173.6: keep the fragments and the ★ slot so `satisfies` can prove a
 * SECOND fragment fits the blank (AC#4). Only a star item carries them, and
 * `sentence` is the example the source reconstructed, which is what the
 * fragments permute back into. */
const recordStarFragments = (
  catalog: CandidateCatalogState,
  family: SourceFamily,
  item: QuestionItem,
  source: CandidateSource
): void => {
  if (family === "star" && source.fragments && source.stimulus) {
    catalog.fragmentRecords.set(item.id, {
      fragments: source.fragments,
      sentence: source.stimulus.japanese,
      starSlot: source.starSlot ?? 0,
    });
  }
};

/**
 * The ordered push pass. `catalog` is only ever mutated here, which is what
 * keeps the shared word-spend safe; a refused entry arrives as null and
 * contributes nothing.
 */
const recordUsableCandidates = ({
  catalog,
  family,
  section,
  usable,
}: {
  catalog: CandidateCatalogState;
  family: SourceFamily;
  section: PaperBlueprintSection["id"];
  usable: readonly (UsableCandidate | null)[];
}): void => {
  for (const entry of usable) {
    if (!entry) {
      continue;
    }
    const { item, source } = entry;
    catalog.anchorLevels.set(source.anchorId, source.level);
    catalog.targetByItemId.set(item.id, source.target);
    if (source.sourcingCase !== undefined) {
      catalog.sourcingCases.set(item.id, source.sourcingCase);
    }
    recordStarFragments(catalog, family, item, source);
    catalog.candidates.push({
      item,
      // TASK-138 AC#3: every non-answer option is attested as a corpus
      // surface of the same family. The old catalog could not say this,
      // because its three distractors were literals with no provenance.
      // TASK-173.6: a star item's distractors are the OTHER fragments of the
      // very sentence this anchor backs, so their relation is `stimulus`, the
      // anchored material itself, not a same-part-of-speech coincidence.
      optionSources: item.options.map((_, optionIndex) =>
        optionIndex === 0
          ? { anchorId: source.anchorId, kind: "answer" }
          : {
              anchorId: source.anchorId,
              kind: "corpus",
              relation: family === "star" ? "stimulus" : "same-pos",
            }
      ),
      section,
    });
  }
};

const appendItemTypeCandidates = async ({
  catalog,
  corpus,
  examId,
  itemType,
  request,
  required,
  reserve,
  section,
  split,
}: {
  catalog: CandidateCatalogState;
  corpus: ExamCorpus;
  examId: string;
  itemType: QuestionItem["itemType"];
  request: PaperRequest;
  required: number;
  reserve: number;
  section: PaperBlueprintSection["id"];
  split: TokenSplitter;
}): Promise<void> => {
  const candidateCount = candidateCountFor(required, reserve);
  const family = SOURCE_FAMILY_BY_ITEM_TYPE[itemType];
  // A pool a few times the run, so a paper does not simply take the first N
  // of the level. Sized from the run, not the level: N1 has 3,475 entries and
  // a 20-item section wants 22.
  // TASK-138 AC#9: a grammar pool sized from ONE item type is too small for the
  // grammar demand across types.
  // TASK-173.9.x slice 2: 主張理解 is 入試-阅读-backed like 中文, so it uses the
  // same white-paper store picker, not the vocabulary/grammar pool.
  // PAPER. Each type sized its own pool from its own run, so an N1 paper's ten
  // listening items drew from the first 48 grammar points while the reading
  // section had already walked them - the spent-once rule then had nothing left
  // and could only repeat. The pool is now sized from the whole paper's grammar
  // demand, so every grammar-backed type draws from one pool big enough for all
  // of them, which is what makes the rule achievable rather than best-effort.
  const grammarDemand = paperGrammarDemand(request, reserve);
  const poolSize = Math.min(
    Math.max(candidateCount * 4, grammarDemand + MAX_DISTRACTORS + 4),
    400
  );
  const vocabPool = poolFor(
    corpus,
    request.level,
    family,
    poolSize,
    catalog.seenAnchors
  );
  const grammarPool = grammarPoolFor(
    corpus,
    request.level,
    poolSize,
    catalog.seenAnchors
  );
  // Same seeded digest as before, now a raw offset into a corpus pool rather
  // than a wrap over sixteen literals.
  // The walk seed is `request.seed` ALONE, and deliberately does not include
  // `examId`.
  //
  // It used to be `${examId}:${request.seed}`, which made an explicit seed
  // useless: `examId` is `exam-${randomUUID()}`, freshly minted per request, so
  // two requests with the same seed walked different parts of the pool and drew
  // different papers. That contradicted the property doc-21 §9 and TASK-139's
  // migration both rely on - "a resumed exam is the same request" - and it made
  // every draw-distribution assertion non-deterministic, which is why the
  // single-group share in exam-sense-groups.test.ts had to concede a loose bar
  // instead of pinning the real number.
  //
  // `parseRequest` already substitutes `generated-${randomUUID()}` when the
  // caller supplies no seed, so an unseeded request stays unique on its own and
  // nothing else is needed to keep variety. The other digests in this file keep
  // `examId` on purpose: those mint per-item identity, and two papers must not
  // collide there.
  const offset = Number.parseInt(
    digest(`${request.seed}:${section}:${itemType}`).slice(0, 8),
    16
  );

  // Built concurrently: masking is a tokenizer call per item and they are
  // independent. The push is a separate ordered pass so `catalog` is only ever
  // mutated in one place, which is what keeps the shared word-spend safe.
  const built = await Promise.all(
    Array.from({ length: candidateCount }, async (_, index) => {
      const source = await pickItemTypeSource({
        catalog,
        corpus,
        family,
        grammarPool,
        index,
        itemType,
        offset,
        request,
        section,
        split,
        vocabPool,
      });
      return source
        ? candidateItem({
            anchorId: source.anchorId,
            examId,
            index,
            itemType,
            request,
            section,
            source,
            split,
          }).then((item) => ({ item, source }))
        : null;
    })
  );

  // TASK-148 AC#4: the run came up dry. The walk is bounded by the pool this
  // family has left, so fewer sources than the type needs means the unseen
  // content at this level cannot fill the blueprint, and every slot it could
  // not reach is going to be a hole. `sourced < required` rather than
  // `pool.length === 0`, because a drained level usually stops like this: N5
  // holds 77 grammar points, so the tenth paper found five unseen ones, filled
  // six of its ten slots, and had twelve points left that no item type could
  // use. An empty pool is the rarer case, not the one that happens.
  //
  // A shortfall this does NOT cover is one the pool could fill - a candidate the
  // validator rejected - and that stays the plain shortfall it was, because
  // telling a learner they have run a level dry is a claim about their history,
  // not about a bug in the picker.
  //
  // Recorded rather than thrown: a short paper is still a paper, and the receipt
  // is what tells the learner why it is short.
  //
  // TASK-173.1 AC#3: a real paper refuses rather than fabricates. An item whose
  // wrong options only existed by widening away from the entry's own sense group
  // (a `same-pos-pool` or `single-group-fallback` distractor) is not the kind the
  // real JLPT asks, so in real mode it does not fill its slot. Daily and
  // exam-conditions keep filling from the fallback, so their papers are unchanged.
  //
  // TASK-173.9.5 AC#1/AC#2: a `composed` reading row joins the refusal by the
  // SAME rule, not a new one. Its prose may be verbatim licensed material with an
  // authored question (a masked slot) or prose this repo wrote whole (the authored
  // route); either way the question and answer key are not proven by the corpus the
  // way it proves a verbatim N5 item. An UNVALIDATED composed row `real` therefore
  // turns down; `shortened`/`exam-conditions` (practice papers, already labeled as
  // such) still serve it. A composed row whose key was falsified offline
  // (`validated: true`, AC#2) is the one exception 173.9.5 grants real mode: that
  // pass is the corpus-proof that was missing, so it is NOT refused.
  // Dropping the `!entry.source.validated` term below would launder an unproven
  // key back into a real paper, and the mutation gate pins exactly that.
  const isRefused = (entry: { source: CandidateSource } | null): boolean =>
    entry !== null &&
    request.mode === "real" &&
    (isFallbackSourcing(entry.source.sourcingCase) ||
      (entry.source.provenance === "composed" && !entry.source.validated));
  // The exhaustion bookkeeping stays on `built`, BEFORE the refusal: TASK-148's
  // flag is a claim about the learner's history, and a real paper that turned down
  // a fallback has not run out of history. Its own gap is recorded separately.
  const sourced = built.filter((entry) => entry !== null).length;
  if (sourced < required) {
    catalog.exhaustedFamilies.add(family);
  }
  if (built.some(isRefused)) {
    catalog.refusedSections.add(section);
  }
  const usable = built.map((entry) => (isRefused(entry) ? null : entry));

  recordUsableCandidates({ catalog, family, section, usable });
};

/**
 * `surfaceByFamily` is exposed because "is the answer one of the entry's own
 * glosses" is a whole-corpus invariant that assembling papers cannot reach - the
 * four entries mangled by the summary parse are N1-N3, so a seed-based search
 * would pass vacuously most of the time. `sensesOf` is NOT a substitute for it:
 * `sensesOf` parses the summary, which is the bug being tested for.
 */
const appendSectionCandidates = async ({
  catalog,
  corpus,
  examId,
  request,
  reserve,
  section,
  split,
}: {
  catalog: CandidateCatalogState;
  corpus: ExamCorpus;
  examId: string;
  request: PaperRequest;
  reserve: number;
  section: PaperBlueprintSection;
  split: TokenSplitter;
}): Promise<void> => {
  const allocation = allocatePaperMix({
    budget: request.budget[section.id] ?? 0,
    level: request.level,
    mode: request.mode,
    section: section.id,
  });
  for (const itemType of ITEM_TYPES) {
    const required = allocation[itemType];
    if (required === 0) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: the allocation is per item TYPE and the catalog's word-spend is shared mutable state, so the runs must land in order rather than race. The tokenizer calls inside a run are already concurrent.
    await appendItemTypeCandidates({
      catalog,
      corpus,
      examId,
      itemType,
      request,
      required,
      reserve,
      section: section.id,
      split,
    });
  }
};

/**
 * TASK-173.6 AC#4: the sentences the corpus itself attests, memoised per corpus.
 * A star item's answer is unique only when NO other offered fragment can fill
 * the ★ slot to make a sentence this corpus actually contains, so the write-time
 * `satisfies` seam tests each candidate reassembly against this set.
 *
 * Built from every grammar example, so an alternative is counted only when the
 * corpus genuinely attests it. That makes the refusal conservative: zero false
 * rejects (an unattested string is never treated as valid) and low recall (a
 * real-but-unrecorded reordering slips through) - the same honest residual the
 * cloze documents, and the reason the block's fill stays high. A `WeakMap` keyed
 * on the corpus so the set drops with the corpus it indexes and the build stays
 * off the assembly hot path.
 */
const attestedSentences = new WeakMap<ExamCorpus, ReadonlySet<string>>();
const attestedSentenceSet = (corpus: ExamCorpus): ReadonlySet<string> => {
  const cached = attestedSentences.get(corpus);
  if (cached !== undefined) {
    return cached;
  }
  const sentences = new Set<string>();
  for (const entries of corpus.grammarByLevel.values()) {
    for (const entry of entries) {
      for (const example of entry.examples) {
        sentences.add(example.japanese);
      }
    }
  }
  attestedSentences.set(corpus, sentences);
  return sentences;
};

/** Every ordering of `items`. A star item has exactly four fragments, so this is
 * bounded at 4! = 24 by the shape, never by the corpus. */
const permutationsOf = (
  items: readonly string[]
): readonly (readonly string[])[] => {
  if (items.length <= 1) {
    return [items];
  }
  const result: (readonly string[])[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const head = items[index] as string;
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutationsOf(rest)) {
      result.push([head, ...tail]);
    }
  }
  return result;
};

/** Guidebook rule ②: a fragment that ends the sentence may never sit in a
 * non-final slot. A reassembly that breaks this is not a legal alternative
 * answer, so it does not make the item ambiguous even if its string happens to
 * be attested. */
const isLegalReassembly = (perm: readonly string[]): boolean => {
  const finalSlot = perm.length - 1;
  return perm.every(
    (fragment, index) =>
      index === finalSlot ||
      !STAR_PERIOD_TOKENS.some((token) => fragment.includes(token))
  );
};

/** AC#4: does some legal, corpus-attested reassembly place `option` in the ★
 * slot? If so it is a second correct answer and the item is ambiguous. The
 * option reaching here is never the target (that returned "yes" upstream), so
 * the original ordering fails the `perm[starSlot] === option` test and is
 * skipped; only a genuine reordering that lands `option` at ★ can satisfy. */
const satisfiesStar = (
  record: StarFragmentRecord,
  option: string,
  corpus: ExamCorpus
): boolean => {
  const context = spanContextOf(record.sentence, record.fragments.join(""));
  if (context === null) {
    return false;
  }
  const sentences = attestedSentenceSet(corpus);
  for (const perm of permutationsOf(record.fragments)) {
    if (perm[record.starSlot] !== option || !isLegalReassembly(perm)) {
      continue;
    }
    if (sentences.has(context.prefix + perm.join("") + context.suffix)) {
      return true;
    }
  }
  return false;
};

/** AC#4: does a NON-answer star fragment fill the ★ slot? Fetches the item's
 * fragment ledger and defers the permutation walk to `satisfiesStar`. A "yes"
 * is what `evaluateSatisfaction` turns into an `ambiguous` refusal, so the item
 * never reaches a learner. Null corpus or a missing record means nothing to
 * prove, so it is not ambiguous. */
const starOptionSatisfies = (
  item: QuestionItem,
  option: string,
  corpus: ExamCorpus | null,
  fragmentRecords: ReadonlyMap<string, StarFragmentRecord>
): boolean => {
  if (corpus === null) {
    return false;
  }
  const record = fragmentRecords.get(item.id);
  return record !== undefined && satisfiesStar(record, option, corpus);
};

/** AC#8 (bare-gloss): is `option` another rendering of the target entry's own
 * sense group? Resolution goes through the real corpus, so an anchor that is
 * not a vocab entry, or an option outside the answer's group, is a legitimate
 * distractor and does not satisfy. Group membership, not flat-gloss membership
 * - checking the flat list is what wrongly made "amber" a second answer. */
const glossOptionSatisfies = (
  item: QuestionItem,
  target: string,
  option: string,
  corpus: ExamCorpus
): boolean => {
  const [anchor] = item.anchors;
  if (anchor === undefined) {
    return false;
  }
  const entry = corpus.vocabByAnchor.get(anchor);
  return entry !== undefined && synonymsOf(entry, target).includes(option);
};

/** The anchor namespaces `resolveAnchor` attests from `anchorLevels` alone,
 * without a vocab or grammar corpus hit (the trust model each TASK added):
 *
 *  - `reading:` (TASK-173.7): a 短文 anchor is a reading-store id, not a vocab
 *    or grammar entry, so the corpus maps do not know it. It is the one
 *    namespace the catalog may attest from `anchorLevels`, which only ever
 *    holds a reading anchor that a source genuinely drew from the licensed
 *    store this build - the same trust the vocab/grammar path gets from a
 *    corpus hit. Every other unknown id still resolves to null, so the anchor
 *    check keeps meaning "this is real content".
 *  - `usage:` (TASK-173.9.23): the 用法 store row id; same trust model - the
 *    catalog only ever records an anchor the source actually drew from the
 *    validated 用法 store.
 *  - `bunshou:` (TASK-173.9.24): the 文章の文法 store row id; same trust model -
 *    the catalog only ever records an anchor a source drew from the
 *    blind-certified 文章の文法 store.
 *  - `hyouki:` (TASK-173.9.25): the 表記 store row id; same trust model - the
 *    catalog only ever records an anchor a source drew from the
 *    blind-certified 表記 store, whose key spelling is itself a
 *    vocab-corpus-attested word+reading pair.
 *  - `goseikei:` (TASK-173.9.26): the 語形成 store row id; same trust model -
 *    the catalog only ever records an anchor a source drew from the
 *    blind-certified 語形成 store, whose key compound is itself pure-kanji
 *    attested in the vocab corpus.
 *  - `iikae:` (TASK-173.9.27): the 言い換え store row id; same trust model -
 *    the catalog only ever records an anchor a source drew from the
 *    blind-certified 言い換え store, whose bracketed target is itself the
 *    exact headword of that level's band file.
 *  - `iikae-sentence:` (TASK-173.9.28): the sentence form's own namespace (the
 *    trailing colon is what keeps it out of the `iikae:` prefix above); same
 *    trust model - the catalog only ever records an anchor a source drew from
 *    the blind-certified sentence store, whose answer is one of four whole
 *    sentences re-saying the passage.
 *  - `listening-` (TASK-173.8.1): the 聴解 blocks use
 *    `listening-{kadai,point,hatsuwa,sokuji,gaiyou,choukai}:${id}` (the
 *    listening store row id); same trust model - the catalog only ever records
 *    an anchor a source drew from that block's own store, whose authored rows
 *    cleared the two blind judge passes and whose licensed rows carry their
 *    CC BY-SA tag. */
const TRUSTED_ANCHOR_NAMESPACES: readonly string[] = [
  "reading:",
  "usage:",
  "bunshou:",
  "hyouki:",
  "goseikei:",
  "iikae:",
  "iikae-sentence:",
  "kitei:",
  "listening-",
];

const candidateCatalogCorpus = (
  targetByItemId: ReadonlyMap<string, string>,
  anchorLevels: ReadonlyMap<string, string>,
  corpus: ExamCorpus | null,
  fragmentRecords: ReadonlyMap<string, StarFragmentRecord>
): ItemCorpusView => ({
  isOptionSourceValid: (item, source) =>
    item.anchors.includes(source.anchorId) && anchorLevels.has(source.anchorId),
  maxPassageLength: (item) => {
    if (item.itemType === "long-reading") {
      return LONG_READING_MAX_PASSAGE_LENGTH;
    }
    if (item.itemType === "claim-understanding") {
      return MEDIUM_READING_MAX_PASSAGE_LENGTH;
    }
    if (item.itemType === "medium-reading") {
      return MEDIUM_READING_MAX_PASSAGE_LENGTH;
    }
    if (item.itemType === "integrated-reading") {
      return INTEGRATED_READING_MAX_PASSAGE_LENGTH;
    }
    if (item.itemType === "text-comparison") {
      return TOUGOU_MAX_PASSAGE_LENGTH;
    }
    if (item.itemType === "info-search") {
      return JOUHOU_MAX_PASSAGE_LENGTH;
    }
    if (item.itemType === "discourse-cloze") {
      return BUNSHOU_MAX_PASSAGE_LENGTH;
    }
    return MAX_PASSAGE_LENGTH;
  },
  // TASK-138 AC#1: resolution goes through the real corpus, so an anchor
  // that is not a real entry returns null and the validator's anchor check
  // means something. Before this, any id the service had registered itself
  // resolved, which made doc-16 §2's anchor guarantee vacuous.
  resolveAnchor: (anchorId) => {
    if (!corpus) {
      return null;
    }
    const level =
      corpus.vocabByAnchor.get(anchorId)?.level ??
      corpus.grammarByAnchor.get(anchorId)?.level ??
      // The store-row namespaces trust `anchorLevels` instead of a corpus hit;
      // see `TRUSTED_ANCHOR_NAMESPACES` for each namespace's own proof.
      (TRUSTED_ANCHOR_NAMESPACES.some((prefix) => anchorId.startsWith(prefix))
        ? anchorLevels.get(anchorId)
        : undefined);
    if (!(level && anchorLevels.has(anchorId))) {
      return null;
    }
    return { id: anchorId, level, surfaces: ["exam"] };
  },
  // TASK-138 AC#8: the write-time half of the bare-gloss fix. The picker no
  // longer offers the target entry's other senses, but a rule only the picker
  // obeys is a rule the next item type routes around - so the refusal lives
  // here, where a fact the validator can check is checked.
  //
  // `satisfies` answers "is this option a correct answer to the question?", and
  // `evaluateSatisfaction` rejects an item as `ambiguous` the moment MORE THAN
  // ONE option satisfies. So answering "yes" for every sense of the target
  // entry - not just the recorded one - makes an ambiguous bare-gloss item
  // unrepresentable: it cannot pass validation, so it cannot be stored, so it
  // cannot reach a learner. No new rejection reason and no post-assembly filter
  // were needed; the seam was already here and unused for this fact.
  //
  // Scoped to the gloss family on purpose. A reading item's options are
  // readings and a conjugation item's are words, so comparing them against
  // English glosses would be a category error that happened to pass. Gating on
  // the family table rather than on one item type means a new gloss type
  // inherits the rule instead of quietly escaping it.
  satisfies: (item, optionIndex) => {
    const target = targetByItemId.get(item.id);
    if (target === undefined) {
      return "unknown";
    }
    const option = item.options[optionIndex];
    if (option === undefined) {
      return "unknown";
    }
    if (option === target) {
      return "yes";
    }
    // TASK-173.6 AC#4: a star item is ambiguous when a DIFFERENT offered
    // fragment can fill the ★ slot to rebuild a sentence the corpus attests.
    // The answer is already handled above (byte-equality with the recorded
    // target); this decides the three distractors, and a "yes" here is what
    // `evaluateSatisfaction` turns into an `ambiguous` refusal so the item
    // never reaches a learner. Gated on the family table, like the gloss rule
    // below, so a future star-shaped type inherits it.
    const family = SOURCE_FAMILY_BY_ITEM_TYPE[item.itemType];
    if (family === "star") {
      return starOptionSatisfies(item, option, corpus, fragmentRecords)
        ? "yes"
        : "no";
    }
    // TASK-138 AC#8: the write-time half of the bare-gloss fix. The picker no
    // longer offers the target entry's other senses, but a rule only the picker
    // obeys is a rule the next item type routes around - so the refusal lives
    // here, where a fact the validator can check is checked. The test is GROUP
    // membership, not gloss membership: every rendering of the answer's own
    // group is a correct answer (AC#8's bug), while a rendering of a different
    // group is a legitimate distractor.
    if (family === "gloss" && corpus !== null) {
      return glossOptionSatisfies(item, target, option, corpus) ? "yes" : "no";
    }
    return "no";
  },
});

/**
 * A test seam for `candidateCatalogCorpus`, and specifically for its
 * `satisfies`. TASK-138 AC#8's write-time refusal lives entirely in that one
 * function, and a test that hand-rolls its own `satisfies` proves nothing about
 * it - the mutation `exam-gloss-ambiguity-not-refused` survived exactly that way
 * until this seam existed, which is the honest reason it is exported rather
 * than tested through a reimplementation.
 */
const sourcingLedgers = new Map<string, ReadonlyMap<string, SourcingCase>>();
const declinedLedgers = new Map<string, ReadonlySet<string>>();
/** TASK-148 AC#7: the exact corpus view one exam's assembly validated against,
 * kept so a test can re-run `validateQuestionItem` over the STORED paper using
 * the service's own `satisfies` instead of a reimplementation of it. Same reason
 * `sourcingLedgers` exists. */
const corpusViewLedgers = new Map<string, ItemCorpusView>();
/** TASK-148: how many widening attempts one `assemble` spent and the reserve it
 * ended on. The fill retry is invisible in the receipt (a paper that needed two
 * attempts looks exactly like one that needed one), so a test that wants to prove
 * the retry RAN cannot tell from the paper alone. Same reason the ledgers above
 * exist. */
const fillLedgers = new Map<string, { attempts: number; reserve: number }>();

export const __test__ = {
  candidateCatalogCorpus,
  // TASK-173.5: the 文脈規定 join and its masking branch. The block ships
  // disabled until the fill rate is measured, so no assembled paper exercises
  // either yet; a test drives them directly rather than through a
  // reimplementation that could drift from the picker.
  candidatePresentationFor,
  // TASK-173.9.12: the 長文 source picker. Exposed for the same reason as the
  // 中文 picker: the refusal path (empty store => null => block short => the real
  // paper names its 長文 hole) and the canned-passage fallback are testable
  // without a full N1 paper.
  choubunSourceFor,
  // TASK-173.9.x slice 2: the 主張理解（長文） source picker. Same refusal
  // contract as mediumReadingSourceFor: empty store => null => block short =>
  // real paper not ready => honest refuse.
  claimUnderstandingSourceFor,
  clozeSourceFor,
  corpusViewOf: (examId: string): ItemCorpusView | null =>
    corpusViewLedgers.get(examId) ?? null,
  declinedAnchorsOf: (examId: string): ReadonlySet<string> =>
    declinedLedgers.get(examId) ?? new Set(),
  // TASK-173.9.24: the 文章の文法 source picker. Exposed for the same reason as
  // the 用法 picker: the refusal path (no store => null => block short => the real
  // paper names its 文章の文法 hole) is testable without a full N3 paper, and a
  // real 文章の文法 小問 needs its whole authored passage, which a synthetic
  // fixture could not prove.
  discourseClozeSourceFor,
  fillOf: (examId: string): { attempts: number; reserve: number } | null =>
    fillLedgers.get(examId) ?? null,
  // TASK-173.9.26: the 語形成 source picker. Exposed for the same reason as the
  // 表記 picker: the refusal path (no store => null => block short => the real
  // paper names its 語形成 hole) is testable without a full N2 paper.
  goseikeiSourceFor,
  // TASK-173.9.25: the 表記 source picker. Exposed for the same reason as the
  // 文章の文法 picker: the refusal path (no store => null => block short => the
  // real paper names its 表記 hole) is testable without a full N5 paper.
  hyoukiSourceFor,
  // TASK-173.9.28: the 言い換え類義 SENTENCE-form source picker. Exposed for the
  // same reason as the word-form picker: the refusal path (no store => null =>
  // block short => the real paper names its 言い換え類義 hole) is testable
  // without a full N4 paper.
  iikaeSentenceSourceFor,
  // TASK-173.9.27: the 言い換え類義 source picker. Exposed for the same reason
  // as the 語形成 picker: the refusal path (no store => null => block short =>
  // the real paper names its 言い換え類義 hole) is testable without a full N1
  // paper.
  iikaeSourceFor,
  // TASK-173.9.7: the 情報検索 source picker. Exposed for the same reason as the
  // 短文 picker: the refusal path (empty store => null => block short => real
  // paper reports the hole) is testable without a full N3 paper.
  infoSearchSourceFor,
  // TASK-173.9.29: the 文脈規定 store picker. Exposed for the same reason as the
  // 言い換え picker: the refusal path (no store => null => block short => the
  // real paper names its 文脈規定 hole) and the spend rules are testable without
  // a full N3 paper.
  kiteiSourceFor,
  // TASK-173.9.29: the store-vs-join dispatch set, exposed so a test can prove
  // the derived join is unreachable at the store levels rather than trusting
  // the receipt of one paper.
  kiteiStoreLevels: KITEI_STORE_LEVELS,
  // TASK-173.8.1: the four 聴解 source pickers. Exposed for the same reason as
  // the 短文 picker: the refusal path (no store => null => block short => the
  // real paper names its 聴解 hole) and the scenario-travels-as-script contract
  // are testable without a full N5 listening paper.
  listeningChoukaiSourceFor,
  listeningGaiyouSourceFor,
  listeningHatsuwaSourceFor,
  listeningKadaiSourceFor,
  listeningPointSourceFor,
  listeningSokujiSourceFor,
  // TASK-173.9.12 AC#6: the canned 長文 text, exposed so a test can name what a
  // FLAT paper is still supposed to print instead of re-typing the sentence.
  longReadingPassage: LONG_READING_PASSAGE,
  // TASK-173.9.2: the 中文 source picker. Exposed for the same reason as the
  // 短文 picker: the refusal path (empty store => null => block short => real
  // paper not ready => honest refuse) is testable without a full N2 paper.
  mediumReadingSourceFor,
  // Forwarded, not shorthand: `paperFrameData` is declared below this object,
  // so naming it directly reads it in its own temporal dead zone at load.
  paperFrameData: (
    ...args: Parameters<typeof paperFrameData>
  ): ReturnType<typeof paperFrameData> => paperFrameData(...args),
  // TASK-173.5: the paper's grammar-pool demand. A 文脈規定 cloze draws its
  // example sentence from the grammar pool, so its slots belong in this number;
  // a test reads the function directly because an undersized pool is invisible
  // in the receipt of a single paper that still happens to fill.
  paperGrammarDemand,
  // TASK-173.9.17 AC#4: the one no-fallback rule all six 読解 pickers call. Exposed
  // so a test can prove the rule itself refuses an off-level row, separate from
  // proving each picker comes up short when its own store is drained.
  servableReadingRow,
  // TASK-173.7: the 短文 source picker. Exposed so the refusal path (empty
  // store => null => block short => real paper not ready => honest refuse) is
  // testable directly without waiting for a full N4 paper assembly to prove it.
  shortReadingSourceFor,
  sourcingCasesOf: (examId: string): ReadonlyMap<string, SourcingCase> =>
    sourcingLedgers.get(examId) ?? new Map(),
  // TASK-173.6: the 文の組み立て split, driven directly by the measurement test
  // so it walks the shipped corpus and prints the per-level fill rate rather than
  // going through a reimplementation that could drift from the picker.
  starSourceFor,
  surfaceByFamily: SURFACE_BY_FAMILY,
  // TASK-173.9.3: the 統合理解 pair picker. Exposed for the same reason as the
  // 情報検索 picker: the refusal path (empty store => null => block short => real
  // paper reports the hole) is testable without a full N1 paper, and a real
  // 統合理解 小問 needs TWO documents, which no single-passage picker can show.
  tougouSourceFor,
  // TASK-173.9.23: the 用法 source picker. Exposed for the same reason as the
  // 情報検索 picker: the refusal path (empty store => null => block short =>
  // real paper names its 用法 hole) is testable without a full N3 paper, and a
  // real 用法 小問 needs its licensed-pattern stem, which a synthetic fixture
  // could not prove.
  usageSourceFor,
};

const buildCandidateCatalog = async ({
  examId,
  request,
  reserve,
  split,
  store,
}: {
  examId: string;
  request: PaperRequest;
  reserve: number;
  split: TokenSplitter;
  store: ItemStore;
}): Promise<{
  candidates: PaperCandidate[];
  contentExhausted: boolean;
  corpus: ItemCorpusView;
  refusedSections: readonly PaperSectionId[];
}> => {
  const catalog: CandidateCatalogState = {
    anchorLevels: new Map(),
    candidates: [],
    declinedAnchors: new Set(),
    exhaustedFamilies: new Set(),
    fragmentRecords: new Map(),
    refusedSections: new Set(),
    seenAnchors: new Set(await store.listServedAnchorsForLevel(request.level)),
    sourcingCases: new Map(),
    targetByItemId: new Map(),
    usedBunshouPassages: new Set(),
    usedChoubunPassages: new Set(),
    usedClaimUnderstandingPassages: new Set(),
    usedFocusAnchors: new Set(),
    usedGoseikeiSentences: new Set(),
    usedGrammarIds: new Set(),
    usedHyoukiSentences: new Set(),
    usedIikaeSentenceSentences: new Set(),
    usedIikaeSentences: new Set(),
    usedJouhouPassages: new Set(),
    usedKiteiPassages: new Set(),
    usedListeningScenarios: new Set(),
    usedMediumReadingPassages: new Set(),
    usedShortReadingPassages: new Set(),
    usedTougouPairs: new Set(),
    usedUsagePassages: new Set(),
    usedVocabWords: new Set(),
  };
  // TASK-138: an unresolvable corpus yields zero candidates, which the
  // assembler reports as an honest shortfall. It never falls back to a
  // built-in word list, because that fallback is the defect this task exists
  // to remove: content the app cannot source is content it made up.
  const corpus = examCorpus();
  if (!corpus) {
    const emptyView = candidateCatalogCorpus(
      catalog.targetByItemId,
      catalog.anchorLevels,
      null,
      catalog.fragmentRecords
    );
    corpusViewLedgers.set(examId, emptyView);
    return {
      candidates: [],
      // Not exhaustion: nothing was withheld, there is simply no corpus to
      // draw from. Telling a learner they have seen everything at this level
      // when the content files are missing would be the wrong diagnosis.
      contentExhausted: false,
      corpus: emptyView,
      refusedSections: [],
    };
  }
  const blueprint = paperBlueprintFor(request.level);
  for (const section of blueprint.sections) {
    if (request.sections.includes(section.id)) {
      // biome-ignore lint/performance/noAwaitInLoops: sections share one catalog, and the push order is what keeps the assembled paper's item order stable, so they cannot be raced.
      await appendSectionCandidates({
        catalog,
        corpus,
        examId,
        request,
        reserve,
        section,
        split,
      });
    }
  }
  sourcingLedgers.set(examId, catalog.sourcingCases);
  declinedLedgers.set(examId, catalog.declinedAnchors);
  const view = candidateCatalogCorpus(
    catalog.targetByItemId,
    catalog.anchorLevels,
    corpus,
    catalog.fragmentRecords
  );
  corpusViewLedgers.set(examId, view);
  return {
    candidates: catalog.candidates,
    contentExhausted: catalog.exhaustedFamilies.size > 0,
    corpus: view,
    refusedSections: [...catalog.refusedSections].sort(),
  };
};

/**
 * TASK-148: build, assemble, and widen the candidate reserve until the paper
 * fills.
 *
 * With no repeat available, a candidate the validator rejects now leaves a hole
 * rather than borrowing a question the learner already answered, and a hole is
 * not a smaller paper: `assemble` marks a paper `ready` only when every slot is
 * filled, and `start` refuses anything else, so a 29/30 build is a paper nobody
 * can open. Widening fills it from content the level still has.
 *
 * The walk is deterministic in the seed, so a wider run asks the pool for a
 * SUPERSET of the same items rather than a different paper: attempt two is
 * attempt one with more candidates, never a reshuffle. Two exits keep the cost
 * bounded and the diagnosis honest. `contentExhausted` ends the loop because
 * widening cannot answer it: that report says the exclusion left nothing to
 * draw, which is a fact about the learner's history, not a reserve that was too
 * small. `MAX_FILL_ATTEMPTS` ends it when the paper is short for a reason this
 * loop cannot reach, and the receipt says so.
 */
const fillCandidatePaper = async ({
  examId,
  request,
  split,
  store,
}: {
  examId: string;
  request: PaperRequest;
  split: TokenSplitter;
  store: ItemStore;
}): Promise<{
  assembly: PaperAssemblyResult;
  attempts: number;
  contentExhausted: boolean;
  refusedSections: readonly PaperSectionId[];
  reserve: number;
}> => {
  let reserve = REJECTED_CANDIDATE_RESERVE;
  let attempts = 1;
  let catalog = await buildCandidateCatalog({
    examId,
    request,
    reserve,
    split,
    store,
  });
  let assembly = assemblePaper({
    candidates: catalog.candidates,
    corpus: catalog.corpus,
    examId,
    request,
  });
  while (
    !(assembly.ready || catalog.contentExhausted) &&
    attempts < MAX_FILL_ATTEMPTS
  ) {
    attempts += 1;
    reserve *= 2;
    // biome-ignore lint/performance/noAwaitInLoops: each attempt only runs when the previous one left a hole, and rebuilding the catalog is what fills it, so the attempts are strictly sequential by design and bounded by MAX_FILL_ATTEMPTS.
    catalog = await buildCandidateCatalog({
      examId,
      request,
      reserve,
      split,
      store,
    });
    assembly = assemblePaper({
      candidates: catalog.candidates,
      corpus: catalog.corpus,
      examId,
      request,
    });
  }
  return {
    assembly,
    attempts,
    contentExhausted: catalog.contentExhausted,
    // Not an exit for the loop above, the way `contentExhausted` is: widening the
    // reserve walks deeper into the pool and may find AUTHENTIC content for the
    // hole, which is exactly what a real paper wants. It is reported so the
    // receipt can say what the paper turned down.
    refusedSections: catalog.refusedSections,
    reserve,
  };
};

/**
 * TASK-141: the text a client may speak for this item.
 *
 * A client projection already carries `speech`, decided listening-only by the
 * store. An ItemResolution does not, so the same decision is applied here -
 * `SPEAKING_ITEM_TYPES` is imported from the store rather than redeclared, so
 * the two paths cannot drift.
 */
const speakingTextFor = (
  item:
    | ItemForClient
    | (Omit<ItemForClient, "stimuli"> & { stimuli?: unknown })
    | ItemResolution
): string | null => {
  if ("speech" in item) {
    return item.speech;
  }
  if (!SPEAKING_ITEM_TYPES.includes(item.itemType)) {
    return null;
  }
  return item.script ?? null;
};

const toContractItem = (
  item:
    | (Omit<ItemForClient, "stimuli"> & {
        stimuli?: readonly Stimulus[] | null;
      })
    | ItemResolution
): ExamItem => {
  // A listening item's spoken text arrives on the CLIENT projection as
  // `speech`; an ItemResolution still has it under `script`. Accept either,
  // because this is called from both the exam state path (client projection) and
  // the assembled-slot path (resolution).
  const speech = speakingTextFor(item);
  if (!isExamSurface(item.surface)) {
    throw new ExamServiceError(
      "INVALID_REQUEST",
      `exam item ${item.id} has an unsupported surface`
    );
  }
  return {
    anchors: [...item.anchors],
    id: item.id,
    itemType: item.itemType,
    level: toLevel(item.level),
    options: [...item.options],
    passage: item.passage,
    prompt: item.prompt,
    seedPart: item.seedPart,
    // TASK-141: decided listening-only at the store's client projection, so
    // this is a pass-through rather than a decision.
    speech,
    // TASK-173.2: another pass-through. The decision is the assembly's, so a
    // re-read paper prints the line the learner was actually asked with.
    stem: item.stem,
    stimuli: itemStimuliForClient(item).map((stimulus) => ({ ...stimulus })),
    surface: item.surface,
  };
};

const sectionMetadata = (
  state: StoredExamState,
  request: PaperRequest
): ExamSectionMetadata[] => {
  const blueprint = paperBlueprintFor(request.level);
  return state.sections.map((section) => {
    const id = toSection(section.section);
    const definition = blueprint.sections.find(
      (candidate) => candidate.id === id
    );
    if (!definition) {
      throw new ExamServiceError(
        "INVALID_REQUEST",
        `section ${id} is not part of the ${request.level} paper`
      );
    }
    const validatedItems = state.items.filter(
      (item) => item.section === id
    ).length;
    return {
      id,
      minutes: definition.minutes,
      position: section.position,
      requestedItems: section.requestedItems,
      scoringSectionIds: [...definition.scoringSectionIds],
      shortfall: Math.max(0, section.requestedItems - validatedItems),
      status: section.status,
      timeLimitSeconds: section.timeLimitSeconds,
      validatedItems,
    };
  });
};

/**
 * TASK-173.4 AC#4, widened: the 読解 item types real mode can only source from a
 * LEVEL store. The prose lives in `packages/japanese/data/reading/` (see
 * `exam-corpus.ts`), so a level with no file has nothing to print in that 大問
 * even though the 大問 has a question kind - which is why the store, not the
 * engine, is what decides whether that block is a hole.
 */
const READING_STORE_FOR: Readonly<
  Partial<Record<ItemType, (level: string) => readonly unknown[]>>
> = {
  "claim-understanding": claimUnderstandingStoreFor,
  // TASK-173.9.26: 語形成 is answered from the per-level 語形成 store (N2 only),
  // same contract as 表記. A level with no store file returns the empty array,
  // so a paper whose blueprint asks the 大問 comes up a named hole rather than a
  // fabricated 小問 (TASK-173.1).
  "compound-completion": goseikeiStoreFor,
  // TASK-173.9.29: 文脈規定 is answered from the authored kitei store at
  // N3/N2/N1 and from the derived join at N4/N5, so the hole decision follows
  // the same split: an empty or missing store at a store level names the 大問
  // rather than reporting a bare shortfall (TASK-173.1), while the join levels
  // always HAVE a source and are never holes. The one-element return for the
  // join levels is a presence marker only: this map is consulted for
  // `.length > 0`, never for the rows themselves.
  "context-cloze": (level: string) =>
    KITEI_STORE_LEVELS.has(level)
      ? kiteiStoreFor(level)
      : ["cloze-derived-source-present"],
  // TASK-173.9.24: 文章の文法 is answered from the per-level discourse-cloze store,
  // so an empty store makes the 大問 a named hole at N4/N5 too (TASK-173.1).
  "discourse-cloze": bunshouStoreFor,
  "info-search": jouhouStoreFor,
  // TASK-173.9.4.2: 聴解統合理解 (N2) same contract; a drained or missing store
  // names 大問5 rather than printing a dialogue nobody wrote.
  "listening-choukai": listeningChoukaiStoreFor,
  // TASK-173.8.1: each 聴解 大問 is answered from its own per-level store, same
  // contract as 短文. A level with no store file returns the empty array, so the
  // 大問 comes up a named hole rather than a fabricated 小問 (TASK-173.1).
  // TASK-173.9.4.1: 概要理解 (N3) is answered from its own per-level store, same
  // contract; N4/N5 ship no file, so their 大問 comes up a named hole.
  "listening-gaiyou": listeningGaiyouStoreFor,
  "listening-hatsuwa": listeningHatsuwaStoreFor,
  "listening-kadai": listeningKadaiStoreFor,
  "listening-point": listeningPointStoreFor,
  "listening-sokuji": listeningSokujiStoreFor,
  // TASK-173.9.12: the 長文 window store exists at N1 only, so this entry is also
  // what keeps N3 大問6 a NAMED hole: the block now declares a question kind, and
  // the store is what answers for it.
  "long-reading": choubunStoreFor,
  "medium-reading": mediumReadingStoreFor,
  // TASK-173.9.28: at N4/N5 the same ねらい is printed as a WHOLE sentence underlined
  // with four complete sentences offered, answered from the per-level sentence store.
  // Same contract as the word form: a level with no store file returns the empty
  // array, so the 大問 is a named hole rather than a fabricated 小問 (TASK-173.1).
  "sentence-paraphrase": iikaeSentenceStoreFor,
  "short-reading": shortReadingStoreFor,
  // TASK-173.9.27: 言い換え類義 is answered from the per-level 言い換え store
  // (N1/N2/N3 word form), same contract as 語形成. N4/N5 print the other form of
  // the same ねらい and are answered by the sentence store above
  // (TASK-173.9.28), so an N4/N5 paper never consults this one.
  "synonym-paraphrase": iikaeStoreFor,
  // TASK-173.9.3: 統合理解 is answered from a PAIR store, whose row shape has no
  // `passage` column. This map asks only whether the level has anything to print,
  // so the entry type is deliberately erased here rather than widened into a
  // union the callers below never read.
  "text-comparison": tougouStoreFor,
  // TASK-173.9.23: 用法 is answered from the per-level usage store, same shape as
  // 情報検索. A level with no store still returns the empty array, so the 大問 is
  // named as a hole rather than a fabricated item (TASK-173.1).
  usage: usageStoreFor,
  // TASK-173.9.25: 表記 is answered from the per-level 表記 store, same contract
  // as 文章の文法. A level with no store file returns the empty array, so the
  // 大問 comes up a named hole rather than a fabricated 小問 (TASK-173.1).
  "word-spelling": hyoukiStoreFor,
};

/**
 * Whether real mode has anything to ask in one 大問 at this level. A 大問 is
 * sourceable as soon as ONE of its question kinds has content: a kind with no
 * level-store dependency (漢字読み, 文の文法1, 文脈規定, ...) is drawn from the
 * corpus directly and always answers yes, while a 読解 block is only as good as
 * its level store. This is what lets the receipt name a store-absent 読解 大問
 * instead of leaving it to read like the learner ran the level dry. It asks
 * only whether a source EXISTS: a store too small for the 大問's 小問数 is
 * sourceable and reported through `shortfall` as before.
 */
const blockHasRealSource =
  (level: string) =>
  (block: AllocatedPaperBlock): boolean => {
    for (const itemType of block.itemTypes) {
      const storeFor = READING_STORE_FOR[itemType];
      if (storeFor === undefined) {
        return true;
      }
      if (storeFor(level).length > 0) {
        return true;
      }
    }
    return false;
  };

/**
 * `poolDrained` is the assembler's report that some family's UNSEEN pool was
 * empty for this level (TASK-148 AC#4). It reaches the receipt only when the
 * paper is actually short, so a ready paper can never claim the learner has run
 * the level dry, and a shortfall caused by something else - a missing corpus, a
 * validator rejection - stays the plain shortfall it was before.
 *
 * `refusedSections` is TASK-173.1 AC#4's different fact: the content was there
 * and the REAL mode turned it down. Like `poolDrained` it is reported only
 * alongside a real gap in that section, but it never sets `contentExhausted`,
 * because "you have seen everything at this level" and "this paper refuses to
 * fabricate" are opposite diagnoses and must not share a flag.
 *
 * `unfilledBlocks` is TASK-173.4 AC#4's third fact, and the one a real paper hits
 * most often: the official 大問 shape asks for a question kind the item engine
 * does not have, so the section is short no matter what the learner has seen or
 * what the picker found. It is a property of the plan, so it is reported for the
 * real mode at section granularity from the block walk rather than inferred from
 * this run's candidates, and it never sets `contentExhausted` either. A 読解 大問
 * whose level has no store is a hole for the same reason and is named here too
 * (`blockHasRealSource`): its question kind exists, but there is no content to
 * ask it with, so a paper that omitted it would look like a shorter official
 * paper and a `contentExhausted` receipt would blame the learner's history for
 * a missing corpus file.
 */
const receiptFromState = (
  state: StoredExamState,
  request: PaperRequest,
  poolDrained = false,
  refusedSections: readonly PaperSectionId[] = []
): ExamBuildReceipt => {
  const shortfall = Math.max(0, totalSlots(request) - state.items.length);
  const sections = sectionMetadata(state, request);
  const refused = new Set(refusedSections);
  const unfilledBlocks =
    request.mode === "real"
      ? sections.flatMap((section) =>
          paperUnfillableBlocks({
            budget: section.requestedItems,
            hasSource: blockHasRealSource(request.level),
            level: request.level,
            section: section.id,
          }).map((block) => ({
            bigQuestion: block.bigQuestion,
            name: block.name,
            requestedItems: block.requestedItems,
            section: block.section,
          }))
        )
      : [];
  return {
    contentExhausted: poolDrained && shortfall > 0,
    conversationId: state.conversationId,
    examId: state.id,
    floor: contractFloor(request),
    label: paperModeLabel(request),
    level: request.level,
    mode: request.mode,
    ready: readyForStatus(state.status),
    refusedSections: sections
      .filter((section) => section.shortfall > 0 && refused.has(section.id))
      .map((section) => section.id),
    request: toContractRequest(request),
    sections,
    shortfall,
    status: state.status,
    totalSlots: totalSlots(request),
    unfilledBlocks,
    validatedSlots: state.items.length,
  };
};

const paperResultForFrame = (result: ExamResult | undefined) => {
  if (!result) {
    return;
  }
  if (result.scoring === "band") {
    return {
      overall: {
        max: result.overall.maxScore,
        passed: result.overall.passed,
        passMark: result.overall.passMark,
        score: result.overall.score,
      },
      scoring: result.scoring,
      sections: result.sections.map((section) => ({
        id: section.id,
        max: section.maxScore,
        passed: section.passed,
        score: section.score,
      })),
    };
  }
  return {
    overall: {
      correct: result.overall.correct,
      total: result.overall.total,
    },
    scoring: result.scoring,
    sections: result.sections.map((section) => ({
      correct: section.correct,
      id: section.id,
      total: section.total,
    })),
  };
};

const paperPhase = (
  receipt: ExamBuildReceipt,
  result: ExamResult | undefined
):
  | "building"
  | "raw-only"
  | "ready"
  | "running"
  | "submitted"
  | "unavailable" => {
  if (result?.scoring === "raw-only") {
    return "raw-only";
  }
  if (result) {
    return "submitted";
  }
  if (receipt.status === "ready") {
    return "ready";
  }
  if (receipt.status === "in_progress") {
    return "running";
  }
  if (receipt.status === "abandoned") {
    return "unavailable";
  }
  return "building";
};

const paperSectionState = (
  section: ExamSectionMetadata
): "building" | "ready" | "unavailable" => {
  if (section.shortfall > 0) {
    return "building";
  }
  if (section.status === "abandoned") {
    return "unavailable";
  }
  return "ready";
};

const paperFrameData = (
  receipt: ExamBuildReceipt,
  result: ExamResult | undefined,
  corpus: ExamCorpus | null
): PaperFrameData => {
  const phase = paperPhase(receipt, result);
  const resultData = paperResultForFrame(result);
  return {
    ...(receipt.status === "abandoned" ? { abandoned: true } : {}),
    ...(result
      ? {
          debrief: {
            saved: true,
            // Deduped like `weakAnchors` themselves: two anchors of one missed
            // item must not name the same word twice in one sentence (TASK-160).
            weakAnchorLabels: uniqueStrings(
              anchorLabelsFor(result.weakAnchors, corpus)
            ),
            weakAnchors: [...result.weakAnchors],
          },
        }
      : {}),
    exam_id: receipt.examId,
    label: receipt.label,
    level: receipt.level,
    mode: receipt.mode,
    phase,
    ...(resultData === undefined ? {} : { result: resultData }),
    sections: receipt.sections.map((section) => ({
      id: section.id,
      label: examSectionLabelForMode({ id: section.id, mode: receipt.mode }),
      state: paperSectionState(section),
      total: section.requestedItems,
      validated: section.validatedItems,
    })),
    total_slots: receipt.totalSlots,
    validated_slots: receipt.validatedSlots,
  };
};

const emitPaperFrame = async (
  db: UserDatabase,
  context: ChatContext | undefined,
  receipt: ExamBuildReceipt,
  result?: ExamResult
): Promise<void> => {
  const data = paperFrameData(receipt, result, examCorpus());
  const msgId = `paper:${receipt.examId}`;
  const uiId = msgId;
  const frame: ChatFrame = {
    conversation_id: receipt.conversationId ?? `exam:${receipt.examId}`,
    created_at: Date.now(),
    data,
    hidden: false,
    msg_id: msgId,
    replace: true,
    status: "finish",
    type: "paper",
  };
  if (context) {
    const hub = hubFor(context, frame.conversation_id);
    // A paper written between turns lands on a hub the last turn already
    // settled, and `chat.subscribe` CLOSES rather than goes live on a settled
    // hub with terminal history (chat-rpc.ts:318). Reopening it is what lets a
    // reconnecting learner see the card at all, the same reason
    // `publishDirectDrillEvent` resets before a direct publish. Guarded on
    // `terminal` because a mid-turn reset would drop the live turn's ring.
    if (hub.terminal) {
      resetHub(hub);
    }
    publishFrame(hub, frame);
  }
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, frame.conversation_id),
        eq(messages.uiId, uiId)
      )
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(messages)
      .set({ content: JSON.stringify(data), status: "finish" })
      .where(eq(messages.id, existing[0].id));
    return;
  }
  await db.insert(messages).values({
    content: JSON.stringify(data),
    conversationId: frame.conversation_id,
    createdAt: new Date().toISOString(),
    frameType: "paper",
    hidden: false,
    msgId,
    refId: receipt.examId,
    seq: sql`(SELECT COALESCE(MAX(${messages.seq}), 0) + 1 FROM ${messages} WHERE ${messages.conversationId} = ${frame.conversation_id})`,
    status: "finish",
    turnId: null,
    uiId,
  });
};

const progressFromState = (
  state: StoredExamState,
  request: PaperRequest
): ExamProgress => ({
  currentSection: toSectionOrNull(state.currentSection),
  examId: state.id,
  floor: contractFloor(request),
  label: paperModeLabel(request),
  level: request.level,
  mode: request.mode,
  ready: readyForStatus(state.status),
  sections: sectionMetadata(state, request),
  status: state.status,
  submittedAt: state.submittedAt,
  totalSlots: totalSlots(request),
  validatedSlots: state.items.length,
});

const stateForClient = async (
  store: ItemStore,
  state: StoredExamState,
  request: PaperRequest,
  at: string
): Promise<ExamState> => {
  const client = await store.getExamForClient(state.id);
  if (!client) {
    throw new ExamServiceError("NOT_FOUND", `exam ${state.id} does not exist`);
  }
  const sectionStates = state.sections.map((section) => {
    const id = toSection(section.section);
    const clientSection = client.sections.find(
      (candidate) => candidate.section === id
    );
    if (!clientSection) {
      throw new ExamServiceError(
        "INVALID_REQUEST",
        `exam ${state.id} is missing section ${id}`
      );
    }
    const timing = sectionTiming(section, at);
    // TASK-173.4 AC#4: the 大問 are not a stored column, so the read path
    // re-walks the section plan and assigns the rows to each 大問 in order. A
    // 大問 that came up short keeps its heading with the count it reached, so a
    // level that has run out of 文脈規定 backing (TASK-173.5) still prints the
    // 大問 it can build. A null here (no heading at all) means the rows disagree
    // with the official shape: an item no 大問 asks for, or a paper built before
    // the walk existed.
    const landed = paperBlocksForLandedItems({
      budget: section.requestedItems,
      itemTypes: clientSection.items.map((entry) => entry.item.itemType),
      level: request.level,
      mode: request.mode,
      section: id,
    });
    return {
      answers: clientSection.answers.map((answer) => ({
        answeredAt: answer.answeredAt,
        itemId: answer.itemId,
        section: id,
        selectedIndex: answer.selectedIndex,
      })),
      blocks:
        landed?.blocks.map((block) => ({
          bigQuestion: block.bigQuestion,
          // TASK-173.2 AC#1: the 大問's printed instruction, looked up per
          // (level, 大問). Null is a real answer: no sample paper in this repo
          // has been read for that pair, and the heading prints without it.
          instruction: paperBlockInstruction({
            block: block.id,
            level: request.level,
          }),
          itemCount: block.itemCount,
          name: block.name,
          requestedItems: block.requestedItems,
        })) ?? [],
      id,
      items: clientSection.items.map((entry, index) => ({
        bigQuestion: landed?.itemBigQuestions[index] ?? null,
        item: toContractItem(entry.item),
        order: entry.order,
        requestedSlotIndex: index,
        section: id,
      })),
      minutes:
        paperBlueprintFor(request.level).sections.find(
          (candidate) => candidate.id === id
        )?.minutes ?? 1,
      pauseCount: section.pauseCount,
      paused: timing.paused,
      pausedMs: timing.pausedMs,
      position: section.position,
      remainingSeconds: timing.remainingSeconds,
      requestedItems: section.requestedItems,
      scoringSectionIds: [
        ...(paperBlueprintFor(request.level).sections.find(
          (candidate) => candidate.id === id
        )?.scoringSectionIds ?? []),
      ],
      startedAt: section.startedAt,
      status: section.status,
      submittedAt: section.submittedAt,
      timeLimitSeconds: section.timeLimitSeconds,
    };
  });
  return {
    abandonedAt: state.abandonedAt,
    answers: client.answers.map((answer) => ({
      answeredAt: answer.answeredAt,
      itemId: answer.itemId,
      section: toSection(answer.section),
      selectedIndex: answer.selectedIndex,
    })),
    conversationId: state.conversationId,
    createdAt: state.createdAt,
    currentSection: toSectionOrNull(state.currentSection),
    examId: state.id,
    floor: contractFloor(request),
    items: sectionStates.flatMap((section) => section.items),
    label: paperModeLabel(request),
    level: request.level,
    mode: request.mode,
    ready: readyForStatus(state.status),
    readyAt: state.readyAt,
    request: toContractRequest(request),
    sections: sectionStates,
    seed: state.seed,
    source: state.source,
    startedAt: state.startedAt,
    status: state.status,
    submittedAt: state.submittedAt,
    totalSlots: totalSlots(request),
    validatedSlots: state.items.length,
  };
};

const isCorrectAnswer = (
  state: StoredExamState,
  itemId: string,
  answerIndex: number | undefined
): boolean => {
  if (answerIndex === undefined) {
    return false;
  }
  return state.items.some(
    (entry) =>
      entry.item.id === itemId && entry.item.answerIndex === answerIndex
  );
};

const answerMap = (state: StoredExamState): Map<string, number> =>
  new Map(state.answers.map((answer) => [answer.itemId, answer.answerIndex]));

const resultSectionEntries = (
  state: StoredExamState,
  sourceSections: readonly PaperSectionId[],
  itemTypes?: readonly ItemType[]
): readonly StoredExamState["items"][number][] =>
  state.items.filter(
    (entry) =>
      sourceSections.some((section) => section === toSection(entry.section)) &&
      (itemTypes === undefined || itemTypes.includes(entry.item.itemType))
  );

const computeResult = (
  state: StoredExamState,
  request: PaperRequest,
  submittedAt: string
): ExamResult => {
  const blueprint = paperBlueprintFor(request.level);
  const answers = answerMap(state);
  const correctTotal = state.items.filter((entry) =>
    isCorrectAnswer(state, entry.item.id, answers.get(entry.item.id))
  ).length;
  const pauseCount = state.sections.reduce(
    (total, section) => total + section.pauseCount,
    0
  );
  const pausedMs = state.sections.reduce(
    (total, section) => total + sectionTiming(section, submittedAt).pausedMs,
    0
  );
  const weakAnchors = uniqueStrings(
    state.items
      .filter(
        (entry) =>
          !isCorrectAnswer(state, entry.item.id, answers.get(entry.item.id))
      )
      .flatMap((entry) => entry.item.anchors)
  );
  const rawSections = blueprint.sections
    .filter((section) => request.sections.includes(section.id))
    .map((section) => {
      const entries = resultSectionEntries(state, [section.id]);
      return {
        correct: entries.filter((entry) =>
          isCorrectAnswer(state, entry.item.id, answers.get(entry.item.id))
        ).length,
        id: section.id,
        total: entries.length,
      };
    });
  const floors = paperScoringFloorStatus(request);
  const scoringSections = blueprint.scoringSections.filter((section) =>
    section.sourceSectionIds.some((sourceSection) =>
      request.sections.includes(sourceSection)
    )
  );
  const floorsMet =
    floors.scoring === "band" &&
    state.items.length === totalSlots(request) &&
    scoringSections.every((section) => {
      const floor = floors.floors.find(
        (candidate) => candidate.id === section.id
      );
      const entries = resultSectionEntries(
        state,
        section.sourceSectionIds,
        section.itemTypes
      );
      return (
        floor !== undefined &&
        floor.status === "met" &&
        entries.length >= floor.minimumItems
      );
    });
  if (!floorsMet) {
    return {
      examId: state.id,
      label: paperModeLabel(request),
      level: request.level,
      mode: request.mode,
      overall: { correct: correctTotal, total: state.items.length },
      pauses: { count: pauseCount, totalMs: pausedMs },
      scoring: "raw-only",
      sections: rawSections,
      status: "submitted",
      submittedAt,
      weakAnchors,
    };
  }
  const sections = scoringSections.map((section) => {
    const entries = resultSectionEntries(
      state,
      section.sourceSectionIds,
      section.itemTypes
    );
    const correct = entries.filter((entry) =>
      isCorrectAnswer(state, entry.item.id, answers.get(entry.item.id))
    ).length;
    const score =
      entries.length === 0
        ? 0
        : Math.round((correct / entries.length) * section.cap);
    return {
      correct,
      id: section.id,
      maxScore: section.cap,
      passed: score >= section.passMark,
      passMark: section.passMark,
      score,
      total: entries.length,
    };
  });
  const score = sections.reduce((total, section) => total + section.score, 0);
  return {
    examId: state.id,
    label: paperModeLabel(request),
    level: request.level,
    mode: request.mode,
    overall: {
      correct: correctTotal,
      maxScore: blueprint.totalCap,
      passed: score >= blueprint.overallPassMark,
      passMark: blueprint.overallPassMark,
      score,
      total: state.items.length,
    },
    pauses: { count: pauseCount, totalMs: pausedMs },
    scoring: "band",
    sections,
    status: "submitted",
    submittedAt,
    weakAnchors,
  };
};

const storedOrComputedResult = async (
  store: ItemStore,
  state: StoredExamState,
  request: PaperRequest
): Promise<ExamResult> => {
  const stored = await store.getExamResult(state.id);
  if (stored) {
    const parsed = ExamResultSchema.safeParse(stored);
    if (parsed.success && parsed.data.examId === state.id) {
      return parsed.data;
    }
  }
  return computeResult(
    state,
    request,
    state.submittedAt ?? new Date().toISOString()
  );
};

const debriefFor = (
  state: StoredExamState,
  request: PaperRequest,
  result: ExamResult,
  corpus: ExamCorpus | null
): ExamDebrief => {
  const blueprint = paperBlueprintFor(request.level);
  const answers = answerMap(state);
  const scoringSectionFor = (id: ExamScoringSectionId) =>
    blueprint.scoringSections.find((section) => section.id === id);
  return {
    examId: state.id,
    items: state.items.map((entry) => {
      const selectedIndex = answers.get(entry.item.id);
      const correctIndex = entry.item.answerIndex;
      const correctOption = entry.item.options[correctIndex];
      if (correctOption === undefined) {
        throw new ExamServiceError(
          "INVALID_REQUEST",
          `exam item ${entry.item.id} has no correct option`
        );
      }
      return {
        anchorLabels: anchorLabelsFor(entry.item.anchors, corpus),
        anchors: [...entry.item.anchors],
        correct:
          selectedIndex === undefined
            ? null
            : isCorrectAnswer(state, entry.item.id, selectedIndex),
        correctIndex,
        correctOption,
        disputed: entry.item.disputed,
        disputedAt: entry.item.disputedAt,
        explanation: entry.item.explanation,
        explanationGenerated: entry.item.explanation !== null,
        item: toContractItem(entry.item),
        itemId: entry.item.id,
        order: entry.order,
        section: toSection(entry.section),
        selectedIndex: selectedIndex ?? null,
        selectedOption:
          selectedIndex === undefined
            ? null
            : (entry.item.options[selectedIndex] ?? null),
      };
    }),
    label: paperModeLabel(request),
    sections: result.sections.map((section) => {
      const scoring = scoringSectionFor(section.id);
      const entries = resultSectionEntries(
        state,
        scoring?.sourceSectionIds ?? [toSection(section.id)],
        scoring?.itemTypes
      );
      return {
        correct: entries.filter((entry) =>
          isCorrectAnswer(state, entry.item.id, answers.get(entry.item.id))
        ).length,
        id: section.id,
        total: entries.length,
        weakAnchors: uniqueStrings(
          entries
            .filter(
              (entry) =>
                !isCorrectAnswer(
                  state,
                  entry.item.id,
                  answers.get(entry.item.id)
                )
            )
            .flatMap((entry) => entry.item.anchors)
        ),
      };
    }),
    status: "submitted",
    summary: {
      correct: result.overall.correct,
      total: result.overall.total,
    },
    weakAnchors: [...result.weakAnchors],
  };
};

const classifyStateError = (
  state: StoredExamState,
  action: "advance" | "answer" | "pause" | "resume" | "start" | "submit"
): ExamServiceError | null => {
  if (state.status === "in_progress") {
    return null;
  }
  if (state.status === "abandoned" || state.status === "submitted") {
    return new ExamServiceError(
      "CONFLICT",
      `exam ${state.id} is ${state.status} and cannot ${action}`
    );
  }
  return new ExamServiceError(
    "NOT_READY",
    `exam ${state.id} is not ready for ${action}`
  );
};

const mapStoreError = (
  error: unknown,
  fallback: ExamServiceErrorCode
): ExamServiceError => {
  if (error instanceof ExamServiceError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  let code = fallback;
  if (NOT_FOUND_ERROR.test(message)) {
    code = "NOT_FOUND";
  } else if (INVALID_REQUEST_ERROR.test(message)) {
    code = "INVALID_REQUEST";
  } else if (NOT_READY_ERROR.test(message)) {
    code = "NOT_READY";
  } else if (CONFLICT_ERROR.test(message)) {
    code = "CONFLICT";
  }
  return Object.assign(new ExamServiceError(code, message), { cause: error });
};

export const createExamService = (
  getUserDb: ExamGetUserDb,
  options: ExamServiceOptions = {}
): ExamService => {
  const requests = new Map<string, PaperRequest>();
  const currentTime = options.now ?? (() => new Date());
  const nowIso = (): string => currentTime().toISOString();
  const rememberRequest = (examId: string, request: PaperRequest): void => {
    requests.delete(examId);
    requests.set(examId, request);
    if (requests.size > MAX_REQUEST_CACHE) {
      const oldest = requests.keys().next().value;
      if (oldest !== undefined) {
        requests.delete(oldest);
      }
    }
  };

  const context = async (): Promise<{ db: UserDatabase; store: ItemStore }> => {
    const db = await getUserDb();
    return { db, store: createItemStore(db) };
  };

  const transaction = async <Value>(
    db: UserDatabase,
    operation: (store: ItemStore) => Promise<Value>
  ): Promise<Value> =>
    db.transaction(async (tx) => operation(createItemStore(tx)), {
      behavior: "immediate",
    });

  const requireState = async (
    store: ItemStore,
    examId: string
  ): Promise<StoredExamState> => {
    const state = await store.getExamState(examId);
    if (!state) {
      throw new ExamServiceError("NOT_FOUND", `exam ${examId} does not exist`);
    }
    return state;
  };

  /** TASK-139: the rebuild must return the request that was made, not a
   * lookalike. `requests` above is a cache, not the contract, so this is
   * the path that runs after a restart or an LRU eviction, and every
   * field here comes off the stored state. `focus` used to be hardcoded
   * to `[]`, which silently discarded a field the contract accepts and
   * made a resumed exam a different request from the one submitted. */
  const requestForState = (state: StoredExamState): PaperRequest => {
    const cached = requests.get(state.id);
    if (cached) {
      return cached;
    }
    const sections = state.sections
      .map((section) => section.section)
      .filter(isSection);
    const request = parseRequest({
      budget: state.budgets,
      focus: state.focus,
      level: state.level,
      mode: state.mode,
      sections,
      seed: state.seed,
    });
    rememberRequest(state.id, request);
    return request;
  };

  const ensureConversation = async (
    db: UserDatabase,
    conversationId: string,
    level: string
  ): Promise<void> => {
    const now = new Date().toISOString();
    await db
      .insert(conversations)
      .values({
        createdAt: now,
        id: conversationId,
        title: `${level} paper`,
        updatedAt: now,
      })
      .onConflictDoNothing();
  };

  const assemble = async (
    examId: string,
    chatContext?: ChatContext
  ): Promise<ExamBuildReceipt> => {
    const { db, store } = await context();
    const state = await requireState(store, examId);
    if (state.status === "ready") {
      const receipt = receiptFromState(state, requestForState(state));
      await emitPaperFrame(db, chatContext, receipt);
      return receipt;
    }
    if (state.status !== "draft") {
      throw new ExamServiceError(
        "CONFLICT",
        `exam ${examId} cannot be assembled while ${state.status}`
      );
    }
    const request = requestForState(state);
    const { assembly, attempts, contentExhausted, refusedSections, reserve } =
      await fillCandidatePaper({
        examId,
        request,
        split: examTokenSplitter(),
        store,
      });
    fillLedgers.set(examId, { attempts, reserve });
    const accepted = assembly.sections.flatMap((section) => section.items);
    await Promise.all(accepted.map((slot) => store.storeItem(slot.item)));
    const existingIds = new Set(state.items.map((entry) => entry.item.id));
    const nextOrder =
      state.items.reduce(
        (highest, entry) => Math.max(highest, entry.order),
        -1
      ) + 1;
    const entries = accepted
      .filter((slot) => !existingIds.has(slot.item.id))
      .map((slot, index) => ({
        itemId: slot.item.id,
        itemType: slot.item.itemType,
        order: nextOrder + index,
        section: slot.section,
      }));
    if (entries.length > 0) {
      try {
        await store.composeExamItems(examId, entries);
      } catch (error) {
        throw mapStoreError(error, "CONFLICT");
      }
    }
    if (assembly.ready && accepted.length > 0) {
      try {
        await store.markExamReady({ examId, validated: true });
      } catch (error) {
        throw mapStoreError(error, "CONFLICT");
      }
    }
    const nextState = await requireState(store, examId);
    const receipt = receiptFromState(
      nextState,
      request,
      contentExhausted,
      refusedSections
    );
    if (receipt.ready) {
      await emitPaperFrame(db, chatContext, receipt);
    }
    return receipt;
  };

  const reconcileTimedOutSection = async (
    db: UserDatabase,
    state: StoredExamState,
    chatContext?: ChatContext
  ): Promise<{ state: StoredExamState; timedOut: boolean }> => {
    if (state.status !== "in_progress" || state.currentSection === null) {
      return { state, timedOut: false };
    }
    const section = state.sections.find(
      (candidate) => candidate.section === state.currentSection
    );
    const at = nowIso();
    if (
      !section ||
      section.pausedAt !== null ||
      sectionTiming(section, at).remainingSeconds !== 0
    ) {
      return { state, timedOut: false };
    }
    const next = await transaction(db, (tx) =>
      tx.advanceExamSection({ at, examId: state.id })
    );
    await emitPaperFrame(
      db,
      chatContext,
      receiptFromState(next, requestForState(next))
    );
    return { state: next, timedOut: true };
  };

  const get = async (examId: string): Promise<ExamState> => {
    const { db, store } = await context();
    const before = await requireState(store, examId);
    const reconciled = await reconcileTimedOutSection(db, before);
    return stateForClient(
      store,
      reconciled.state,
      requestForState(reconciled.state),
      nowIso()
    );
  };

  const status = async (examId: string): Promise<ExamProgress> => {
    const { db, store } = await context();
    const before = await requireState(store, examId);
    const reconciled = await reconcileTimedOutSection(db, before);
    return progressFromState(
      reconciled.state,
      requestForState(reconciled.state)
    );
  };

  const start = async (
    examId: string,
    chatContext?: ChatContext
  ): Promise<ExamState> => {
    const { db, store } = await context();
    const before = await requireState(store, examId);
    const reconciled = await reconcileTimedOutSection(db, before, chatContext);
    const { state } = reconciled;
    if (state.status === "draft") {
      throw new ExamServiceError(
        "NOT_READY",
        `exam ${examId} is still a draft`
      );
    }
    if (state.status === "abandoned" || state.status === "submitted") {
      throw new ExamServiceError(
        "CONFLICT",
        `exam ${examId} is ${state.status} and cannot start`
      );
    }
    let next: StoredExamState;
    try {
      next =
        state.status === "in_progress"
          ? state
          : await transaction(db, (tx) =>
              tx.startExam({ at: nowIso(), examId })
            );
    } catch (error) {
      throw mapStoreError(error, "CONFLICT");
    }
    const request = requestForState(next);
    await emitPaperFrame(db, chatContext, receiptFromState(next, request));
    return stateForClient(store, next, request, nowIso());
  };

  const answer = async (input: {
    examId: string;
    itemId: string;
    selectedIndex: number;
  }): Promise<ExamAnswerOutput> => {
    const { db, store } = await context();
    const initial = await requireState(store, input.examId);
    const reconciled = await reconcileTimedOutSection(db, initial);
    if (reconciled.timedOut) {
      throw new ExamServiceError(
        "CONFLICT",
        `exam ${input.examId} section time is up`
      );
    }
    const before = reconciled.state;
    const stateError = classifyStateError(before, "answer");
    if (stateError) {
      throw stateError;
    }
    const priorIds = new Set(before.answers.map((entry) => entry.id));
    let storedAnswer: StoredExamAnswer;
    try {
      storedAnswer = await transaction(db, (tx) =>
        tx.recordExamAnswer({
          answerIndex: input.selectedIndex,
          at: nowIso(),
          examId: input.examId,
          itemId: input.itemId,
        })
      );
    } catch (error) {
      throw mapStoreError(error, "INVALID_REQUEST");
    }
    const after = await requireState(store, input.examId);
    return {
      answer: {
        answeredAt: storedAnswer.answeredAt,
        itemId: storedAnswer.itemId,
        section: toSection(storedAnswer.section),
        selectedIndex: storedAnswer.answerIndex,
      },
      recorded: !priorIds.has(storedAnswer.id),
      state: await stateForClient(
        store,
        after,
        requestForState(after),
        nowIso()
      ),
    };
  };

  const advanceSection = async (input: {
    examId: string;
    section?: ExamSectionId;
  }): Promise<ExamState> => {
    const { db, store } = await context();
    const initial = await requireState(store, input.examId);
    const reconciled = await reconcileTimedOutSection(db, initial);
    if (reconciled.timedOut) {
      return stateForClient(
        store,
        reconciled.state,
        requestForState(reconciled.state),
        nowIso()
      );
    }
    const stateError = classifyStateError(reconciled.state, "advance");
    if (stateError) {
      throw stateError;
    }
    let next: StoredExamState;
    try {
      next = await transaction(db, (tx) =>
        tx.advanceExamSection({ ...input, at: nowIso() })
      );
    } catch (error) {
      throw mapStoreError(error, "CONFLICT");
    }
    return stateForClient(store, next, requestForState(next), nowIso());
  };

  const submit = async (
    examId: string,
    chatContext?: ChatContext
  ): Promise<ExamState> => {
    const { db, store } = await context();
    const initial = await requireState(store, examId);
    const reconciled = await reconcileTimedOutSection(db, initial, chatContext);
    const stateError = classifyStateError(reconciled.state, "submit");
    if (stateError) {
      throw stateError;
    }
    const request = requestForState(reconciled.state);
    const submittedAt = nowIso();
    const result = computeResult(reconciled.state, request, submittedAt);
    let next: StoredExamState;
    try {
      next = await transaction(db, (tx) =>
        tx.autoSubmitExam({
          at: submittedAt,
          examId,
          result,
        })
      );
    } catch (error) {
      throw mapStoreError(error, "CONFLICT");
    }
    await emitPaperFrame(
      db,
      chatContext,
      receiptFromState(next, request),
      result
    );
    return stateForClient(store, next, request, submittedAt);
  };

  const pause = async (examId: string): Promise<ExamState> => {
    const { db, store } = await context();
    const before = await requireState(store, examId);
    const stateError = classifyStateError(before, "pause");
    if (stateError) {
      throw stateError;
    }
    const next = await transaction(db, (tx) =>
      tx.pauseExam({ at: nowIso(), examId })
    );
    return stateForClient(store, next, requestForState(next), nowIso());
  };

  const resume = async (examId: string): Promise<ExamState> => {
    const { db, store } = await context();
    const before = await requireState(store, examId);
    const stateError = classifyStateError(before, "resume");
    if (stateError) {
      throw stateError;
    }
    const next = await transaction(db, (tx) =>
      tx.resumeExam({ at: nowIso(), examId })
    );
    return stateForClient(store, next, requestForState(next), nowIso());
  };

  const abandon = async (
    examId: string,
    chatContext?: ChatContext
  ): Promise<ExamState> => {
    const { db, store } = await context();
    const before = await requireState(store, examId);
    if (before.status === "submitted" || before.status === "abandoned") {
      throw new ExamServiceError(
        "CONFLICT",
        `exam ${examId} is ${before.status} and cannot be abandoned`
      );
    }
    const next = await transaction(db, (tx) =>
      tx.abandonExam({ at: nowIso(), examId })
    );
    await emitPaperFrame(
      db,
      chatContext,
      receiptFromState(next, requestForState(next))
    );
    return stateForClient(store, next, requestForState(next), nowIso());
  };

  const result = async (examId: string): Promise<ExamResult> => {
    const { db, store } = await context();
    const before = await requireState(store, examId);
    const reconciled = await reconcileTimedOutSection(db, before);
    const { state } = reconciled;
    if (state.status === "abandoned") {
      throw new ExamServiceError(
        "CONFLICT",
        `exam ${examId} was abandoned and has no result`
      );
    }
    if (state.status !== "submitted") {
      throw new ExamServiceError(
        "NOT_READY",
        `exam ${examId} has not been submitted`
      );
    }
    return storedOrComputedResult(store, state, requestForState(state));
  };

  const debrief = async (examId: string): Promise<ExamDebrief> => {
    const { db, store } = await context();
    const before = await requireState(store, examId);
    const reconciled = await reconcileTimedOutSection(db, before);
    const { state } = reconciled;
    if (state.status === "abandoned") {
      throw new ExamServiceError(
        "CONFLICT",
        `exam ${examId} was abandoned and has no debrief`
      );
    }
    if (state.status !== "submitted") {
      throw new ExamServiceError(
        "NOT_READY",
        `exam ${examId} has not been submitted`
      );
    }
    const request = requestForState(state);
    return debriefFor(
      state,
      request,
      await storedOrComputedResult(store, state, request),
      examCorpus()
    );
  };

  const dispute = async (input: {
    examId: string;
    itemId: string;
  }): Promise<ExamDisputeOutput> => {
    const { db, store } = await context();
    const before = await requireState(store, input.examId);
    const reconciled = await reconcileTimedOutSection(db, before);
    const { state } = reconciled;
    if (state.status === "abandoned") {
      throw new ExamServiceError(
        "CONFLICT",
        `exam ${input.examId} was abandoned and cannot be disputed`
      );
    }
    if (state.status !== "submitted") {
      throw new ExamServiceError(
        "NOT_READY",
        `exam ${input.examId} has not been submitted`
      );
    }
    const composed = state.items.find(
      (entry) => entry.item.id === input.itemId
    );
    if (!composed) {
      const item = await store.resolveItem(input.itemId);
      if (!item) {
        throw new ExamServiceError(
          "NOT_FOUND",
          `item ${input.itemId} does not exist`
        );
      }
      throw new ExamServiceError(
        "INVALID_REQUEST",
        `item ${input.itemId} does not belong to exam ${input.examId}`
      );
    }
    const disputed = await store.markItemDisputed(input.itemId);
    return {
      disputed: disputed.disputed,
      disputedAt: disputed.disputedAt,
      itemId: input.itemId,
    };
  };

  return {
    abandon,
    advanceSection,
    answer,
    assemble,
    debrief,
    dispute,
    get,
    pause,
    request: async (input: unknown) => {
      const request = parseRequest(input);
      const { db, store } = await context();
      const examId = `exam-${randomUUID()}`;
      const conversationId = requestedConversationId(input) ?? `exam:${examId}`;
      await ensureConversation(db, conversationId, request.level);
      await store.createExam({
        budgets: { ...request.budget },
        conversationId,
        focus: request.focus,
        id: examId,
        level: request.level,
        mode: request.mode,
        seed: request.seed,
        source: "generated",
      });
      rememberRequest(examId, request);
      return receiptFromState(await requireState(store, examId), request);
    },
    result,
    resume,
    review: debrief,
    start,
    status,
    submit,
  };
};
