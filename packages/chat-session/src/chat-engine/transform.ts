/**
 * The pure frame fold dispatcher (TASK-80.3, table-driven TASK-81.2).
 * Given the previous card list, one `ChatFrame`, and the active-turn
 * context, return the next card list. No side effects, no React, no I/O.
 *
 * Id conventions (deterministic — a replayed transcript and a live stream
 * fold identically, unlike AionUi's uuid-per-frame):
 * - `text` / `thinking`: `id = frame.msg_id`
 * - `plan`: `id = plan:{frame.msg_id}`
 * - `acp_tool_call`: `id = tool:{frame.data.toolCallId}`
 * - `acp_permission`: `id = perm:{frame.data.request_id}`
 * - `ask`: `id = ask:{frame.data.request_id}`
 * - `error`: `id = err:{frame.msg_id}`
 * - `user_created`: `id = user:{frame.msg_id}`
 * - `acp_terminal_output`: `id = term:{msg_id}:{terminal_id}`
 * - `acp_context_usage`: `id = usage:{conversation_id}` (singleton per
 *   conversation, not per turn — TASK-103)
 * - `retry_notice` (no wire frame; injected by the hook on auto-retry):
 *   `id = retry:{conversation_id}` (singleton, TASK-104)
 *
 * Transient frames (`start`, `finish`, `acp_config_option`, `acp_mode_info`,
 * `acp_session_info`, `available_commands`, `agent_status`) produce no card;
 * they feed `deriveStatus` / the hook's turn tracking. `acp_context_usage`
 * moved OUT of this set (TASK-103): it folds to a durable card so the
 * context reading survives a reload / agent restart via `cardsFromRows`.
 */

import type { ChatFrame } from "@manobu/api-contract";

import { foldAsk } from "./folds/ask";
import { foldDrillItem } from "./folds/drill";
import { foldPaper } from "./folds/paper";
import {
  foldAcpPermission,
  foldAcpPermissionResolved,
} from "./folds/permission";
import { foldPlan } from "./folds/plan";
import { settleRetryNotice } from "./folds/retry-notice";
import {
  foldContextUsage,
  foldError,
  foldFinishError,
  foldTerminal,
  foldUserCreated,
} from "./folds/simple";
import { foldText } from "./folds/text";
import { foldAcpToolCall } from "./folds/tool-call";
import type { FrameCtx, TMessage } from "./types";

/** One dispatch-table entry: the fold for a single wire frame type. The
 * switch is deliberately replaced by a `Record` over the closed union so
 * `transformFrame` itself has nothing left to branch on. */
type FrameFold<F extends ChatFrame["type"]> = (
  prev: TMessage[],
  frame: Extract<ChatFrame, { type: F }>
) => TMessage[];

/** Folds that produce or mutate a card, keyed by frame type. */
const CARD_FOLDS: {
  content: FrameFold<"content">;
  thinking: FrameFold<"thinking">;
  plan: FrameFold<"plan">;
  acp_tool_call: FrameFold<"acp_tool_call">;
  acp_permission: FrameFold<"acp_permission">;
  acp_permission_resolved: FrameFold<"acp_permission_resolved">;
  ask: FrameFold<"ask">;
  drill_item: FrameFold<"drill_item">;
  paper: FrameFold<"paper">;
  error: FrameFold<"error">;
  user_created: FrameFold<"user_created">;
  acp_terminal_output: FrameFold<"acp_terminal_output">;
  acp_context_usage: FrameFold<"acp_context_usage">;
} = {
  acp_context_usage: foldContextUsage,
  acp_permission: foldAcpPermission,
  acp_permission_resolved: foldAcpPermissionResolved,
  acp_terminal_output: foldTerminal,
  acp_tool_call: foldAcpToolCall,
  ask: foldAsk,
  content: (prev, frame) => foldText(prev, frame, "text"),
  drill_item: foldDrillItem,
  error: foldError,
  paper: foldPaper,
  plan: foldPlan,
  thinking: (prev, frame) => foldText(prev, frame, "thinking"),
  user_created: foldUserCreated,
};

/** Frame types that produce no card: the reducer ignores them (they feed
 * `deriveStatus` / the hook's turn tracking instead). `start` marks the
 * turn open; `finish` marks it terminal; the rest is side-state. */
const TRANSIENT_FRAME_TYPES: ReadonlySet<ChatFrame["type"]> = new Set([
  "start",
  "finish",
  "available_commands",
  "acp_config_option",
  "acp_mode_info",
  "acp_session_info",
  "agent_status",
]);

export function transformFrame(
  prev: TMessage[],
  frame: ChatFrame,
  ctx: FrameCtx
): TMessage[] {
  // Stale-turn guard: frames from a different turn than the one we're
  // actively subscribed to are ignored (the server echoes them during a
  // resubscribe replay, or a second concurrent subscriber's turn lands
  // here — AionUi bus semantics: one hub, many subscribers).
  if (ctx.turnId && frame.turn_id && frame.turn_id !== ctx.turnId) {
    return [...prev];
  }

  const fold = CARD_FOLDS[frame.type as keyof typeof CARD_FOLDS];
  if (fold) {
    return fold(prev, frame as never);
  }
  // `finish` is dual: a clean finish is transient (feeds `deriveStatus`),
  // but one that closed with an error message produces a terminal error
  // card (TASK-102 AC#4/#6). Checked here rather than in `CARD_FOLDS`
  // because most finishes produce no card.
  if (frame.type === "finish") {
    const afterError = foldFinishError(prev, frame);
    if (afterError !== prev) {
      return afterError;
    }
    if ((frame.data as { stopReason?: string }).stopReason === "error") {
      // An error finish that carried no message folds nothing (TASK-102
      // semantics); it must not read as a recovery either.
      return prev;
    }
    // Clean finish (TASK-104 AC#2): settle the conversation's "retrying"
    // notice to "recovered" — the re-driven turn closed clean, so the
    // learner can see the turn auto-recovered.
    return settleRetryNotice(prev);
  }
  if (TRANSIENT_FRAME_TYPES.has(frame.type)) {
    return prev;
  }
  // Runtime safety net for a frame type added to the wire without a
  // matching fold (AionUi's "default: warn" discipline).
  throw new Error(`Unreachable frame type: ${String(frame.type)}`);
}
