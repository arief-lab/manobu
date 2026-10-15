/**
 * UI-facing status derivation (TASK-80.3, rule-list since TASK-81.2).
 *
 * Drives `isSending` in the hook (`status !== "idle"`). Each rule is one
 * contract clause, evaluated in precedence order; the first match wins.
 */

import type { ChatFrame } from "@manobu/api-contract";

import type { TMessage } from "./types";

export type FrameStatus = "error" | "idle" | "streaming" | "submitted";

interface StatusRule {
  applies: (messages: TMessage[], lastFrame: ChatFrame | null) => boolean;
  /** Human-readable contract clause (kept next to the predicate). */
  doc: string;
  status:
    | FrameStatus
    | ((messages: TMessage[], lastFrame: ChatFrame | null) => FrameStatus);
}

const STREAMING_FRAME_TYPES = new Set([
  "content",
  "thinking",
  "acp_tool_call",
  "plan",
  "acp_terminal_output",
]);

const RULES: readonly StatusRule[] = [
  {
    applies: (messages) => messages.some((m) => m.type === "error"),
    doc: "A terminal error card wins over any last frame: a failed turn leaves an err:{msg_id} card in the list even when the closing finish frame's stopReason is clean (server-side error path).",
    status: "error",
  },
  {
    applies: (_messages, lastFrame) => lastFrame === null,
    doc: "No frames folded yet: nothing is in flight.",
    status: "idle",
  },
  {
    applies: (_messages, lastFrame) => lastFrame?.type === "error",
    doc: "A terminal error frame is an immediate error.",
    status: "error",
  },
  {
    applies: (_messages, lastFrame) => lastFrame?.type === "finish",
    doc: "A clean finish closes the turn (a NEW send re-enters submitted/streaming); stopReason:error stays an error.",
    status: (_messages, lastFrame) => {
      const { stopReason } = (lastFrame as ChatFrame & { type: "finish" })
        .data as { stopReason?: string };
      return stopReason === "error" ? "error" : "idle";
    },
  },
  {
    applies: (_messages, lastFrame) => lastFrame?.type === "user_created",
    doc: "A user card with no assistant content yet = the send was accepted (submitted) but the agent has not started producing frames; assistant content flowing = streaming.",
    status: (messages) =>
      messages.some((m) => m.type === "text" || m.type === "thinking")
        ? "streaming"
        : "submitted",
  },
  {
    applies: (_messages, lastFrame) => {
      if (lastFrame?.type !== "drill_item") {
        return false;
      }
      return (
        lastFrame.data.phase === "pending" &&
        lastFrame.status !== "finish" &&
        lastFrame.status !== "error"
      );
    },
    doc: "A pending drill item keeps the turn in flight while the learner chooses an answer.",
    status: "streaming",
  },
  {
    applies: (_messages, lastFrame) =>
      lastFrame?.type === "ask" &&
      (lastFrame as ChatFrame & { type: "ask" }).status !== "finish" &&
      (lastFrame as ChatFrame & { type: "ask" }).status !== "error",
    doc: "A parked ask keeps the turn in flight: the agent is blocked on the answer and Stop is the only way to abandon it, so the status must stay non-idle (TASK-86 AC#3). Live ask frames carry no status; replayed parked rows carry `pending`. A settled replay row (finish/error) falls through to the neutral default.",
    status: "streaming",
  },
  {
    applies: (_messages, lastFrame) =>
      lastFrame !== null && STREAMING_FRAME_TYPES.has(lastFrame.type),
    doc: "Live content/thinking/tool/plan/terminal frames: streaming.",
    status: "streaming",
  },
];

export function deriveStatus(
  messages: TMessage[],
  lastFrame: ChatFrame | null
): FrameStatus {
  for (const rule of RULES) {
    if (rule.applies(messages, lastFrame)) {
      return typeof rule.status === "function"
        ? rule.status(messages, lastFrame)
        : rule.status;
    }
  }
  // `start` / `agent_status` / side-state frames do not advance status
  // out of the caller's current value; the reducer returns "idle" as the
  // neutral default (the hook overrides with "submitted" the moment
  // `send` is called).
  return "idle";
}
