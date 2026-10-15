/**
 * Plan fold (TASK-81.2 extraction): full-replace snapshot card.
 */

import type { ChatFrame } from "@manobu/api-contract";

import type { TMessage, TMessagePlan } from "../types";

import { upsertCard } from "./upsert";

export function foldPlan(
  prev: TMessage[],
  frame: ChatFrame & { type: "plan" }
): TMessage[] {
  const { entries } = frame.data;
  // card envelope literals differ per card type; a shared builder would hide each card's contract fields.
  const card: TMessagePlan = {
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    entries,
    hidden: frame.hidden,
    id: `plan:${frame.msg_id}`,
    msg_id: frame.msg_id,
    position: frame.position,
    status: frame.status,
    turn_id: frame.turn_id,
    type: "plan",
  };
  // FULL-REPLACE snapshot (AionUi parity)
  return upsertCard(prev, card);
}

// Sanitizes the dual-case ACP tool payload union in one place by design (sanitizeAcpToolUpdate chokepoint).
