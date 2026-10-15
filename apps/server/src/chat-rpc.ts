/*
 * Chat procedures for the native-ACP surface (TASK-80.2 / TASK-80.7 AC#3).
 *
 * The 13 procedure handlers (oRPC `implement`), plus the turn runner and
 * two module-local helpers. The hub plumbing lives in `chat-hub.ts` and
 * the persistence bridge (frame → row → wire) in `chat-persistence.ts`.
 */

import { randomUUID } from "node:crypto";
import type {
  AcpConfigOption,
  AcpDrillItemEvent,
  AcpStreamEvent,
  AcpTurnErrorCode,
} from "@manobu/acp/acp-events";
import type { AcpSessionHandle } from "@manobu/acp/session-types";
import { contract } from "@manobu/api-contract";
import { implement, type RouterImplementer, withEventMeta } from "@orpc/server";
import {
  type ChatContext,
  hubFor,
  RING_LAG_LIMIT,
  resetHub,
  TERMINAL_FRAME_TYPES,
  type WireFrame,
  waitSettled,
} from "./chat-hub";
import {
  emitUserTurn,
  sinkFor,
  toAcpDrillSnapshot,
  toWireFrame,
} from "./chat-persistence";
import {
  deleteConversation as deleteConversationRow,
  deriveTitle,
  ensureConversation,
  getConversation as getConversationRow,
  listConversations as listConversationsPage,
  renameConversation as renameConversationRow,
  type StoredMessage,
  settlePending,
} from "./chat-store";
import {
  controller as defaultController,
  ensureAcp,
  getDrillBridge,
} from "./context";
import {
  type DrillBridge,
  DrillBridgeError,
  toAcpDrillItem,
} from "./services/drill-bridge";

/**
 * Standalone chat builder: `createChatHandlers(deps)` still boots without
 * a passed-in implementer (the production path is rpc.ts's single
 * implementer; this default is the test/legacy seam, so it builds lazily
 * and the module load stays free of a second implementer).
 */
let cachedChatBuilder: ChatBuilder | null = null;
function standaloneChatBuilder(): ChatBuilder {
  cachedChatBuilder ??= implement(contract).$context<ChatContext>().chat;
  return cachedChatBuilder;
}

/**
 * Test seam: substitute the session controller (the real one spawns a
 * child; the fake replays scripted frames + parks instead). The real
 * `SessionController` satisfies this structurally.
 */
export interface ChatDeps {
  controller?: ChatController;
  drill?: Pick<
    DrillBridge,
    "answer" | "open" | "park" | "skip" | "start" | "stop"
  >;
  /**
   * Test seam: substitute the session handle for a conversation. The
   * default resolves through the warm pool in context.ts; the fake-agent
   * harness substitutes a scripted child so the suite runs with no CLI.
   */
  resolveHandle?: (
    agentId?: string,
    conversationId?: string
  ) => Promise<AcpSessionHandle>;
}

/**
 * Structural controller interface: the real `SessionController` and the
 * fake in tests both satisfy it. The fake's simplified signatures are
 * wider (accept more, return less specific) which is assignment-compatible.
 */
export interface ChatController {
  answerAsk: (
    requestId: string,
    payload: { answers?: unknown[]; decline?: boolean }
  ) => boolean;
  cancel: (sessionId: string, turnId?: string) => Promise<boolean>;
  configOptions: (
    handle: AcpSessionHandle,
    patch?: unknown
  ) => Promise<AcpConfigOption[]>;
  confirm: (callId: string, optionId: string) => boolean;
  dispose: (sessionId: string) => Promise<void>;
  handleFor: (sessionId: string) => AcpSessionHandle | null;
  killTerminal: (terminalId: string) => boolean;
  listConfirmations: (sessionId: string) => AcpStreamEvent[];
  prompt: (
    handle: AcpSessionHandle,
    input: { content?: unknown; sink: (event: AcpStreamEvent) => Promise<void> }
  ) => Promise<{ stopReason: string; usage: unknown }>;
}

/**
 * The chat subtree of the router's SINGLE implementer (TASK-80.8 AC#7):
 * rpc.ts owns the one `implement(contract)` and hands its `chat`
 * implementer down; this factory keeps the ChatDeps DI seam for tests.
 * Named off the full contract so a drift in the implementer's context or
 * error map is a compile error at the call site (not a `ReturnType`
 * alias coupled to a helper).
 */
export type ChatBuilder = RouterImplementer<
  typeof contract,
  ChatContext & object
>["chat"];

type DrillStartResult = Awaited<ReturnType<DrillBridge["start"]>>;
type OpenedDrillStartResult = Exclude<
  DrillStartResult,
  { kind: "unavailable" }
>;
type DrillStartDraw = OpenedDrillStartResult["draw"];
type DrillStartPhase = "pending" | "summary" | "suspended" | "unavailable";

const DRILL_START_PHASE = {
  completed: "summary",
  item: "pending",
  paused: "suspended",
  pending: "pending",
  unavailable: "unavailable",
} satisfies Record<DrillStartDraw["kind"], DrillStartPhase>;

const toDrillStartItem = (draw: DrillStartDraw) =>
  draw.kind === "item"
    ? {
        ...toAcpDrillItem(draw.item),
        anchors: [...draw.item.anchors],
        options: [...draw.item.options],
      }
    : null;

export function createChatHandlers(
  deps: ChatDeps = {},
  chat: ChatBuilder = standaloneChatBuilder()
) {
  const resolveHandle = deps.resolveHandle ?? ensureAcp;
  const controller = deps.controller ?? defaultController;
  const { drill } = deps;

  // ── Helpers ────────────────────────────────────────────────────────

  /** The stored ACP sessionId used for `session/load` resume. */
  async function storedSessionId(
    conversationId: string
  ): Promise<string | null> {
    const { getUserAcpSessionId } = await import("./chat-store");
    return getUserAcpSessionId(conversationId);
  }

  /** Stored row → the AionUi message-row shape `chat.listMessages` serves. */
  function toMessageRow(row: StoredMessage) {
    return {
      content: row.content,
      conversation_id: row.conversationId,
      created_at: row.createdAt,
      hidden: row.hidden,
      id: row.id,
      msg_id: row.msgId,
      ref_id: row.refId,
      status: row.status,
      turn_id: row.turnId,
      type: row.frameType,
      ui_id: row.uiId,
    } as const;
  }

  /** AionUi config-option wire shape from engine `AcpConfigOption[]`. */
  function configOptionsToWire(options: AcpConfigOption[]): Array<{
    currentValue: string | boolean;
    id: string;
    options: Array<{ value: string }>;
    type: "boolean" | "select";
  }> {
    return options.map((option) => ({
      currentValue: option.currentValue,
      id: option.id,
      options: option.options.map((o) => ({ value: o.value })),
      type: option.type,
    }));
  }

  function toDrillStartResponse(result: DrillStartResult) {
    if (result.kind === "unavailable") {
      return result;
    }
    return {
      item: toDrillStartItem(result.draw),
      kind: "opened" as const,
      phase: DRILL_START_PHASE[result.draw.kind],
      sessionId: result.snapshot.sessionId,
      snapshot: toAcpDrillSnapshot(result.snapshot),
    };
  }

  async function publishDirectDrillEvent(
    context: ChatContext,
    conversationId: string,
    event: AcpDrillItemEvent
  ): Promise<void> {
    const turnId = randomUUID();
    const msgId = randomUUID();
    resetHub(hubFor(context, conversationId));
    await sinkFor(context, conversationId, turnId, msgId, {
      awaitNonTerminal: true,
    })(event);
  }

  /** Run one turn to completion; the sink emits every frame, terminal included. */
  async function runTurn(
    context: ChatContext,
    conversationId: string,
    turnId: string,
    input: {
      agent?: string;
      messages: { content: string; role: string }[];
      model?: string;
    },
    sink: (event: AcpStreamEvent) => Promise<void>
  ): Promise<void> {
    try {
      const handle = await resolveHandle(input.agent, conversationId);
      if (input.model) {
        try {
          await controller.configOptions(handle, { modelId: input.model });
        } catch (error) {
          console.warn(
            `[chat] model switch to "${input.model}" failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      await controller.prompt(handle, {
        content: input.messages.map((message) => ({
          text: message.content,
          type: "text",
        })),
        sink: async (event: AcpStreamEvent) => {
          await sink(event);
        },
        // The armed turn must carry THIS turn id: chat.cancel guards on it,
        // and the client only ever knows the ack's id (TASK-86 Stop fix).
        turnId,
      });
    } catch (error) {
      // A typed engine rejection carries its own `code` (TASK-102): AUTH_REQUIRED
      // and CONFIG_SWITCH_FAILED reach the client as a distinct, renderable
      // terminal error rather than a generic send failure. Anything else
      // stays an unclassified error with the engine's message.
      const { code } = error as { code?: AcpTurnErrorCode };
      await sink({
        error: {
          code,
          message: error instanceof Error ? error.message : String(error),
        },
        stopReason: "error",
        type: "turn_end",
      });
    } finally {
      context.turns.delete(conversationId);
    }
  }

  // ── WS link: live-turn surface ────────────────────────────────────
  const subscribe = chat.subscribe.handler(async function* ({
    context,
    input,
    signal,
  }): AsyncGenerator<WireFrame, void, unknown> {
    const { conversationId } = input;
    const hub = hubFor(context, conversationId);

    // ── History (the ONE connect-time DB read) ─────────────────────
    // Persisted rows replay as `replace: true` frames (coarse, idempotent
    // reload-restore / reconnect catch-up). `lastEventId` is ignored:
    // the coarse replay replaces the per-frame seq-cursor (TASK-80.14).
    const { listMessages } = await import("./chat-store");
    // TASK-82: the replay window. 200 rows ≈ a full turn's frames (tool
    // calls fan out ~10 rows/turn), i.e. the last ~20 turns — beyond that
    // the client's transcript starts at the window edge (older turns stay
    // in local.db; a chat-history viewer remains the deep-traversal path).
    // Raise only with a pager design: unbounded replay re-floods a reload
    // with thousands of replace-frames and starves the live drain behind
    // them.
    const history = await listMessages(conversationId, { limit: 200 });
    const sawTerminal = history.some((row) =>
      (TERMINAL_FRAME_TYPES as readonly string[]).includes(row.frameType)
    );
    for (const row of history) {
      yield withEventMeta(toWireFrame(row, true), {
        id: String(row.seq),
      });
    }

    // Settled conversation (no live turn): the history IS the transcript.
    // Close the stream so a one-shot replay consumer (the e2e, the smoke)
    // terminates; the desktop client treats the close as settle.
    if (hub.terminal && sawTerminal) {
      return;
    }

    // ── Live drain off the in-memory ring (zero DB reads) ──────────
    // A per-subscriber PUMP keeps up with every hub pulse into a local
    // queue; the generator only mediates delivery from the queue. This
    // mirrors AionCore's broadcast shape: liveness (the pump) is NOT
    // coupled to consumer pacing (the generator resumes only between
    // pulls, so lane snapshots published while suspended at a yield
    // would otherwise sit undelivered until the next pull raced a
    // settle-close — the AC#6 bug). The pump drains the lane + ring on
    // EVERY wake, so nothing is ever missed; the queue buffers what the
    // consumer has not pulled yet.
    //
    // The pump exits when the hub settles and the queue is empty; the
    // generator then closes (stream-close = settled, TASK-80.14 S3).
    const pending: WireFrame[] = [];
    let wakeDelivery: (() => void) | undefined;
    let pumpClosed = false;
    let cursor = 0;
    let laneCursor = 0;

    // Sync drain of the lane + ring past the cursors into the delivery
    // queue. Lane snapshots go FIRST: they are published during the turn,
    // before the terminal ring frame, so lane-then-ring preserves arrival
    // order and the terminal `finish`/`error` frame stays LAST.
    function drainIntoPending(): void {
      for (const entry of hub.terminalLane.values()) {
        if (entry.seq > laneCursor) {
          // The lane holds terminal-output snapshots only (stream-only
          // frames); the union spread makes the narrowed wire type flow.
          pending.push({ ...entry.frame, status: "work" } as WireFrame);
          laneCursor = entry.seq;
        }
      }
      if (cursor > hub.ring.length) {
        // The ring was cleared/replaced under us (a new turn reset it):
        // self-reset so the new turn's frames flow from the start.
        cursor = 0;
      }
      while (cursor < hub.ring.length) {
        const frame = hub.ring[cursor];
        cursor += 1;
        if (frame) {
          pending.push(frame);
        }
      }
    }

    // The pump: a plain async loop (not a generator) that parks on the
    // hub gate and keeps the queue topped up regardless of consumer
    // pacing. Abort (dropped WS peer) stops it without cancelling the
    // turn (80.10). The pump lives as long as the subscriber: the gate
    // wait is the design (same as the old bus park), and the delivery
    // generator's `return` (consumer close/abort) triggers the pump's
    // exit via the same abort signal — no orphaned loops.
    const pump = (async () => {
      try {
        for (;;) {
          drainIntoPending();
          if (wakeDelivery) {
            const wake: () => void = wakeDelivery;
            wakeDelivery = undefined;
            wake();
          }
          if (hub.terminal) {
            return;
          }
          signal?.throwIfAborted();
          // biome-ignore lint/performance/noAwaitInLoops: the pump MUST park on the hub gate inside its loop — the gate is the only wake signal for frames/settle, and recursion cannot carry the pump's shared queue state. The park is the design, not a leak.
          await waitSettled(hub);
        }
      } catch {
        // Aborted or hub replaced mid-wait: stop pumping; the delivery
        // generator sees the queue drained and closes via consumer abort.
      } finally {
        pumpClosed = true;
        if (wakeDelivery) {
          const wake: () => void = wakeDelivery;
          wakeDelivery = undefined;
          wake();
        }
      }
    })();
    pump.catch((error: unknown) => {
      console.error(
        `[chat] subscriber pump failed on ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });

    // Liveness is loud and bounded (AC#5): a subscriber left more than
    // RING_LAG_LIMIT entries behind is logged. In practice the pump
    // runs synchronously after every pulse, so lag only happens on a
    // wedged consumer — exactly the case AionCore's Lagged signal
    // exists for.
    if (pending.length > RING_LAG_LIMIT) {
      console.error(
        `[chat] subscriber lagged on ${conversationId}: ${pending.length} frames buffered`
      );
    }

    // Delivery: pull from the queue; when empty, park on the pump's wake
    // promise. The pump closes it on settle/abort (pumpClosed + wake), so
    // stream-close = settled (TASK-80.14 S3).
    for (;;) {
      while (pending.length > 0) {
        const frame = pending.shift() as WireFrame;
        yield frame;
      }
      if (pumpClosed) {
        return;
      }
      // biome-ignore lint/performance/noAwaitInLoops: the delivery loop MUST park on the pump's wake promise — this is a queue consumer, not a busy drain; the pump guarantees the wake fires on every publish/settle/abort, so there is no lost-wake window.
      await new Promise<void>((resolve) => {
        wakeDelivery = resolve;
      });
      wakeDelivery = undefined;
    }
  });

  const send = chat.send.handler(async ({ context, input, errors }) => {
    const { conversationId } = input;
    await ensureConversation(conversationId, {
      agent: input.agent,
      assistant: input.assistant,
      title: deriveTitle(input.messages[0]?.content ?? "") ?? undefined,
    });
    // The gate: one turn per conversation — a second send is a client bug
    // (double-tap, a cron tick mid-answer), not a queue candidate here.
    if (context.turns.has(conversationId)) {
      throw errors.CONVERSATION_BUSY({
        data: { message: "A turn is already running for this conversation" },
      });
    }
    const turnId = randomUUID();
    const msgId = randomUUID();
    context.turns.set(conversationId, { msgId, turnId });
    const hub = hubFor(context, conversationId);
    // Fresh ring for the new turn: the previous turn's frames live on in
    // the DB as history; the SAME hub object reopens so parked subscribers
    // flow straight onto the new ring (TASK-80.14).
    resetHub(hub);
    const sink = sinkFor(context, conversationId, turnId, msgId);
    // TASK-107 AC#1: persist + publish the learner's prompt as the turn's
    // first frame, AWAITED so its row precedes every agent frame the sink
    // writes (turn-order transcript). An empty/whitespace prompt is skipped
    // (AC#4): nothing recoverable to show or name, so the chat stays Untitled
    // and renameable rather than fabricating a blank turn.
    const promptText = input.messages[0]?.content.trim() ?? "";
    if (promptText.length > 0) {
      await emitUserTurn(context, conversationId, turnId, msgId, promptText);
    }
    const turn = runTurn(context, conversationId, turnId, input, sink);
    turn.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[chat] turn ${turnId} for ${conversationId} failed: ${message}`
      );
    });

    const sessionId = await storedSessionId(conversationId);
    return {
      msg_id: msgId,
      runtime: {
        can_send_message: false,
        is_processing: true,
        pending_confirmations: sessionId
          ? controller.listConfirmations(sessionId).length
          : 0,
        state: "processing",
        turn_id: turnId,
      },
      turn_id: turnId,
    };
  });

  const confirm = chat.confirm.handler(async ({ input, errors }) => {
    const settled = controller.confirm(input.callId, input.data);
    if (!settled) {
      throw errors.NOT_FOUND({
        data: { message: "No pending permission for that call id" },
      });
    }
    await settlePending(input.conversationId, input.callId);
    return { settled: true };
  });

  const answerAsk = chat.answerAsk.handler(async ({ input, errors }) => {
    const settled = controller.answerAsk(input.requestId, {
      answers: input.answers,
      decline: input.decline ?? false,
    });
    if (!settled) {
      throw errors.NOT_FOUND({
        data: { message: "No pending ask for that request id" },
      });
    }
    // TASK-86: settle with the answer summary merged into the row content,
    // so a reload replays the compact answered card (not a fresh prompt).
    await settlePending(input.conversationId, input.requestId, "finish", {
      answers: input.answers ?? [],
      declined: input.decline === true,
    });
    return { settled: true };
  });

  const answerDrillItem = chat.answerDrillItem.handler(
    async ({ input, errors }) => {
      try {
        const answerer = drill ?? (await getDrillBridge());
        return await answerer.answer(input);
      } catch (error: unknown) {
        if (error instanceof DrillBridgeError && error.code === "NOT_FOUND") {
          throw errors.NOT_FOUND({
            data: { message: error.message },
          });
        }
        throw error;
      }
    }
  );

  const startDrill = chat.startDrill.handler(async ({ input, context }) => {
    await ensureConversation(input.conversationId, {});
    const bridge = drill ?? (await getDrillBridge());
    try {
      const result = await bridge.start(
        {
          anchors: input.anchors,
          conversationId: input.conversationId,
          count: input.count,
          id: randomUUID(),
          itemId: input.itemId,
          level: input.level,
          seed: input.seed,
          tier: input.tier,
        },
        (conversationId, event) =>
          publishDirectDrillEvent(context, conversationId, event)
      );
      return toDrillStartResponse(result);
    } catch (error: unknown) {
      if (error instanceof DrillBridgeError) {
        return { kind: "unavailable", reason: error.message };
      }
      throw error;
    }
  });

  const skipDrill = chat.skipDrill.handler(async ({ input, errors }) => {
    try {
      const bridge = drill ?? (await getDrillBridge());
      return await bridge.skip(input);
    } catch (error: unknown) {
      if (error instanceof DrillBridgeError && error.code === "NOT_FOUND") {
        throw errors.NOT_FOUND({
          data: { message: error.message },
        });
      }
      throw error;
    }
  });

  const stopDrill = chat.stopDrill.handler(async ({ input, errors }) => {
    try {
      const bridge = drill ?? (await getDrillBridge());
      return await bridge.stop(input);
    } catch (error: unknown) {
      if (error instanceof DrillBridgeError && error.code === "NOT_FOUND") {
        throw errors.NOT_FOUND({
          data: { message: error.message },
        });
      }
      throw error;
    }
  });

  const cancel = chat.cancel.handler(async ({ context, input }) => {
    // Resolve the conversation's LIVE session without spawning a new one
    // (direct-cli sessions like agy park no turn state; the stored
    // session id is what the engine indexes the live handle by). No
    // session yet, or the handle is gone: nothing to cancel.
    const sessionId = await storedSessionId(input.conversationId);
    const handle = sessionId ? controller.handleFor(sessionId) : null;
    const cancelled = handle
      ? await controller.cancel(handle.sessionId, input.turnId)
      : false;
    context.turns.delete(input.conversationId);
    return { cancelled };
  });

  const killTerminal = chat.killTerminal.handler(({ input }) => {
    const killed = controller.killTerminal(input.terminalId);
    return { killed };
  });

  const listConfirmations = chat.listConfirmations.handler(
    async ({ input }) => {
      // Recovery after a reload: the parked cards are in-memory engine
      // state keyed by the live session id (persisted via storedSessionId),
      // not DB rows. No session yet: an empty list is the honest answer.
      const sessionId = await storedSessionId(input.conversationId);
      const handle = sessionId ? controller.handleFor(sessionId) : null;
      const confirmations = (
        handle ? controller.listConfirmations(handle.sessionId) : []
      )
        .filter(
          (event) =>
            event.type === "acp_permission" ||
            event.type === "ask" ||
            event.type === "drill_item"
        )
        .map((event) => ({
          data: event,
          msg_id: randomUUID(),
          type: event.type,
        }));
      return {
        confirmations,
        turn_id: handle?.activeTurn?.turnId ?? null,
      };
    }
  );

  // ── fetch link: persisted-state surface ───────────────────────────

  const getConversation = chat.getConversation.handler(
    async ({ errors, input }) => {
      const row = await getConversationRow(input.conversationId);
      if (!row) {
        throw errors.NOT_FOUND({
          data: { message: "No conversation with that id" },
        });
      }
      return row;
    }
  );

  const listConversations = chat.listConversations.handler(async ({ input }) =>
    listConversationsPage({ before: input.before, limit: input.limit })
  );

  const renameConversation = chat.renameConversation.handler(
    async ({ errors, input }) => {
      const conversation = await renameConversationRow(
        input.conversationId,
        input.title
      );
      if (!conversation) {
        throw errors.NOT_FOUND({
          data: { message: "No conversation with that id" },
        });
      }
      return { conversation };
    }
  );

  const deleteConversation = chat.deleteConversation.handler(
    async ({ context, errors, input }) => {
      // Not under a live turn: the sink is still appending rows, and
      // cascading them away mid-flight would leave that writer on a
      // conversation that no longer exists. Cancel first.
      if (context.turns.has(input.conversationId)) {
        throw errors.CONVERSATION_BUSY({
          data: { message: "Turn in progress, cancel it before deleting" },
        });
      }
      // Read the stored session id BEFORE the delete: after the row goes,
      // nothing else maps this conversation to its agent child.
      const sessionId = await storedSessionId(input.conversationId);
      const deleted = await deleteConversationRow(input.conversationId);
      if (!deleted) {
        throw errors.NOT_FOUND({
          data: { message: "No conversation with that id" },
        });
      }
      // The session was spawned for this conversation, so dropping it
      // without disposing the child leaks a live agent process. An already
      // exited child is not a failed delete.
      if (sessionId) {
        await controller.dispose(sessionId).catch(() => undefined);
      }
      context.hubs.delete(input.conversationId);
      return deleted;
    }
  );

  const listMessages = chat.listMessages.handler(async ({ input, errors }) => {
    const { listMessages: listStoredMessages } = await import("./chat-store");
    const rows = await listStoredMessages(input.conversationId, {
      before: input.before,
      limit: input.limit,
    });
    if (rows.length === 0) {
      const live = await storedSessionId(input.conversationId);
      if (!live) {
        throw errors.NOT_FOUND({
          data: { message: "No conversation with that id" },
        });
      }
    }
    return { messages: rows.map(toMessageRow) };
  });

  const slashCommands = chat.slashCommands.handler(
    async ({ input, errors }) => {
      const sessionId = await storedSessionId(input.conversationId);
      if (!sessionId) {
        throw errors.NOT_FOUND({
          data: { message: "No session for this conversation yet" },
        });
      }
      const handle = controller.handleFor(sessionId);
      return {
        commands: (handle?.slashCommands ?? []).map((command) => ({
          description: command.description ?? "",
          input: { hint: undefined },
          name: command.name,
        })),
      };
    }
  );

  const setConfigOption = chat.setConfigOption.handler(
    async ({ input, errors }) => {
      const sessionId = await storedSessionId(input.conversationId);
      if (!sessionId) {
        throw errors.NOT_FOUND({
          data: { message: "No session for this conversation yet" },
        });
      }
      const handle = controller.handleFor(sessionId);
      if (!handle) {
        throw errors.NOT_FOUND({
          data: { message: "Session is no longer live" },
        });
      }
      try {
        const configOptions = await controller.configOptions(handle, {
          configId: input.optionId,
          value: input.value,
        });
        return { configOptions: configOptionsToWire(configOptions) };
      } catch (error) {
        // The session EXISTS but the agent rejected / failed the switch:
        // a distinct typed code (TASK-80.8 AC#8). NOT_FOUND stays
        // reserved for the no-session / no-live-handle cases above.
        throw errors.CONFIG_SWITCH_FAILED({
          data: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  );

  return {
    chat: {
      answerAsk,
      answerDrillItem,
      cancel,
      confirm,
      deleteConversation,
      getConversation,
      killTerminal,
      listConfirmations,
      listConversations,
      listMessages,
      renameConversation,
      send,
      setConfigOption,
      skipDrill,
      slashCommands,
      startDrill,
      stopDrill,
      subscribe,
    },
  };
}
