/**
 * Lifecycle-family translators (TASK-81.1): message chunks, plan, and the
 * suppressed user echo. Each translator maps one `sessionUpdate` variant
 * to its AionUi frame; the dispatch table lives in `index.ts`.
 */

import type { SessionUpdate } from "@agentclientprotocol/sdk";

import type { AcpStreamEvent } from "../acp-events";
import { planEntry } from "../session-normalize";
import type { AcpSessionHandle } from "../session-types";

type Update = Extract<
  SessionUpdate,
  | { sessionUpdate: "agent_message_chunk" }
  | { sessionUpdate: "agent_thought_chunk" }
  | { sessionUpdate: "plan" }
  | { sessionUpdate: "user_message_chunk" }
>;

export function translateLifecycle(
  _handle: AcpSessionHandle,
  update: Update
): AcpStreamEvent {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return {
        content: { ...update.content },
        message_id: update.messageId ?? null,
        type: "text",
      };
    case "agent_thought_chunk":
      return {
        content: { ...update.content },
        type: "thinking",
      };
    case "plan":
      return {
        entries: update.entries.map(planEntry),
        type: "plan",
      };
    case "user_message_chunk":
      // History replay on session/load is suppressed at the emit gate; a
      // live user chunk means the agent echoes our own prompt — noise.
      return {
        payload: null,
        tag: "acp_update:user_message_chunk",
        type: "adapter_specific",
      };
    default: {
      // The family dispatch (index.ts) owns the A1 opaque fallback, so an
      // unknown variant can never reach a family translator; this default
      // only satisfies the exhaustive-switch lint over the closed union.
      return update satisfies never as never;
    }
  }
}
