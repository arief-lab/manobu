/**
 * Append-or-replace folds (TASK-81.2 extraction): error, user_created,
 * acp_terminal_output — each builds one deterministic-id card and
 * replaces in place when the id already exists.
 */

import type { ChatFrame } from "@manobu/api-contract";

import type {
  TMessage,
  TMessageContextUsage,
  TMessageError,
  TMessageTerminal,
  TMessageUserCreated,
} from "../types";

import { dropRetryingNotice } from "./retry-notice";
import { upsertCard } from "./upsert";

export function foldError(
  prev: TMessage[],
  frame: ChatFrame & { type: "error" }
): TMessage[] {
  const { text } = frame.data;
  const card: TMessageError = {
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    hidden: frame.hidden,
    id: `err:${frame.msg_id}`,
    msg_id: frame.msg_id,
    position: frame.position,
    status: frame.status,
    text,
    turn_id: frame.turn_id,
    type: "error",
  };
  // A terminal error card is landing (TASK-104 AC#3): any still-"retrying"
  // notice the hook injected for an earlier attempt is superseded by the
  // real error, so drop it before the upsert.
  return upsertCard(dropRetryingNotice(prev), card);
}

/** TASK-102 AC#4/#6: a `finish` frame that closed the turn with
 * `stopReason: "error"` and carried a message becomes the same terminal
 * error card the dedicated `error` frame produces (id `err:{msg_id}`), so a
 * failed turn is legible instead of a blank error state. A clean finish (or
 * an error finish with no message) is transient and folds to no card. */
export function foldFinishError(
  prev: TMessage[],
  frame: ChatFrame & { type: "finish" }
): TMessage[] {
  const { error, stopReason } = frame.data as {
    error?: { code?: TMessageError["code"]; message?: string };
    stopReason?: string;
  };
  if (stopReason !== "error" || !error?.message) {
    return prev;
  }
  const card: TMessageError = {
    code: error.code,
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    hidden: frame.hidden,
    id: `err:${frame.msg_id}`,
    msg_id: frame.msg_id,
    position: frame.position,
    status: frame.status,
    text: error.message,
    turn_id: frame.turn_id,
    type: "error",
  };
  return upsertCard(dropRetryingNotice(prev), card);
}

/** TASK-103: fold an `acp_context_usage` frame into the conversation's
 * single context-usage card. The engine emits a fresh cumulative snapshot
 * each turn and the server persists one row per emit, so the latest frame
 * (live) or row (reload/replay) full-replaces it: id =
 * `usage:{conversation_id}`, deliberately NOT keyed by `msg_id` so a
 * conversation carries one running reading, not a card per turn. */
export function foldContextUsage(
  prev: TMessage[],
  frame: ChatFrame & { type: "acp_context_usage" }
): TMessage[] {
  const { cost, size, used } = frame.data;
  const card: TMessageContextUsage = {
    conversation_id: frame.conversation_id,
    cost,
    created_at: frame.created_at,
    hidden: frame.hidden,
    id: `usage:${frame.conversation_id}`,
    msg_id: frame.msg_id,
    position: frame.position,
    size,
    status: frame.status,
    turn_id: frame.turn_id,
    type: "acp_context_usage",
    used,
  };
  return upsertCard(prev, card);
}

export function foldUserCreated(
  prev: TMessage[],
  frame: ChatFrame & { type: "user_created" }
): TMessage[] {
  const { text } = frame.data;
  // The server confirms the user row persisted. Replace the optimistic
  // user card (id = `user:{msg_id}`) if the hook appended one, else
  // insert a new card.
  const id = `user:${frame.msg_id}`;
  const card: TMessageUserCreated = {
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    hidden: frame.hidden,
    id,
    msg_id: frame.msg_id,
    position: frame.position ?? "right",
    status: frame.status,
    text,
    turn_id: frame.turn_id,
    type: "user_created",
  };
  return upsertCard(prev, card);
}

/** Fold an `acp_terminal_output` frame: cumulative full-replace of the
 * `term:{msg_id}:{terminal_id}` card (AionUi cumulative-buffer parity —
 * the snapshot already carries the whole buffer, no chunk appending). */
export function foldTerminal(
  prev: TMessage[],
  frame: ChatFrame & { type: "acp_terminal_output" }
): TMessage[] {
  const { command, exit_status, output, terminal_id, truncated } = frame.data;
  const card: TMessageTerminal = {
    command,
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    exitStatus:
      exit_status === null || exit_status === undefined
        ? null
        : {
            exit_code: exit_status.exit_code ?? null,
            signaled: exit_status.signaled ?? false,
          },
    hidden: frame.hidden,
    id: `term:${frame.msg_id}:${terminal_id}`,
    msg_id: frame.msg_id,
    output,
    position: frame.position,
    status: frame.status,
    terminalId: terminal_id,
    truncated,
    turn_id: frame.turn_id,
    type: "acp_terminal_output",
  };
  return upsertCard(prev, card);
}

// Exhaustive frame-union dispatcher; each branch is one wire frame type.
