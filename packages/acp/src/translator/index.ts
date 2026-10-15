/**
 * Table-driven session-update dispatch (TASK-81.1, replaces the 11-arm
 * `updateEvent` switch). One translator function per event family lives
 * in the sibling modules; this table is the single dispatch point.
 *
 * Doctrine (unchanged from the pre-refactor switch): match the
 * `sessionUpdate` **string**, never a closed enum — an agent shipping an
 * unknown variant degrades to an opaque `adapter_specific` frame instead
 * of a panic or a silently dropped event (A1).
 */

import type { SessionUpdate } from "@agentclientprotocol/sdk";

import type { AcpStreamEvent } from "../acp-events";
import type { AcpSessionHandle } from "../session-types";
import { translateContext } from "./context";
import { translateLifecycle } from "./lifecycle";
import { translateTooling } from "./tooling";

type Translator = (handle: AcpSessionHandle, update: never) => AcpStreamEvent;

/** Family dispatch: the first matching predicate owns the variant. */
const FAMILIES: ReadonlyArray<{
  matches: (kind: string) => boolean;
  translate: Translator;
}> = [
  {
    matches: (kind) =>
      kind === "agent_message_chunk" ||
      kind === "agent_thought_chunk" ||
      kind === "plan" ||
      kind === "user_message_chunk",
    translate: translateLifecycle as Translator,
  },
  {
    matches: (kind) => kind === "tool_call" || kind === "tool_call_update",
    translate: translateTooling as Translator,
  },
  {
    matches: (kind) =>
      kind === "available_commands_update" ||
      kind === "current_mode_update" ||
      kind === "config_option_update" ||
      kind === "session_info_update" ||
      kind === "usage_update",
    translate: translateContext as Translator,
  },
];

export function dispatchSessionUpdate(
  handle: AcpSessionHandle,
  update: SessionUpdate
): AcpStreamEvent {
  const kind = String((update as { sessionUpdate?: string }).sessionUpdate);
  const family = FAMILIES.find((f) => f.matches(kind));
  if (!family) {
    // A1 doctrine: variants beyond the SDK union ride through opaque.
    return {
      payload: update,
      tag: `acp_update:${kind}`,
      type: "adapter_specific",
    };
  }
  return family.translate(handle, update as never);
}
