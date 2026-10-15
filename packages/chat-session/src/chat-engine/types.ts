/**
 * The chat-engine card model (TASK-80.3, folder-ized TASK-81.2).
 *
 * The AionUi `IMessage` envelope reduced to the ACP dialect: one card per
 * durable frame type, each with a deterministic `id` so a replayed
 * transcript and a live stream fold identically. Pure types + runtime
 * guards; the fold logic lives in `./folds/*`, dispatch in `./transform.ts`,
 * status rules in `./status.ts`.
 */

// `mode` and `label` are the contract's, not a re-declared literal union. This
// card model is the fourth place a paper's mode was spelled out, and the fourth
// is exactly where a new mode goes quietly missing (TASK-173.1 AC#9).
import type { ExamMode, ExamModeLabel } from "@manobu/api-contract";

interface CardBase {
  conversation_id: string;
  created_at?: number;
  hidden?: boolean;
  id: string;
  msg_id: string;
  position?: "center" | "left" | "pop" | "right";
  replace?: boolean;
  status?: "error" | "finish" | "pending" | "work";
  turn_id?: string;
}

/** `content` frame: streaming assistant text. Appended onto the card with
 * the same `msg_id` until the envelope's `replace` flag says otherwise. */
export type TMessageText = CardBase & {
  content: string;
  type: "text";
};

/** `thinking` frame: streaming reasoning, same fold semantics as text. */
export type TMessageThinking = CardBase & {
  content: string;
  type: "thinking";
};

/** One plan checklist entry (the wire `plan` frame's `entries` array). */
export interface PlanEntry {
  content: string;
  priority?: "high" | "low" | "medium";
  status: "completed" | "in_progress" | "pending";
}

/** `plan` frame: a FULL-REPLACE snapshot. `id` = `plan:{msg_id}` (deterministic,
 * matching the persisted row's primary key, AionUi parity). */
export type TMessagePlan = CardBase & {
  entries: PlanEntry[];
  type: "plan";
};

/** `acp_tool_call` frame: one (possibly partial) tool card. Subsequent
 * `tool_call_update` frames merge into the SAME card (id =
 * `tool:{tool_call_id}`). `raw_output` is sanitized via
 * `sanitizeAcpToolUpdate` at this fold, never in components. */
export type TMessageAcpToolCall = Omit<CardBase, "status"> & {
  content?: Array<{ type: string }> | null;
  kind: string | null;
  locations: Array<{ line?: number | null; path: string }> | null;
  raw_input: unknown;
  raw_output: unknown;
  /** Alias for `raw_output` (the sanitized tool result payload). */
  output?: unknown;
  status: string | null;
  title: string | null;
  toolCallId: string;
  type: "acp_tool_call";
};

/** One offered permission option (the wire `acp_permission` shape,
 * matching `PermissionOptionSchema` in `@manobu/api-contract`). */
export interface PermissionOption {
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  name: string;
  optionId: string;
  [key: string]: unknown;
}

/** `acp_permission` frame: a PARKED card the UI must answer (id =
 * `perm:{request_id}`). `acp_permission_resolved` settles it in place. */
export type TMessageAcpPermission = CardBase & {
  options: PermissionOption[];
  requestId: string;
  settled?: { optionId: string | null };
  toolCall: Record<string, unknown>;
  type: "acp_permission";
};

/** One structured question in an `ask` frame (the `ask_user` host-MCP
 * shape, re-sourced here from `AskQuestionSchema`). */
export interface AskQuestion {
  header?: string;
  multiSelect?: boolean;
  options: Array<{ description?: string; label: string }>;
  question: string;
}

/** One structured answer in an `ask` submission (one per question,
 * `labels` = chosen options or the free-text "Other" value). */
export interface AskAnswer {
  labels: string[];
  question: string;
}

/** `ask` frame: a PARKED question set the UI must answer (id =
 * `ask:{request_id}`). On replay of a settled row, `settled` carries the
 * persisted summary and `status` is "finish" (answered/declined) or
 * "error" (expired) — TASK-86. */
export type TMessageAsk = CardBase & {
  questions: AskQuestion[];
  requestId: string;
  settled?: {
    answers?: AskAnswer[];
    decline?: boolean;
  };
  type: "ask";
};

export type DrillPhase =
  | "pending"
  | "answered"
  | "suspended"
  | "summary"
  | "unavailable";

export interface DrillItem {
  anchors: string[];
  id: string;
  itemType: string;
  level: string;
  options: string[];
  passage?: string | null;
  prompt: string;
}

export interface DrillResolution {
  chosenIndex: number;
  correct: boolean;
  correctIndex: number;
  correctOption?: string;
  explanation?: string | null;
  itemId?: string;
  skipped?: boolean;
}

export interface DrillSnapshot {
  answered: number;
  asked: number;
  correct?: number;
  declaredCount: number;
  nextReview?: string | null;
  pendingRefill?: boolean;
  readyCount?: number;
  remaining: number;
  skipped?: number;
  unanswered?: number;
}

export type TMessageDrillItem = CardBase & {
  drillSessionId: string;
  item: DrillItem | null;
  phase: DrillPhase;
  requestId: string;
  resolution?: DrillResolution;
  sessionId: string;
  snapshot: DrillSnapshot;
  type: "drill_item";
};

export type PaperPhase =
  | "building"
  | "ready"
  | "running"
  | "submitted"
  | "raw-only"
  | "unavailable";

export interface PaperSectionSummary {
  id: string;
  label: string;
  state: "building" | "ready" | "unavailable";
  total: number;
  validated: number;
}

export type PaperResult =
  | {
      overall: {
        max: number;
        passed: boolean;
        passMark: number;
        score: number;
      };
      scoring: "band";
      sections: Array<{
        id: string;
        label: string;
        max: number;
        passed: boolean;
        score: number;
      }>;
    }
  | {
      overall: { correct: number; total: number };
      scoring: "raw-only";
      sections: Array<{
        correct: number;
        id: string;
        label: string;
        total: number;
      }>;
    };

export type TMessagePaper = CardBase & {
  abandoned?: boolean;
  debrief?: {
    saved: boolean;
    weakAnchorLabels?: string[];
    weakAnchors: string[];
  };
  examId: string;
  label: ExamModeLabel;
  level: "N1" | "N2" | "N3" | "N4" | "N5";
  mode: ExamMode;
  offline?: boolean;
  phase: PaperPhase;
  result?: PaperResult;
  sections: PaperSectionSummary[];
  totalSlots: number;
  type: "paper";
  validatedSlots: number;
};

/** `error` frame: a terminal error card (id = `err:{msg_id}`). Also produced
 * by a `finish` frame that closed with `stopReason: "error"` and a message
 * (TASK-102 AC#4/#6). `code` discriminates a distinct sign-in / switch-rejected
 * prompt from a generic failure. */
export type TMessageError = CardBase & {
  code?: "AUTH_REQUIRED" | "CONFIG_SWITCH_FAILED";
  text: string;
  type: "error";
};

/** `user_created` frame: the server confirms the user row was persisted.
 * Replaces the optimistic user card the hook appended on `send` (same
 * `msg_id` → same id, deterministic). */
export type TMessageUserCreated = CardBase & {
  text: string;
  type: "user_created";
};

/** `acp_terminal_output` frame: a cumulative hosted-terminal snapshot
 * (AionUi `AcpTerminalOutput` contract). The server streams the FULL
 * buffer every frame (stream-only, never persisted per the 0006 DDL),
 * so the fold full-replaces the card in place: id =
 * `term:{msg_id}:{terminal_id}` (deterministic). `exitStatus` null =
 * running; a non-null exit status settles the card. */
export type TMessageTerminal = CardBase & {
  command: string;
  /** Cumulative output buffer (full snapshot, not a chunk). */
  output: string;
  exitStatus: {
    exit_code: number | null;
    signaled: boolean;
  } | null;
  terminalId: string;
  truncated: boolean;
  type: "acp_terminal_output";
};

/** `acp_context_usage` frame: how full the agent's context window is for
 * this conversation. A singleton per conversation (id =
 * `usage:{conversation_id}`): the engine emits a fresh cumulative snapshot
 * each turn and the server persists one row per emit, so the newest frame
 * (live) or row (reload/replay) full-replaces the card. `used`/`size` are
 * the agent's OWN reported figures; the UI never divides by a guessed window
 * (TASK-103 AC#4). */
export type TMessageContextUsage = CardBase & {
  cost?: { amount: number; currency: string } | null;
  size: number;
  type: "acp_context_usage";
  used: number;
};

/** TASK-104: a retry notice for a turn whose retryable upstream error the
 * hook swallowed and re-drove once. A CLIENT-ONLY card: no wire frame ever
 * produces it and the server never persists it, so it exists only in the
 * live transcript (a reload shows the re-driven turn's two user rows
 * without the notice). A singleton per conversation (id =
 * `retry:{conversation_id}`), like the usage card: one running retry story,
 * not one per attempt. `state` "retrying" = the re-drive is in flight;
 * the retried turn's clean finish flips it to "recovered" (AC#2); a folded
 * terminal error card DROPS a retrying notice (the error card tells the
 * final story). `reason` is the short policy label ("rate limit", ...),
 * never the raw upstream message. */
export type TMessageRetryNotice = CardBase & {
  reason: string;
  state: "recovered" | "retrying";
  type: "retry_notice";
};

/** One card shape per durable frame type. */
export type TMessage =
  | TMessageAsk
  | TMessageDrillItem
  | TMessageAcpPermission
  | TMessageAcpToolCall
  | TMessageContextUsage
  | TMessageError
  | TMessagePaper
  | TMessagePlan
  | TMessageRetryNotice
  | TMessageTerminal
  | TMessageText
  | TMessageThinking
  | TMessageUserCreated;

/** Runtime guard: narrow a card to `acp_tool_call`. */
export function isToolCard(msg: TMessage): msg is TMessageAcpToolCall {
  return msg.type === "acp_tool_call";
}

/** Runtime guard: narrow a card to `acp_permission`. */
export function isPermissionCard(msg: TMessage): msg is TMessageAcpPermission {
  return msg.type === "acp_permission";
}

/** Runtime guard: narrow a card to `ask`. */
export function isAskCard(msg: TMessage): msg is TMessageAsk {
  return msg.type === "ask";
}

/** Runtime guard: narrow a card to `drill_item`. */
export function isDrillItemCard(msg: TMessage): msg is TMessageDrillItem {
  return msg.type === "drill_item";
}

/** Runtime guard: narrow a card to `paper`. */
export function isPaperCard(msg: TMessage): msg is TMessagePaper {
  return msg.type === "paper";
}

/** Runtime guard: narrow a card to `text`. */
export function isTextCard(msg: TMessage): msg is TMessageText {
  return msg.type === "text";
}

/** Runtime guard: narrow a card to `thinking`. */
export function isThinkingCard(msg: TMessage): msg is TMessageThinking {
  return msg.type === "thinking";
}

/** Runtime guard: narrow a card to `user_created`. */
export function isUserCard(msg: TMessage): msg is TMessageUserCreated {
  return msg.type === "user_created";
}

/** Runtime guard: narrow a card to `acp_terminal_output`. */
export function isTerminalCard(msg: TMessage): msg is TMessageTerminal {
  return msg.type === "acp_terminal_output";
}

/** Runtime guard: narrow a card to `plan`. */
export function isPlanCard(msg: TMessage): msg is TMessagePlan {
  return msg.type === "plan";
}

/** Runtime guard: narrow a card to `acp_context_usage`. */
export function isContextUsageCard(msg: TMessage): msg is TMessageContextUsage {
  return msg.type === "acp_context_usage";
}

/** Runtime guard: narrow a card to `retry_notice` (TASK-104). */
export function isRetryNoticeCard(msg: TMessage): msg is TMessageRetryNotice {
  return msg.type === "retry_notice";
}

/** Runtime guard: narrow a card to `error`. */
/** The live-turn anchor for the stale-turn guard. When set, any frame
 * whose `turn_id` does not match is ignored (returns a new array,
 * unchanged content — the caller's state stays authoritative). */
export interface FrameCtx {
  turnId?: string;
}
