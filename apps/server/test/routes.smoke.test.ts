import { describe, expect, it } from "bun:test";

// Set required env vars before importing index.ts (which imports @manobu/env/server)
process.env.CORS_ORIGIN = "http://localhost:3000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider, getUserDb } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("routes.smoke");
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

const { aiRoutes } = await import("../src/index");

/** UUID (turn_id/msg_id) wire shape — assert against it, not an inline regex. */
const UUID_RE = /^[0-9a-f-]+$/;

/**
 * `Response.json()` returns `Promise<unknown>` since Hono 4.
 * Smoke tests only need a few fields — type the call site once instead of
 * every `as { ... }` cast downstream.
 */
const jsonAs = async <T>(res: Response): Promise<T> => (await res.json()) as T;

describe("route smoke tests (app.request)", () => {
  it("GET /kanji returns 400 when neither character nor level", async () => {
    const { createJapDataRoute } = await import("../src/routes/jap-data");
    const japData = createJapDataRoute();
    const res = await japData.request("/kanji");
    expect(res.status).toBe(400);
  });

  it("GET /kanji?level=N5 returns the N5 list (TASK-37 index grid)", async () => {
    const { createJapDataRoute } = await import("../src/routes/jap-data");
    const japData = createJapDataRoute();
    const res = await japData.request("/kanji?level=N5");
    expect(res.status).toBe(200);
    const json = await jsonAs<{
      level: string;
      rows: Array<{ character: string; strokeCount: number }>;
    }>(res);
    expect(json.level).toBe("N5");
    expect(json.rows.length).toBeGreaterThan(50);
    expect(json.rows[0]?.character).toBeTruthy();
  });

  it("GET /kanji?character=食 returns kanji data", async () => {
    const { createJapDataRoute } = await import("../src/routes/jap-data");
    const japData = createJapDataRoute();
    const res = await japData.request("/kanji?character=食");
    expect(res.status).toBe(200);
    const json = await jsonAs<{
      character: string;
      jlpt: string | null;
    }>(res);
    expect(json.character).toBe("食");
    expect(json.jlpt).toBeTruthy();
  });

  it("GET /grammar returns grammar list", async () => {
    const { createJapDataRoute } = await import("../src/routes/jap-data");
    const japData = createJapDataRoute();
    const res = await japData.request("/grammar?level=N5");
    expect(res.status).toBe(200);
    const json = await jsonAs<{ grammar: unknown[] }>(res);
    expect(Array.isArray(json.grammar)).toBe(true);
    expect(json.grammar.length).toBeGreaterThan(0);
  });

  it("GET /learn/nextCards returns next cards (mount-relative, TASK-45)", async () => {
    const { createLearnChatRoute } = await import("../src/routes/learn-chat");
    const learnChat = createLearnChatRoute();
    // Route paths are relative to the /learn mount in index.ts — request
    // through the mounted app, the same shape production serves.
    const mounted = learnChat.route("/learn", learnChat);
    const res = await mounted.request("/learn/nextCards?level=N5");
    expect(res.status).toBe(200);
    const json = await jsonAs<{ nextCards: unknown[] }>(res);
    expect(Array.isArray(json.nextCards)).toBe(true);
  });
});

describe("chained top-level routes (AppType)", () => {
  it("GET / returns OK", async () => {
    const res = await aiRoutes.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("GET /agents returns agent list", async () => {
    const res = await aiRoutes.request("/agents");
    expect(res.status).toBe(200);
    const json = await jsonAs<{ agents: unknown[] }>(res);
    expect(Array.isArray(json.agents)).toBe(true);
  });

  it("GET /assistants returns persona list", async () => {
    const res = await aiRoutes.request("/assistants");
    expect(res.status).toBe(200);
    const json = await jsonAs<{
      assistants: unknown[];
      default: string;
    }>(res);
    expect(Array.isArray(json.assistants)).toBe(true);
    expect(json.default).toBeTruthy();
  });

  it.skip("GET /agents/:id/models needs warm ACP session (skipped)", async () => {
    const res = await aiRoutes.request("/agents/claude-code/models");
    expect([200, 404]).toContain(res.status);
  });

  it("chat: send on a valid conversation returns a turn ack over the WS link", async () => {
    const { AcpSessionHandle } = await import("@manobu/acp/session-types");
    const { createRpcHandlers } = await import("../src/rpc");
    const { bootChatServer } = await import("./harness");

    const db = await getUserDb();
    const handle = new AcpSessionHandle("fake");
    handle.sessionId = "smoke-conv";
    handle.sessionActive = true;
    handle.healthy = true;

    // Minimal fake controller: emits one text frame + finish.
    const controller = {
      answerAsk: (
        _requestId: string,
        _payload: { answers?: unknown[]; decline?: boolean }
      ) => false,
      cancel: async (_sessionId: string, _turnId?: string) => true,
      configOptions: async (_handle: unknown, _patch?: unknown) =>
        [] as import("@manobu/acp/acp-events").AcpConfigOption[],
      confirm: (_callId: string, _optionId: string) => true,
      handleFor: (_sessionId: string) => handle,
      killTerminal: (_terminalId: string) => false,
      listConfirmations: (_sessionId: string) =>
        [] as import("@manobu/acp/acp-events").AcpStreamEvent[],
      prompt: async (
        _h: unknown,
        input: { content?: unknown; sink: (e: unknown) => Promise<void> }
      ): Promise<{ stopReason: string; usage: unknown }> => {
        await input.sink({ session_id: "fake", type: "turn_start" });
        await input.sink({
          content: { text: "smoke reply", type: "text" },
          message_id: "m",
          type: "text",
        });
        await input.sink({
          stopReason: "end_turn",
          type: "turn_end",
          usage: null,
        });
        return { stopReason: "end_turn", usage: null };
      },
    } as unknown as import("../src/chat-rpc").ChatController;

    const router = createRpcHandlers({
      controller,
      resolveHandle: () => Promise.resolve(handle),
    });
    const server = await bootChatServer({
      agent: { handle, script: new Map() },
      db,
      router,
    });
    try {
      const ack = await server.clients.ws.chat.send({
        conversationId: "smoke-conv",
        messages: [{ content: "hi", role: "user" }],
      });
      expect(ack.turn_id).toMatch(UUID_RE);
      expect(ack.msg_id).toMatch(UUID_RE);
    } finally {
      await server.close();
    }
  });

  it("GET /nonexistent returns 404", async () => {
    const res = await aiRoutes.request("/nonexistent");
    expect(res.status).toBe(404);
  });
});
