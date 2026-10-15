/**
 * Persistence bridge: engine frame → live wire frame → stored row
 * (TASK-80.14 live/durable split).
 *
 * The live plane is the hub's in-memory ring: `sinkFor` publishes the wire
 * frame FIRST (in-memory order is the liveness source of truth — no DB
 * poll on the live path), then fires the DB write as the durability layer:
 * fire-and-forget for non-terminal frames, AWAITED for the terminal frame
 * (so reconnect/reload always finds the terminal row). The seq-cursor
 * replay helpers of the TASK-80.7 design are gone: resume = persisted
 * history (`listMessages`) + the live ring.
 */

import {
  type AcpDrillSnapshot,
  type AcpStreamEvent,
  type AcpTerminalOutputEvent,
  isHostToolCallTitle,
  sanitizeAcpToolUpdate,
} from "@manobu/acp/acp-events";
import {
  type ChatContext,
  closeHub,
  hubFor,
  publishFrame,
  pushTerminalFrame,
  TERMINAL_FRAME_TYPES,
  type WireFrame,
} from "./chat-hub";
import {
  appendMessage,
  listFramesAfter,
  type StoredMessage,
  updateMessageByUiId,
} from "./chat-store";
import {
  accumulate,
  resetAccumulators,
  type TextAccumulators,
  withAccumulatedText,
} from "./chat-text-accumulator";

/** Engine frame type → wire `type` (AionUi IResponseMessage naming). */
const FRAME_TYPE: Record<AcpStreamEvent["type"], string> = {
  acp_config_option: "acp_config_option",
  acp_context_usage: "acp_context_usage",
  acp_mode_info: "acp_mode_info",
  acp_permission: "acp_permission",
  acp_permission_resolved: "acp_permission_resolved",
  acp_session_info: "acp_session_info",
  acp_terminal_output: "acp_terminal_output",
  acp_tool_call: "acp_tool_call",
  adapter_specific: "adapter_specific",
  agent_status: "agent_status",
  ask: "ask",
  available_commands: "available_commands",
  drill_item: "drill_item",
  plan: "plan",
  text: "content",
  thinking: "thinking",
  turn_end: "finish",
  turn_start: "start",
};

type StoredStatus = "error" | "finish" | "pending" | "work";

/** Persisted-row status per frame type. */
function rowStatus(event: AcpStreamEvent): StoredStatus {
  if (event.type === "turn_end") {
    return event.stopReason === "error" ? "error" : "finish";
  }
  if (event.type === "acp_permission" || event.type === "ask") {
    return "pending";
  }
  if (event.type === "drill_item") {
    if (event.phase === "pending") {
      return "pending";
    }
    return event.phase === "unavailable" ? "error" : "finish";
  }
  if (event.type === "acp_permission_resolved") {
    return "finish";
  }
  return "work";
}

/** The persisted `status` column is a plain string; re-narrow it. */
function isStoredStatus(status: string): status is StoredStatus {
  return (
    status === "error" ||
    status === "finish" ||
    status === "pending" ||
    status === "work"
  );
}

/**
 * Does this frame belong to a host tool, so neither the live ring nor the
 * stored history may see it?
 *
 * Only the frame that OPENS a tool call carries its title; the follow-up
 * `tool_call_update`s for the same `toolCallId` arrive title-less, so a
 * check on the title alone lets the raw JSON in through the back frame
 * (TASK-149). The first host-titled frame therefore CLAIMS its
 * `toolCallId`, and every later frame for that call is dropped on the
 * claim alone. The claim lives in the sink's closure, so it is bounded by
 * the hub and released with the turn.
 */
const isSuppressedEvent = (
  event: AcpStreamEvent,
  claimedHostToolCallIds: Set<string>
): boolean => {
  if (event.type !== "acp_tool_call") {
    return false;
  }
  const { title, toolCallId } = event.update;
  if (isHostToolCallTitle(title)) {
    claimedHostToolCallIds.add(toolCallId);
    return true;
  }
  return claimedHostToolCallIds.has(toolCallId);
};

const accumulatedEvent = (
  event: AcpStreamEvent,
  accumulators: TextAccumulators
): AcpStreamEvent => {
  if (event.type !== "text" && event.type !== "thinking") {
    return event;
  }
  return withAccumulatedText(event, accumulate(accumulators, event));
};

const publishTerminalOutput = (
  ctx: ChatContext,
  conversationId: string,
  turnId: string,
  msgId: string,
  event: AcpTerminalOutputEvent
): void => {
  const hub = ctx.hubs.get(conversationId);
  if (!hub || hub.terminal) {
    return;
  }
  pushTerminalFrame(
    hub,
    toTerminalWireFrame(event, conversationId, turnId, msgId),
    event.terminal_id
  );
};

const isTerminalEvent = (event: AcpStreamEvent): boolean =>
  (TERMINAL_FRAME_TYPES as readonly string[]).includes(
    FRAME_TYPE[event.type] ?? event.type
  );

/** The turn's frame sink: publish live, then persist. */
export function sinkFor(
  ctx: ChatContext,
  conversationId: string,
  turnId: string,
  msgId: string,
  options?: { awaitNonTerminal?: boolean }
): (event: AcpStreamEvent) => Promise<void> {
  // Durability-order chain: each turn's persists run sequentially, so the
  // terminal row (awaited) can never overtake an earlier frame's
  // in-flight fire-and-forget write — otherwise the persisted history
  // reads back out of order (the AC#1/AC#5/AC#6 replay-order failures of
  // 2026-09-19). The live ring keeps its own order; this chain preserves
  // the SAME order in the DB.
  let persistChain: Promise<void> = Promise.resolve();

  // Streaming text accumulators (per hub lifetime): ACP chunks are deltas,
  // but the wire/DB contract is snapshot-based (`replace: true` = full
  // accumulated text). See chat-text-accumulator.ts for the doctrine.
  const accumulators: TextAccumulators = new Map();

  // Host tool calls opened by THIS turn's sink (TASK-149): the titled frame is
  // the only one that names the tool, so it claims the `toolCallId` and every
  // later title-less update for that call is suppressed with it. Cleared with
  // the accumulators at the terminal frame, and the closure itself dies when
  // the turn's sink does, so the set cannot outlive the turn it explains.
  const claimedHostToolCallIds: Set<string> = new Set();

  return async (rawEvent: AcpStreamEvent): Promise<void> => {
    if (isSuppressedEvent(rawEvent, claimedHostToolCallIds)) {
      return;
    }
    // DELTA → SNAPSHOT: rewrite streaming text/thinking chunks to carry the
    // FULL accumulated text so the live frame and the stored row both hold
    // the whole reply, not just the last delta (truncation bug, 2026-09-21).
    const event = accumulatedEvent(rawEvent, accumulators);
    // Terminal output is stream-only (too large, never persisted).
    // It rides the hub's in-memory lane: publish + pulse, no DB row.
    if (event.type === "acp_terminal_output") {
      publishTerminalOutput(ctx, conversationId, turnId, msgId, event);
      return;
    }

    const hub = hubFor(ctx, conversationId);
    if (hub.terminal) {
      return;
    }

    // LIVE FIRST: the in-memory ring is the liveness source of truth.
    const liveFrame = toLiveFrame(event, conversationId, turnId, msgId);
    publishFrame(hub, liveFrame);

    // DURABILITY SECOND: the terminal row is awaited (reconnect/reload
    // must find it); every other frame is fire-and-forget — a failed or
    // slow DB write must never stall the live stream. The chain invokes
    // each write LAZILY (persistFrame is called inside the .then), so
    // write N+1 cannot START until write N committed — DB order equals
    // ring order.
    const write = (): Promise<void> =>
      persistFrame(conversationId, turnId, msgId, event)
        .then(() => undefined)
        .catch((error: unknown) => {
          console.error(
            `[chat] persist failed for ${conversationId}/${event.type}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
    persistChain = persistChain.then(write);
    if (isTerminalEvent(event) || options?.awaitNonTerminal === true) {
      await persistChain;
      resetAccumulators(accumulators);
      claimedHostToolCallIds.clear();
      closeHub(hub);
    }
  };
}

/**
 * Persist + publish the learner's prompt as a `user_created` frame
 * (TASK-107 AC#1). This is the one frame the turn's `sink` never sees: the
 * engine prompts FROM the user text and streams only the reply, so the send
 * handler calls this directly before the turn starts.
 *
 * The caller AWAITs it so the user row's seq/id land BELOW every agent frame
 * of the same turn, and `listMessages` (insertion order) returns the
 * transcript interleaved exactly as the learner spoke. Live, the frame rides
 * the ring so a subscribed client folds the bubble with no optimistic append
 * (the `use-chat-engine` send contract).
 */
export async function emitUserTurn(
  ctx: ChatContext,
  conversationId: string,
  turnId: string,
  msgId: string,
  text: string
): Promise<void> {
  const hub = hubFor(ctx, conversationId);
  if (hub.terminal) {
    return;
  }
  const frame: WireFrame = {
    conversation_id: conversationId,
    created_at: Date.now(),
    data: { text },
    hidden: false,
    msg_id: msgId,
    replace: true,
    status: "finish",
    turn_id: turnId,
    type: "user_created",
  };
  publishFrame(hub, frame);
  await appendMessage({
    content: { text },
    conversationId,
    frameType: "user_created",
    msgId,
    status: "finish",
    turnId,
    uiId: `user:${msgId}`,
  });
}

/** Store one frame; text/thinking/plan/tool rows grow in place by ui_id. */
async function persistFrame(
  conversationId: string,
  turnId: string,
  msgId: string,
  event: AcpStreamEvent
): Promise<StoredMessage> {
  const frameType = FRAME_TYPE[event.type] ?? event.type;
  const uiId = frameUiId(msgId, event);
  const content = frameContent(event);
  if (uiId && content !== undefined) {
    const updated = await updateMessageByUiId(conversationId, uiId, {
      content,
      status: rowStatus(event),
    });
    if (updated) {
      return rowFor(conversationId, uiId);
    }
  }
  return appendMessage({
    content: content ?? null,
    conversationId,
    frameType,
    hidden: event.type === "agent_status" && event.status === "connecting",
    msgId,
    refId: frameReference(event),
    status: rowStatus(event),
    turnId,
    uiId,
  });
}

/** Rows the client reducer collapses into one card. */
function frameUiId(msgId: string, event: AcpStreamEvent): string | null {
  switch (event.type) {
    case "text":
    case "thinking":
      return `${event.type}:${msgId}`;
    case "plan":
      return `plan:${msgId}`;
    case "acp_tool_call":
      return `tool:${event.update.toolCallId}`;
    case "drill_item":
      return `drill:${event.request_id}`;
    default:
      return null;
  }
}

/** Correlation id for parked cards (permission/ask recovery). */
function frameReference(event: AcpStreamEvent): string | null {
  if (event.type === "acp_permission") {
    return event.tool_call.toolCallId;
  }
  if (event.type === "ask" || event.type === "drill_item") {
    return event.request_id;
  }
  return null;
}

type DrillItemEvent = Extract<AcpStreamEvent, { type: "drill_item" }>;

const drillItemFrameContent = (
  item: DrillItemEvent["item"]
): Record<string, unknown> | null => {
  if (item === null) {
    return null;
  }
  return {
    anchors: [...item.anchors],
    id: item.id,
    itemType: item.itemType,
    level: item.level,
    options: [...item.options],
    passage: item.passage ?? null,
    prompt: item.prompt,
  };
};

const drillResolutionFrameContent = (
  resolution: NonNullable<DrillItemEvent["resolution"]>
): Record<string, unknown> => ({
  chosenIndex: resolution.chosenIndex,
  correct: resolution.correct,
  correctIndex: resolution.correctIndex,
  ...(resolution.correctOption === undefined
    ? {}
    : { correctOption: resolution.correctOption }),
  ...(resolution.explanation === undefined
    ? {}
    : { explanation: resolution.explanation }),
  ...(resolution.itemId === undefined ? {} : { itemId: resolution.itemId }),
  ...(resolution.skipped === undefined ? {} : { skipped: resolution.skipped }),
});

export const toAcpDrillSnapshot = (
  snapshot: AcpDrillSnapshot
): AcpDrillSnapshot => ({
  answered: snapshot.answered,
  asked: snapshot.asked,
  ...(snapshot.correct === undefined ? {} : { correct: snapshot.correct }),
  declaredCount: snapshot.declaredCount,
  nextReview: snapshot.nextReview,
  pendingRefill: snapshot.pendingRefill,
  readyCount: snapshot.readyCount,
  remaining: snapshot.remaining,
  ...(snapshot.skipped === undefined ? {} : { skipped: snapshot.skipped }),
  ...(snapshot.unanswered === undefined
    ? {}
    : { unanswered: snapshot.unanswered }),
});

const drillFrameContent = (event: DrillItemEvent): Record<string, unknown> => ({
  drill_session_id: event.drill_session_id,
  item: drillItemFrameContent(event.item),
  phase: event.phase,
  request_id: event.request_id,
  ...(event.phase === "answered" && event.resolution
    ? { resolution: drillResolutionFrameContent(event.resolution) }
    : {}),
  session_id: event.session_id,
  snapshot: toAcpDrillSnapshot(event.snapshot),
});

const FRAME_CONTENT: Partial<{
  [T in AcpStreamEvent["type"]]: (
    event: Extract<AcpStreamEvent, { type: T }>
  ) => unknown;
}> = {
  acp_config_option: (event) => ({ configOptions: event.configOptions }),
  acp_context_usage: (event) => ({ ...event.data }),
  acp_mode_info: (event) => ({ currentModeId: event.currentModeId }),
  acp_permission: (event) => ({
    options: event.options,
    request_id: event.request_id,
    tool_call: sanitizeAcpToolUpdate({ ...event.tool_call }),
  }),
  acp_permission_resolved: (event) => ({
    option_id: event.option_id,
    request_id: event.request_id,
  }),
  acp_session_info: (event) => ({
    title: event.title,
    updatedAt: event.updatedAt,
  }),
  acp_tool_call: (event) => sanitizeAcpToolUpdate({ ...event.update }),
  agent_status: (event) => ({
    agent_id: event.agent_id,
    detail: event.detail,
    session_id: event.session_id,
    status: event.status,
  }),
  ask: (event) => ({
    questions: event.questions,
    request_id: event.request_id,
  }),
  available_commands: (event) => ({ commands: event.commands }),
  drill_item: (event) => drillFrameContent(event),
  plan: (event) => ({ entries: event.entries }),
  text: (event) => event.content,
  thinking: (event) => event.content,
  turn_end: (event) => ({
    // TASK-102 AC#4/#6: the failure message + code ride the terminal frame,
    // so a failed turn renders its reason to the client (and survives a
    // reload) instead of a bare error stop-reason with nothing to show.
    error: event.error,
    stopReason: event.stopReason,
    usage: event.usage ?? null,
  }),
  turn_start: (event) => ({ session_id: event.session_id }),
};

function frameContent(event: AcpStreamEvent): unknown {
  const extract = (
    FRAME_CONTENT as Record<
      string,
      ((event: AcpStreamEvent) => unknown) | undefined
    >
  )[event.type];
  if (extract) {
    return extract(event);
  }
  return event;
}

/** The stored row for an in-place update (re-read for its new seq). */
async function rowFor(
  conversationId: string,
  uiId: string
): Promise<StoredMessage> {
  const rows = await listFramesAfter(conversationId, 0, 500);
  const found = rows.find((row) => row.uiId === uiId);
  if (found) {
    return found;
  }
  // Unreachable in practice (the update hit a row): fall back to an error row.
  return appendMessage({
    content: null,
    conversationId,
    frameType: "error",
    msgId: "",
    status: "error",
    turnId: null,
    uiId,
  });
}

/**
 * Build the LIVE wire frame from one engine event (the ring's payload).
 * Mirrors `toWireFrame`'s envelope semantics: live frames carry
 * `replace: true` for the frames the client reducer collapses by ui_id
 * (cumulative snapshots), so a live subscriber renders identically to a
 * history replay.
 */
function toLiveFrame(
  event: AcpStreamEvent,
  conversationId: string,
  turnId: string,
  msgId: string
): WireFrame {
  const type = (FRAME_TYPE[event.type] ?? event.type) as WireFrame["type"];
  const collapsible =
    event.type === "text" ||
    event.type === "thinking" ||
    event.type === "plan" ||
    event.type === "acp_tool_call" ||
    event.type === "drill_item";
  const frame = {
    conversation_id: conversationId,
    created_at: Date.now(),
    // `frameContent` returns `unknown` but each `type` branch above
    // produces the matching schema's payload; the wire type is carried by
    // the literal `type` field, so the assertion is sound per-branch.
    data: frameContent(event) as WireFrame["data"],
    hidden: event.type === "agent_status" && event.status === "connecting",
    msg_id: msgId,
    replace: collapsible ? true : undefined,
    turn_id: turnId,
    type,
  } as WireFrame;
  return frame;
}

/** Wire frame for one terminal-output event (the live lane's payload).
 * The envelope mirrors `toLiveFrame` (no `id` — that is oRPC event meta,
 * set by the subscribe drain now); `status` stays `work` so the client
 * reducer drives the card's running/exited badge from `data.exit_status`
 * instead. */
function toTerminalWireFrame(
  event: AcpTerminalOutputEvent,
  conversationId: string,
  turnId: string,
  msgId: string
): WireFrame {
  // `status` stays `work`: the card's running/exited state is derived
  // client-side from `exit_status` (the wire carries the raw status).
  const { exit_status } = event;
  return {
    conversation_id: conversationId,
    created_at: Date.now(),
    data: {
      command: event.command,
      exit_status: exit_status ?? null,
      output: event.output,
      terminal_id: event.terminal_id,
      truncated: event.truncated,
    },
    hidden: false,
    msg_id: msgId,
    replace: true,
    status: "work",
    turn_id: turnId,
    type: "acp_terminal_output",
  };
}

/**
 * Persisted row → wire frame (replayed rows carry `replace: true`).
 *
 * TASK-86: parked `ask` rows also carry their settled `status` so a reload
 * can tell an answered/expired ask (finish/error) from one still awaiting
 * the learner (pending). TASK-109: `acp_permission` rows carry it for the
 * same reason — without it a permission left `pending` by a crashed park
 * replays indistinguishable from a live one, tappable forever. Other frame
 * types replay statusless as before, so their client reducers are
 * unchanged.
 */
export function toWireFrame(row: StoredMessage, replace: boolean): WireFrame {
  const frame: WireFrame = {
    conversation_id: row.conversationId,
    created_at: utcTextToEpochMs(row.createdAt),
    data: JSON.parse(row.content),
    hidden: row.hidden,
    msg_id: row.msgId,
    replace,
    turn_id: row.turnId ?? undefined,
    type: row.frameType as WireFrame["type"],
  };
  if (
    (row.frameType === "ask" ||
      row.frameType === "acp_permission" ||
      row.frameType === "drill_item") &&
    isStoredStatus(row.status)
  ) {
    frame.status = row.status;
  }
  return frame;
}

/**
 * SQLite `datetime('now')` writes UTC in `YYYY-MM-DD HH:MM:SS` (space
 * separator, no Z), which `new Date()` rejects on Node ≥ 16 — it returns
 * `NaN`, so `toWireFrame`'s old `.getTime() || undefined` silently dropped
 * the field. Parse the UTC string explicitly; fall back to undefined if the
 * value is already absent or unparseable.
 */
function utcTextToEpochMs(utc: string | undefined): number | undefined {
  if (utc === undefined) {
    return undefined;
  }
  // `YYYY-MM-DD HH:MM:SS` → `YYYY-MM-DDTHH:MM:SSZ` for ISO parsing.
  const iso = `${utc.replace(" ", "T")}Z`;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}
