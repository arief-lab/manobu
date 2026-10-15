/**
 * The retry-notice card folds (TASK-104). Client-only transcript
 * mutations the hook orchestrates around an automatic retry: `begin`
 * injects the singleton notice when a retryable terminal error is
 * swallowed, `settle` marks it recovered when the re-driven turn closes
 * clean, and `dropRetrying` removes a still-"retrying" notice when a
 * terminal error card finally folds (the error card tells the ending;
 * AC#2/#3). All three are pure and id-preserving where possible: they
 * return `prev` by identity when there is nothing to change, so the
 * replay path (which never carries a notice) costs nothing.
 */

import type { ChatFrame } from "@manobu/api-contract";

import {
  isRetryNoticeCard,
  type TMessage,
  type TMessageRetryNotice,
} from "../types";

import { upsertCard } from "./upsert";

/** Inject (or replace) the conversation's retry notice in "retrying"
 * state. Called by the hook when it swallows a retryable terminal error
 * and re-drives; the frame supplies the envelope fields. Singleton id
 * `retry:{conversation_id}` (types.ts). */
export function beginRetryNotice(
  prev: TMessage[],
  frame: ChatFrame,
  reason: string
): TMessage[] {
  const card: TMessageRetryNotice = {
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    id: `retry:${frame.conversation_id}`,
    msg_id: frame.msg_id,
    position: "center",
    reason,
    state: "retrying",
    turn_id: frame.turn_id,
    type: "retry_notice",
  };
  return upsertCard(prev, card);
}

/** The re-driven turn closed clean: settle the conversation's "retrying"
 * notice to "recovered" in place (AC#2: the recovered turn stays legible
 * after the fact). A no-op (identity) with no retrying notice. */
export function settleRetryNotice(prev: TMessage[]): TMessage[] {
  for (const [index, card] of prev.entries()) {
    if (isRetryNoticeCard(card) && card.state === "retrying") {
      const next = prev.slice();
      next[index] = { ...card, state: "recovered" };
      return next;
    }
  }
  return prev;
}

/** A terminal error card is folding: drop any still-"retrying" notice (the
 * retry budget is spent; the error card is now the story). Settled
 * "recovered" notices are history and stay. A no-op (identity) when there
 * is nothing to drop. */
export function dropRetryingNotice(prev: TMessage[]): TMessage[] {
  const hasRetrying = prev.some(
    (card) => card.type === "retry_notice" && card.state === "retrying"
  );
  if (!hasRetrying) {
    return prev;
  }
  return prev.filter(
    (card) => !(card.type === "retry_notice" && card.state === "retrying")
  );
}
