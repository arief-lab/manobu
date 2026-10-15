import {
  PAPER_BLUEPRINTS,
  PAPER_SECTION_IDS,
  type PaperLevel,
  type PaperSectionId,
  paperSectionTimeLimitSeconds,
} from "@manobu/item-engine/paper";
import {
  declaredStimuli,
  firstStimulusText,
  parseStimuli,
  stimulusTexts,
} from "@manobu/item-engine/stimuli";
import {
  ITEM_SURFACES,
  ITEM_TYPES,
  type ItemMask,
  type ItemSurface,
  type ItemType,
  type QuestionItem,
  type Stimulus,
} from "@manobu/item-engine/types";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import type { createUserDb } from "./index";
import {
  drillAttempts,
  drillPoolItems,
  drillSessionLifecycle,
  drillSessions,
  examAnswers,
  examItems,
  examSections,
  exams,
  items,
} from "./schema/user";

const EXAM_MODES = ["real", "shortened", "exam-conditions"] as const;
const EXAM_SOURCES = ["generated", "seed", "checkpoint"] as const;
const EXAM_STATUSES = [
  "draft",
  "ready",
  "in_progress",
  "submitted",
  "abandoned",
] as const;
const EXAM_SECTION_STATUSES = [
  "pending",
  "in_progress",
  "submitted",
  "abandoned",
] as const;
/** TASK-148: the exam statuses in which the learner was actually shown the
 * paper's questions. `draft` and `ready` are not among them: the pane shows a
 * question only from the section named by `currentSection`, and only `startExam`
 * sets it (apps/desktop/src/features/exam/exam-paper-pane.tsx:404), so a paper
 * assembled and never opened has served nothing. Counting those would let an
 * abandoned request quietly spend a level's content. */
const SERVED_EXAM_STATUSES = ["abandoned", "in_progress", "submitted"] as const;
const DRILL_SESSION_STATUSES = ["active", "paused", "completed"] as const;
const DRILL_POOL_STATES = ["ready", "asked", "dropped", "superseded"] as const;
const FSRS_ITEM_TYPES: readonly ItemType[] = [
  "kanji-reading",
  "word-in-context",
];

export type { ItemSurface, ItemType } from "@manobu/item-engine/types";
export type ExamMode = (typeof EXAM_MODES)[number];
export type ExamSource = (typeof EXAM_SOURCES)[number];
export type ExamStatus = (typeof EXAM_STATUSES)[number];
export type ExamSectionStatus = (typeof EXAM_SECTION_STATUSES)[number];
export type DrillSessionStatus = (typeof DRILL_SESSION_STATUSES)[number];
export type UserDatabase = Awaited<ReturnType<typeof createUserDb>>;
export type ItemStoreDatabase = Pick<
  UserDatabase,
  "delete" | "insert" | "select" | "update"
>;
export type StoreItemInput = QuestionItem;

/** A client-readable stimulus. Scripts never cross this boundary. */
export interface ItemStimulusForClient {
  kind: "passage";
  text: string;
}

interface ItemCore {
  anchors: readonly string[];
  createdAt: string;
  id: string;
  itemType: ItemType;
  level: string;
  options: readonly string[];
  /** The first passage stimulus, the single-stimulus projection of the set. */
  passage: string | null;
  prompt: string;
  seedPart: string | null;
  /** TASK-173.2: the Japanese 小問 line, null when the item has none. */
  stem: string | null;
  surface: ItemSurface;
}

export interface ItemForClient extends ItemCore {
  /** TASK-141: the text a listening item speaks, null for every other item
   * type. A listening-only, documented exception to TASK-132 - see
   * `toClientItem` for why the rule had to be narrowed rather than kept. */
  speech: string | null;
  stimuli: readonly ItemStimulusForClient[];
}

export interface ItemResolution extends ItemCore {
  answerIndex: number;
  disputed: boolean;
  disputedAt: string | null;
  explanation: string | null;
  fsrsVocabId: number | null;
  /** TASK-142: the masking record, or null for an item with nothing to mask.
   * Deliberately NOT projected to the client: the reader is the review surface
   * TASK-137 owns, and a contract field with no reader is the doc-21 §2 defect
   * shape. */
  mask: ItemMask | null;
  script: string | null;
  /** The declared stimulus set, or null for a row written before it existed. */
  stimuli: readonly Stimulus[] | null;
}

export interface CreateExamInput {
  budgets: Readonly<Record<string, number>>;
  conversationId: string;
  /** TASK-139: the paper request's focus, persisted verbatim so the
   * request survives a restart. Defaults to empty, which is what
   * `parseRequest` yields for a request that carried none. */
  focus?: readonly string[];
  id: string;
  level: string;
  mode: ExamMode;
  seed: string;
  source: ExamSource;
}

export interface StoredExam {
  abandonedAt: string | null;
  budgets: Readonly<Record<string, number>>;
  conversationId: string;
  createdAt: string;
  currentSection: string | null;
  /** TASK-139: the focus the request was made with, so a rebuilt
   * request is the request rather than a lookalike. */
  focus: string[];
  id: string;
  level: string;
  mode: ExamMode;
  readyAt: string | null;
  result: Readonly<Record<string, unknown>> | null;
  seed: string;
  source: ExamSource;
  startedAt: string | null;
  status: ExamStatus;
  submittedAt: string | null;
}

export interface StoredExamSection {
  activeMs: number;
  createdAt: string;
  examId: string;
  pauseCount: number;
  pausedAt: string | null;
  pausedMs: number;
  position: number;
  requestedItems: number;
  section: string;
  startedAt: string | null;
  status: ExamSectionStatus;
  submittedAt: string | null;
  timeLimitSeconds: number | null;
  timerStartedAt: string | null;
}

export interface StoredExamAnswer {
  answeredAt: string;
  answerIndex: number;
  createdAt: string;
  examId: string;
  id: number;
  itemId: string;
  section: string;
}

export interface ExamState extends StoredExam {
  answeredCount: number;
  answers: StoredExamAnswer[];
  items: ComposedExamItem[];
  sections: StoredExamSection[];
  totalItems: number;
}

export interface ExamItemForClient {
  item: ItemForClient;
  itemType: ItemType;
  order: number;
  section: string;
}

export interface ExamAnswerForClient {
  answeredAt: string;
  itemId: string;
  section: string;
  selectedIndex: number;
}

export interface ExamSectionForClient extends StoredExamSection {
  answers: ExamAnswerForClient[];
  items: ExamItemForClient[];
}

/** TASK-139: `focus` is omitted on purpose. It is an assembly input, not a
 * rendering fact, and nothing in the desktop consumes it. Exposing it
 * would be the §2 defect shape in doc-21: a declared field with no
 * downstream reader. Add it back when a surface shows what a paper
 * targets. */
export interface ExamForClient extends Omit<StoredExam, "focus" | "result"> {
  answers: ExamAnswerForClient[];
  items: ExamItemForClient[];
  sections: ExamSectionForClient[];
}

export interface MarkExamReadyOptions {
  at?: string;
  validated?: boolean;
}

export interface MarkExamReadyInput extends MarkExamReadyOptions {
  examId: string;
}

export interface AbandonExamInput {
  at?: string;
  examId: string;
}

export interface StartExamInput {
  at?: string;
  examId: string;
}

export interface ExamClockInput {
  at?: string;
  examId: string;
}

export interface RecordExamAnswerInput {
  answerIndex: number;
  at?: string;
  examId: string;
  itemId: string;
}

export interface AdvanceExamSectionInput {
  at?: string;
  examId: string;
  section?: string;
}

export interface SubmitExamInput {
  at?: string;
  examId: string;
  result?: Readonly<Record<string, unknown>>;
}

export type ExamIdInput = string | { examId: string };

export interface ExamItemInput {
  itemId: string;
  itemType: ItemType;
  order: number;
  section: string;
  timeLimitSeconds?: number;
}

export interface ComposedExamItem {
  item: ItemResolution;
  itemType: ItemType;
  order: number;
  section: string;
}

export interface CreateDrillSessionInput {
  anchors: readonly string[];
  conversationId: string;
  declaredCount: number;
  id: string;
  level?: string;
  maxPerType?: number;
  tier: string;
}

export interface StoredDrillSession {
  anchors: readonly string[];
  conversationId: string;
  declaredCount: number;
  endedAt: string | null;
  id: string;
  level: string | null;
  startedAt: string;
  status: DrillSessionStatus;
  tier: string;
}

export interface DrillSessionState extends StoredDrillSession {
  answered: number;
  answeredCorrect: number;
  answeredItemIds: readonly string[];
  asked: number;
  askedItemIds: readonly string[];
  generation: number;
  maxPerType: number;
  readyCount: number;
  remaining: number;
  skipped: number;
  supersessionCount: number;
}

export type DrillPoolState = "asked" | "dropped" | "ready" | "superseded";
export type DrillPoolDropReason =
  | "disputed"
  | "invalid-at-draw"
  | "superseded"
  | "type-cap";

export interface DrillPoolEntry {
  dropReason: string | null;
  generation: number;
  itemId: string;
  position: number;
  state: DrillPoolState;
}

export interface DrillLifecycleRecord {
  generation: number;
  maxPerType: number;
  sessionId: string;
  supersessionCount: number;
}

export interface AppendDrillPoolInput {
  expectedGeneration: number;
  itemIds: readonly string[];
  sessionId: string;
}

export interface ClaimDrillItemResult {
  attempt: StoredDrillAttempt;
  kind: "claimed" | "current";
}

export interface SupersedeDrillPoolResult {
  dropped: number;
  lifecycle: DrillLifecycleRecord;
  superseded: boolean;
}

export interface StoredDrillAttempt {
  at: string;
  chosenIndex: number | null;
  correct: boolean | null;
  id: number;
  itemId: string;
  sessionId: string;
  skipped: boolean;
}

export interface DrillAnswerResult {
  attempt: StoredDrillAttempt;
  recorded: boolean;
}

const isOneOf = <Value extends string>(
  value: string,
  allowed: readonly Value[]
): value is Value => allowed.some((candidate) => candidate === value);

const isPaperLevel = (value: string): value is PaperLevel =>
  Object.hasOwn(PAPER_BLUEPRINTS, value);

const isPaperSectionId = (value: string): value is PaperSectionId =>
  PAPER_SECTION_IDS.some((section) => section === value);

const sectionTimeLimitSeconds = (
  level: string,
  section: string,
  override?: number,
  mode: ExamMode = "exam-conditions",
  budget?: number
): number | null => {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 1) {
      throw new Error("an exam section time limit must be a positive integer");
    }
    return override;
  }
  if (!(isPaperLevel(level) && isPaperSectionId(section))) {
    return null;
  }
  return paperSectionTimeLimitSeconds({
    budget,
    level,
    mode,
    section,
  });
};

const policySectionNames = (level: string): ReadonlySet<string> | null => {
  if (!isPaperLevel(level)) {
    return null;
  }
  return new Set(PAPER_BLUEPRINTS[level].sections.map((section) => section.id));
};

const sectionNamesForExam = (
  exam: StoredExam,
  composedItems: readonly ComposedExamItem[]
): string[] => {
  const policySections = policySectionNames(exam.level);
  const names = new Set<string>();
  for (const section of Object.keys(exam.budgets)) {
    if (!policySections || policySections.has(section)) {
      names.add(section);
    }
  }
  for (const item of composedItems) {
    names.add(item.section);
  }
  const orderedNames = [...names];
  if (!isPaperLevel(exam.level)) {
    return orderedNames;
  }
  const order = new Map<string, number>(
    PAPER_BLUEPRINTS[exam.level].sections.map((section, index) => [
      section.id,
      index,
    ])
  );
  return orderedNames.sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
};

const defaultMaxPerType = (declaredCount: number): number =>
  Math.max(1, Math.floor(declaredCount * 0.2));

const decodeDrillPoolState = (value: string): DrillPoolState => {
  if (!isOneOf(value, DRILL_POOL_STATES)) {
    throw new Error(`drill pool item has an invalid state: ${value}`);
  }
  return value;
};

const decodeDrillLifecycle = (
  row: typeof drillSessionLifecycle.$inferSelect
): DrillLifecycleRecord => ({
  generation: row.generation,
  maxPerType: row.maxPerType,
  sessionId: row.sessionId,
  supersessionCount: row.supersessionCount,
});

const decodeJson = (raw: string, field: string): unknown => {
  try {
    const value: unknown = JSON.parse(raw);
    return value;
  } catch (error) {
    throw new Error(`${field} is not valid JSON`, { cause: error });
  }
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry: unknown) => typeof entry === "string");

const decodeStringArray = (
  raw: string,
  field: string,
  exactLength?: number
): string[] => {
  const value = decodeJson(raw, field);
  if (!isStringArray(value)) {
    throw new Error(`${field} must be a string array`);
  }
  if (exactLength !== undefined && value.length !== exactLength) {
    throw new Error(`${field} must contain ${exactLength} entries`);
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const examIdFrom = (input: ExamIdInput): string =>
  typeof input === "string" ? input : input.examId;

const normalizeMarkExamReadyInput = (
  input: string | MarkExamReadyInput,
  validatedOrOptions?: boolean | MarkExamReadyOptions
): MarkExamReadyInput => {
  if (typeof input !== "string") {
    return input;
  }
  if (typeof validatedOrOptions === "boolean") {
    return { examId: input, validated: validatedOrOptions };
  }
  return { examId: input, ...(validatedOrOptions ?? {}) };
};

const normalizeStartExamInput = (
  input: string | StartExamInput,
  at?: string
): StartExamInput =>
  typeof input === "string" ? { at, examId: input } : input;

const normalizeExamClockInput = (
  input: string | ExamClockInput,
  at?: string
): ExamClockInput =>
  typeof input === "string" ? { at, examId: input } : input;

const normalizeRecordExamAnswerInput = (
  input: string | RecordExamAnswerInput,
  itemId?: string,
  answerIndex?: number,
  at?: string
): RecordExamAnswerInput => {
  if (typeof input !== "string") {
    return input;
  }
  if (itemId === undefined || answerIndex === undefined) {
    throw new Error("an exam answer requires an item id and answer index");
  }
  return { answerIndex, at, examId: input, itemId };
};

const normalizeAdvanceExamSectionInput = (
  input: string | AdvanceExamSectionInput,
  section?: string,
  at?: string
): AdvanceExamSectionInput =>
  typeof input === "string" ? { at, examId: input, section } : input;

const examSectionPointerGuard = (section: string | null) =>
  section === null
    ? isNull(exams.currentSection)
    : eq(exams.currentSection, section);

const normalizeSubmitExamInput = (
  input: string | SubmitExamInput,
  resultOrAt?: Readonly<Record<string, unknown>> | string,
  at?: string
): SubmitExamInput => {
  if (typeof input !== "string") {
    return input;
  }
  if (typeof resultOrAt === "string") {
    return { at: resultOrAt, examId: input };
  }
  return {
    ...(resultOrAt === undefined ? {} : { result: resultOrAt }),
    at,
    examId: input,
  };
};

const isNumberRecord = (value: unknown): value is Record<string, number> =>
  isRecord(value) &&
  Object.values(value).every((entry: unknown) => typeof entry === "number");

const decodeNumberRecord = (
  raw: string,
  field: string
): Record<string, number> => {
  const value = decodeJson(raw, field);
  if (!isNumberRecord(value)) {
    throw new Error(`${field} must be a numeric record`);
  }
  return value;
};

const decodeObjectRecord = (
  raw: string,
  field: string
): Record<string, unknown> => {
  const value = decodeJson(raw, field);
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
};

const decodeItemType = (value: string, field: string): ItemType => {
  if (!isOneOf(value, ITEM_TYPES)) {
    throw new Error(`${field} has an invalid item type`);
  }
  return value;
};

const decodeStimuli = (
  raw: string | null,
  field: string
): Stimulus[] | null => {
  if (raw === null) {
    return null;
  }
  const stimuli = parseStimuli(decodeJson(raw, field));
  if (stimuli === null) {
    throw new Error(`${field} must be a stimulus array`);
  }
  return [...stimuli];
};

/**
 * TASK-142: normalize an incoming mask to the PERSISTED shape.
 *
 * The picker hands over a `MaskResult`, which also carries `masked` - the
 * sentence with the blank in it, which is already the item's passage and must
 * not be duplicated into a column. Normalizing here rather than at the call
 * site also fixes the key order, which is what a JSON comparison would
 * otherwise trip over, and lets the invariant be enforced on the way IN rather
 * than only on the way out.
 */
const maskRecord = (mask: ItemMask | null | undefined): ItemMask | null => {
  if (mask === null || mask === undefined) {
    return null;
  }
  // A verified mask asserts the target surface was token-checked out of the
  // sentence, and only the masking strategies that DO that re-verify may
  // claim it: `trailing-literal` (TASK-142, a grammar pattern's literal),
  // `context-word` (TASK-173.5, a cloze's blanked word) and `fragment-span`
  // (TASK-173.6, a star item's blanked fragment region). Every other strategy
  // is a recorded failure and must stay `verified: false`.
  if (
    mask.verified &&
    mask.strategy !== "trailing-literal" &&
    mask.strategy !== "context-word" &&
    mask.strategy !== "fragment-span"
  ) {
    throw new Error(
      "an item mask cannot be verified unless the literal was masked"
    );
  }
  return {
    literal: mask.literal,
    strategy: mask.strategy,
    verified: mask.verified,
  };
};

/** TASK-142: the masking record. A cell the store cannot read is
 * corruption and throws, exactly like `stimuli`: a mask that silently decodes
 * to null would make an item look unmasked when the record says otherwise,
 * which is the outcome AC#3 exists to prevent. */
const MASK_STRATEGIES = [
  "context-word",
  "fragment-span",
  "literal-absent-from-sentence",
  "literal-not-a-token",
  "no-literal-in-pattern",
  "trailing-literal",
  "unverified-after-masking",
] as const;

/** One canonical encoding, so a comparison never depends on key order. */
const encodeMask = (mask: ItemMask | null): string | null =>
  mask ? JSON.stringify(mask) : null;

const decodeItemMask = (raw: string | null, field: string): ItemMask | null => {
  if (raw === null) {
    return null;
  }
  const value = decodeJson(raw, field);
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mask object`);
  }
  const { literal, strategy, verified } = value;
  if (typeof literal !== "string" && literal !== null) {
    throw new Error(`${field} literal must be a string or null`);
  }
  if (
    typeof strategy !== "string" ||
    !MASK_STRATEGIES.includes(strategy as ItemMask["strategy"])
  ) {
    throw new Error(`${field} has an invalid mask strategy`);
  }
  if (typeof verified !== "boolean") {
    throw new Error(`${field} verified must be a boolean`);
  }
  return maskRecord({ literal, strategy, verified } as ItemMask);
};

const decodeItem = (row: typeof items.$inferSelect): ItemResolution => {
  if (!isOneOf(row.surface, ITEM_SURFACES)) {
    throw new Error(`item ${row.id} has an invalid surface`);
  }
  if (!isOneOf(row.itemType, ITEM_TYPES)) {
    throw new Error(`item ${row.id} has an invalid item type`);
  }
  const options = decodeStringArray(row.options, `item ${row.id} options`, 4);
  const anchors = decodeStringArray(row.anchors, `item ${row.id} anchors`);
  if (anchors.length === 0) {
    throw new Error(`item ${row.id} must have an anchor`);
  }
  if (
    !Number.isInteger(row.answerIndex) ||
    row.answerIndex < 0 ||
    row.answerIndex >= options.length
  ) {
    throw new Error(`item ${row.id} has an invalid answer index`);
  }
  return {
    anchors,
    answerIndex: row.answerIndex,
    createdAt: row.createdAt,
    disputed: row.disputed,
    disputedAt: row.disputedAt,
    explanation: row.explanation,
    fsrsVocabId: row.fsrsVocabId,
    id: row.id,
    itemType: row.itemType,
    level: row.level,
    mask: decodeItemMask(row.mask, `item ${row.id} mask`),
    options,
    passage: row.passage,
    prompt: row.prompt,
    script: row.script,
    seedPart: row.seedPart,
    stem: row.stem,
    stimuli: decodeStimuli(row.stimuli, `item ${row.id} stimuli`),
    surface: row.surface,
  };
};

/** The passage-only stimulus set a client may read. Scripts never cross. */
export const itemStimuliForClient = (
  item: Pick<QuestionItem, "passage" | "script" | "stimuli">
): readonly ItemStimulusForClient[] =>
  stimulusTexts(item, "passage").map((text) => ({ kind: "passage", text }));

/**
 * The item types whose answer is heard. The six standalone 聴解 forms —
 * `listening-detail`, TASK-173.8.1's four paper blocks
 * (`listening-kadai` 課題理解, `listening-point` ポイント理解,
 * `listening-hatsuwa` 発話表現, `listening-sokuji` 即時応答),
 * TASK-173.9.4.1's 概要理解 (`listening-gaiyou`, N3) and TASK-173.9.4.2's
 * 聴解統合理解 (`listening-choukai`, N2) — because each
 * one's ONLY stimulus is its script: the scenario is spoken, nothing is
 * printed, so the client cannot answer it without the text it synthesizes.
 * Exported so the exam service's resolution path decides identically.
 *
 * `integrated-listening` is deliberately excluded even though it also has a
 * script, because its script is ONE OF SEVERAL stimuli: a script plus an
 * accompanying passage, which is the shape TASK-132 wrote `itemStimuliForClient`
 * for, and a named test there ("keeps an integrated listening script out of the
 * client render") guards the rule. Widening the exception to it would silently
 * override an invariant TASK-132 owns, which is not this task's call. So an
 * integrated-listening item carries no speech, and playing one is a separate
 * decision with its own reasoning.
 */
export const SPEAKING_ITEM_TYPES: readonly ItemType[] = [
  "listening-detail",
  "listening-choukai",
  "listening-gaiyou",
  "listening-kadai",
  "listening-point",
  "listening-hatsuwa",
  "listening-sokuji",
];

/** TASK-141: the text a listening item speaks, and null for every other item
 * type.
 *
 * This is a documented exception to TASK-132's rule that "a listening script
 * must never be projected", and the exception is narrow on purpose:
 *
 *  - it is LISTENING-ONLY, so no reading item's passage or script can be
 *    spoken by a client that was never asked to hear it;
 *  - it is the SYNTHESIS INPUT, not a reading aid. The audio is produced on the
 *    client by sherpa-onnx, because the models live in the Tauri shell and the
 *    sidecar has no TTS and never will - so there is no audio file to ship and
 *    nothing to cache. The old rule held while the audio was assumed to come
 *    from elsewhere;
 *  - `stimuli` still projects passages only (`itemStimuliForClient`), and an
 *    integrated-listening item's accompanying passage still travels as
 *    `passage`. What crosses here is the sentence that is spoken, nothing else.
 */
const toClientItem = (item: ItemResolution): ItemForClient => ({
  anchors: item.anchors,
  createdAt: item.createdAt,
  id: item.id,
  itemType: item.itemType,
  level: item.level,
  options: item.options,
  passage: item.passage,
  prompt: item.prompt,
  seedPart: item.seedPart,
  speech: SPEAKING_ITEM_TYPES.includes(item.itemType) ? item.script : null,
  stem: item.stem,
  stimuli: itemStimuliForClient(item),
  surface: item.surface,
});

const toClientExamItem = (entry: ComposedExamItem): ExamItemForClient => ({
  item: toClientItem(entry.item),
  itemType: entry.itemType,
  order: entry.order,
  section: entry.section,
});

const toClientExamAnswer = (answer: StoredExamAnswer): ExamAnswerForClient => ({
  answeredAt: answer.answeredAt,
  itemId: answer.itemId,
  section: answer.section,
  selectedIndex: answer.answerIndex,
});

const requireOneOf = <Value extends string>(
  value: string,
  allowed: readonly Value[],
  message: string
): Value => {
  if (!isOneOf(value, allowed)) {
    throw new Error(message);
  }
  return value;
};

const assertNonNegativeInteger = (value: number, message: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(message);
  }
};

const assertPositiveInteger = (value: number, message: string): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(message);
  }
};

const assertExactLength = (
  value: readonly unknown[],
  length: number,
  message: string
): void => {
  if (value.length !== length) {
    throw new Error(message);
  }
};

const decodeExamSection = (
  row: typeof examSections.$inferSelect
): StoredExamSection => {
  const status = requireOneOf(
    row.status,
    EXAM_SECTION_STATUSES,
    `exam section ${row.examId}/${row.section} has an invalid status`
  );
  assertNonNegativeInteger(
    row.position,
    `exam section ${row.examId}/${row.section} has an invalid position`
  );
  assertNonNegativeInteger(
    row.requestedItems,
    `exam section ${row.examId}/${row.section} has an invalid item count`
  );
  if (row.timeLimitSeconds !== null) {
    assertPositiveInteger(
      row.timeLimitSeconds,
      `exam section ${row.examId}/${row.section} has an invalid time limit`
    );
  }
  for (const [field, value] of [
    ["active time", row.activeMs],
    ["pause count", row.pauseCount],
    ["paused time", row.pausedMs],
  ] as const) {
    assertNonNegativeInteger(
      value,
      `exam section ${row.examId}/${row.section} has an invalid ${field}`
    );
  }
  return {
    activeMs: row.activeMs,
    createdAt: row.createdAt,
    examId: row.examId,
    pauseCount: row.pauseCount,
    pausedAt: row.pausedAt,
    pausedMs: row.pausedMs,
    position: row.position,
    requestedItems: row.requestedItems,
    section: row.section,
    startedAt: row.startedAt,
    status,
    submittedAt: row.submittedAt,
    timeLimitSeconds: row.timeLimitSeconds,
    timerStartedAt: row.timerStartedAt,
  };
};

const elapsedSince = (from: string, to: string): number =>
  Math.max(0, Date.parse(to) - Date.parse(from));

const activeElapsedMs = (section: StoredExamSection, at: string): number =>
  section.activeMs +
  (section.timerStartedAt === null
    ? 0
    : elapsedSince(section.timerStartedAt, at));

const pausedElapsedMs = (section: StoredExamSection, at: string): number =>
  section.pausedMs +
  (section.pausedAt === null ? 0 : elapsedSince(section.pausedAt, at));

const isAnswerableExamSection = (
  section: StoredExamSection | undefined
): section is StoredExamSection =>
  section !== undefined &&
  section.status === "in_progress" &&
  section.pausedAt === null &&
  section.timerStartedAt !== null;

const decodeExamAnswer = (
  row: typeof examAnswers.$inferSelect
): StoredExamAnswer => {
  if (!Number.isInteger(row.answerIndex) || row.answerIndex < 0) {
    throw new Error(`exam answer ${row.id} has an invalid answer index`);
  }
  return {
    answeredAt: row.answeredAt,
    answerIndex: row.answerIndex,
    createdAt: row.createdAt,
    examId: row.examId,
    id: row.id,
    itemId: row.itemId,
    section: row.section,
  };
};

const decodeExam = (row: typeof exams.$inferSelect): StoredExam => {
  if (!isOneOf(row.mode, EXAM_MODES)) {
    throw new Error(`exam ${row.id} has an invalid mode`);
  }
  if (!isOneOf(row.source, EXAM_SOURCES)) {
    throw new Error(`exam ${row.id} has an invalid source`);
  }
  if (!isOneOf(row.status, EXAM_STATUSES)) {
    throw new Error(`exam ${row.id} has an invalid status`);
  }
  return {
    abandonedAt: row.abandonedAt,
    budgets: decodeNumberRecord(row.budgets, `exam ${row.id} budgets`),
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    currentSection: row.currentSection,
    focus: decodeStringArray(row.focus, `exam ${row.id} focus`),
    id: row.id,
    level: row.level,
    mode: row.mode,
    readyAt: row.readyAt,
    result: row.result
      ? decodeObjectRecord(row.result, `exam ${row.id} result`)
      : null,
    seed: row.seed,
    source: row.source,
    startedAt: row.startedAt,
    status: row.status,
    submittedAt: row.submittedAt,
  };
};

const decodeDrillSession = (
  row: typeof drillSessions.$inferSelect
): StoredDrillSession => {
  if (!isOneOf(row.status, DRILL_SESSION_STATUSES)) {
    throw new Error(`drill session ${row.id} has an invalid status`);
  }
  return {
    anchors: decodeStringArray(row.anchors, `drill session ${row.id} anchors`),
    conversationId: row.conversationId,
    declaredCount: row.declaredCount,
    endedAt: row.endedAt,
    id: row.id,
    level: row.level,
    startedAt: row.startedAt,
    status: row.status,
    tier: row.tier,
  };
};

const stringArraysEqual = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((entry, index) => entry === right[index]);

type ItemInputComparator = (
  item: ItemResolution,
  input: StoreItemInput
) => boolean;

const itemInputComparators: readonly ItemInputComparator[] = [
  (item, input) => item.answerIndex === input.answerIndex,
  (item, input) => item.explanation === (input.explanation ?? null),
  (item, input) => item.fsrsVocabId === (input.fsrsVocabId ?? null),
  (item, input) => item.id === input.id,
  (item, input) => item.itemType === input.itemType,
  (item, input) => item.level === input.level,
  (item, input) => encodeMask(item.mask) === encodeMask(maskRecord(input.mask)),
  (item, input) =>
    item.passage === (input.passage ?? firstStimulusText(input, "passage")),
  (item, input) => item.prompt === input.prompt,
  (item, input) =>
    item.script === (input.script ?? firstStimulusText(input, "script")),
  (item, input) => item.seedPart === (input.seedPart ?? null),
  (item, input) => item.stem === (input.stem ?? null),
  (item, input) => item.surface === input.surface,
  (item, input) =>
    JSON.stringify(declaredStimuli(item)) ===
    JSON.stringify(declaredStimuli(input)),
  (item, input) => stringArraysEqual(item.anchors, input.anchors),
  (item, input) => stringArraysEqual(item.options, input.options),
];

const itemMatchesInput = (
  item: ItemResolution,
  input: StoreItemInput
): boolean => itemInputComparators.every((compare) => compare(item, input));

const isValidChoice = (choice: number, optionCount: number): boolean =>
  Number.isInteger(choice) && choice >= 0 && choice < optionCount;

const validateItemInput = (input: StoreItemInput): void => {
  requireOneOf(input.surface, ITEM_SURFACES, "an item surface is invalid");
  requireOneOf(input.itemType, ITEM_TYPES, "an item type is invalid");
  if (input.anchors.length === 0) {
    throw new Error("an item must have at least one anchor");
  }
  assertExactLength(input.options, 4, "an item must have exactly four options");
  if (!isValidChoice(input.answerIndex, input.options.length)) {
    throw new Error("an item answer index must select one of its options");
  }
  const { fsrsVocabId } = input;
  if (
    input.stem !== undefined &&
    input.stem !== null &&
    input.stem.length === 0
  ) {
    throw new Error("an item stem must name the line the paper prints");
  }
  if (fsrsVocabId !== undefined && fsrsVocabId !== null) {
    if (!FSRS_ITEM_TYPES.includes(input.itemType)) {
      throw new Error(`${input.itemType} items cannot link to an FSRS card`);
    }
    assertPositiveInteger(
      fsrsVocabId,
      "an FSRS vocabulary id must be a positive integer"
    );
  }
};

const validateExamItemEntry = (
  level: string,
  entry: ExamItemInput,
  mode: ExamMode
): void => {
  if (!Number.isInteger(entry.order) || entry.order < 0) {
    throw new Error("an exam item order must be a non-negative integer");
  }
  if (entry.section.trim().length === 0) {
    throw new Error("an exam item must have a section");
  }
  const allowedSections = policySectionNames(level);
  if (allowedSections && !allowedSections.has(entry.section)) {
    throw new Error(`${entry.section} is not a ${level} paper section`);
  }
  if (entry.timeLimitSeconds !== undefined) {
    sectionTimeLimitSeconds(level, entry.section, entry.timeLimitSeconds, mode);
  }
};

const assertUniqueExamValues = (
  values: readonly unknown[],
  message: string
): void => {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
};

const validateExamItemEntries = (
  level: string,
  entries: readonly ExamItemInput[],
  mode: ExamMode = "exam-conditions"
): void => {
  if (entries.length === 0) {
    throw new Error("an exam must contain at least one item");
  }
  assertUniqueExamValues(
    entries.map((entry) => entry.itemId),
    "an exam cannot compose the same item twice"
  );
  assertUniqueExamValues(
    entries.map((entry) => entry.order),
    "exam item order must be unique"
  );
  for (const entry of entries) {
    validateExamItemEntry(level, entry, mode);
  }
};

const validateDrillSessionInput = (input: CreateDrillSessionInput): void => {
  if (input.anchors.length === 0) {
    throw new Error("a drill session must have at least one anchor");
  }
  if (!Number.isInteger(input.declaredCount) || input.declaredCount < 0) {
    throw new Error("a drill session count must be a non-negative integer");
  }
  if (
    input.maxPerType !== undefined &&
    (!Number.isInteger(input.maxPerType) || input.maxPerType < 1)
  ) {
    throw new Error("a drill session type cap must be a positive integer");
  }
};

export const createItemStore = (db: ItemStoreDatabase) => {
  const getDrillLifecycle = async (
    sessionId: string
  ): Promise<DrillLifecycleRecord | null> => {
    const [row] = await db
      .select()
      .from(drillSessionLifecycle)
      .where(eq(drillSessionLifecycle.sessionId, sessionId))
      .limit(1);
    return row ? decodeDrillLifecycle(row) : null;
  };

  const ensureDrillLifecycle = async (
    sessionId: string,
    maxPerType = 1
  ): Promise<DrillLifecycleRecord> => {
    await db
      .insert(drillSessionLifecycle)
      .values({ maxPerType, sessionId })
      .onConflictDoNothing();
    const lifecycle = await getDrillLifecycle(sessionId);
    if (!lifecycle) {
      throw new Error(`drill session lifecycle ${sessionId} was not stored`);
    }
    return lifecycle;
  };

  const readExam = async (id: string): Promise<StoredExam | null> => {
    const [row] = await db
      .select()
      .from(exams)
      .where(eq(exams.id, id))
      .limit(1);
    return row ? decodeExam(row) : null;
  };

  const readExamSections = async (
    examId: string
  ): Promise<StoredExamSection[]> => {
    const rows = await db
      .select()
      .from(examSections)
      .where(eq(examSections.examId, examId))
      .orderBy(asc(examSections.position));
    return rows.map(decodeExamSection);
  };

  const readExamItems = async (examId: string): Promise<ComposedExamItem[]> => {
    const rows = await db
      .select({ examItem: examItems, item: items })
      .from(examItems)
      .innerJoin(items, eq(examItems.itemId, items.id))
      .where(eq(examItems.examId, examId))
      .orderBy(asc(examItems.order));
    return rows.map(({ examItem, item }) => ({
      item: decodeItem(item),
      itemType: decodeItemType(examItem.itemType, `exam item ${examItem.id}`),
      order: examItem.order,
      section: examItem.section,
    }));
  };

  /** TASK-148: the anchors this level has already SERVED, derived from the exam
   * rows instead of kept in a second ledger. Every composed item carries its
   * anchor in `items.anchors` and every paper records what it composed in
   * `exam_items`, so the union over `exams.level → exam_items → items`, limited
   * to `SERVED_EXAM_STATUSES`, IS the seen set. Deriving it is what makes the
   * guarantee durable for free (AC#2: the thing that survives a restart is the
   * exams table, not a map) and what scopes it per level (AC#3). Two
   * consequences follow from the derivation and are accepted deliberately: an
   * abandoned paper still counts, because it did show those questions; deleting
   * an exam forgets its anchors, because the exam rows are the record. */
  const readServedAnchorsForLevel = async (
    level: string
  ): Promise<readonly string[]> => {
    const rows = await db
      .select({ anchors: items.anchors, id: items.id })
      .from(examItems)
      .innerJoin(items, eq(examItems.itemId, items.id))
      .innerJoin(exams, eq(examItems.examId, exams.id))
      .where(
        and(
          eq(exams.level, level),
          inArray(exams.status, [...SERVED_EXAM_STATUSES])
        )
      );
    const served = new Set<string>();
    for (const row of rows) {
      for (const anchor of decodeStringArray(
        row.anchors,
        `item ${row.id} anchors`
      )) {
        served.add(anchor);
      }
    }
    return [...served];
  };

  const readExamAnswers = async (
    examId: string
  ): Promise<StoredExamAnswer[]> => {
    const rows = await db
      .select({ answer: examAnswers, order: examItems.order })
      .from(examAnswers)
      .innerJoin(
        examItems,
        and(
          eq(examAnswers.examId, examItems.examId),
          eq(examAnswers.itemId, examItems.itemId)
        )
      )
      .where(eq(examAnswers.examId, examId))
      .orderBy(asc(examItems.order), asc(examAnswers.id));
    return rows.map(({ answer }) => decodeExamAnswer(answer));
  };

  const ensureExamSections = async (
    exam: StoredExam
  ): Promise<StoredExamSection[]> => {
    const existing = await readExamSections(exam.id);
    const composedItems = await readExamItems(exam.id);
    const existingNames = new Set(existing.map((section) => section.section));
    const missingNames = sectionNamesForExam(exam, composedItems).filter(
      (section) => !existingNames.has(section)
    );
    if (missingNames.length > 0) {
      const startPosition =
        existing.reduce((max, section) => Math.max(max, section.position), -1) +
        1;
      await db
        .insert(examSections)
        .values(
          missingNames.map((section, index) => {
            const budget = exam.budgets[section] ?? 0;
            return {
              examId: exam.id,
              position: startPosition + index,
              requestedItems: Number.isInteger(budget) ? budget : 0,
              section,
              timeLimitSeconds: sectionTimeLimitSeconds(
                exam.level,
                section,
                undefined,
                exam.mode,
                budget
              ),
            };
          })
        )
        .onConflictDoNothing();
    }
    const current = await readExamSections(exam.id);
    const updates = current.flatMap((section) => {
      const budget = exam.budgets[section.section] ?? 0;
      const requestedItems = Number.isInteger(budget) ? budget : 0;
      const timeLimitSeconds =
        section.timeLimitSeconds ??
        sectionTimeLimitSeconds(
          exam.level,
          section.section,
          undefined,
          exam.mode,
          exam.budgets[section.section]
        );
      if (
        section.requestedItems === requestedItems &&
        section.timeLimitSeconds === timeLimitSeconds
      ) {
        return [];
      }
      return [
        db
          .update(examSections)
          .set({ requestedItems, timeLimitSeconds })
          .where(
            and(
              eq(examSections.examId, exam.id),
              eq(examSections.section, section.section)
            )
          ),
      ];
    });
    await Promise.all(updates);
    return readExamSections(exam.id);
  };

  const getExamState = async (id: string): Promise<ExamState | null> => {
    const exam = await readExam(id);
    if (!exam) {
      return null;
    }
    const sections = await ensureExamSections(exam);
    const composedItems = await readExamItems(id);
    const answers = await readExamAnswers(id);
    return {
      ...exam,
      answeredCount: answers.length,
      answers,
      items: composedItems,
      sections,
      totalItems: composedItems.length,
    };
  };

  const requireExamState = async (id: string): Promise<ExamState> => {
    const state = await getExamState(id);
    if (!state) {
      throw new Error(`exam ${id} does not exist`);
    }
    return state;
  };

  const requireInProgressExam = async (id: string): Promise<ExamState> => {
    const state = await requireExamState(id);
    if (state.status !== "in_progress") {
      throw new Error(`exam ${id} is not in progress`);
    }
    return state;
  };

  const getExamResult = async (
    id: string
  ): Promise<Readonly<Record<string, unknown>> | null> => {
    const exam = await readExam(id);
    if (exam?.status !== "submitted") {
      return null;
    }
    return exam.result;
  };

  const markExamReady = async (
    input: string | MarkExamReadyInput,
    validatedOrOptions?: boolean | MarkExamReadyOptions
  ): Promise<ExamState> => {
    const normalized = normalizeMarkExamReadyInput(input, validatedOrOptions);
    const state = await requireExamState(normalized.examId);
    if (state.status !== "draft") {
      throw new Error(`exam ${state.id} is not in draft state`);
    }
    if (normalized.validated !== true) {
      throw new Error(`exam ${state.id} cannot become ready before validation`);
    }
    if (state.items.length === 0) {
      throw new Error(`exam ${state.id} cannot become ready without items`);
    }
    const counts = new Map<string, number>();
    for (const item of state.items) {
      counts.set(item.section, (counts.get(item.section) ?? 0) + 1);
    }
    const incomplete = state.sections.filter(
      (section) =>
        section.requestedItems > 0 &&
        (counts.get(section.section) ?? 0) < section.requestedItems
    );
    if (incomplete.length > 0) {
      throw new Error(
        `exam ${state.id} is not fully validated: ${incomplete
          .map((section) => section.section)
          .join(", ")}`
      );
    }
    const readyAt = normalized.at ?? new Date().toISOString();
    const updated = await db
      .update(exams)
      .set({ readyAt, status: "ready" })
      .where(and(eq(exams.id, state.id), eq(exams.status, "draft")))
      .returning({ id: exams.id });
    if (!updated[0]) {
      throw new Error(`exam ${state.id} is not in draft state`);
    }
    return requireExamState(state.id);
  };

  const startExam = async (
    input: string | StartExamInput,
    at?: string
  ): Promise<ExamState> => {
    const normalized = normalizeStartExamInput(input, at);
    const state = await requireExamState(normalized.examId);
    if (state.status === "in_progress") {
      return state;
    }
    if (state.status !== "ready") {
      throw new Error(`exam ${state.id} is not ready`);
    }
    const firstSection = state.sections.find(
      (section) => section.status === "pending"
    );
    if (!firstSection) {
      throw new Error(`exam ${state.id} has no pending section`);
    }
    const startedAt =
      state.startedAt ?? normalized.at ?? new Date().toISOString();
    const updated = await db
      .update(exams)
      .set({
        currentSection: firstSection.section,
        startedAt,
        status: "in_progress",
      })
      .where(
        and(
          eq(exams.id, state.id),
          eq(exams.status, "ready"),
          isNull(exams.currentSection)
        )
      )
      .returning({ id: exams.id });
    if (!updated[0]) {
      throw new Error(`exam ${state.id} could not be started`);
    }
    const sectionUpdated = await db
      .update(examSections)
      .set({
        pausedAt: null,
        startedAt,
        status: "in_progress",
        timerStartedAt: startedAt,
      })
      .where(
        and(
          eq(examSections.examId, state.id),
          eq(examSections.section, firstSection.section),
          eq(examSections.status, "pending")
        )
      )
      .returning({ section: examSections.section });
    if (!sectionUpdated[0]) {
      throw new Error(`exam ${state.id} could not start its first section`);
    }
    return requireExamState(state.id);
  };

  const pauseExam = async (
    input: string | ExamClockInput,
    at?: string
  ): Promise<ExamState> => {
    const normalized = normalizeExamClockInput(input, at);
    const state = await requireInProgressExam(normalized.examId);
    const currentSection = state.sections.find(
      (section) =>
        section.section === state.currentSection &&
        section.status === "in_progress"
    );
    if (!currentSection) {
      throw new Error(`exam ${state.id} has no active section`);
    }
    if (currentSection.pausedAt !== null) {
      return state;
    }
    const pausedAt = normalized.at ?? new Date().toISOString();
    const timerGuard =
      currentSection.timerStartedAt === null
        ? isNull(examSections.timerStartedAt)
        : eq(examSections.timerStartedAt, currentSection.timerStartedAt);
    const updated = await db
      .update(examSections)
      .set({
        activeMs: activeElapsedMs(currentSection, pausedAt),
        pauseCount: currentSection.pauseCount + 1,
        pausedAt,
        pausedMs: currentSection.pausedMs,
        timerStartedAt: null,
      })
      .where(
        and(
          eq(examSections.examId, state.id),
          eq(examSections.section, currentSection.section),
          eq(examSections.status, "in_progress"),
          timerGuard
        )
      )
      .returning({ section: examSections.section });
    if (!updated[0]) {
      throw new Error(`exam ${state.id} could not pause its active section`);
    }
    return requireExamState(state.id);
  };

  const restoreExamSectionClock = async (
    state: ExamState,
    section: StoredExamSection,
    resumedAt: string
  ): Promise<void> => {
    const sectionGuard = and(
      eq(examSections.examId, state.id),
      eq(examSections.section, section.section)
    );
    if (section.status === "pending") {
      const started = await db
        .update(examSections)
        .set({
          pausedAt: null,
          startedAt: resumedAt,
          status: "in_progress",
          timerStartedAt: resumedAt,
        })
        .where(and(sectionGuard, eq(examSections.status, "pending")))
        .returning({ section: examSections.section });
      if (!started[0]) {
        throw new Error(`exam ${state.id} could not resume its section`);
      }
      return;
    }
    if (section.pausedAt !== null) {
      const resumed = await db
        .update(examSections)
        .set({
          pausedAt: null,
          pausedMs: pausedElapsedMs(section, resumedAt),
          timerStartedAt: resumedAt,
        })
        .where(
          and(
            sectionGuard,
            eq(examSections.status, "in_progress"),
            eq(examSections.pausedAt, section.pausedAt)
          )
        )
        .returning({ section: examSections.section });
      if (!resumed[0]) {
        throw new Error(`exam ${state.id} could not resume its active section`);
      }
      return;
    }
    if (section.timerStartedAt !== null) {
      return;
    }
    const restored = await db
      .update(examSections)
      .set({ timerStartedAt: resumedAt })
      .where(
        and(
          sectionGuard,
          eq(examSections.status, "in_progress"),
          isNull(examSections.timerStartedAt)
        )
      )
      .returning({ section: examSections.section });
    if (!restored[0]) {
      throw new Error(`exam ${state.id} could not restore its section clock`);
    }
  };

  const restoreExamPointer = async (
    state: ExamState,
    section: StoredExamSection
  ): Promise<void> => {
    if (state.currentSection === section.section) {
      return;
    }
    const moved = await db
      .update(exams)
      .set({ currentSection: section.section })
      .where(
        and(
          eq(exams.id, state.id),
          eq(exams.status, "in_progress"),
          examSectionPointerGuard(state.currentSection)
        )
      )
      .returning({ id: exams.id });
    if (!moved[0]) {
      throw new Error(`exam ${state.id} could not restore its active section`);
    }
  };

  const resumeExam = async (
    input: string | StartExamInput,
    at?: string
  ): Promise<ExamState> => {
    const normalized = normalizeStartExamInput(input, at);
    const state = await requireInProgressExam(normalized.examId);
    const resumedAt = normalized.at ?? new Date().toISOString();
    let currentSection = state.sections.find(
      (section) => section.section === state.currentSection
    );
    if (currentSection?.status !== "in_progress") {
      currentSection =
        state.sections.find((section) => section.status === "in_progress") ??
        state.sections.find((section) => section.status === "pending");
    }
    if (!currentSection) {
      return state;
    }
    await restoreExamSectionClock(state, currentSection, resumedAt);
    await restoreExamPointer(state, currentSection);
    return requireExamState(state.id);
  };

  const readExamAnswer = async (
    examId: string,
    itemId: string
  ): Promise<StoredExamAnswer | null> => {
    const [row] = await db
      .select()
      .from(examAnswers)
      .where(
        and(eq(examAnswers.examId, examId), eq(examAnswers.itemId, itemId))
      )
      .limit(1);
    return row ? decodeExamAnswer(row) : null;
  };

  const requireComposedExamItem = (
    state: ExamState,
    itemId: string
  ): ComposedExamItem => {
    const composed = state.items.find((entry) => entry.item.id === itemId);
    if (!composed) {
      throw new Error(`item ${itemId} is not in exam ${state.id}`);
    }
    if (state.currentSection !== composed.section) {
      throw new Error(`item ${itemId} is not in the active section`);
    }
    return composed;
  };

  const requireAnswerableExamSection = (
    state: ExamState
  ): StoredExamSection => {
    const activeSection = state.sections.find(
      (section) => section.section === state.currentSection
    );
    if (!isAnswerableExamSection(activeSection)) {
      throw new Error(`exam ${state.id} is not accepting answers while paused`);
    }
    return activeSection;
  };

  const assertExamAnswerTime = (
    state: ExamState,
    activeSection: StoredExamSection,
    answeredAt: string
  ): void => {
    if (
      activeSection.timeLimitSeconds !== null &&
      activeElapsedMs(activeSection, answeredAt) >=
        activeSection.timeLimitSeconds * 1000
    ) {
      throw new Error(`exam ${state.id} section time is up`);
    }
  };

  const insertExamAnswer = async (
    state: ExamState,
    composed: ComposedExamItem,
    answerIndex: number,
    answeredAt: string
  ): Promise<StoredExamAnswer | null> => {
    const [row] = await db
      .insert(examAnswers)
      .values({
        answeredAt,
        answerIndex,
        examId: state.id,
        itemId: composed.item.id,
        section: composed.section,
      })
      .onConflictDoNothing()
      .returning();
    return row ? decodeExamAnswer(row) : null;
  };

  const recordExamAnswer = async (
    input: string | RecordExamAnswerInput,
    itemId?: string,
    answerIndex?: number,
    at?: string
  ): Promise<StoredExamAnswer> => {
    const normalized = normalizeRecordExamAnswerInput(
      input,
      itemId,
      answerIndex,
      at
    );
    const state = await requireInProgressExam(normalized.examId);
    const existing = await readExamAnswer(normalized.examId, normalized.itemId);
    if (existing) {
      return existing;
    }
    const composed = requireComposedExamItem(state, normalized.itemId);
    const activeSection = requireAnswerableExamSection(state);
    if (!isValidChoice(normalized.answerIndex, composed.item.options.length)) {
      throw new Error("an exam answer must select one of the item options");
    }
    const answeredAt = normalized.at ?? new Date().toISOString();
    assertExamAnswerTime(state, activeSection, answeredAt);
    const inserted = await insertExamAnswer(
      state,
      composed,
      normalized.answerIndex,
      answeredAt
    );
    if (inserted) {
      return inserted;
    }
    const current = await readExamAnswer(normalized.examId, normalized.itemId);
    if (!current) {
      throw new Error(
        `exam answer for item ${normalized.itemId} was not stored`
      );
    }
    return current;
  };

  const nextExamSectionFor = (
    state: ExamState,
    currentSection: StoredExamSection,
    requestedSection: string | undefined
  ): StoredExamSection | undefined => {
    if (requestedSection && requestedSection !== currentSection.section) {
      const nextSection = state.sections.find(
        (candidate) => candidate.section === requestedSection
      );
      if (
        nextSection?.status !== "pending" ||
        nextSection.position !== currentSection.position + 1
      ) {
        throw new Error(`exam ${state.id} cannot advance to that section`);
      }
      return nextSection;
    }
    return state.sections.find(
      (candidate) =>
        candidate.position > currentSection.position &&
        candidate.status === "pending"
    );
  };

  const completeExamSection = async (
    state: ExamState,
    currentSection: StoredExamSection,
    submittedAt: string
  ): Promise<void> => {
    const completed = await db
      .update(examSections)
      .set({
        activeMs: activeElapsedMs(currentSection, submittedAt),
        pausedAt: null,
        pausedMs: pausedElapsedMs(currentSection, submittedAt),
        status: "submitted",
        submittedAt,
        timerStartedAt: null,
      })
      .where(
        and(
          eq(examSections.examId, state.id),
          eq(examSections.section, currentSection.section),
          eq(examSections.status, "in_progress")
        )
      )
      .returning({ section: examSections.section });
    if (!completed[0]) {
      throw new Error(`exam ${state.id} could not complete its active section`);
    }
  };

  const clearExamPointer = async (
    state: ExamState,
    currentSection: StoredExamSection
  ): Promise<void> => {
    const cleared = await db
      .update(exams)
      .set({ currentSection: null })
      .where(
        and(
          eq(exams.id, state.id),
          eq(exams.status, "in_progress"),
          eq(exams.currentSection, currentSection.section)
        )
      )
      .returning({ id: exams.id });
    if (!cleared[0]) {
      throw new Error(`exam ${state.id} could not clear its active section`);
    }
  };

  const startNextExamSection = async (
    state: ExamState,
    nextSection: StoredExamSection,
    startedAt: string
  ): Promise<void> => {
    const nextUpdated = await db
      .update(examSections)
      .set({
        pausedAt: null,
        startedAt,
        status: "in_progress",
        timerStartedAt: startedAt,
      })
      .where(
        and(
          eq(examSections.examId, state.id),
          eq(examSections.section, nextSection.section),
          eq(examSections.status, "pending")
        )
      )
      .returning({ section: examSections.section });
    if (!nextUpdated[0]) {
      throw new Error(`exam ${state.id} could not start its next section`);
    }
  };

  const moveExamPointer = async (
    state: ExamState,
    currentSection: StoredExamSection,
    nextSection: StoredExamSection
  ): Promise<void> => {
    const moved = await db
      .update(exams)
      .set({ currentSection: nextSection.section })
      .where(
        and(
          eq(exams.id, state.id),
          eq(exams.status, "in_progress"),
          eq(exams.currentSection, currentSection.section)
        )
      )
      .returning({ id: exams.id });
    if (!moved[0]) {
      throw new Error(`exam ${state.id} could not advance its active section`);
    }
  };

  const advanceExamSection = async (
    input: string | AdvanceExamSectionInput,
    section?: string,
    at?: string
  ): Promise<ExamState> => {
    const normalized = normalizeAdvanceExamSectionInput(input, section, at);
    const state = await requireInProgressExam(normalized.examId);
    const currentSection = state.sections.find(
      (candidate) => candidate.section === state.currentSection
    );
    if (currentSection?.status !== "in_progress") {
      throw new Error(`exam ${state.id} has no active section`);
    }
    const nextSection = nextExamSectionFor(
      state,
      currentSection,
      normalized.section
    );
    const submittedAt = normalized.at ?? new Date().toISOString();
    await completeExamSection(state, currentSection, submittedAt);
    if (!nextSection) {
      await clearExamPointer(state, currentSection);
      return requireExamState(state.id);
    }
    const startedAt = normalized.at ?? new Date().toISOString();
    await startNextExamSection(state, nextSection, startedAt);
    await moveExamPointer(state, currentSection, nextSection);
    return requireExamState(state.id);
  };

  const settleActiveExamSections = async (
    state: ExamState,
    at: string,
    status: "abandoned" | "submitted"
  ): Promise<void> => {
    const activeSections = state.sections.filter(
      (section) => section.status === "in_progress"
    );
    const settled = await Promise.all(
      activeSections.map(async (section) =>
        db
          .update(examSections)
          .set({
            activeMs: activeElapsedMs(section, at),
            pausedAt: null,
            pausedMs: pausedElapsedMs(section, at),
            status,
            ...(status === "submitted" ? { submittedAt: at } : {}),
            timerStartedAt: null,
          })
          .where(
            and(
              eq(examSections.examId, state.id),
              eq(examSections.section, section.section),
              eq(examSections.status, "in_progress")
            )
          )
          .returning({ section: examSections.section })
      )
    );
    const failed = activeSections.find((_, index) => !settled[index]?.[0]);
    if (failed) {
      throw new Error(
        `exam ${state.id} could not stop section ${failed.section}`
      );
    }
  };

  const submitExam = async (
    input: string | SubmitExamInput,
    resultOrAt?: Readonly<Record<string, unknown>> | string,
    at?: string
  ): Promise<ExamState> => {
    const normalized = normalizeSubmitExamInput(input, resultOrAt, at);
    const state = await requireInProgressExam(normalized.examId);
    if (normalized.result !== undefined && !isRecord(normalized.result)) {
      throw new Error("an exam result must be an object");
    }
    const submittedAt = normalized.at ?? new Date().toISOString();
    await settleActiveExamSections(state, submittedAt, "submitted");
    const updated = await db
      .update(exams)
      .set({
        currentSection: null,
        result: normalized.result ? JSON.stringify(normalized.result) : null,
        status: "submitted",
        submittedAt,
      })
      .where(and(eq(exams.id, state.id), eq(exams.status, "in_progress")))
      .returning({ id: exams.id });
    if (!updated[0]) {
      throw new Error(`exam ${state.id} could not be submitted`);
    }
    await db
      .update(examSections)
      .set({ status: "submitted", submittedAt })
      .where(
        and(
          eq(examSections.examId, state.id),
          eq(examSections.status, "pending")
        )
      );
    return requireExamState(state.id);
  };

  const autoSubmitExam = async (
    input: string | SubmitExamInput,
    resultOrAt?: Readonly<Record<string, unknown>> | string,
    at?: string
  ): Promise<ExamState> => submitExam(input, resultOrAt, at);

  const abandonExam = async (
    input: string | AbandonExamInput,
    at?: string
  ): Promise<ExamState> => {
    const normalized =
      typeof input === "string" ? { at, examId: input } : input;
    const state = await requireExamState(normalized.examId);
    if (state.status === "submitted" || state.status === "abandoned") {
      throw new Error(`exam ${state.id} cannot be abandoned`);
    }
    const abandonedAt = normalized.at ?? new Date().toISOString();
    await settleActiveExamSections(state, abandonedAt, "abandoned");
    const updated = await db
      .update(exams)
      .set({ abandonedAt, currentSection: null, status: "abandoned" })
      .where(
        and(
          eq(exams.id, state.id),
          inArray(exams.status, ["draft", "ready", "in_progress"])
        )
      )
      .returning({ id: exams.id });
    if (!updated[0]) {
      throw new Error(`exam ${state.id} could not be abandoned`);
    }
    await db
      .update(examSections)
      .set({ status: "abandoned" })
      .where(
        and(
          eq(examSections.examId, state.id),
          eq(examSections.status, "pending")
        )
      );
    return requireExamState(state.id);
  };

  const renderExam = async (
    input: ExamIdInput
  ): Promise<ExamForClient | null> => {
    const state = await getExamState(examIdFrom(input));
    if (!state) {
      return null;
    }
    const answers = state.answers.map(toClientExamAnswer);
    const clientItems = state.items.map(toClientExamItem);
    return {
      abandonedAt: state.abandonedAt,
      answers,
      budgets: state.budgets,
      conversationId: state.conversationId,
      createdAt: state.createdAt,
      currentSection: state.currentSection,
      id: state.id,
      items: clientItems,
      level: state.level,
      mode: state.mode,
      readyAt: state.readyAt,
      sections: state.sections.map((section) => ({
        ...section,
        answers: answers.filter((answer) => answer.section === section.section),
        items: clientItems.filter((item) => item.section === section.section),
      })),
      seed: state.seed,
      source: state.source,
      startedAt: state.startedAt,
      status: state.status,
      submittedAt: state.submittedAt,
    };
  };

  const getExamForClient = renderExam;

  const listExamItemsForClient = async (
    examId: string
  ): Promise<ExamItemForClient[]> => {
    const state = await getExamState(examId);
    return state ? state.items.map(toClientExamItem) : [];
  };

  const requireExamResult = async (
    id: string
  ): Promise<Readonly<Record<string, unknown>>> => {
    const result = await getExamResult(id);
    if (!result) {
      throw new Error(`exam ${id} has no submitted result`);
    }
    return result;
  };

  const requireDrillSessionStatus = async (
    id: string,
    status: DrillSessionStatus,
    message: string
  ): Promise<DrillSessionState> => {
    const current = await getDrillSessionState(id);
    if (current?.status !== status) {
      throw new Error(message);
    }
    return current;
  };

  const setDrillSessionStatus = async (
    id: string,
    status: DrillSessionStatus,
    endedAt?: string
  ): Promise<DrillSessionState> => {
    const values = endedAt === undefined ? { status } : { endedAt, status };
    const updated = await db
      .update(drillSessions)
      .set(values)
      .where(eq(drillSessions.id, id))
      .returning({ id: drillSessions.id });
    if (!updated[0]) {
      throw new Error(`drill session ${id} does not exist`);
    }
    const state = await getDrillSessionState(id);
    if (!state) {
      throw new Error(`drill session ${id} does not exist`);
    }
    return state;
  };

  const getItemResolution = async (
    id: string
  ): Promise<ItemResolution | null> => {
    const [row] = await db
      .select()
      .from(items)
      .where(eq(items.id, id))
      .limit(1);
    return row ? decodeItem(row) : null;
  };

  const requireItemResolution = async (id: string): Promise<ItemResolution> => {
    const item = await getItemResolution(id);
    if (!item) {
      throw new Error(`item ${id} does not exist`);
    }
    return item;
  };

  const markItemDisputed = async (
    id: string,
    at = new Date().toISOString()
  ): Promise<ItemResolution> => {
    const current = await getItemResolution(id);
    if (!current) {
      throw new Error(`item ${id} does not exist`);
    }
    if (current.disputed) {
      return current;
    }
    await db
      .update(items)
      .set({
        disputed: true,
        disputedAt: sql`COALESCE(${items.disputedAt}, ${at})`,
      })
      .where(eq(items.id, id))
      .returning({ id: items.id });
    return requireItemResolution(id);
  };

  const getDrillAttempt = async (
    sessionId: string,
    itemId: string
  ): Promise<StoredDrillAttempt | null> => {
    const [row] = await db
      .select()
      .from(drillAttempts)
      .where(
        and(
          eq(drillAttempts.sessionId, sessionId),
          eq(drillAttempts.itemId, itemId)
        )
      )
      .orderBy(desc(drillAttempts.id))
      .limit(1);
    return row ?? null;
  };

  const getCurrentDrillAttempt = async (
    sessionId: string
  ): Promise<StoredDrillAttempt | null> => {
    const [row] = await db
      .select()
      .from(drillAttempts)
      .where(
        and(
          eq(drillAttempts.sessionId, sessionId),
          isNull(drillAttempts.chosenIndex),
          eq(drillAttempts.skipped, false)
        )
      )
      .orderBy(asc(drillAttempts.id))
      .limit(1);
    return row ?? null;
  };

  const getDrillSessionState = async (
    id: string
  ): Promise<DrillSessionState | null> => {
    const [sessionRow] = await db
      .select()
      .from(drillSessions)
      .where(eq(drillSessions.id, id))
      .limit(1);
    if (!sessionRow) {
      return null;
    }
    const session = decodeDrillSession(sessionRow);
    const lifecycle = await ensureDrillLifecycle(
      id,
      defaultMaxPerType(session.declaredCount)
    );
    const attemptRows = await db
      .select({
        chosenIndex: drillAttempts.chosenIndex,
        correct: drillAttempts.correct,
        itemId: drillAttempts.itemId,
        skipped: drillAttempts.skipped,
      })
      .from(drillAttempts)
      .where(eq(drillAttempts.sessionId, id))
      .orderBy(asc(drillAttempts.id));
    const askedItemIds = attemptRows.map((attempt) => attempt.itemId);
    const answeredItemIds = attemptRows
      .filter((attempt) => attempt.chosenIndex !== null && !attempt.skipped)
      .map((attempt) => attempt.itemId);
    const skipped = attemptRows.filter((attempt) => attempt.skipped).length;
    const readyRows = await db
      .select({ itemId: drillPoolItems.itemId })
      .from(drillPoolItems)
      .where(
        and(eq(drillPoolItems.sessionId, id), eq(drillPoolItems.state, "ready"))
      );
    return {
      ...session,
      answered: answeredItemIds.length,
      answeredCorrect: attemptRows.filter(
        (attempt) => attempt.correct === true && !attempt.skipped
      ).length,
      answeredItemIds,
      asked: askedItemIds.length,
      askedItemIds,
      generation: lifecycle.generation,
      maxPerType: lifecycle.maxPerType,
      readyCount: readyRows.length,
      remaining: Math.max(session.declaredCount - askedItemIds.length, 0),
      skipped,
      supersessionCount: lifecycle.supersessionCount,
    };
  };

  const validateStoredExamItems = async (
    entries: readonly ExamItemInput[]
  ): Promise<void> => {
    const storedItems = await db
      .select({ id: items.id, itemType: items.itemType })
      .from(items)
      .where(
        inArray(
          items.id,
          entries.map((entry) => entry.itemId)
        )
      );
    if (storedItems.length !== entries.length) {
      throw new Error("an exam can only compose stored items");
    }
    const storedTypes = new Map(
      storedItems.map((item) => [item.id, item.itemType])
    );
    for (const entry of entries) {
      if (storedTypes.get(entry.itemId) !== entry.itemType) {
        throw new Error(`exam item ${entry.itemId} has a mismatched type`);
      }
    }
  };

  const requireAnswerableDrillSession = (
    session: DrillSessionState | null,
    sessionId: string,
    existing: StoredDrillAttempt | null
  ): void => {
    if (!session) {
      throw new Error(`drill session ${sessionId} does not exist`);
    }
    if (session.status !== "active") {
      throw new Error(`drill session ${sessionId} is not active`);
    }
    if (!existing && session.asked >= session.declaredCount) {
      throw new Error(`drill session ${sessionId} has no remaining items`);
    }
  };

  const insertDrillAttempt = async (
    sessionId: string,
    itemId: string,
    chosenIndex: number,
    correct: boolean
  ): Promise<StoredDrillAttempt | undefined> => {
    const [attempt] = await db
      .insert(drillAttempts)
      .values({ chosenIndex, correct, itemId, sessionId })
      .onConflictDoNothing()
      .returning();
    return attempt;
  };

  const updatePendingDrillAttempt = async (
    sessionId: string,
    itemId: string,
    chosenIndex: number,
    correct: boolean
  ): Promise<StoredDrillAttempt | undefined> => {
    const [attempt] = await db
      .update(drillAttempts)
      .set({ chosenIndex, correct, skipped: false })
      .where(
        and(
          eq(drillAttempts.sessionId, sessionId),
          eq(drillAttempts.itemId, itemId),
          isNull(drillAttempts.chosenIndex),
          eq(drillAttempts.skipped, false)
        )
      )
      .returning();
    return attempt;
  };

  const answerDrillItem = async (
    sessionId: string,
    itemId: string,
    chosenIndex: number
  ): Promise<DrillAnswerResult> => {
    const existing = await getDrillAttempt(sessionId, itemId);
    if (existing && existing.chosenIndex !== null) {
      return { attempt: existing, recorded: false };
    }
    const item = await requireItemResolution(itemId);
    const session = await getDrillSessionState(sessionId);
    requireAnswerableDrillSession(session, sessionId, existing);
    if (!isValidChoice(chosenIndex, item.options.length)) {
      throw new Error("a drill answer must select one of the item options");
    }
    const correct = chosenIndex === item.answerIndex;
    const inserted = existing
      ? undefined
      : await insertDrillAttempt(sessionId, itemId, chosenIndex, correct);
    if (inserted) {
      return { attempt: inserted, recorded: true };
    }
    const updated = await updatePendingDrillAttempt(
      sessionId,
      itemId,
      chosenIndex,
      correct
    );
    if (updated) {
      return { attempt: updated, recorded: true };
    }
    const attempt = await getDrillAttempt(sessionId, itemId);
    if (!attempt) {
      throw new Error(`drill attempt for item ${itemId} was not stored`);
    }
    return { attempt, recorded: false };
  };

  return {
    abandonExam,

    advanceExamSection,
    answerDrillItem,
    appendDrillPoolItems: async (
      input: AppendDrillPoolInput
    ): Promise<number> => {
      const session = await getDrillSessionState(input.sessionId);
      if (
        session?.status !== "active" ||
        session.generation !== input.expectedGeneration
      ) {
        return 0;
      }
      const existingRows = await db
        .select({ position: drillPoolItems.position })
        .from(drillPoolItems)
        .where(eq(drillPoolItems.sessionId, input.sessionId))
        .orderBy(asc(drillPoolItems.position));
      const startPosition = existingRows.at(-1)?.position ?? -1;
      const inserted = await db
        .insert(drillPoolItems)
        .values(
          input.itemIds.map((itemId, index) => ({
            generation: input.expectedGeneration,
            itemId,
            position: startPosition + index + 1,
            sessionId: input.sessionId,
          }))
        )
        .onConflictDoNothing()
        .returning({ itemId: drillPoolItems.itemId });
      return inserted.length;
    },

    autoSubmitExam,

    claimDrillItem: async (
      sessionId: string,
      itemId: string
    ): Promise<ClaimDrillItemResult> => {
      const current = await getCurrentDrillAttempt(sessionId);
      if (current) {
        return { attempt: current, kind: "current" };
      }
      const session = await getDrillSessionState(sessionId);
      if (!session) {
        throw new Error(`drill session ${sessionId} does not exist`);
      }
      if (session.status !== "active") {
        throw new Error(`drill session ${sessionId} is not active`);
      }
      if (session.asked >= session.declaredCount) {
        throw new Error(`drill session ${sessionId} has no remaining items`);
      }
      const claimed = await db
        .update(drillPoolItems)
        .set({ state: "asked" })
        .where(
          and(
            eq(drillPoolItems.sessionId, sessionId),
            eq(drillPoolItems.itemId, itemId),
            eq(drillPoolItems.state, "ready")
          )
        )
        .returning({ itemId: drillPoolItems.itemId });
      if (!claimed[0]) {
        throw new Error(`drill item ${itemId} is not ready`);
      }
      const inserted = await db
        .insert(drillAttempts)
        .values({ itemId, sessionId })
        .onConflictDoNothing()
        .returning();
      const attempt = inserted[0] ?? (await getDrillAttempt(sessionId, itemId));
      if (!attempt) {
        throw new Error(`drill attempt for item ${itemId} was not stored`);
      }
      return { attempt, kind: inserted[0] ? "claimed" : "current" };
    },

    completeDrillSession: async (id: string): Promise<DrillSessionState> =>
      setDrillSessionStatus(id, "completed", new Date().toISOString()),

    composeExamItems: async (
      examId: string,
      entries: readonly ExamItemInput[]
    ): Promise<void> => {
      const exam = await readExam(examId);
      if (!exam) {
        throw new Error(`exam ${examId} does not exist`);
      }
      if (exam.status !== "draft") {
        throw new Error(`exam ${examId} is not in draft state`);
      }
      validateExamItemEntries(exam.level, entries, exam.mode);
      await validateStoredExamItems(entries);
      await db.insert(examItems).values(
        entries.map((entry) => ({
          examId,
          itemId: entry.itemId,
          itemType: entry.itemType,
          order: entry.order,
          section: entry.section,
        }))
      );
      const updatedExam = await readExam(examId);
      if (!updatedExam) {
        throw new Error(`exam ${examId} does not exist`);
      }
      await ensureExamSections(updatedExam);
      const timingUpdates = entries.flatMap((entry) =>
        entry.timeLimitSeconds === undefined
          ? []
          : [
              db
                .update(examSections)
                .set({ timeLimitSeconds: entry.timeLimitSeconds })
                .where(
                  and(
                    eq(examSections.examId, examId),
                    eq(examSections.section, entry.section)
                  )
                ),
            ]
      );
      await Promise.all(timingUpdates);
    },

    createDrillSession: async (
      input: CreateDrillSessionInput
    ): Promise<StoredDrillSession> => {
      validateDrillSessionInput(input);
      const [row] = await db
        .insert(drillSessions)
        .values({
          anchors: JSON.stringify(input.anchors),
          conversationId: input.conversationId,
          declaredCount: input.declaredCount,
          id: input.id,
          level: input.level ?? null,
          tier: input.tier,
        })
        .returning();
      if (!row) {
        throw new Error(`drill session ${input.id} was not stored`);
      }
      await ensureDrillLifecycle(
        input.id,
        input.maxPerType ?? defaultMaxPerType(input.declaredCount)
      );
      return decodeDrillSession(row);
    },

    createExam: async (input: CreateExamInput): Promise<StoredExam> => {
      if (!isPaperLevel(input.level)) {
        throw new Error("an exam level is invalid");
      }
      if (!isOneOf(input.mode, EXAM_MODES)) {
        throw new Error("an exam mode is invalid");
      }
      if (!isOneOf(input.source, EXAM_SOURCES)) {
        throw new Error("an exam source is invalid");
      }
      if (
        !Object.values(input.budgets).every(
          (budget) => Number.isInteger(budget) && budget >= 0
        )
      ) {
        throw new Error("exam budgets must be non-negative integers");
      }
      const [row] = await db
        .insert(exams)
        .values({
          budgets: JSON.stringify(input.budgets),
          conversationId: input.conversationId,
          focus: JSON.stringify(input.focus ?? []),
          id: input.id,
          level: input.level,
          mode: input.mode,
          seed: input.seed,
          source: input.source,
        })
        .returning();
      if (!row) {
        throw new Error(`exam ${input.id} was not stored`);
      }
      const exam = decodeExam(row);
      await ensureExamSections(exam);
      return exam;
    },

    deleteDrillSession: async (id: string): Promise<boolean> => {
      const deleted = await db
        .delete(drillSessions)
        .where(eq(drillSessions.id, id))
        .returning({ id: drillSessions.id });
      return deleted.length > 0;
    },

    deleteExam: async (id: string): Promise<boolean> => {
      const deleted = await db
        .delete(exams)
        .where(eq(exams.id, id))
        .returning({ id: exams.id });
      return deleted.length > 0;
    },

    dropDrillPoolItem: async (
      sessionId: string,
      itemId: string,
      reason: DrillPoolDropReason
    ): Promise<boolean> => {
      const dropped = await db
        .update(drillPoolItems)
        .set({ dropReason: reason, state: "dropped" })
        .where(
          and(
            eq(drillPoolItems.sessionId, sessionId),
            eq(drillPoolItems.itemId, itemId),
            eq(drillPoolItems.state, "ready")
          )
        )
        .returning({ itemId: drillPoolItems.itemId });
      return dropped.length > 0;
    },

    getCurrentDrillAttempt,

    getDrillAttempt,

    getDrillAttempts: async (
      sessionId: string
    ): Promise<StoredDrillAttempt[]> =>
      db
        .select()
        .from(drillAttempts)
        .where(eq(drillAttempts.sessionId, sessionId))
        .orderBy(asc(drillAttempts.id)),

    getDrillLifecycle,

    getDrillPool: async (sessionId: string): Promise<DrillPoolEntry[]> => {
      const rows = await db
        .select()
        .from(drillPoolItems)
        .where(eq(drillPoolItems.sessionId, sessionId))
        .orderBy(asc(drillPoolItems.position));
      return rows.map((row) => ({
        dropReason: row.dropReason,
        generation: row.generation,
        itemId: row.itemId,
        position: row.position,
        state: decodeDrillPoolState(row.state),
      }));
    },

    getDrillSessionState,

    getExam: readExam,

    getExamAnswers: readExamAnswers,

    getExamForClient,

    getExamResult,

    getExamSections: readExamSections,

    getExamState,

    isItemDisputed: async (id: string): Promise<boolean> =>
      (await getItemResolution(id))?.disputed ?? false,

    listExamItems: readExamItems,

    listExamItemsForClient,

    listServedAnchorsForLevel: readServedAnchorsForLevel,

    markDrillItemAsked: async (
      sessionId: string,
      itemId: string
    ): Promise<StoredDrillAttempt> => {
      const existing = await getDrillAttempt(sessionId, itemId);
      if (existing) {
        return existing;
      }
      await requireItemResolution(itemId);
      const session = await getDrillSessionState(sessionId);
      if (!session) {
        throw new Error(`drill session ${sessionId} does not exist`);
      }
      if (session.status !== "active") {
        throw new Error(`drill session ${sessionId} is not active`);
      }
      if (session.asked >= session.declaredCount) {
        throw new Error(`drill session ${sessionId} has no remaining items`);
      }
      await db
        .insert(drillAttempts)
        .values({ itemId, sessionId })
        .onConflictDoNothing();
      const attempt = await getDrillAttempt(sessionId, itemId);
      if (!attempt) {
        throw new Error(`drill attempt for item ${itemId} was not stored`);
      }
      return attempt;
    },

    markExamReady,

    markItemDisputed,

    pauseDrillSession: async (id: string): Promise<DrillSessionState> => {
      await requireDrillSessionStatus(
        id,
        "active",
        `drill session ${id} is not active`
      );
      return setDrillSessionStatus(id, "paused");
    },

    pauseExam,

    recordExamAnswer,

    renderExam,

    renderItem: async (id: string): Promise<ItemForClient | null> => {
      const item = await getItemResolution(id);
      return item ? toClientItem(item) : null;
    },

    requeueDrillItem: async (
      sessionId: string,
      itemId: string,
      expectedGeneration: number
    ): Promise<boolean> => {
      const session = await getDrillSessionState(sessionId);
      if (
        session?.status !== "active" ||
        session.generation !== expectedGeneration
      ) {
        return false;
      }
      const rows = await db
        .select({ position: drillPoolItems.position })
        .from(drillPoolItems)
        .where(eq(drillPoolItems.sessionId, sessionId))
        .orderBy(asc(drillPoolItems.position));
      const position = (rows.at(-1)?.position ?? -1) + 1;
      const inserted = await db
        .insert(drillPoolItems)
        .values({
          generation: expectedGeneration,
          itemId,
          position,
          sessionId,
        })
        .returning({ itemId: drillPoolItems.itemId });
      return inserted.length === 1;
    },

    requireExamResult,

    resolveItem: async (id: string): Promise<ItemResolution | null> =>
      getItemResolution(id),

    resumeDrillSession: async (id: string): Promise<DrillSessionState> => {
      await requireDrillSessionStatus(
        id,
        "paused",
        `drill session ${id} is not paused`
      );
      return setDrillSessionStatus(id, "active");
    },

    resumeExam,

    skipDrillItem: async (
      sessionId: string,
      itemId: string
    ): Promise<StoredDrillAttempt | null> => {
      const current = await getCurrentDrillAttempt(sessionId);
      if (!current || current.itemId !== itemId) {
        return null;
      }
      await db
        .update(drillAttempts)
        .set({ skipped: true })
        .where(eq(drillAttempts.id, current.id));
      return getDrillAttempt(sessionId, itemId);
    },

    startExam,

    storeItem: async (input: StoreItemInput): Promise<ItemForClient> => {
      validateItemInput(input);
      const declared = declaredStimuli(input);
      await db
        .insert(items)
        .values({
          anchors: JSON.stringify(input.anchors),
          answerIndex: input.answerIndex,
          explanation: input.explanation ?? null,
          fsrsVocabId: input.fsrsVocabId ?? null,
          id: input.id,
          itemType: input.itemType,
          level: input.level,
          mask: encodeMask(maskRecord(input.mask)),
          options: JSON.stringify(input.options),
          // The singular columns stay the materialized first stimulus, so a
          // multi-stimulus item still reads as a passage or script item to the
          // consumers that only know that shape.
          passage: input.passage ?? firstStimulusText(input, "passage"),
          prompt: input.prompt,
          script: input.script ?? firstStimulusText(input, "script"),
          seedPart: input.seedPart ?? null,
          stem: input.stem ?? null,
          stimuli: declared.length > 0 ? JSON.stringify(declared) : null,
          surface: input.surface,
        })
        .onConflictDoNothing();
      const item = await requireItemResolution(input.id);
      if (!itemMatchesInput(item, input)) {
        throw new Error(
          `item ${input.id} already exists with different content`
        );
      }
      return toClientItem(item);
    },

    submitExam,

    supersedeDrillPool: async (
      sessionId: string
    ): Promise<SupersedeDrillPoolResult> => {
      const current = await ensureDrillLifecycle(sessionId);
      if (current.supersessionCount >= 2) {
        return { dropped: 0, lifecycle: current, superseded: false };
      }
      const updated = await db
        .update(drillSessionLifecycle)
        .set({
          generation: current.generation + 1,
          supersessionCount: current.supersessionCount + 1,
        })
        .where(
          and(
            eq(drillSessionLifecycle.sessionId, sessionId),
            eq(drillSessionLifecycle.generation, current.generation),
            lt(drillSessionLifecycle.supersessionCount, 2)
          )
        )
        .returning();
      if (!updated[0]) {
        const latest = await getDrillLifecycle(sessionId);
        if (!latest) {
          throw new Error(
            `drill session lifecycle ${sessionId} was not stored`
          );
        }
        return { dropped: 0, lifecycle: latest, superseded: false };
      }
      const dropped = await db
        .update(drillPoolItems)
        .set({ dropReason: "superseded", state: "superseded" })
        .where(
          and(
            eq(drillPoolItems.sessionId, sessionId),
            eq(drillPoolItems.generation, current.generation),
            eq(drillPoolItems.state, "ready")
          )
        )
        .returning({ itemId: drillPoolItems.itemId });
      return {
        dropped: dropped.length,
        lifecycle: decodeDrillLifecycle(updated[0]),
        superseded: true,
      };
    },
  };
};

export type ItemStore = ReturnType<typeof createItemStore>;
