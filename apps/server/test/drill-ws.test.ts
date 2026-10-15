import { describe, expect, test } from "bun:test";

process.env.CORS_ORIGIN = "http://localhost:3000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider, getUserDb } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("drill-ws");
const { applyContentMigrations } = await import("@manobu/db/migrate");
applyContentMigrations(DB_URL);
process.env.DATABASE_URL = DB_URL;
// Every code path, including the module-scope singletons in chat-store and
// routes/cards, resolves through this. Setting the env alone is not enough:
// `bun test` loads all spec files first, so the env is whatever the last one
// assigned. See src/user-db.ts for the whole story.
setUserDbProvider(async () =>
  (await import("@manobu/db")).createUserDb(DB_URL)
);

import type {
  AcpDrillItemEvent,
  AcpDrillResolution,
  AcpDrillSnapshot,
  AcpStreamEvent,
} from "@manobu/acp/acp-events";
import type { AcpSessionHandle } from "@manobu/acp/session-types";
import type { ItemForClient } from "@manobu/db/item-store";

import type { ChatController } from "../src/chat-rpc";
import type {
  DrillBridgeController,
  SettleDrillPending,
} from "../src/services/drill-bridge";
import type {
  DrillLifecycle,
  DrillSettlement,
} from "../src/services/drill-lifecycle";

const { AcpSessionHandle: Handle } = await import("@manobu/acp/session-types");

const { createRpcHandlers } = await import("../src/rpc");
const { createDrillBridge } = await import("../src/services/drill-bridge");
const { ensureConversation, setUserAcpSessionId } = await import(
  "../src/chat-store"
);
const { bootChatServer } = await import("./harness");
type ChatServer = Awaited<ReturnType<typeof bootChatServer>>;

const conversationId = "ws-drill-conversation";
const drillSessionId = "ws-drill-session";
const requestId = "ws-drill-request";
const item = {
  anchors: ["grammar:particle"],
  id: "ws-drill-item",
  itemType: "grammar-form" as const,
  level: "N5",
  options: ["correct", "wrong-a", "wrong-b", "wrong-c"],
  passage: null,
  prompt: "Choose the particle.",
};
const storedItem: ItemForClient = {
  ...item,
  createdAt: "2026-09-25T00:00:00.000Z",
  seedPart: "seed",
  speech: null,
  stem: null,
  stimuli: [],
  surface: "drill",
};
const before: AcpDrillSnapshot = {
  answered: 0,
  asked: 1,
  declaredCount: 5,
  pendingRefill: false,
  readyCount: 3,
  remaining: 4,
};
const after: AcpDrillSnapshot = {
  answered: 1,
  asked: 1,
  declaredCount: 5,
  pendingRefill: false,
  readyCount: 2,
  remaining: 4,
};
const answer: AcpDrillResolution = {
  chosenIndex: 1,
  correct: false,
  correctIndex: 0,
  correctOption: "correct",
  explanation: "Use the particle that marks the subject.",
  itemId: item.id,
};

const settlement = (): DrillSettlement => ({
  attempt: {
    at: "2026-09-25T00:00:00.000Z",
    chosenIndex: answer.chosenIndex,
    correct: answer.correct,
    id: 1,
    itemId: item.id,
    sessionId: drillSessionId,
    skipped: false,
  },
  card: null,
  recorded: true,
  snapshot: {
    answered: 1,
    asked: 1,
    declaredCount: 5,
    generation: 0,
    maxPerType: 1,
    pendingRefill: false,
    phase: "active",
    readyCount: 2,
    remaining: 4,
    sessionId: drillSessionId,
    supersessionCount: 0,
  },
  verdict: {
    chosenIndex: answer.chosenIndex,
    correct: answer.correct,
    correctIndex: answer.correctIndex,
    correctOption: answer.correctOption ?? "correct",
    explanation: answer.explanation ?? null,
  },
});

const pendingEvent = (): AcpDrillItemEvent => ({
  drill_session_id: drillSessionId,
  item,
  phase: "pending",
  request_id: requestId,
  session_id: "ws-acp-session",
  snapshot: before,
  type: "drill_item",
});

const answeredEvent = (): AcpDrillItemEvent => ({
  ...pendingEvent(),
  phase: "answered",
  resolution: answer,
  snapshot: after,
});

const makeLifecycle = (
  settleCalls: Record<string, unknown>[]
): DrillLifecycle => ({
  draw: async () => ({ kind: "unavailable", snapshot: settlement().snapshot }),
  end: async () => settlement().snapshot,
  open: async () => ({
    kind: "unavailable",
    reason: "no-valid-items",
    snapshot: null,
  }),
  pause: async () => settlement().snapshot,
  resume: async () => settlement().snapshot,
  settle: (input) => {
    settleCalls.push(input);
    return Promise.resolve(settlement());
  },
  skip: async () => settlement().snapshot,
  snapshot: async () => settlement().snapshot,
  supersede: async () => settlement().snapshot,
});

const collect = (iterator: AsyncIterator<unknown>): Promise<unknown[]> =>
  iterator
    .next()
    .then((next) =>
      next.done ? [] : collect(iterator).then((rest) => [next.value, ...rest])
    );

const waitForPending = async (
  listMessages: () => Promise<{
    messages: { content: string; type: string }[];
  }>,
  attempt = 0
): Promise<Record<string, unknown> | undefined> => {
  if (attempt >= 100) {
    return undefined;
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { messages } = await listMessages();
  const row = messages.find((candidate) => candidate.type === "drill_item");
  return row
    ? (JSON.parse(row.content) as Record<string, unknown>)
    : waitForPending(listMessages, attempt + 1);
};

const makePendingController = (
  handle: AcpSessionHandle
): {
  answerCalls: AcpDrillResolution[];
  controller: ChatController & DrillBridgeController;
} => {
  let pending = true;
  let pick: PromiseWithResolvers<void> | null = null;
  const answerCalls: AcpDrillResolution[] = [];
  const controller = {
    answerAsk: () => false,
    answerDrillItem: (id: string, resolution: AcpDrillResolution) => {
      expect(id).toBe(requestId);
      answerCalls.push(resolution);
      pending = false;
      pick?.resolve();
      return true;
    },
    cancel: async () => true,
    configOptions: async () => [],
    confirm: () => false,
    dispose: async () => undefined,
    handleFor: () => handle,
    killTerminal: () => false,
    listConfirmations: () => (pending ? [pendingEvent()] : []),
    parkDrillItem: () => ({
      promise: Promise.resolve(answer),
      requestId,
    }),
    prompt: async (
      _handle: AcpSessionHandle,
      input: { sink: (event: AcpStreamEvent) => Promise<void> }
    ) => {
      await input.sink({ session_id: handle.sessionId, type: "turn_start" });
      await input.sink({
        type: "acp_tool_call",
        update: {
          sessionUpdate: "tool_call",
          title: "manobu-host-tools_next_drill_item",
          toolCallId: "host-tool-1",
        },
      });
      await input.sink(pendingEvent());
      pick = Promise.withResolvers<void>();
      await pick.promise;
      await input.sink(answeredEvent());
      await input.sink({
        content: { text: "Nice work.", type: "text" },
        type: "text",
      });

      await input.sink({
        stopReason: "end_turn",
        type: "turn_end",
        usage: null,
      });
      return { stopReason: "end_turn", usage: null };
    },
    retireDrillItem: () => true,
  } as unknown as ChatController & DrillBridgeController;
  return { answerCalls, controller };
};

interface StreamFrame {
  data?: Record<string, unknown>;
  type: string;
}

const assertPendingDrillFrame = (
  pendingFrame: Record<string, unknown> | undefined
): void => {
  expect(pendingFrame).toBeDefined();
  expect(pendingFrame).not.toHaveProperty("resolution");
  expect(pendingFrame?.item).toEqual(item);
};

const assertDrillConfirmations = (confirmations: {
  confirmations: { type: string }[];
}): void => {
  expect(confirmations.confirmations.map((entry) => entry.type)).toEqual([
    "drill_item",
  ]);
};

const assertLiveDrillFrames = (frames: StreamFrame[]): void => {
  const drillFrames = frames.filter((frame) => frame.type === "drill_item");
  expect(frames.some((frame) => frame.type === "acp_tool_call")).toBe(false);
  expect(drillFrames).toHaveLength(2);

  expect(drillFrames[0]?.data).not.toHaveProperty("resolution");
  expect(drillFrames[1]?.data?.resolution).toEqual(answer);
  expect(frames.at(-1)?.type).toBe("finish");
  expect(
    frames.findIndex(
      (frame) => frame.type === "drill_item" && frame.data?.resolution
    )
  ).toBeLessThan(frames.findIndex((frame) => frame.type === "content"));
  expect(frames.findIndex((frame) => frame.type === "content")).toBeLessThan(
    frames.findIndex((frame) => frame.type === "finish")
  );
};

const assertPersistedDrillCard = async (
  fetchClient: ChatServer["clients"]["fetch"]
): Promise<void> => {
  const { messages } = await fetchClient.chat.listMessages({ conversationId });
  const drillRow = messages.find((row) => row.type === "drill_item");
  expect(drillRow?.status).toBe("finish");
  expect(JSON.parse(drillRow?.content ?? "{}")).toMatchObject({
    phase: "answered",
    resolution: answer,
  });
};

const assertReplayedDrillCard = async (
  wsClient: ChatServer["clients"]["ws"]
): Promise<void> => {
  const replay = (await collect(
    await wsClient.chat.subscribe({ conversationId })
  )) as {
    data?: Record<string, unknown>;
    status?: string;
    type: string;
  }[];
  const replayDrill = replay.find((frame) => frame.type === "drill_item");
  expect(replayDrill?.status).toBe("finish");
  expect(replayDrill?.data?.resolution).toEqual(answer);
};

const assertPendingDrillResolution = async (
  server: ChatServer,
  answerCalls: AcpDrillResolution[],
  settleCalls: Record<string, unknown>[],
  settled: Parameters<SettleDrillPending>[]
): Promise<void> => {
  const { fetch, ws } = server.clients;
  const stream = await ws.chat.subscribe({ conversationId });
  const framesPromise = collect(stream);
  await ws.chat.send({
    conversationId,
    messages: [{ content: "start the drill", role: "user" }],
  });
  const pendingFrame = await waitForPending(() =>
    fetch.chat.listMessages({ conversationId })
  );
  assertPendingDrillFrame(pendingFrame);
  const confirmations = await ws.chat.listConfirmations({ conversationId });
  assertDrillConfirmations(confirmations);

  const result = await ws.chat.answerDrillItem({
    chosenIndex: answer.chosenIndex,
    conversationId,
    itemId: item.id,
    requestId,
  });
  expect(result).toEqual({ resolution: answer, snapshot: after });
  expect(settleCalls).toEqual([
    {
      chosenIndex: answer.chosenIndex,
      itemId: item.id,
      responseQuality: "standard",
      sessionId: drillSessionId,
    },
  ]);
  expect(answerCalls).toEqual([answer]);
  expect(settled).toHaveLength(1);

  const frames = (await framesPromise) as StreamFrame[];
  assertLiveDrillFrames(frames);
  await assertPersistedDrillCard(fetch);
  await assertReplayedDrillCard(ws);
};

describe("chat.answerDrillItem over the live WS", () => {
  test("resolves a pending card, persists the verdict, and replays it terminal", async () => {
    const db = await getUserDb();
    const handle = new Handle("fake") as AcpSessionHandle;
    handle.sessionId = "ws-acp-session";
    handle.sessionActive = true;
    handle.healthy = true;
    await ensureConversation(conversationId, { title: "Drill WS" });
    await setUserAcpSessionId(conversationId, handle.sessionId);

    const { answerCalls, controller } = makePendingController(handle);
    const settleCalls: Record<string, unknown>[] = [];
    const lifecycle = makeLifecycle(settleCalls);
    const settled: Parameters<SettleDrillPending>[] = [];
    const bridge = createDrillBridge({
      controller,
      getConversationSession: async (id) =>
        id === conversationId ? { handle, sessionId: handle.sessionId } : null,
      getDrillSessionOwner: async (id) =>
        id === drillSessionId ? { conversationId } : null,
      lifecycle,
      settlePending: (...args) => {
        settled.push(args);
        return Promise.resolve();
      },
    });
    const router = createRpcHandlers({
      controller,
      drill: bridge,
      resolveHandle: async () => handle,
    });
    const server = await bootChatServer({
      agent: { handle, script: new Map() },
      db,
      router,
    });
    try {
      await assertPendingDrillResolution(
        server,
        answerCalls,
        settleCalls,
        settled
      );
    } finally {
      await server.close();
    }
  }, 20_000);

  test("starts a model-free drill and settles its direct card", async () => {
    const db = await getUserDb();
    const directConversationId = "ws-direct-drill-conversation";
    const handle = new Handle("fake") as AcpSessionHandle;
    handle.sessionId = "unused-direct-session";
    handle.sessionActive = true;
    handle.healthy = true;
    await ensureConversation(directConversationId, { title: "Direct Drill" });

    const settleCalls: Record<string, unknown>[] = [];
    const lifecycle: DrillLifecycle = {
      ...makeLifecycle(settleCalls),
      draw: async () => ({
        kind: "completed",
        snapshot: settlement().snapshot,
      }),
      open: async () => ({
        draw: {
          item: storedItem,
          kind: "item",
          snapshot: settlement().snapshot,
        },
        kind: "opened",
        snapshot: settlement().snapshot,
      }),
    };
    const controller = {
      answerDrillItem: () => true,
      listConfirmations: () => [],
      parkDrillItem: () => {
        throw new Error("unexpected ACP park");
      },
      retireDrillItem: () => true,
    } as unknown as ChatController & DrillBridgeController;
    const bridge = createDrillBridge({
      controller,
      getConversationSession: async () => null,
      getDrillSessionOwner: async () => ({
        conversationId: directConversationId,
      }),
      lifecycle,
      settlePending: () => Promise.resolve(),
    });
    const router = createRpcHandlers({
      controller,
      drill: bridge,
      resolveHandle: async () => handle,
    });
    const server = await bootChatServer({
      agent: { handle, script: new Map() },
      db,
      router,
    });
    try {
      const { fetch, ws } = server.clients;
      const started = await ws.chat.startDrill({
        anchors: ["grammar:particle"],
        conversationId: directConversationId,
        count: 1,
        level: "N5",
        seed: "direct-seed",
        tier: "2",
      });
      expect(started.kind).toBe("opened");

      const pendingRow = await waitForPending(() =>
        fetch.chat.listMessages({ conversationId: directConversationId })
      );
      expect(pendingRow?.item).toEqual(item);
      const pending = pendingRow as {
        request_id: string;
        snapshot: AcpDrillSnapshot;
      };
      const result = await ws.chat.answerDrillItem({
        chosenIndex: answer.chosenIndex,
        conversationId: directConversationId,
        itemId: item.id,
        requestId: pending.request_id,
      });
      expect(result.resolution).toEqual(answer);

      const { messages } = await fetch.chat.listMessages({
        conversationId: directConversationId,
      });
      const row = messages.find((candidate) => candidate.type === "drill_item");
      expect(row?.status).toBe("finish");
      expect(JSON.parse(row?.content ?? "{}")).toMatchObject({
        item: null,
        phase: "summary",
      });
    } finally {
      await server.close();
    }
  }, 20_000);
});
