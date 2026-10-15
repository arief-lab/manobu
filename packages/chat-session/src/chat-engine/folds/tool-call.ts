/**
 * ACP tool-call fold (TASK-81.2 extraction): AionUi
 * `mergeAcpToolCallContent` semantics — field-wise spread, sanitize the
 * combined raw output (`sanitizeAcpToolUpdate` chokepoint). Decomposed
 * into `normalizeToolCard` (envelope → card) and `mergeToolCard`
 * (field-wise union) so the fold orchestration stays trivial.
 */

import {
  isHostToolCallTitle,
  sanitizeAcpToolUpdate,
} from "@manobu/acp/acp-events";
import type { ChatFrame } from "@manobu/api-contract";

import type { TMessage, TMessageAcpToolCall } from "../types";

import { upsertCard } from "./upsert";

/** Sanitized payload type: `sanitizeAcpToolUpdate` passes unknown fields
 * through and the dual-case (camel/snake) raw payloads survive it. */
type SanitizedTool = Record<string, unknown> & {
  content?: unknown;
  kind?: unknown;
  locations?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  raw_input?: unknown;
  raw_output?: unknown;
  status?: unknown;
  title?: unknown;
};

function asNull<T>(value: unknown): T | null {
  return (value as T | null | undefined) ?? null;
}

/** Envelope → incoming card (always builds a full card; the merge step
 * decides whether to keep it as-is or union it with an existing one). */
function normalizeToolCard(
  frame: ChatFrame & { type: "acp_tool_call" },
  id: string,
  toolCallId: string,
  sanitized: SanitizedTool
): TMessageAcpToolCall {
  return {
    content: asNull<Array<{ type: string }>>(sanitized.content),
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    hidden: frame.hidden,
    id,
    kind: asNull<string>(sanitized.kind),
    locations: asNull<Array<{ line?: number | null; path: string }>>(
      sanitized.locations
    ),
    msg_id: frame.msg_id,
    raw_input: sanitized.rawInput ?? sanitized.raw_input,
    raw_output: sanitized.rawOutput ?? sanitized.raw_output,
    status: asNull<string>(sanitized.status),
    title: asNull<string>(sanitized.title),
    toolCallId,
    turn_id: frame.turn_id,
    type: "acp_tool_call",
  };
}

/** Field-wise union of an existing card and the incoming one (AionUi's
 * `mergeAcpToolCallContent`): non-null incoming wins, else the existing
 * value survives; the combined raw output is re-sanitized. */
function mergeToolCard(
  existing: TMessageAcpToolCall,
  incoming: TMessageAcpToolCall,
  sanitized: SanitizedTool
): TMessageAcpToolCall {
  const mergedRaw = sanitizeAcpToolUpdate({
    rawInput: existing.raw_input,
    rawOutput: existing.raw_output,
    ...sanitized,
  }) as SanitizedTool;
  return {
    ...existing,
    ...incoming,
    content: incoming.content ?? existing.content,
    kind: incoming.kind ?? existing.kind,
    locations: incoming.locations ?? existing.locations,
    raw_input: mergedRaw.rawInput ?? mergedRaw.raw_input,
    raw_output: mergedRaw.rawOutput ?? mergedRaw.raw_output,
    turn_id: incoming.turn_id ?? existing.turn_id,
  };
}

export function foldAcpToolCall(
  prev: TMessage[],
  frame: ChatFrame & { type: "acp_tool_call" }
): TMessage[] {
  const { sessionUpdate, toolCallId, title } = frame.data as {
    sessionUpdate?: string;
    toolCallId: string;
    title?: string | null;
  };
  const id = `tool:${toolCallId}`;
  const existing = prev.find((m): m is TMessageAcpToolCall => m.id === id);
  if (isHostToolCallTitle(title)) {
    return prev.filter((message) => message.id !== id);
  }
  // TASK-149: an update with no title and nothing to update has no card in
  // it. A host tool's titled frame is dropped before it reaches this fold, so
  // the title-less update is the FIRST frame the reducer ever sees for that
  // toolCallId, and building a card from it resurrects the raw JSON the titled
  // frame was suppressed to hide. The same shape arrives from storage: the side
  // writes no titled host row, so a reopened conversation replays exactly this
  // one row. Only `tool_call_update` is refused, because `sessionUpdate` is a
  // required enum on the wire schema and an initial `tool_call` with no title
  // is still the only description that call exists.
  if (sessionUpdate === "tool_call_update" && !title && !existing) {
    return prev;
  }
  const sanitized = sanitizeAcpToolUpdate(
    frame.data as Record<string, unknown>
  ) as SanitizedTool;
  const incoming = normalizeToolCard(frame, id, toolCallId, sanitized);
  if (!existing) {
    return upsertCard(prev, incoming);
  }
  return upsertCard(prev, mergeToolCard(existing, incoming, sanitized));
}
