import { oc, type RouterContractClient } from "@orpc/contract";
import { z } from "zod";
import { chatContract } from "./chat";
import { examContract } from "./exam";
// Side-effect: the oRPC Registry narrowing of ORPCErrorCode (TASK-80.9).
import "./orpc-error-codes";
import {
  AgentsOutputSchema,
  AssistantsOutputSchema,
  ModelCatalogSchema,
} from "./schemas/acp";
import {
  CardNotFoundError,
  CreateCardsInputSchema,
  CreateCardsOutputSchema,
  DueOutputSchema,
  GradeInputSchema,
  GradeOutputSchema,
} from "./schemas/cards";
import {
  GrammarItemSchema,
  JlptLevelSchema,
  KanjiEntrySchema,
  KanjiListRowSchema,
  KanjiNotFoundError,
  LevelQuerySchema,
  NoStrokeDataError,
  StrokeOrderSchema,
  VocabItemSchema,
} from "./schemas/jap-data";
import {
  NextCardsInputSchema,
  NextCardsOutputSchema,
  RateLimitedError,
} from "./schemas/learn";

// ── cards (user.db / FSRS queue — POST /cards, GET /cards/due, POST /cards/grade)

export type { PersonaOption } from "./schemas/acp";
export type {
  GrammarItem,
  JlptLevel,
  KanjiListRow,
  StrokeNumber,
  StrokePath,
  VocabItem,
} from "./schemas/jap-data";

export const createCards = oc
  .input(CreateCardsInputSchema)
  .output(CreateCardsOutputSchema);

export const dueCards = oc.output(DueOutputSchema);

export const gradeCard = oc
  .input(GradeInputSchema)
  .output(GradeOutputSchema)
  .errors({ NOT_FOUND: { data: CardNotFoundError } });

// ── jap-data (read-only corpora — GET /kanji, /kanji/stroke, /grammar, /vocab)

export const lookupKanji = oc
  .input(z.object({ character: z.string().min(1).max(1) }))
  .output(KanjiEntrySchema)
  .errors({ NOT_FOUND: { data: KanjiNotFoundError } });

export const listKanji = oc
  .input(z.object({ level: JlptLevelSchema }))
  .output(
    z.object({ level: JlptLevelSchema, rows: z.array(KanjiListRowSchema) })
  );

export const strokeOrder = oc
  .input(z.object({ character: z.string().min(1).max(1) }))
  .output(StrokeOrderSchema)
  .errors({ NOT_FOUND: { data: NoStrokeDataError } });

export const listGrammar = oc
  .input(LevelQuerySchema)
  .output(z.object({ grammar: z.array(GrammarItemSchema) }));

export const listVocab = oc
  .input(LevelQuerySchema)
  .output(z.object({ vocab: z.array(VocabItemSchema) }));

// ── acp (agent/session plumbing — GET /agents, /assistants, /agents/:id/models;
//    chat lives under `chat` below, TASK-80.2)
export const listAgents = oc.output(AgentsOutputSchema);

export const listAssistants = oc.output(AssistantsOutputSchema);

export const agentModels = oc
  .input(z.object({ id: z.string().min(1) }))
  .output(ModelCatalogSchema)
  .errors({
    AUTH_REQUIRED: { data: z.object({ message: z.string() }) },
    NOT_FOUND: { data: z.object({ message: z.string() }) },
  });

// ── learn (Teacher Agent orchestrator — GET /learn/nextCards; POST /learn/chat
//    stays on the SSE route until the streaming phase, TASK-71 AC6)

export const nextCards = oc
  .input(NextCardsInputSchema)
  .output(NextCardsOutputSchema)
  .errors({ TOO_MANY_REQUESTS: { data: RateLimitedError } });

export type ContractClient = RouterContractClient<typeof contract>;

export const contract = {
  acp: {
    agents: { list: listAgents, models: agentModels },
    assistants: { list: listAssistants },
  },
  cards: {
    create: createCards,
    due: dueCards,
    grade: gradeCard,
  },
  chat: chatContract,
  exam: examContract,
  jap: {
    grammar: { list: listGrammar },
    kanji: { find: lookupKanji, list: listKanji, stroke: strokeOrder },
    vocab: { list: listVocab },
  },
  learn: {
    nextCards,
  },
};

// Chat frame vocabulary (TASK-80.2): the client reducer's input type.
export type { ChatFrame } from "./chat";

export type {
  ExamAdvanceSectionInput,
  ExamAnswer,
  ExamAnswerInput,
  ExamAnswerOutput,
  ExamBudget,
  ExamBuildInput,
  ExamBuildReceipt,
  ExamComposedItem,
  ExamDebrief,
  ExamDebriefItem,
  ExamDebriefSection,
  ExamDisputeInput,
  ExamDisputeOutput,
  ExamFloor,
  ExamFloorEntry,
  ExamIdInput,
  ExamItem,
  ExamItemType,
  ExamLevel,
  ExamMode,
  ExamModeLabel,
  ExamPaperBlock,
  ExamPauseSummary,
  ExamProgress,
  ExamRequest,
  ExamRequestInput,
  ExamResult,
  ExamReview,
  ExamScoringSectionId,
  ExamSectionId,
  ExamSectionMetadata,
  ExamSectionState,
  ExamSectionStatus,
  ExamSource,
  ExamState,
  ExamStatus,
  ExamStimulus,
  ExamSubmitInput,
  ExamUnfilledPaperBlock,
} from "./exam";

// biome-ignore lint/performance/noBarrelFile: the package index is the shared public contract facade
export {
  EXAM_ITEM_TYPES,
  EXAM_MODE_LABELS,
  EXAM_MODES,
  EXAM_SCORING_SECTION_IDS,
  EXAM_SCORING_SECTION_LABELS,
  EXAM_SCORING_SECTION_LABELS_JA,
  EXAM_SECTION_IDS,
  EXAM_SECTION_LABELS,
  EXAM_SECTION_LABELS_JA,
  EXAM_SECTION_STATUSES,
  EXAM_SOURCES,
  EXAM_STATUSES,
  ExamAdvanceSectionInputSchema,
  ExamAnswerInputSchema,
  ExamAnswerOutputSchema,
  ExamAnswerSchema,
  ExamBudgetSchema,
  ExamBuildInputSchema,
  ExamBuildReceiptSchema,
  ExamComposedItemSchema,
  ExamDebriefItemSchema,
  ExamDebriefSchema,
  ExamDebriefSectionSchema,
  ExamDisputeInputSchema,
  ExamDisputeOutputSchema,
  ExamFloorSchema,
  ExamIdInputSchema,
  ExamItemSchema,
  ExamItemTypeSchema,
  ExamLevelSchema,
  ExamModeLabelSchema,
  ExamModeSchema,
  ExamPaperBlockSchema,
  ExamPauseSummarySchema,
  ExamProgressSchema,
  ExamRequestInputSchema,
  ExamRequestSchema,
  ExamResultSchema,
  ExamReviewSchema,
  ExamScoringSectionIdSchema,
  ExamSectionIdSchema,
  ExamSectionMetadataSchema,
  ExamSectionStateSchema,
  ExamSectionStatusSchema,
  ExamSourceSchema,
  ExamStateSchema,
  ExamStatusSchema,
  ExamStimulusSchema,
  ExamSubmitInputSchema,
  ExamUnfilledPaperBlockSchema,
  examContract,
  examScoringSectionLabel,
  examScoringSectionLabelForMode,
  examSectionLabel,
  examSectionLabelForMode,
} from "./exam";
// Schema type re-exports for consumers that type query caches without
// re-deriving from the contract (apps/desktop/src/lib/sensei.ts).
export type {
  AgentOption,
  AgentsOutput,
  AssistantsOutput,
  ModelCatalog,
} from "./schemas/acp";
export { JlptLevelSchema } from "./schemas/jap-data";
