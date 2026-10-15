/**
 * Text/thinking fold (TASK-81.2 extraction): AionUi
 * `mergeTextMessageContent` semantics, decomposed into a table of
 * per-card-type merge behaviors so the fold itself has nothing complex
 * left to measure.
 */

import type { ChatFrame } from "@manobu/api-contract";

import { isTextCard, isThinkingCard, type TMessage } from "../types";

/** Read the text payload off a `content`/`thinking` frame. The wire
 * payload is `{ type: string }` (a content block); `text` blocks carry
 * the text in `data.text` or `data.content` — the `z.looseObject` schema
 * is open, so the actual text field is read structurally. */
function frameDataText(frame: ChatFrame): string {
  const data = frame.data as unknown as Record<string, unknown>;
  if (typeof data.text === "string") {
    return data.text;
  }
  if (typeof data.content === "string") {
    return data.content;
  }
  return "";
}

/** Build a brand-new card from the frame envelope. */
function newCard(
  frame: ChatFrame,
  id: string,
  text: string,
  cardType: "text" | "thinking"
): TMessage {
  return {
    content: text,
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    hidden: frame.hidden,
    id,
    msg_id: frame.msg_id,
    position: frame.position ?? "left",
    replace: frame.replace === true ? true : undefined,
    status: frame.status,
    turn_id: frame.turn_id,
    type: cardType,
  };
}

/** Per-card-type merge behavior for an existing card of the same type:
 * compute the merged content (and any envelope updates). Returns null
 * when the existing card's type does not match (defensive fall-through). */
const MERGES: {
  text:
    | ((existing: TMessage, frame: ChatFrame, text: string) => TMessage)
    | null;
  thinking:
    | ((existing: TMessage, frame: ChatFrame, text: string) => TMessage)
    | null;
} = {
  text: (existing, frame, text) => {
    if (!isTextCard(existing)) {
      return existing;
    }
    const content = frame.replace === true ? text : existing.content + text;
    return {
      ...existing,
      content,
      replace: frame.replace === true ? true : existing.replace,
      status: frame.status ?? existing.status,
    };
  },
  thinking: (existing, frame, text) => {
    if (!isThinkingCard(existing)) {
      return existing;
    }
    // Thinking chunks append (no replace flag on thinking frames); a
    // `replace: true` envelope still wins (the server re-stamped a row).
    return {
      ...existing,
      content: frame.replace === true ? text : existing.content + text,
    };
  },
};

/** Fold one streaming `text`/`thinking` frame into the card list.
 *
 * AionUi's `mergeTextMessageContent` semantics: same `msg_id` → append;
 * envelope `replace: true` → the new frame's text REPLACES the card's
 * accumulated content (the server re-stamps a full row during replay,
 * not a chunk). Different `msg_id` → a new card is appended. */
export function foldText(
  prev: TMessage[],
  frame: ChatFrame,
  cardType: "text" | "thinking"
): TMessage[] {
  const text = frameDataText(frame);
  // Card id mirrors the server's ui_id scheme (`text:{msgId}` /
  // `thinking:{msgId}`, chat-persistence frameUiId): EVERY frame in a
  // turn shares one turn msg_id, so the id must be scoped by card type —
  // a bare msg_id collides across text/thinking and every later chunk
  // falls into the different-type fall-through, duplicating the card
  // per chunk (live-UI smoke, 2026-09-21).
  const id = `${cardType}:${frame.msg_id}`;
  const idx = prev.findIndex((m) => m.id === id);
  if (idx < 0) {
    return [...prev, newCard(frame, id, text, cardType)];
  }

  const merge = MERGES[cardType];
  const existing = prev[idx] as TMessage;
  const merged = merge?.(existing, frame, text);
  if (merged && merged !== existing) {
    const next = prev.slice();
    next[idx] = merged;
    return next;
  }

  // The card with this id exists but is a different card type (impossible
  // in practice — ids are scoped by card type prefix; this is the
  // defensive fall-through, matching AionUi's "last card of a different
  // type → append new" rule).
  const next = prev.slice();
  next.push(newCard(frame, id, text, cardType));
  return next;
}
