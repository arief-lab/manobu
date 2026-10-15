/**
 * session/update → AcpStreamEvent translation (TASK-80.1, dispatch
 * table-driven since TASK-81.1).
 *
 * Ports aioncore's `map_update` doctrine: match the `sessionUpdate`
 * **string**, never a closed enum, so an agent shipping an unknown variant
 * degrades to an opaque `adapter_specific` frame instead of a panic or a
 * silently dropped event (A1). Known variants map 1:1 onto the AionUi frame
 * vocabulary (`packages/acp/src/acp-events`).
 *
 * The per-family translators live in `./translator/` (lifecycle / tooling /
 * context); the dispatch table is `translator/index.ts`. Wire behavior is
 * pinned by `test/translator-golden.test.ts`.
 */

import type {
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";

import type { AcpSessionHandle } from "./session-types";
import { dispatchSessionUpdate } from "./translator";

/** Translate one inbound notification and route it through the handle. */
export function translateSessionUpdate(
  handle: AcpSessionHandle,
  notification: SessionNotification
): void {
  const update = notification.update as SessionUpdate;
  handle.emitFrame(dispatchSessionUpdate(handle, update));
}
