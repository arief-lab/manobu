/*
 * A typed engine turn-failure reaches the client legibly (TASK-102 AC#4/#6).
 *
 * `runTurn` swallows nothing: a controller rejection carrying a `code`
 * (AUTH_REQUIRED from a session open, CONFIG_SWITCH_FAILED from a refused
 * cold switch — both surface through the same catch) must be projected onto
 * the terminal `turn_end` frame WITH its message, persisted, and replayed as
 * a `finish` frame the client can render. Before this the terminal frame
 * dropped the message, so a failed turn showed a bare error with nothing to
 * read. Driven over the real sidecar WS so every layer (catch -> sink ->
 * FRAME_CONTENT -> wire) is production code; only the controller throws.
 *
 * `chatErrorStatusMap` is asserted alongside: the synchronous `agentModels`
 * 401 is the other half of the same AUTH_REQUIRED contract.
 */

import { describe, expect, it } from "bun:test";

// Required env before src imports load (Bun hoists statics; see chat-e2e).
process.env.CORS_ORIGIN = "http://localhost:3000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider, getUserDb } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("chat-turn-error");
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

const { createRpcHandlers } = await import("../src/rpc");
const { chatErrorStatusMap } = await import("../src/rpc");
const { bootChatServer } = await import("./harness");

type ChatController = import("../src/chat-rpc").ChatController;
type AcpSessionHandle = import("@manobu/acp/session-types").AcpSessionHandle;
type AcpStreamEvent = import("@manobu/acp/acp-events").AcpStreamEvent;

function minimalHandle(): AcpSessionHandle {
  const handle = {
    healthy: true,
    sessionActive: true,
    sessionId: "fake-turn-error",
  } as unknown as AcpSessionHandle;
  return handle;
}

/** A controller whose `prompt` throws a coded engine rejection; the rest are
 * inert because the test only drives send -> subscribe -> finish. */
function throwingController(error: unknown): ChatController {
  return {
    answerAsk: () => true,
    cancel: async () => true,
    configOptions: async () => [],
    confirm: () => true,
    dispose: async () => undefined,
    handleFor: () => null,
    killTerminal: () => false,
    listConfirmations: () => [],
    prompt: async (
      _handle: AcpSessionHandle,
      input: {
        content?: unknown;
        sink: (event: AcpStreamEvent) => Promise<void>;
      }
    ) => {
      // Emit the turn start first: the failure comes AFTER the session was
      // open and the turn began, exactly as a mid-turn auth/switch rejection.
      await input.sink({
        session_id: "fake-turn-error",
        type: "turn_start",
      } as unknown as AcpStreamEvent);
      throw error;
    },
  };
}

async function finishFrameFor(
  conversationId: string,
  error: unknown
): Promise<Record<string, unknown>> {
  const db = await getUserDb();
  const handle = minimalHandle();
  const router = createRpcHandlers({
    controller: throwingController(error),
    resolveHandle: () => Promise.resolve(handle),
  });
  const server = await bootChatServer({
    agent: { handle, script: new Map() },
    db,
    router,
  });
  try {
    const { ws } = server.clients;
    const iterator = await ws.chat.subscribe({ conversationId });
    const frames: unknown[] = [];
    const collect = (async () => {
      for (;;) {
        // biome-ignore lint/performance/noAwaitInLoops: poll the async iterator
        const { done, value } = await iterator.next();
        if (done) {
          break;
        }
        frames.push(value);
      }
    })();
    await ws.chat.send({
      conversationId,
      messages: [{ content: "hi", role: "user" }],
    });
    await collect;
    const finish = frames.at(-1) as
      | { data?: unknown; type?: string }
      | undefined;
    expect(finish?.type).toBe("finish");
    return (finish?.data ?? {}) as Record<string, unknown>;
  } finally {
    await server.close();
  }
}

describe("typed turn failure -> wire finish frame", () => {
  it("projects an AUTH_REQUIRED code and its message onto the terminal frame", async () => {
    const error = Object.assign(
      new Error('agent "claude" needs you to sign in'),
      {
        code: "AUTH_REQUIRED",
      }
    );
    const data = await finishFrameFor("conv-auth", error);
    const wireError = data.error as { code?: string; message?: string };
    expect(wireError.code).toBe("AUTH_REQUIRED");
    expect(wireError.message).toContain("needs you to sign in");
    expect(data.stopReason).toBe("error");
  });

  it("projects a CONFIG_SWITCH_FAILED code and message the same way", async () => {
    const error = Object.assign(
      new Error(
        'model switch to "gpt-9" was rejected by the agent: not offered'
      ),
      { code: "CONFIG_SWITCH_FAILED" }
    );
    const data = await finishFrameFor("conv-switch", error);
    const wireError = data.error as { code?: string; message?: string };
    expect(wireError.code).toBe("CONFIG_SWITCH_FAILED");
    expect(wireError.message).toContain('model switch to "gpt-9"');
    expect(data.stopReason).toBe("error");
  });

  it("an unclassified failure keeps its message and carries no code", async () => {
    const data = await finishFrameFor(
      "conv-generic",
      new Error("connection closed unexpectedly")
    );
    const wireError = data.error as { code?: string; message?: string };
    expect(wireError.code).toBeUndefined();
    expect(wireError.message).toBe("connection closed unexpectedly");
  });
});

describe("AUTH_REQUIRED HTTP contract", () => {
  it("maps the sync agentModels error to 401 and the switch to 400", () => {
    expect(chatErrorStatusMap.AUTH_REQUIRED).toBe(401);
    expect(chatErrorStatusMap.CONFIG_SWITCH_FAILED).toBe(400);
  });
});
