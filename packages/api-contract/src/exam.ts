import { oc } from "@orpc/contract";
import { z } from "zod";
import { type JlptLevel, JlptLevelSchema } from "./schemas/jap-data";

/** The SAME schema object as the wire's `?level=`, aliased under the exam
 * domain name. A second `z.enum` over the same five strings would be a second
 * validator that `/vocab` accepts and `exam-service.ts` `toLevel` rejects. */
export const ExamLevelSchema = JlptLevelSchema;
export type ExamLevel = JlptLevel;

export const EXAM_MODES = ["real", "shortened", "exam-conditions"] as const;
export const ExamModeSchema = z.enum(EXAM_MODES);
export type ExamMode = z.infer<typeof ExamModeSchema>;

export const EXAM_SECTION_IDS = [
  "vocabulary",
  "grammar-reading",
  "listening",
  "language-knowledge-reading",
] as const;
export const ExamSectionIdSchema = z.enum(EXAM_SECTION_IDS);
export type ExamSectionId = z.infer<typeof ExamSectionIdSchema>;

export const EXAM_SCORING_SECTION_IDS = [
  "language-knowledge",
  "reading",
  ...EXAM_SECTION_IDS,
] as const;
export const ExamScoringSectionIdSchema = z.enum(EXAM_SCORING_SECTION_IDS);
export type ExamScoringSectionId = z.infer<typeof ExamScoringSectionIdSchema>;

/** The official name of a test section (doc-12 §2.6). Total over the id union
 * on purpose: a partial `if` chain with a default arm silently renamed the N1
 * reading column "Vocabulary", which is how one fact ended up with two labels
 * on one screen (TASK-137). Adding an id now fails to compile instead. */
export const EXAM_SECTION_LABELS = {
  "grammar-reading": "Grammar·Reading",
  "language-knowledge-reading": "Language Knowledge·Reading",
  listening: "Listening",
  vocabulary: "Vocabulary",
} as const satisfies Record<ExamSectionId, string>;

/** The scoring-column names that are a plain function of the id.
 * `language-knowledge` is deliberately absent: see `examScoringSectionLabel`. */
export const EXAM_SCORING_SECTION_LABELS = {
  ...EXAM_SECTION_LABELS,
  reading: "Reading",
} as const satisfies Record<
  Exclude<ExamScoringSectionId, "language-knowledge">,
  string
>;

/** Levels whose 120-point `language-knowledge` column has reading folded into
 * it, so its official name is the longer one. N1/N2 score the same id as the
 * 60-point vocabulary-plus-grammar column beside a separate reading column. */
const FOLDED_READING_LEVELS: readonly ExamLevel[] = ["N4", "N5"];

export const examSectionLabel = (id: ExamSectionId): string =>
  EXAM_SECTION_LABELS[id];

/** The one label per scoring fact, for both the chat summary and the result
 * pane. The per-level id sets are pinned against the blueprint by
 * `apps/server/test/exam-section-labels.test.ts`: `api-contract` and
 * `item-engine` are both boundary leaves that may not import each other, so
 * the two declarations are checked the same way `ExamLevelSchema` is
 * (`apps/server/test/level-vocabulary.test.ts`) rather than shared. */
export const examScoringSectionLabel = ({
  id,
  level,
}: {
  id: ExamScoringSectionId;
  level: ExamLevel;
}): string => {
  if (id === "language-knowledge") {
    return FOLDED_READING_LEVELS.includes(level)
      ? EXAM_SECTION_LABELS["language-knowledge-reading"]
      : "Language Knowledge";
  }
  return EXAM_SCORING_SECTION_LABELS[id];
};

/** The same four test sections under the names the paper itself prints, read
 * off the official 問題の構成 pages (doc-12 §2.6, doc-26 §8). Total over the id
 * union for the same reason the English table is: a missing key would fall back
 * to a name that means something else. */
export const EXAM_SECTION_LABELS_JA = {
  "grammar-reading": "言語知識（文法）・読解",
  "language-knowledge-reading": "言語知識（文字・語彙・文法）・読解",
  listening: "聴解",
  vocabulary: "言語知識（文字・語彙）",
} as const satisfies Record<ExamSectionId, string>;

/** The scoring names that are a plain function of the id, Japanese twin of
 * `EXAM_SCORING_SECTION_LABELS`. `language-knowledge` is absent for the same
 * reason: see `examScoringSectionLabelForMode`. */
export const EXAM_SCORING_SECTION_LABELS_JA = {
  ...EXAM_SECTION_LABELS_JA,
  reading: "読解",
} as const satisfies Record<
  Exclude<ExamScoringSectionId, "language-knowledge">,
  string
>;

/** The 60-point 言語知識 column at N1/N2/N3, which is not the folded 120-point
 * column of N4/N5. */
const LANGUAGE_KNOWLEDGE_JA = "言語知識（文字・語彙・文法）";

/** The section name a learner sees on the paper. A `real` paper prints the
 * official Japanese 科目; `shortened` and `exam-conditions` are this app's own
 * formats and keep the English name. Internal, non-learner contexts keep
 * calling `examSectionLabel` directly and are unaffected by mode (TASK-173.3
 * AC#2). */
export const examSectionLabelForMode = ({
  id,
  mode,
}: {
  id: ExamSectionId;
  mode: ExamMode;
}): string =>
  mode === "real" ? EXAM_SECTION_LABELS_JA[id] : EXAM_SECTION_LABELS[id];

/** `examSectionLabelForMode` for a scoring column, so the result pane and the
 * chat summary name one section one way. The `language-knowledge` id is
 * level-dependent in Japanese exactly as it is in English. */
export const examScoringSectionLabelForMode = ({
  id,
  level,
  mode,
}: {
  id: ExamScoringSectionId;
  level: ExamLevel;
  mode: ExamMode;
}): string => {
  if (mode !== "real") {
    return examScoringSectionLabel({ id, level });
  }
  if (id === "language-knowledge") {
    return FOLDED_READING_LEVELS.includes(level)
      ? EXAM_SECTION_LABELS_JA["language-knowledge-reading"]
      : LANGUAGE_KNOWLEDGE_JA;
  }
  return EXAM_SCORING_SECTION_LABELS_JA[id];
};

export const EXAM_STATUSES = [
  "draft",
  "ready",
  "in_progress",
  "submitted",
  "abandoned",
] as const;
export const ExamStatusSchema = z.enum(EXAM_STATUSES);
export type ExamStatus = z.infer<typeof ExamStatusSchema>;

export const EXAM_SECTION_STATUSES = [
  "pending",
  "in_progress",
  "submitted",
  "abandoned",
] as const;
export const ExamSectionStatusSchema = z.enum(EXAM_SECTION_STATUSES);
export type ExamSectionStatus = z.infer<typeof ExamSectionStatusSchema>;

export const EXAM_SOURCES = ["generated", "seed", "checkpoint"] as const;
export const ExamSourceSchema = z.enum(EXAM_SOURCES);
export type ExamSource = z.infer<typeof ExamSourceSchema>;

export const EXAM_MODE_LABELS = [
  "exam-conditions",
  "real-paper-banded",
  "real-paper-raw-only",
  "shortened-paper-banded",
  "shortened-paper-raw-only",
] as const;
export const ExamModeLabelSchema = z.enum(EXAM_MODE_LABELS);
export type ExamModeLabel = z.infer<typeof ExamModeLabelSchema>;

export const EXAM_ITEM_TYPES = [
  "kanji-reading",
  "word-spelling",
  "compound-completion",
  "synonym-paraphrase",
  "sentence-paraphrase",
  "word-in-context",
  "context-cloze",
  "discourse-cloze",
  "star-ordering",
  "grammar-form",
  "usage",
  "conjugation",
  "particle",
  "reading-info",
  "long-reading",
  "medium-reading",
  "short-reading",
  "claim-understanding",
  "text-comparison",
  "info-search",
  "integrated-reading",
  "listening-detail",
  "integrated-listening",
  "listening-kadai",
  "listening-point",
  "listening-hatsuwa",
  "listening-sokuji",
  "listening-choukai",
  "listening-gaiyou",
  "kana-cell",
] as const;
export const ExamItemTypeSchema = z.enum(EXAM_ITEM_TYPES);
export type ExamItemType = z.infer<typeof ExamItemTypeSchema>;

const IdentifierSchema = z.string().trim().min(1);
const TimestampSchema = z.string().min(1);
const NonNegativeCountSchema = z.number().int().nonnegative();
const PositiveCountSchema = z.number().int().positive();

export const ExamBudgetSchema = z
  .object({
    "grammar-reading": NonNegativeCountSchema.optional(),
    "language-knowledge-reading": NonNegativeCountSchema.optional(),
    listening: NonNegativeCountSchema.optional(),
    vocabulary: NonNegativeCountSchema.optional(),
  })
  .strict();
export type ExamBudget = z.infer<typeof ExamBudgetSchema>;

const ExamSectionsSchema = z
  .array(ExamSectionIdSchema)
  .min(1)
  .max(EXAM_SECTION_IDS.length)
  .refine((sections) => new Set(sections).size === sections.length, {
    message: "exam sections must be unique",
  });
const ExamFocusSchema = z.array(IdentifierSchema).max(100);

export const ExamRequestInputSchema = z
  .object({
    budget: ExamBudgetSchema.optional(),
    conversationId: IdentifierSchema.optional(),
    focus: ExamFocusSchema.optional(),
    level: ExamLevelSchema,
    mode: ExamModeSchema.default("shortened"),
    sections: ExamSectionsSchema.optional(),
    seed: IdentifierSchema.optional(),
  })
  .strict();
export type ExamRequestInput = z.infer<typeof ExamRequestInputSchema>;

export const ExamRequestSchema = z
  .object({
    budget: ExamBudgetSchema,
    focus: ExamFocusSchema,
    level: ExamLevelSchema,
    mode: ExamModeSchema,
    sections: ExamSectionsSchema,
    seed: IdentifierSchema,
  })
  .strict();
export type ExamRequest = z.infer<typeof ExamRequestSchema>;

const ExamFloorEntrySchema = z
  .object({
    cap: z.union([z.literal(60), z.literal(120)]),
    id: ExamScoringSectionIdSchema,
    itemCount: NonNegativeCountSchema,
    minimumItems: z.union([z.literal(10), z.literal(20)]),
    status: z.enum(["met", "unmet"]),
  })
  .strict();
export type ExamFloorEntry = z.infer<typeof ExamFloorEntrySchema>;

export const ExamFloorSchema = z
  .object({
    floors: z.array(ExamFloorEntrySchema),
    scoring: z.enum(["band", "raw-only"]),
  })
  .strict();
export type ExamFloor = z.infer<typeof ExamFloorSchema>;

export const ExamSectionMetadataSchema = z
  .object({
    id: ExamSectionIdSchema,
    minutes: PositiveCountSchema,
    position: NonNegativeCountSchema,
    requestedItems: NonNegativeCountSchema,
    scoringSectionIds: z.array(ExamScoringSectionIdSchema).min(1),
    shortfall: NonNegativeCountSchema,
    status: ExamSectionStatusSchema,
    timeLimitSeconds: PositiveCountSchema.nullable(),
    validatedItems: NonNegativeCountSchema,
  })
  .strict();
export type ExamSectionMetadata = z.infer<typeof ExamSectionMetadataSchema>;

/**
 * One 大問 of the official shape that this real paper asked for and could not
 * ask (TASK-173.4 AC#4). Neither of the two older shortage diagnoses describes
 * it: the content was not exhausted and nothing was turned down. A block lands
 * here for either of two reasons, and they are the same fact to a learner: the
 * item engine has no question kind for it, or its question kind exists but this
 * level has no store to ask it from (the sourced 読解 blocks). `name` is the
 * official Japanese heading, so the learner is told which part of the paper is
 * missing.
 */
export const ExamUnfilledPaperBlockSchema = z
  .object({
    bigQuestion: PositiveCountSchema,
    name: z.string().min(1),
    requestedItems: PositiveCountSchema,
    section: ExamSectionIdSchema,
  })
  .strict();
export type ExamUnfilledPaperBlock = z.infer<
  typeof ExamUnfilledPaperBlockSchema
>;

export const ExamBuildReceiptSchema = z
  .object({
    /** TASK-148 AC#4 + AC#6: the paper is short because this level has no
     * UNSEEN content left for at least one of its families, as distinct from
     * `shortfall > 0` for a reason the learner did nothing about (no corpus, a
     * validator rejection). True only alongside a shortfall, so a ready paper
     * never claims the learner has run a level dry. */
    contentExhausted: z.boolean(),
    conversationId: IdentifierSchema.optional(),
    examId: IdentifierSchema,
    floor: ExamFloorSchema,
    label: ExamModeLabelSchema,
    level: ExamLevelSchema,
    mode: ExamModeSchema,
    ready: z.boolean(),
    /** TASK-173.1 AC#4/#6: the sections a `real` paper came up short in because
     * it refused a fabricated candidate, not because the level ran dry. A refusal
     * and `contentExhausted` are opposite diagnoses, so they are separate fields
     * and only the build that refused can set this. The 大問 that the official
     * shape asks for and real mode cannot ask at all are a third fact and are
     * named one by one in `unfilledBlocks`. */
    refusedSections: z.array(ExamSectionIdSchema),
    request: ExamRequestSchema,
    sections: z.array(ExamSectionMetadataSchema),
    shortfall: NonNegativeCountSchema,
    status: ExamStatusSchema,
    totalSlots: NonNegativeCountSchema,
    unfilledBlocks: z.array(ExamUnfilledPaperBlockSchema),
    validatedSlots: NonNegativeCountSchema,
  })
  .strict();
export type ExamBuildReceipt = z.infer<typeof ExamBuildReceiptSchema>;

export const ExamIdInputSchema = z
  .object({
    examId: IdentifierSchema,
  })
  .strict();
export type ExamIdInput = z.infer<typeof ExamIdInputSchema>;

export const ExamDisputeInputSchema = z
  .object({
    examId: IdentifierSchema,
    itemId: IdentifierSchema,
  })
  .strict();
export type ExamDisputeInput = z.infer<typeof ExamDisputeInputSchema>;

export const ExamDisputeOutputSchema = z
  .object({
    disputed: z.boolean(),
    disputedAt: TimestampSchema.nullable(),
    itemId: IdentifierSchema,
  })
  .strict();
export type ExamDisputeOutput = z.infer<typeof ExamDisputeOutputSchema>;

export const ExamBuildInputSchema = ExamIdInputSchema;
export type ExamBuildInput = z.infer<typeof ExamBuildInputSchema>;

export const ExamAnswerInputSchema = z
  .object({
    examId: IdentifierSchema,
    itemId: IdentifierSchema,
    selectedIndex: z.number().int().nonnegative().max(3),
  })
  .strict();
export type ExamAnswerInput = z.infer<typeof ExamAnswerInputSchema>;

export const ExamAdvanceSectionInputSchema = z
  .object({
    examId: IdentifierSchema,
    section: ExamSectionIdSchema.optional(),
  })
  .strict();
export type ExamAdvanceSectionInput = z.infer<
  typeof ExamAdvanceSectionInputSchema
>;

export const ExamSubmitInputSchema = ExamIdInputSchema;
export type ExamSubmitInput = z.infer<typeof ExamSubmitInputSchema>;

/**
 * A client-readable stimulus. The kind is a literal because a listening script
 * must never reach the client: only passages are readable, in order.
 */
export const ExamStimulusSchema = z.object({
  kind: z.literal("passage"),
  text: z.string().min(1),
});
export type ExamStimulus = z.infer<typeof ExamStimulusSchema>;

export const ExamItemSchema = z
  .object({
    anchors: z.array(IdentifierSchema).min(1),
    id: IdentifierSchema,
    itemType: ExamItemTypeSchema,
    level: ExamLevelSchema,
    options: z.array(z.string().min(1)).length(4),
    passage: z.string().nullable(),
    prompt: z.string().min(1),
    seedPart: z.string().nullable(),
    /** TASK-141: the text a listening item speaks, null for every other item
     * type. The synthesis INPUT, not a reading aid - the audio is produced on
     * the client because the TTS models live in the Tauri shell. A documented,
     * listening-only exception to TASK-132; see item-store's `toClientItem`. */
    speech: z.string().nullable(),
    /** TASK-173.2 AC#2: the Japanese line the paper prints for this 小問, null
     * for an item a real paper does not ask. A real paper shows this and never
     * `prompt`; the daily modes show `prompt` and have no stem to show. */
    stem: z.string().min(1).nullable(),
    stimuli: z.array(ExamStimulusSchema),
    surface: z.enum(["exam", "checkpoint"]),
  })
  .strict();
export type ExamItem = z.infer<typeof ExamItemSchema>;

/**
 * One 大問 of a real paper (TASK-173.4 AC#4): the official heading, the 小問 it
 * asks for, how many this paper actually got, and the instruction sentence the
 * paper prints under that heading (TASK-173.2 AC#1). A section with no 大問
 * structure to print, which is every mode but `real`, carries an empty list.
 */
export const ExamPaperBlockSchema = z
  .object({
    bigQuestion: PositiveCountSchema,
    /** TASK-173.2 AC#1: the 大問's printed instruction, quoted from the level's
     * sample paper. Null when no paper in this repo has been read for that
     * (level, 大問), because a heading nobody printed is worse than none. */
    instruction: z.string().min(1).nullable(),
    itemCount: NonNegativeCountSchema,
    name: z.string().min(1),
    requestedItems: NonNegativeCountSchema,
  })
  .strict();
export type ExamPaperBlock = z.infer<typeof ExamPaperBlockSchema>;

export const ExamComposedItemSchema = z
  .object({
    /** The 大問 this item is a 小問 of, or null when the paper has no 大問
     * structure. Groups on `ExamSectionState.blocks`. */
    bigQuestion: PositiveCountSchema.nullable(),
    item: ExamItemSchema,
    order: NonNegativeCountSchema,
    requestedSlotIndex: NonNegativeCountSchema,
    section: ExamSectionIdSchema,
  })
  .strict();
export type ExamComposedItem = z.infer<typeof ExamComposedItemSchema>;

export const ExamAnswerSchema = z
  .object({
    answeredAt: TimestampSchema,
    itemId: IdentifierSchema,
    section: ExamSectionIdSchema,
    selectedIndex: z.number().int().nonnegative().max(3),
  })
  .strict();
export type ExamAnswer = z.infer<typeof ExamAnswerSchema>;

export const ExamSectionStateSchema = z
  .object({
    answers: z.array(ExamAnswerSchema),
    /** The 大問 of a real paper, in exam order. Empty for every other mode, and
     * empty for a real paper whose stored items no longer match the plan (see
     * `paperBlocksForLandedItems`), because a wrong heading is worse than none. */
    blocks: z.array(ExamPaperBlockSchema),
    id: ExamSectionIdSchema,
    items: z.array(ExamComposedItemSchema),
    minutes: PositiveCountSchema,
    pauseCount: NonNegativeCountSchema,
    paused: z.boolean(),
    pausedMs: NonNegativeCountSchema,
    position: NonNegativeCountSchema,
    remainingSeconds: NonNegativeCountSchema.nullable(),
    requestedItems: NonNegativeCountSchema,
    scoringSectionIds: z.array(ExamScoringSectionIdSchema).min(1),
    startedAt: TimestampSchema.nullable(),
    status: ExamSectionStatusSchema,
    submittedAt: TimestampSchema.nullable(),
    timeLimitSeconds: PositiveCountSchema.nullable(),
  })
  .strict();
export type ExamSectionState = z.infer<typeof ExamSectionStateSchema>;

export const ExamProgressSchema = z
  .object({
    currentSection: ExamSectionIdSchema.nullable(),
    examId: IdentifierSchema,
    floor: ExamFloorSchema,
    label: ExamModeLabelSchema,
    level: ExamLevelSchema,
    mode: ExamModeSchema,
    ready: z.boolean(),
    sections: z.array(ExamSectionMetadataSchema),
    status: ExamStatusSchema,
    submittedAt: TimestampSchema.nullable(),
    totalSlots: NonNegativeCountSchema,
    validatedSlots: NonNegativeCountSchema,
  })
  .strict();
export type ExamProgress = z.infer<typeof ExamProgressSchema>;

export const ExamStateSchema = z
  .object({
    abandonedAt: TimestampSchema.nullable(),
    answers: z.array(ExamAnswerSchema),
    conversationId: IdentifierSchema,
    createdAt: TimestampSchema,
    currentSection: ExamSectionIdSchema.nullable(),
    examId: IdentifierSchema,
    floor: ExamFloorSchema,
    items: z.array(ExamComposedItemSchema),
    label: ExamModeLabelSchema,
    level: ExamLevelSchema,
    mode: ExamModeSchema,
    ready: z.boolean(),
    readyAt: TimestampSchema.nullable(),
    request: ExamRequestSchema,
    sections: z.array(ExamSectionStateSchema),
    seed: IdentifierSchema,
    source: ExamSourceSchema,
    startedAt: TimestampSchema.nullable(),
    status: ExamStatusSchema,
    submittedAt: TimestampSchema.nullable(),
    totalSlots: NonNegativeCountSchema,
    validatedSlots: NonNegativeCountSchema,
  })
  .strict();
export type ExamState = z.infer<typeof ExamStateSchema>;

export const ExamAnswerOutputSchema = z
  .object({
    answer: ExamAnswerSchema,
    recorded: z.boolean(),
    state: ExamStateSchema,
  })
  .strict();
export type ExamAnswerOutput = z.infer<typeof ExamAnswerOutputSchema>;

const ExamResultSectionIdSchema = z.enum([
  "language-knowledge",
  "reading",
  ...EXAM_SECTION_IDS,
]);

const ExamRawScoreSchema = z
  .object({
    correct: NonNegativeCountSchema,
    total: NonNegativeCountSchema,
  })
  .strict();

const ExamBandOverallSchema = z
  .object({
    correct: NonNegativeCountSchema,
    maxScore: z.union([z.literal(120), z.literal(180)]),
    passed: z.boolean(),
    passMark: z.union([
      z.literal(80),
      z.literal(90),
      z.literal(95),
      z.literal(100),
    ]),
    score: NonNegativeCountSchema,
    total: NonNegativeCountSchema,
  })
  .strict();

const ExamBandSectionResultSchema = z
  .object({
    correct: NonNegativeCountSchema,
    id: ExamResultSectionIdSchema,
    maxScore: z.union([z.literal(60), z.literal(120)]),
    passed: z.boolean(),
    passMark: z.union([z.literal(19), z.literal(38)]),
    score: NonNegativeCountSchema,
    total: NonNegativeCountSchema,
  })
  .strict();

const ExamRawSectionResultSchema = z
  .object({
    correct: NonNegativeCountSchema,
    id: ExamResultSectionIdSchema,
    total: NonNegativeCountSchema,
  })
  .strict();

export const ExamPauseSummarySchema = z
  .object({
    count: NonNegativeCountSchema,
    totalMs: NonNegativeCountSchema,
  })
  .strict();
export type ExamPauseSummary = z.infer<typeof ExamPauseSummarySchema>;

const ExamResultEnvelopeSchema = z.object({
  examId: IdentifierSchema,
  label: ExamModeLabelSchema,
  level: ExamLevelSchema,
  mode: ExamModeSchema,
  pauses: ExamPauseSummarySchema,
  status: z.literal("submitted"),
  submittedAt: TimestampSchema,
  weakAnchors: z.array(IdentifierSchema),
});

const ExamBandResultSchema = ExamResultEnvelopeSchema.extend({
  overall: ExamBandOverallSchema,
  scoring: z.literal("band"),
  sections: z.array(ExamBandSectionResultSchema),
}).strict();

const ExamRawResultSchema = ExamResultEnvelopeSchema.extend({
  overall: ExamRawScoreSchema,
  scoring: z.literal("raw-only"),
  sections: z.array(ExamRawSectionResultSchema),
}).strict();

export const ExamResultSchema = z.discriminatedUnion("scoring", [
  ExamBandResultSchema,
  ExamRawResultSchema,
]);
export type ExamResult = z.infer<typeof ExamResultSchema>;

export const ExamDebriefItemSchema = z
  .object({
    /** TASK-160: the learner-facing name of each anchor the item was built
     * from, in `anchors` order, and EMPTY when the corpus cannot name them.
     * `anchors` itself is a corpus id (`vocab:N5:<hash>`, `grammar:<id>`) and
     * must never be interpolated into a sentence a learner reads. */
    anchorLabels: z.array(z.string().min(1)),
    anchors: z.array(IdentifierSchema).min(1),
    correct: z.boolean().nullable(),
    correctIndex: z.number().int().nonnegative().max(3),
    correctOption: z.string().min(1),
    disputed: z.boolean(),
    disputedAt: TimestampSchema.nullable(),
    explanation: z.string().nullable(),
    explanationGenerated: z.boolean(),
    item: ExamItemSchema,
    itemId: IdentifierSchema,
    order: NonNegativeCountSchema,
    section: ExamSectionIdSchema,
    selectedIndex: z.number().int().nonnegative().max(3).nullable(),
    selectedOption: z.string().nullable(),
  })
  .strict();
export type ExamDebriefItem = z.infer<typeof ExamDebriefItemSchema>;

export const ExamDebriefSectionSchema = z
  .object({
    correct: NonNegativeCountSchema,
    id: ExamResultSectionIdSchema,
    total: NonNegativeCountSchema,
    weakAnchors: z.array(IdentifierSchema),
  })
  .strict();
export type ExamDebriefSection = z.infer<typeof ExamDebriefSectionSchema>;

export const ExamDebriefSchema = z
  .object({
    examId: IdentifierSchema,
    items: z.array(ExamDebriefItemSchema),
    label: ExamModeLabelSchema,
    sections: z.array(ExamDebriefSectionSchema),
    status: z.literal("submitted"),
    summary: ExamRawScoreSchema,
    weakAnchors: z.array(IdentifierSchema),
  })
  .strict();
export type ExamDebrief = z.infer<typeof ExamDebriefSchema>;
export const ExamReviewSchema = ExamDebriefSchema;
export type ExamReview = z.infer<typeof ExamReviewSchema>;

const ExamErrorSchema = z
  .object({
    message: z.string().min(1),
  })
  .strict();

const examError = { data: ExamErrorSchema } as const;
const examNotFoundError = { NOT_FOUND: examError } as const;
const examNotReadyError = { NOT_READY: examError } as const;
const examConflictError = { CONFLICT: examError } as const;
const examInvalidRequestError = { INVALID_REQUEST: examError } as const;
const examLifecycleErrors = {
  ...examNotFoundError,
  ...examNotReadyError,
  ...examConflictError,
  ...examInvalidRequestError,
} as const;

const request = oc
  .input(ExamRequestInputSchema)
  .output(ExamBuildReceiptSchema)
  .errors(examInvalidRequestError);

const assemble = oc
  .input(ExamBuildInputSchema)
  .output(ExamBuildReceiptSchema)
  .errors(examLifecycleErrors);

const get = oc
  .input(ExamIdInputSchema)
  .output(ExamStateSchema)
  .errors(examNotFoundError);

const status = oc
  .input(ExamIdInputSchema)
  .output(ExamProgressSchema)
  .errors(examNotFoundError);

const start = oc
  .input(ExamIdInputSchema)
  .output(ExamStateSchema)
  .errors(examLifecycleErrors);

const answer = oc
  .input(ExamAnswerInputSchema)
  .output(ExamAnswerOutputSchema)
  .errors(examLifecycleErrors);

const advanceSection = oc
  .input(ExamAdvanceSectionInputSchema)
  .output(ExamStateSchema)
  .errors(examLifecycleErrors);

const pause = oc
  .input(ExamIdInputSchema)
  .output(ExamStateSchema)
  .errors(examLifecycleErrors);

const resume = oc
  .input(ExamIdInputSchema)
  .output(ExamStateSchema)
  .errors(examLifecycleErrors);

const abandon = oc
  .input(ExamIdInputSchema)
  .output(ExamStateSchema)
  .errors(examLifecycleErrors);

const submit = oc
  .input(ExamSubmitInputSchema)
  .output(ExamStateSchema)
  .errors(examLifecycleErrors);

const result = oc
  .input(ExamIdInputSchema)
  .output(ExamResultSchema)
  .errors(examLifecycleErrors);

const debrief = oc
  .input(ExamIdInputSchema)
  .output(ExamDebriefSchema)
  .errors(examLifecycleErrors);

const review = oc
  .input(ExamIdInputSchema)
  .output(ExamReviewSchema)
  .errors(examLifecycleErrors);

const dispute = oc
  .input(ExamDisputeInputSchema)
  .output(ExamDisputeOutputSchema)
  .errors(examLifecycleErrors);

export const examContract = {
  abandon,
  advanceSection,
  answer,
  assemble,
  debrief,
  dispute,
  get,
  pause,
  request,
  result,
  resume,
  review,
  start,
  status,
  submit,
};
