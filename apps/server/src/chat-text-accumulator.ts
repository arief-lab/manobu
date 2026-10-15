/**
 * Streaming text accumulation for the persistence bridge (delta bug fix,
 * 2026-09-21): ACP `agent_message_chunk` / `agent_thought_chunk` arrive as
 * DELTAS, but the persistence bridge's contract with the client fold is
 * snapshot-based — `replace: true` means "this frame's text is the FULL
 * accumulated text so far" (`folds/text.ts` doctrine). Publishing or
 * persisting the raw delta therefore truncated assistant replies to their
 * LAST chunk, both on the live wire and in the stored row.
 *
 * The accumulator lives per-conversation-hub: keyed by the same ui_id
 * scheme as `frameUiId` (`text:{msgId}` / `thinking:{msgId}`), it appends
 * each delta and hands back the full snapshot. Cleared on turn settle
 * (`resetConversationAccumulators`) so long conversations don't grow
 * unbounded across turns.
 */

import type { AcpStreamEvent } from "@manobu/acp/acp-events";

/** Streaming text events whose `content` is a text-bearing block. */
type StreamingTextEvent = Extract<
  AcpStreamEvent,
  { type: "text" | "thinking" }
>;

function isStreamingText(event: AcpStreamEvent): event is StreamingTextEvent {
  return event.type === "text" || event.type === "thinking";
}

/** Read the text off an event's content block (structural, the block is
 * `{ type: "text", text?: string, content?: string }` per ACP). */
function chunkText(event: StreamingTextEvent): string {
  const block = event.content as { content?: unknown; text?: unknown } | null;
  if (typeof block?.text === "string") {
    return block.text;
  }
  if (typeof block?.content === "string") {
    return block.content;
  }
  return "";
} /** Map a streaming event to its accumulator key (`frameUiId` scheme).
 * Only `text` carries a message id; thinking chunks in one turn share the
 * turn msg_id anyway, so a bare `thinking:` key (all thinking of the turn
 * in one card) matches how frameUiId keys the stored row. */
function accumulatorKey(event: StreamingTextEvent): string {
  return event.type === "text" ? `text:${event.message_id ?? ""}` : "thinking";
}

/** ui_id → accumulated full text for the active turn(s). */
export type TextAccumulators = Map<string, string>;

/** Append one delta; return the FULL accumulated text for the ui_id. */
export function accumulate(
  accumulators: TextAccumulators,
  event: StreamingTextEvent
): string {
  const key = accumulatorKey(event);
  const full = accumulators.get(key) ?? "";
  const next = full + chunkText(event);
  accumulators.set(key, next);
  return next;
}

/** Drop the turn's accumulators (call on turn settle). */
export function resetAccumulators(accumulators: TextAccumulators): void {
  accumulators.clear();
}
/** Rewrite a streaming event's content block to carry the accumulated
 * snapshot. The block keeps its `type` discriminant; only the text field
 * is swapped, so `frameContent` and the wire schema see a normal block. */
export function withAccumulatedText(
  event: StreamingTextEvent,
  fullText: string
): StreamingTextEvent {
  const block = event.content as Record<string, unknown> | null;
  if (block && typeof block.text === "string") {
    return { ...event, content: { ...block, text: fullText } };
  }
  if (block && typeof block.content === "string") {
    return { ...event, content: { ...block, content: fullText } };
  }
  return event;
}

/** True when the event's text stream must be accumulated before
 * publish/persist. */
export const isDeltaTextEvent = isStreamingText;
