import { z } from "zod";
import {
  ExamModeLabelSchema,
  ExamModeSchema,
  ExamScoringSectionIdSchema,
} from "../exam";
import { JlptLevelSchema } from "./jap-data";

/**
 * AionUi `IResponseMessage` envelope + the frame union streamed on
 * `chat.subscribe` (TASK-80.2). The envelope shape is taken from AionUi's
 * ipcBridge (type/data/msg_id/turn_id/conversation_id/created_at/hidden/
 * position/status/replace); the `data` payloads mirror the native engine's
 * `AcpStreamEvent` union (packages/acp/src/acp-events.ts), renamed to the
 * AionUi wire vocabulary:
 *
 *   turn_start → start          turn_end → finish (+ error frame when failed)
 *   text → content              thinking → thinking
 *   acp_context_usage, acp_tool_call, acp_permission,
 *   acp_permission_resolved, ask, available_commands,
 *   acp_config_option, acp_mode_info, acp_session_info,
 *   acp_terminal_output, agent_status keep their engine names;
 *   user_created is server-emitted when a prompt stores its user row.
 *
 * `status`/`replace` drive the client reducer: live text chunks append
 * (replace absent), replayed persisted rows replace (replace: true).
 */

/** ACP content block (`text`/`image`/`resource`/`resource_link`, agent-shaped). */
export const ContentBlockSchema = z.looseObject({ type: z.string() });

const NullableString = z.string().nullable().optional();

const ToolCallContentItemSchema = z.looseObject({ type: z.string() });

/** The engine's `AcpToolCallUpdatePayload` (dual-case names are sanitized
 * server-side before the frame is emitted; only camelCase reaches the wire). */
const ToolCallUpdateSchema = z.looseObject({
  content: z.array(ToolCallContentItemSchema).nullable().optional(),
  kind: z.string().nullable().optional(),
  locations: z
    .array(
      z.looseObject({
        line: z.number().nullable().optional(),
        path: z.string(),
      })
    )
    .nullable()
    .optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
  status: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  toolCallId: z.string(),
});

const PermissionOptionSchema = z.looseObject({
  kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
  name: z.string(),
  optionId: z.string(),
});

const ConfigOptionSchema = z.looseObject({
  category: z.string().nullable().optional(),
  currentValue: z.union([z.string(), z.boolean()]),
  description: z.string().nullable().optional(),
  id: z.string(),
  name: z.string().nullable().optional(),
  options: z.array(
    z.looseObject({
      description: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      value: z.string(),
    })
  ),
  type: z.enum(["select", "boolean"]),
});

const AskQuestionSchema = z.looseObject({
  header: z.string().optional(),
  multiSelect: z.boolean().optional(),
  options: z.array(
    z.looseObject({ description: z.string().optional(), label: z.string() })
  ),
  question: z.string(),
});

export const DrillItemSchema = z.object({
  anchors: z.array(z.string()),
  id: z.string(),
  itemType: z.string(),
  level: z.string(),
  options: z.array(z.string()),
  passage: z.string().nullable().optional(),
  prompt: z.string(),
});

export const DrillResolutionSchema = z.object({
  chosenIndex: z.number(),
  correct: z.boolean(),
  correctIndex: z.number(),
  correctOption: z.string().optional(),
  explanation: z.string().nullable().optional(),
  itemId: z.string().optional(),
  skipped: z.boolean().optional(),
});

export const DrillSnapshotSchema = z.object({
  answered: z.number(),
  asked: z.number(),
  correct: z.number().optional(),
  declaredCount: z.number(),
  nextReview: z.string().nullable().optional(),
  pendingRefill: z.boolean().optional(),
  readyCount: z.number().optional(),
  remaining: z.number(),
  skipped: z.number().optional(),
  unanswered: z.number().optional(),
});

const DrillItemDataSchema = z.object({
  drill_session_id: z.string(),
  item: DrillItemSchema.nullable(),
  phase: z.enum(["pending", "answered", "suspended", "summary", "unavailable"]),
  request_id: z.string(),
  resolution: DrillResolutionSchema.optional(),
  session_id: z.string(),
  snapshot: DrillSnapshotSchema,
});

export const PaperFrameSectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(["building", "ready", "unavailable"]),
  total: z.number().int().nonnegative(),
  validated: z.number().int().nonnegative(),
});

export const PaperFrameResultSchema = z.object({
  overall: z.looseObject({
    correct: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
    passed: z.boolean().optional(),
    passMark: z.number().int().nonnegative().optional(),
    score: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  }),
  scoring: z.enum(["band", "raw-only"]),
  sections: z.array(
    z.looseObject({
      correct: z.number().int().nonnegative().optional(),
      // The scoring id, not a name: the name depends on the level and the mode
      // (doc-12 §2.6, TASK-173.3), so `examScoringSectionLabelForMode` derives
      // it at read time. An emitted label is what let a stored frame replay the
      // wrong section name beside the correct one in the result pane (TASK-137).
      id: ExamScoringSectionIdSchema,
      max: z.number().int().nonnegative().optional(),
      passed: z.boolean().optional(),
      score: z.number().int().nonnegative().optional(),
      total: z.number().int().nonnegative().optional(),
    })
  ),
});

export const PaperFrameDebriefSchema = z.object({
  saved: z.boolean(),
  /** TASK-160: the learner-facing NAME of each weak anchor, the names a card
   * may interpolate. `weakAnchors` are corpus ids (`vocab:N5:東:ひがし`,
   * `grammar:dewa-arimasen-negative-polite-copula`) and stay only as keys.
   * OPTIONAL because a stored frame is replayed through this schema (TASK-137
   * learned that the hard way): a paper published before this field existed
   * must still parse, and the card prints nothing rather than the ids it used
   * to print. */
  weakAnchorLabels: z.array(z.string().min(1)).optional(),
  weakAnchors: z.array(z.string()),
});

const PaperFrameDataSchema = z.object({
  abandoned: z.boolean().optional(),
  debrief: PaperFrameDebriefSchema.optional(),
  exam_id: z.string(),
  // The receipt's own label enum, not a copy of it: a new paper mode adds a
  // label, and a frame that re-declares the list rejects the paper it is
  // carrying (TASK-173.1 AC#9). Widening is backward compatible for replay,
  // because every label stored before the new mode is still in the set.
  label: ExamModeLabelSchema,
  level: JlptLevelSchema,
  mode: ExamModeSchema,
  offline: z.boolean().optional(),
  phase: z.enum([
    "building",
    "ready",
    "running",
    "submitted",
    "raw-only",
    "unavailable",
  ]),
  result: PaperFrameResultSchema.optional(),
  sections: z.array(PaperFrameSectionSchema),
  total_slots: z.number().int().nonnegative(),
  validated_slots: z.number().int().nonnegative(),
});

const SlashCommandSchema = z.looseObject({
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
  description: z.string(),
  input: z.looseObject({ hint: z.string().optional() }).nullable().optional(),
  name: z.string(),
});

const TurnUsageSchema = z.looseObject({
  cachedReadTokens: z.number().nullable().optional(),
  cachedWriteTokens: z.number().nullable().optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  thoughtTokens: z.number().nullable().optional(),
  totalTokens: z.number(),
});

const StopReason = z.enum([
  "cancelled",
  "end_turn",
  "error",
  "max_tokens",
  "max_turn_requests",
  "refusal",
]);

/** Terminal-failure detail on a `finish` frame (TASK-102). `code` lets the
 * client render a distinct sign-in / switch-rejected prompt instead of one
 * generic error bubble; `message` is the human-readable reason. */
const TurnErrorSchema = z.looseObject({
  code: z.enum(["AUTH_REQUIRED", "CONFIG_SWITCH_FAILED"]).optional(),
  message: z.string(),
});

/** Shared envelope fields; every frame carries them. */
const envelope = {
  conversation_id: z.string(),
  created_at: z.number().optional(),
  hidden: z.boolean().optional(),
  msg_id: z.string(),
  position: z.enum(["center", "left", "pop", "right"]).optional(),
  replace: z.boolean().optional(),
  status: z.enum(["error", "finish", "pending", "work"]).optional(),
  turn_id: z.string().optional(),
};

export const ChatFrameSchema = z.discriminatedUnion("type", [
  z.looseObject({
    ...envelope,
    data: z.looseObject({ session_id: z.string().optional() }),
    type: z.literal("start"),
  }),
  z.looseObject({
    ...envelope,
    data: ContentBlockSchema,
    type: z.literal("content"),
  }),
  z.looseObject({
    ...envelope,
    data: ContentBlockSchema,
    type: z.literal("thinking"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      entries: z.array(
        z.looseObject({
          content: z.string(),
          priority: z.enum(["high", "low", "medium"]).optional(),
          status: z.enum(["completed", "in_progress", "pending"]),
        })
      ),
    }),
    type: z.literal("plan"),
  }),
  z.looseObject({
    ...envelope,
    data: z
      .looseObject({
        sessionUpdate: z.enum(["tool_call", "tool_call_update"]),
      })
      .and(ToolCallUpdateSchema),
    type: z.literal("acp_tool_call"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      options: z.array(PermissionOptionSchema),
      request_id: z.string(),
      session_id: z.string().optional(),
      tool_call: ToolCallUpdateSchema,
    }),
    type: z.literal("acp_permission"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      option_id: z.string().nullable().optional(),
      request_id: z.string(),
    }),
    type: z.literal("acp_permission_resolved"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      // TASK-86: set only on SETTLED ask rows (the server merges them into
      // the persisted content at answer time); live ask frames carry just
      // the questions. `declined` marks an explicit deny.
      answers: z
        .array(
          z.looseObject({
            labels: z.array(z.string()),
            question: z.string(),
          })
        )
        .optional(),
      declined: z.boolean().optional(),
      questions: z.array(AskQuestionSchema),
      request_id: z.string(),
      session_id: z.string().optional(),
    }),
    type: z.literal("ask"),
  }),
  z.looseObject({
    ...envelope,
    data: DrillItemDataSchema,
    type: z.literal("drill_item"),
  }),
  z.looseObject({
    ...envelope,
    data: PaperFrameDataSchema,
    type: z.literal("paper"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({ commands: z.array(SlashCommandSchema) }),
    type: z.literal("available_commands"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      _meta: z.record(z.string(), z.unknown()).nullable().optional(),
      cost: z
        .looseObject({ amount: z.number(), currency: z.string() })
        .nullable()
        .optional(),
      size: z.number(),
      used: z.number(),
    }),
    type: z.literal("acp_context_usage"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({ configOptions: z.array(ConfigOptionSchema) }),
    type: z.literal("acp_config_option"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({ currentModeId: z.string() }),
    type: z.literal("acp_mode_info"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      title: NullableString,
      updatedAt: NullableString,
    }),
    type: z.literal("acp_session_info"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      command: z.string(),
      exit_status: z
        .looseObject({
          exit_code: z.number().nullable().optional(),
          signaled: z.boolean().optional(),
        })
        .nullable()
        .optional(),
      output: z.string(),
      terminal_id: z.string(),
      truncated: z.boolean(),
    }),
    type: z.literal("acp_terminal_output"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      agent_id: z.string().optional(),
      detail: z.string().optional(),
      session_id: z.string().optional(),
      status: z.enum([
        "connected",
        "connecting",
        "disconnected",
        "error",
        "session_active",
      ]),
    }),
    type: z.literal("agent_status"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({
      error: TurnErrorSchema.optional(),
      stopReason: StopReason,
      usage: TurnUsageSchema.nullable().optional(),
    }),
    type: z.literal("finish"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({ text: z.string() }),
    type: z.literal("error"),
  }),
  z.looseObject({
    ...envelope,
    data: z.looseObject({ text: z.string() }),
    type: z.literal("user_created"),
  }),
]);

export type ChatFrame = z.infer<typeof ChatFrameSchema>;
