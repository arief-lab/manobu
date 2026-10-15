/**
 * Ask fold (TASK-81.2 extraction): park/refresh the agent's ask_user card.
 *
 * TASK-86: a replayed settled row carries `status` (finish/error) plus the
 * persisted `answers`/`declined` summary in its content; the refresh branch
 * merges them onto the parked card so the part can render the compact
 * answered/failed state instead of re-arming the form.
 */

import type { ChatFrame } from "@manobu/api-contract";

import { isAskCard, type TMessage, type TMessageAsk } from "../types";

/** The persisted resolution summary, if this frame carries one. */
function settledFrom(
  frame: ChatFrame & { type: "ask" }
): TMessageAsk["settled"] {
  const { answers, declined } = frame.data;
  if (answers === undefined && declined === undefined) {
    return undefined;
  }
  return {
    answers,
    decline: declined,
  };
}

export function foldAsk(
  prev: TMessage[],
  frame: ChatFrame & { type: "ask" }
): TMessage[] {
  const { questions, request_id } = frame.data;
  const id = `ask:${request_id}`;
  const settled = settledFrom(frame);
  const existing = prev.find((m) => m.id === id);
  if (existing && isAskCard(existing)) {
    const refreshed: TMessageAsk = {
      ...existing,
      questions,
      settled: settled ?? existing.settled,
      status: frame.status ?? existing.status,
    };
    const idx = prev.findIndex((m) => m.id === id);
    const next = prev.slice();
    next[idx] = refreshed;
    return next;
  }
  // card envelope literals differ per card type; a shared builder would hide each card's contract fields.
  const card: TMessageAsk = {
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    hidden: frame.hidden,
    id,
    msg_id: frame.msg_id,
    position: frame.position,
    questions,
    requestId: request_id,
    settled,
    status: frame.status,
    turn_id: frame.turn_id,
    type: "ask",
  };
  return [...prev, card];
}
