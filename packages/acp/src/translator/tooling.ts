/**
 * Tooling-family translators (TASK-81.1): tool_call + tool_call_update.
 * Both route the raw payload through `normalizeToolCallUpdate` (dual-case
 * fold + base64 strip) and stamp `sessionUpdate` for the sink merge.
 */

import type { SessionUpdate } from "@agentclientprotocol/sdk";

import type { AcpStreamEvent } from "../acp-events";
import { normalizeToolCallUpdate } from "../session-normalize";
import type { AcpSessionHandle } from "../session-types";

type ToolCallUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "tool_call" } | { sessionUpdate: "tool_call_update" }
>;

/** Read the defensively-dual-case raw output off the wire payload. */
function rawOutputOf(update: ToolCallUpdate): unknown {
  const wire = update as unknown as Record<string, unknown>;
  return wire.rawOutput ?? wire.raw_output;
}

/** A new call defaults to pending/untitled; an update carries no
 * defaults (a missing status/title is meaningful there). */
function defaultsFor(update: ToolCallUpdate): {
  status: string | null;
  title: string | null;
} {
  if (update.sessionUpdate === "tool_call") {
    return { status: update.status ?? "pending", title: update.title ?? "" };
  }
  return { status: update.status ?? null, title: update.title ?? null };
}

export function translateTooling(
  _handle: AcpSessionHandle,
  update: ToolCallUpdate
): AcpStreamEvent {
  const defaults = defaultsFor(update);
  return {
    type: "acp_tool_call",
    update: {
      ...normalizeToolCallUpdate({
        content: update.content ?? null,
        kind: update.kind ?? null,
        locations: update.locations ?? null,
        rawInput: update.rawInput,
        rawOutput: rawOutputOf(update),
        status: defaults.status,
        title: defaults.title,
        toolCallId: update.toolCallId,
      }),
      sessionUpdate: update.sessionUpdate,
    },
  };
}
