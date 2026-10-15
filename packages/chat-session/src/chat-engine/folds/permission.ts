/**
 * Permission folds (TASK-81.2 extraction): park/refresh + settle.
 */

import type { ChatFrame } from "@manobu/api-contract";

import {
  isPermissionCard,
  type TMessage,
  type TMessageAcpPermission,
} from "../types";

export function foldAcpPermission(
  prev: TMessage[],
  frame: ChatFrame & { type: "acp_permission" }
): TMessage[] {
  const { options, request_id, tool_call } = frame.data;
  const id = `perm:${request_id}`;
  const existing = prev.find((m) => m.id === id);
  if (existing && isPermissionCard(existing)) {
    // The card already exists; refresh the options/toolCall payload
    // (a re-issued permission request during the same turn) and carry the
    // replayed lifecycle status (TASK-109: a crashed park settles its row
    // to `error`, and the part renders that expired — parity with the ask
    // fold).
    const refreshed: TMessageAcpPermission = {
      ...existing,
      options,
      status: frame.status ?? existing.status,
      toolCall: tool_call,
    };
    const idx = prev.findIndex((m) => m.id === id);
    const next = prev.slice();
    next[idx] = refreshed;
    return next;
  }
  const card: TMessageAcpPermission = {
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    hidden: frame.hidden,
    id,
    msg_id: frame.msg_id,
    options,
    position: frame.position,
    requestId: request_id,
    status: frame.status,
    toolCall: tool_call,
    turn_id: frame.turn_id,
    type: "acp_permission",
  };
  return [...prev, card];
}

export function foldAcpPermissionResolved(
  prev: TMessage[],
  frame: ChatFrame & { type: "acp_permission_resolved" }
): TMessage[] {
  const { request_id, option_id } = frame.data;
  const id = `perm:${request_id}`;
  const idx = prev.findIndex((m) => m.id === id);
  if (idx < 0) {
    return prev; // The card was already dropped (e.g. reset) — no-op.
  }
  const card = prev[idx] as TMessage;
  const next = prev.slice();
  next[idx] = isPermissionCard(card)
    ? { ...card, settled: { optionId: option_id ?? null } }
    : card;
  return next;
}
