import { describe, expect, test } from "bun:test";

process.env.CORS_ORIGIN = "http://localhost:3000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("drill-bridge");
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
} from "@manobu/acp/acp-events";
import type { AcpSessionHandle } from "@manobu/acp/session-types";
import type { ItemForClient } from "@manobu/db/item-store";
import type {
  DrillBridgeController,
  SettleDrillPending,
} from "../src/services/drill-bridge";
import type {
  DrillDrawResult,
  DrillLifecycle,
  DrillOpenResult,
  DrillSettlement,
  OpenDrillInput,
} from "../src/services/drill-lifecycle";

const { AcpSessionHandle: Handle } = await import("@manobu/acp/session-types");
const { AskToolServer } = await import("../src/ask-tool");
const { callHostTool } = await import("./host-tool-client");
const { createDrillBridge } = await import("../src/services/drill-bridge");

const STABLE_KEY_RE = /^[a-f0-9]{64}$/;

const item: ItemForClient = {
  anchors: ["grammar:particle"],
  createdAt: "2026-09-25T00:00:00.000Z",
  id: "bridge-item-1",
  itemType: "grammar-form",
  level: "N5",
  options: ["correct", "wrong-a", "wrong-b", "wrong-c"],
  passage: null,
  prompt: "Choose the particle.",
  seedPart: "seed",
  speech: null,
  stem: null,
  stimuli: [],
  surface: "drill",
};

const snapshot: AcpDrillSnapshot = {
  answered: 0,
  asked: 1,
  declaredCount: 5,
  pendingRefill: false,
  readyCount: 3,
  remaining: 4,
};

const afterSnapshot: AcpDrillSnapshot = {
  answered: 1,
  asked: 1,
  declaredCount: 5,
  pendingRefill: false,
  readyCount: 2,
  remaining: 4,
};

const resolution: AcpDrillResolution = {
  chosenIndex: 1,
  correct: false,
  correctIndex: 0,
  correctOption: "correct",
  explanation: "Use the particle that marks the subject.",
  itemId: item.id,
};

interface Deferred<Value> {
  promise: Promise<Value>;
  reject: (error: Error) => void;
  resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  if (!(resolve && reject)) {
    throw new Error("deferred was not initialized");
  }
  return { promise, reject, resolve };
};

const fakeHandle = (): AcpSessionHandle => {
  const handle = new Handle("fake");
  handle.sessionId = "bridge-acp-session";
  handle.sessionActive = true;
  handle.healthy = true;
  return handle;
};

const pendingEvent = (requestId: string): AcpDrillItemEvent => ({
  drill_session_id: "bridge-drill-session",
  item: {
    anchors: [...item.anchors],
    id: item.id,
    itemType: item.itemType,
    level: item.level,
    options: [...item.options],
    passage: item.passage,
    prompt: item.prompt,
  },
  phase: "pending",
  request_id: requestId,
  session_id: "bridge-acp-session",
  snapshot,
  type: "drill_item",
});

const settlement = (): DrillSettlement => ({
  attempt: {
    at: "2026-09-25T00:00:00.000Z",
    chosenIndex: resolution.chosenIndex,
    correct: resolution.correct,
    id: 1,
    itemId: item.id,
    sessionId: "bridge-drill-session",
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
    sessionId: "bridge-drill-session",
    supersessionCount: 0,
  },
  verdict: {
    chosenIndex: resolution.chosenIndex,
    correct: resolution.correct,
    correctIndex: resolution.correctIndex,
    correctOption: resolution.correctOption ?? "correct",
    explanation: resolution.explanation ?? null,
  },
});

const makeHarness = (
  draw: DrillDrawResult,
  openedResult: DrillOpenResult = {
    kind: "unavailable",
    reason: "no-valid-items",
    snapshot: null,
  }
) => {
  const handle = fakeHandle();
  const parked = deferred<AcpDrillResolution>();
  const settleCalls: {
    chosenIndex: number;
    itemId: string;
    responseQuality: string;
    sessionId: string;
  }[] = [];
  const answerCalls: {
    requestId: string;
    resolution: AcpDrillResolution;
    snapshot: AcpDrillSnapshot;
  }[] = [];
  const parkCalls: {
    drillSessionId: string;
    item: Record<string, unknown>;
    key: string | undefined;
    snapshot: AcpDrillSnapshot;
  }[] = [];
  const pending = [pendingEvent("bridge-request")];
  const controller: DrillBridgeController = {
    answerDrillItem: (requestId, answer, nextSnapshot) => {
      answerCalls.push({
        requestId,
        resolution: answer,
        snapshot: nextSnapshot ?? snapshot,
      });
      parked.resolve(answer);
      return true;
    },
    handleFor: () => handle,
    listConfirmations: () => pending,
    parkDrillItem: (_handle, drillSessionId, nextItem, nextSnapshot, key) => {
      parkCalls.push({
        drillSessionId,
        item: nextItem as unknown as Record<string, unknown>,
        key,
        snapshot: nextSnapshot,
      });
      return { promise: parked.promise, requestId: "bridge-request" };
    },
    retireDrillItem: () => true,
  };
  const lifecycle: DrillLifecycle = {
    draw: async () => draw,
    end: async () => ({ ...settlement().snapshot, phase: "completed" }),
    open: async () => openedResult,
    pause: async () => settlement().snapshot,
    resume: async () => settlement().snapshot,
    settle: (input) => {
      settleCalls.push(input);
      return Promise.resolve(settlement());
    },
    skip: async () => settlement().snapshot,
    snapshot: async () => settlement().snapshot,
    supersede: async () => settlement().snapshot,
  };
  const settled: Parameters<SettleDrillPending>[] = [];
  const settlePending: SettleDrillPending = (...args) => {
    settled.push(args);
    return Promise.resolve();
  };
  const bridge = createDrillBridge({
    controller,
    getConversationSession: async (conversationId) =>
      conversationId === "bridge-conversation"
        ? { handle, sessionId: handle.sessionId }
        : null,
    getDrillSessionOwner: async (drillSessionId) =>
      drillSessionId === "bridge-drill-session"
        ? { conversationId: "bridge-conversation" }
        : null,
    lifecycle,
    settlePending,
  });
  return {
    answerCalls,
    bridge,
    controller,
    handle,
    parkCalls,
    parked,
    settleCalls,
    settled,
  };
};

const openResult: DrillDrawResult = {
  item,
  kind: "item",
  snapshot: {
    answered: 0,
    asked: 1,
    declaredCount: 5,
    generation: 0,
    maxPerType: 1,
    pendingRefill: false,
    phase: "active",
    readyCount: 3,
    remaining: 4,
    sessionId: "bridge-drill-session",
    supersessionCount: 0,
  },
};

describe("drill host bridge", () => {
  test("parks a key-free lifecycle item with a stable key", async () => {
    const harness = makeHarness(openResult);
    const first = await harness.bridge.park({
      conversationId: "bridge-conversation",
      drillSessionId: "bridge-drill-session",
    });
    const second = await harness.bridge.park({
      conversationId: "bridge-conversation",
      drillSessionId: "bridge-drill-session",
    });

    expect(first.requestId).toBe("bridge-request");
    expect(second.requestId).toBe("bridge-request");
    expect(harness.parkCalls[0]?.key).toMatch(STABLE_KEY_RE);
    expect(harness.parkCalls[1]?.key).toBe(harness.parkCalls[0]?.key);
    expect(harness.parkCalls[0]?.item).toEqual({
      anchors: ["grammar:particle"],
      id: item.id,
      itemType: item.itemType,
      level: item.level,
      options: item.options,
      passage: null,
      prompt: item.prompt,
    });
    expect(harness.parkCalls[0]?.item).not.toHaveProperty("answerIndex");
    expect(harness.parkCalls[0]?.item).not.toHaveProperty("script");
    expect(harness.parkCalls[0]?.item).not.toHaveProperty("fsrsVocabId");
  });

  test("publishes an honest unavailable card instead of falling back to prose", async () => {
    const harness = makeHarness(openResult);
    const published: AcpDrillItemEvent[] = [];
    const result = await harness.bridge.start(
      {
        anchors: ["grammar:particle"],
        conversationId: "bridge-conversation",
        count: 1,
        id: "unavailable-start",
        level: "N5",
        seed: "unavailable",
        tier: "2",
      },
      (_, event) => {
        published.push(event);
        return Promise.resolve();
      }
    );
    expect(result.kind).toBe("unavailable");
    expect(published).toHaveLength(1);
    expect(published[0]?.phase).toBe("unavailable");
    expect(published[0]?.item).toBeNull();
  });

  test("starts without a live ACP handle and keeps the direct card answerable", async () => {
    const harness = makeHarness(openResult, {
      draw: openResult,
      kind: "opened",
      snapshot: openResult.snapshot,
    });
    const published: AcpDrillItemEvent[] = [];
    const input: OpenDrillInput = {
      anchors: [],
      conversationId: "bridge-conversation",
      count: 1,
      id: "start-request",
      level: "N5",
      seed: "seed",
      tier: "drill",
    };
    const result = await harness.bridge.start(input, (_, event) => {
      published.push(event);
      return Promise.resolve();
    });

    expect(result.kind).toBe("opened");
    expect(published).toHaveLength(1);
    expect(published[0]?.item).not.toHaveProperty("answerIndex");
    expect(published[0]?.resolution).toBeUndefined();

    const answer = await harness.bridge.answer({
      chosenIndex: 1,
      conversationId: "bridge-conversation",
      itemId: item.id,
      requestId: published[0]?.request_id ?? "missing",
    });

    expect(answer.resolution).toEqual(resolution);
    expect(published).toHaveLength(3);
    expect(published[1]?.phase).toBe("answered");
    expect(published[1]?.resolution).toEqual(resolution);
    expect(published[2]?.phase).toBe("pending");
    expect(harness.answerCalls).toEqual([]);
    expect(harness.settleCalls).toHaveLength(1);
  });

  test("skips without grading and advances a direct session", async () => {
    const harness = makeHarness(openResult, {
      draw: openResult,
      kind: "opened",
      snapshot: openResult.snapshot,
    });
    const published: AcpDrillItemEvent[] = [];
    await harness.bridge.start(
      {
        anchors: ["grammar:particle"],
        conversationId: "bridge-conversation",
        count: 5,
        id: "skip-start",
        level: "N5",
        seed: "skip",
        tier: "2",
      },
      (_, event) => {
        published.push(event);
        return Promise.resolve();
      }
    );
    const result = await harness.bridge.skip({
      conversationId: "bridge-conversation",
      itemId: item.id,
      requestId: published[0]?.request_id ?? "missing",
    });
    expect(result.skipped).toBe(true);
    expect(published[1]?.phase).toBe("answered");
    expect(published[1]?.resolution?.skipped).toBe(true);
    expect(published[2]?.phase).toBe("pending");
    expect(harness.settleCalls).toEqual([]);
  });

  test("settles locally, resolves the park with the verdict, and patches the row", async () => {
    const harness = makeHarness(openResult);
    const output = await harness.bridge.answer({
      chosenIndex: 1,
      conversationId: "bridge-conversation",
      itemId: item.id,
      requestId: "bridge-request",
    });

    expect(harness.settleCalls).toEqual([
      {
        chosenIndex: 1,
        itemId: item.id,
        responseQuality: "standard",
        sessionId: "bridge-drill-session",
      },
    ]);
    expect(harness.answerCalls[0]?.requestId).toBe("bridge-request");
    expect(harness.answerCalls[0]?.resolution).toEqual(resolution);
    expect(harness.answerCalls[0]?.snapshot).toEqual(afterSnapshot);
    expect(harness.settled).toEqual([
      [
        "bridge-conversation",
        "bridge-request",
        "finish",
        {
          phase: "answered",
          resolution,
          snapshot: afterSnapshot,
        },
      ],
    ]);
    expect(output).toEqual({ resolution, snapshot: afterSnapshot });
  });

  test("stops a parked session with a real summary snapshot", async () => {
    const harness = makeHarness(openResult);
    await harness.bridge.park({
      conversationId: "bridge-conversation",
      drillSessionId: "bridge-drill-session",
    });

    const result = await harness.bridge.stop({
      conversationId: "bridge-conversation",
      requestId: "bridge-request",
    });

    expect(result.stopped).toBe(true);
    expect(harness.settled[0]?.[3]).toMatchObject({ phase: "summary" });
  });

  test("refuses a request from another conversation before settling", async () => {
    const harness = makeHarness(openResult);
    await expect(
      harness.bridge.answer({
        chosenIndex: 1,
        conversationId: "other-conversation",
        itemId: item.id,
        requestId: "bridge-request",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.settleCalls).toEqual([]);
    expect(harness.answerCalls).toEqual([]);
  });

  test("returns an honest unavailable result when the lifecycle has no item", async () => {
    const harness = makeHarness({
      kind: "unavailable",
      snapshot: settlement().snapshot,
    });
    await expect(
      harness.bridge.park({
        conversationId: "bridge-conversation",
        drillSessionId: "bridge-drill-session",
      })
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(harness.parkCalls).toEqual([]);
  });
});

type ToolReply = import("./host-tool-client").ToolReply;

const callNextDrillItem = (
  server: InstanceType<typeof AskToolServer>,
  token: string,
  drillSessionId = "bridge-drill-session"
): Promise<ToolReply> =>
  callHostTool(server, token, {
    arguments: { sessionId: drillSessionId },
    name: "next_drill_item",
  });

describe("next_drill_item host tool", () => {
  test("waits for the deferred pick before returning a result", async () => {
    const parked = deferred<AcpDrillResolution>();
    const server = new AskToolServer({
      park: () => ({
        promise: Promise.resolve("unused"),
        requestId: "unused",
      }),
      parkDrillItem: async () => ({
        promise: parked.promise,
        requestId: "tool-drill-request",
      }),
    });
    const token = server.tokenFor("bridge-conversation");
    const call = callNextDrillItem(server, token);
    const early = await Promise.race([
      call.then(() => "returned"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("waiting"), 25)
      ),
    ]);
    expect(early).toBe("waiting");

    parked.resolve(resolution);
    const reply = await call;
    expect(reply.isError).toBe(false);
    expect(JSON.parse(reply.text)).toEqual(resolution);
  });

  test("returns an honest error when the bridge is not configured", async () => {
    const server = new AskToolServer({
      park: () => ({
        promise: Promise.resolve("unused"),
        requestId: "unused",
      }),
    });
    const reply = await callNextDrillItem(
      server,
      server.tokenFor("bridge-conversation")
    );
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("not configured");
    expect(reply.text).not.toContain("answerIndex");
  });
});
