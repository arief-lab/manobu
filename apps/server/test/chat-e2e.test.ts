/*
 * Fake-agent end-to-end tests for the native-ACP chat surface (TASK-80.2).
 *
 * The suite runs over a REAL live WebSocket: `bootChatServer` boots the
 * production Bun.serve fetch+websocket hooks, and the WS link dials /ws
 * through `@orpc/client/websocket`. A scripted `controller` replaces the
 * real `SessionController` (the fake injects frame sequences and parked
 * permissions/asks instead of spawning a child). No package imports
 * apps/server — the router is assembled here, satisfying the no-boundary-
 * inversion rule.
 */

import { describe, expect, it } from "bun:test";

// Required env must be set before src imports run (index.ts loads
// @manobu/env/server). Bun hoists static imports, so the src modules are
// loaded dynamically AFTER this file's env setup.
process.env.CORS_ORIGIN = "http://localhost:3000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider, getUserDb } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("chat-e2e");
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

const { AcpSessionHandle } = await import("@manobu/acp/session-types");
type AcpSessionHandle = import("@manobu/acp/session-types").AcpSessionHandle;
type AcpConfigOption = import("@manobu/acp/acp-events").AcpConfigOption;
type AcpStreamEvent = import("@manobu/acp/acp-events").AcpStreamEvent;
type AcpPermissionOption = import("@manobu/acp/acp-events").AcpPermissionOption;
type AcpAskQuestion = import("@manobu/acp/acp-events").AcpAskQuestion;
type ChatController = import("../src/chat-rpc").ChatController;

const { createRpcHandlers } = await import("../src/rpc");
const { bootChatServer } = await import("./harness");
type FakeAgent = import("./harness").FakeAgent;
type ChatClient = import("./harness").ChatClients["ws"];
type ChatServer = import("./harness").ChatServer;

/** UUID (turn_id/msg_id) wire shape — assert against it, not an inline regex. */
const UUID_RE = /^[0-9a-f-]+$/;

/** A fake ACP session handle backed by no real child. */
function fakeHandle(agentId: string, sessionId: string): AcpSessionHandle {
  const handle = new AcpSessionHandle(agentId);
  handle.sessionId = sessionId;
  handle.sessionActive = true;
  handle.healthy = true;
  return handle;
}

/** Shared boot: fake agent → controller → router → in-process WS server.
 * `resolveHandle` defaults to the agent's handle; tests that need the
 * stored-session seam pass their own (AC#4/AC#11/AC#12). */
function bootFakeChat(
  db: Awaited<ReturnType<typeof getUserDb>>,
  agent: FakeAgent,
  resolveHandle?: () => Promise<AcpSessionHandle>
): Promise<ChatServer> {
  const controller = fakeController(agent);
  const router = createRpcHandlers({
    controller,
    resolveHandle: resolveHandle ?? (() => Promise.resolve(agent.handle)),
  });
  return bootChatServer({ agent, db, router });
}

/** The single allow-once permission option the fake agents offer. */
const ALLOW_ONCE_OPTION: {
  kind: string;
  name?: string;
  optionId: string;
}[] = [{ kind: "allow_once", name: "Allow once", optionId: "allow_once" }];

/**
 * Collect frames from `chat.subscribe` until the conversation reaches its
 * terminal frame (the generator closes there).
 */
async function collectFrames(
  ws: ChatClient,
  conversationId: string
): Promise<unknown[]> {
  const frames: unknown[] = [];
  const iterator = await ws.chat.subscribe({ conversationId });
  try {
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: an async iterator MUST be polled one `next()` at a time; the drop test asserts on frames collected so far, and `Promise.all` would not work on an iterator that closes on the terminal frame.
      const { done, value } = await iterator.next();
      if (done) {
        break;
      }
      frames.push(value);
    }
  } catch {
    // Socket closed mid-iteration (a drop test); frames so far are the
    // assertion target.
  }
  return frames;
}

describe("chat surface (TASK-80.2) — live WebSocket", () => {
  it("AC#1: send→ack, subscribe→start/content/finish, resubscribe replays then closes", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-conv-1"),
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { ws } = server.clients;
      // Subscribe first so the live frames land on the conversation hub.
      const subPromise = collectFrames(ws, "conv-1");
      const ack = await ws.chat.send({
        conversationId: "conv-1",
        messages: [{ content: "hi", role: "user" }],
      });
      expect(ack.turn_id).toMatch(UUID_RE);
      expect(ack.msg_id).toMatch(UUID_RE);

      const live = await subPromise;
      const types = live.map((f) => (f as { type: string }).type);
      expect(types).toContain("start");
      expect(types).toContain("content");
      expect(types).toContain("finish");
      for (const frame of live) {
        expect((frame as { conversation_id: string }).conversation_id).toBe(
          "conv-1"
        );
        expect(typeof (frame as { msg_id: string }).msg_id).toBe("string");
      }

      // Resubscribe: the persisted frames replay, then close on the terminal.
      const replay = await collectFrames(ws, "conv-1");
      expect(
        replay.some((f) => (f as { type: string }).type === "content")
      ).toBe(true);
      expect((replay.at(-1) as { type: string }).type).toBe("finish");
    } finally {
      await server.close();
    }
  });

  it("TASK-101: a turn names the conversation, and no later turn renames it", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-naming"),
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { fetch, ws } = server.clients;
      // Whitespace collapses; the row is named at send time, so the ack
      // already implies a listable conversation. Each turn is awaited to its
      // terminal frame so the next `send` on that conversation is not busy.
      const first = collectFrames(ws, "conv-naming");
      const ack = await ws.chat.send({
        conversationId: "conv-naming",
        messages: [{ content: "  halo   apa   kabar  ", role: "user" }],
      });
      expect(ack.turn_id).toMatch(UUID_RE);
      await first;
      const named = await fetch.chat.getConversation({
        conversationId: "conv-naming",
      });
      expect(named.title).toBe("halo apa kabar");

      // A long first prompt is truncated to a list row, not a UUID.
      const long = collectFrames(ws, "conv-long");
      await ws.chat.send({
        conversationId: "conv-long",
        messages: [
          {
            content: `Belajar kanshi ${"dasar ".repeat(20)}`.trim(),
            role: "user",
          },
        ],
      });
      await long;
      const truncated = await fetch.chat.getConversation({
        conversationId: "conv-long",
      });
      expect(truncated.title?.length).toBe(60);
      expect(truncated.title?.endsWith("…")).toBe(true);
      expect(truncated.title?.startsWith("Belajar kanshi")).toBe(true);

      // The second turn must not overwrite the name the first one gave.
      const second = collectFrames(ws, "conv-naming");
      await ws.chat.send({
        conversationId: "conv-naming",
        messages: [{ content: "lanjutkan", role: "user" }],
      });
      await second;
      const again = await fetch.chat.getConversation({
        conversationId: "conv-naming",
      });
      expect(again.title).toBe("halo apa kabar");
      // A turn is activity: the conversation this one just moved ahead of
      // the other conversation in this test. (Ranked against its sibling
      // rather than the whole table: the store's in-memory db is shared
      // with the other server test files in this process.)
      const page = await fetch.chat.listConversations({ limit: 100 });
      const ids = page.conversations.map((row) => row.id);
      expect(ids.indexOf("conv-naming")).toBeLessThan(ids.indexOf("conv-long"));
    } finally {
      await server.close();
    }
  });

  it("AC#2: permission frame appears, confirm unblocks the turn", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-p"),
      permission: {
        callId: "call-1",
        options: ALLOW_ONCE_OPTION,
      },
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { ws } = server.clients;
      const subPromise = collectFrames(ws, "conv-p");
      await ws.chat.send({
        conversationId: "conv-p",
        messages: [{ content: "go", role: "user" }],
      });
      // The turn parks on the permission; confirm releases it.
      const confirm = await ws.chat.confirm({
        callId: "call-1",
        conversationId: "conv-p",
        data: "allow_once",
      });
      expect(confirm.settled).toBe(true);

      const all = await subPromise;
      expect(
        all.some((f) => (f as { type: string }).type === "acp_permission")
      ).toBe(true);
      expect((all.at(-1) as { type: string }).type).toBe("finish");
    } finally {
      await server.close();
    }
  });

  it("AC#3: ask frame, answerAsk resumes, listConfirmations rebuilds the card", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      ask: {
        questions: [{ options: [{ label: "N5" }], question: "What level?" }],
        requestId: "ask-1",
      },
      handle: fakeHandle("fake", "fake-a"),
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { ws } = server.clients;
      const subPromise = collectFrames(ws, "conv-a");
      await ws.chat.send({
        conversationId: "conv-a",
        messages: [{ content: "study", role: "user" }],
      });
      const answer = await ws.chat.answerAsk({
        answers: [{ labels: ["N5"], question: "What level?" }],
        conversationId: "conv-a",
        requestId: "ask-1",
      });
      expect(answer.settled).toBe(true);
      const all = await subPromise;
      expect(all.some((f) => (f as { type: string }).type === "ask")).toBe(
        true
      );
      expect((all.at(-1) as { type: string }).type).toBe("finish");
      // TASK-86: the settled ask row carries status "finish" and the
      // persisted answer summary in its content (listMessages serves the
      // raw row; the subscribe replay projects the same content into the
      // wire frame with its status).
      const { messages } = await server.clients.fetch.chat.listMessages({
        conversationId: "conv-a",
      });
      const askRow = messages.find((m) => m.type === "ask");
      expect(askRow?.status).toBe("finish");
      const askContent = JSON.parse(askRow?.content ?? "{}") as {
        answers?: { labels: string[]; question: string }[];
        declined?: boolean;
      };
      expect(askContent.answers).toEqual([
        { labels: ["N5"], question: "What level?" },
      ]);
      expect(askContent.declined).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("AC#4: cancel releases the gate; a socket drop alone does not cancel", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-c"),
      permission: {
        callId: "call-c",
        options: ALLOW_ONCE_OPTION,
      },
      script: new Map(),
    };
    // Production persists the conversation's session id on first use
    // (`ensureAcp` → `setUserAcpSessionId`); the fake skips the engine, so
    // the seam persists it here — the cancel path resolves the live
    // handle through the stored id without respawning.
    const { setUserAcpSessionId } = await import("../src/chat-store");
    const server = await bootFakeChat(db, agent, async () => {
      await setUserAcpSessionId("conv-c", agent.handle.sessionId);
      return agent.handle;
    });
    try {
      const { ws } = server.clients;
      const subPromise = collectFrames(ws, "conv-c");
      await ws.chat.send({
        conversationId: "conv-c",
        messages: [{ content: "x", role: "user" }],
      });
      // A second send is rejected while the first holds the gate.
      let busyCode: string | undefined;
      try {
        await ws.chat.send({
          conversationId: "conv-c",
          messages: [{ content: "y", role: "user" }],
        });
      } catch (e) {
        busyCode = (e as { code?: string }).code;
      }
      expect(busyCode).toBe("CONVERSATION_BUSY");
      // Cancel releases the gate.
      const cancel = await ws.chat.cancel({
        conversationId: "conv-c",
        turnId: "any",
      });
      expect(cancel.cancelled).toBe(true);
      await subPromise;
    } finally {
      await server.close();
    }
  });

  it("AC#5: conversations persist across a server restart via chat.listMessages", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-r"),
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    const subPromise = collectFrames(server.clients.ws, "conv-r");
    await server.clients.ws.chat.send({
      conversationId: "conv-r",
      messages: [{ content: "persist me", role: "user" }],
    });
    const frames = await subPromise;
    expect((frames.at(-1) as { type: string }).type).toBe("finish");
    await server.close();

    // Restart: a fresh server on the SAME db; in-memory state is gone,
    // but the persisted rows survive.
    const server2 = await server.restart();
    try {
      const { messages } = await server2.clients.fetch.chat.listMessages({
        conversationId: "conv-r",
      });
      expect(messages.some((m) => m.type === "content")).toBe(true);
      expect(messages.at(-1)?.type).toBe("finish");
    } finally {
      await server2.close();
    }
  });

  it("AC#6: terminal-output snapshots stream live via the hub lane + kill round-trips", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-t"),
      script: new Map(),
      terminal: { command: "npm test", id: "term-e2e", output: "1 passed" },
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { ws } = server.clients;
      const subPromise = collectFrames(ws, "conv-t");
      await ws.chat.send({
        conversationId: "conv-t",
        messages: [{ content: "run it", role: "user" }],
      });
      const all = await subPromise;
      // The live lane delivered the terminal snapshots (stream-only: they
      // are NOT in the persisted replay, but the live subscriber saw them).
      // The lane coalesces same-terminal snapshots (last-writer-wins), so
      // assert at-least-one plus the DETERMINISTIC property: the last
      // cumulative snapshot carries the exit status.
      const terminals = all.filter(
        (f) => (f as { type: string }).type === "acp_terminal_output"
      );
      expect(terminals.length).toBeGreaterThanOrEqual(1);
      const last = terminals.at(-1) as { data: { exit_status: unknown } };
      expect(last.data.exit_status).toEqual({ exit_code: 0, signaled: false });
      expect(all.some((f) => (f as { type: string }).type === "finish")).toBe(
        true
      );

      // killTerminal RPC round-trips the right terminal id.
      const kill = await ws.chat.killTerminal({
        conversationId: "conv-t",
        terminalId: "term-e2e",
      });
      expect(kill.killed).toBe(true);
      expect(agent.terminalKilled).toBe("term-e2e");

      // Stream-only: a resubscribe replay carries no terminal rows (the
      // 0006 DDL skips them), only the persisted tail.
      const replay = await collectFrames(ws, "conv-t");
      expect(
        replay.some(
          (f) => (f as { type: string }).type === "acp_terminal_output"
        )
      ).toBe(false);
      expect((replay.at(-1) as { type: string }).type).toBe("finish");
    } finally {
      await server.close();
    }
  });

  it("AC#2 (80.5): the fake agent's commands + config options round-trip via the fetch procedures", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      configOptions: [
        {
          currentValue: "sonnet",
          id: "model",
          options: [{ value: "sonnet" }, { value: "opus" }],
          type: "select",
        },
        {
          currentValue: "default",
          id: "mode",
          options: [{ value: "default" }, { value: "plan" }],
          type: "select",
        },
      ],
      handle: fakeHandle("fake", "fake-cfg"),
      script: new Map(),
    };
    agent.handle.slashCommands = [
      { description: "Review the diff", name: "review" },
    ];
    const server = await bootFakeChat(db, agent);
    try {
      const { fetch } = server.clients;
      // Seed the session-id gate: the conversation row exists and the
      // ACP sessionId is stored (normally persisted by the first
      // `send`'s `ensureAcp`; here the fake path skips the engine).
      const { ensureConversation, setUserAcpSessionId } = await import(
        "../src/chat-store"
      );
      await ensureConversation("conv-cfg", {});
      await setUserAcpSessionId("conv-cfg", "fake-cfg");

      // The fake agent's available_commands surface in the procedure.
      const { commands } = await fetch.chat.slashCommands({
        conversationId: "conv-cfg",
      });
      expect(commands.map((c) => c.name)).toContain("review");

      // The model switch round-trips into the option's currentValue.
      const modelRes = await fetch.chat.setConfigOption({
        conversationId: "conv-cfg",
        optionId: "model",
        value: "opus",
      });
      expect(
        modelRes.configOptions.find((o) => o.id === "model")?.currentValue
      ).toBe("opus");

      // The mode selector's values + a mode round-trip.
      const modeRes = await fetch.chat.setConfigOption({
        conversationId: "conv-cfg",
        optionId: "mode",
        value: "plan",
      });
      const mode = modeRes.configOptions.find((o) => o.id === "mode");
      expect(mode?.currentValue).toBe("plan");
      expect(mode?.options.map((o) => o.value)).toEqual(["default", "plan"]);
    } finally {
      await server.close();
    }
  });

  it("AC#11: listConfirmations rebuilds the pending-card recovery payload over /ws", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-lc"),
      permission: {
        callId: "call-lc",
        options: ALLOW_ONCE_OPTION,
      },
      script: new Map(),
    };
    // Production persists the conversation's session id on first use
    // (`ensureAcp` → `setUserAcpSessionId`); the fake skips the engine, so
    // the seam persists it here — listConfirmations resolves the live
    // handle through the stored id without respawning.
    const { setUserAcpSessionId } = await import("../src/chat-store");
    const server = await bootFakeChat(db, agent, async () => {
      await setUserAcpSessionId("conv-lc", agent.handle.sessionId);
      return agent.handle;
    });
    try {
      const { ws } = server.clients;
      const subPromise = collectFrames(ws, "conv-lc");
      await ws.chat.send({
        conversationId: "conv-lc",
        messages: [{ content: "go", role: "user" }],
      });

      // Over /ws the live-turn surface is exposed (the AC#1 handler filter
      // admits chat.listConfirmations). The fake parks inside the
      // fire-and-forget turn, so poll the recovery procedure until the
      // parked card is visible (a real reload/recovery wait).
      let recovery = await ws.chat.listConfirmations({
        conversationId: "conv-lc",
      });
      for (let i = 0; i < 200 && recovery.confirmations.length === 0; i += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: the fake parks the card inside the fire-and-forget turn, so a sequential re-poll of the recovery procedure is the only way to observe it going visible; Promise.all cannot order a one-sided procedure re-call.
        await new Promise((resolve) => setTimeout(resolve, 25));
        recovery = await ws.chat.listConfirmations({
          conversationId: "conv-lc",
        });
      }
      expect(recovery.confirmations.map((c) => c.type)).toEqual([
        "acp_permission",
      ]);
      expect(recovery.confirmations.every((c) => UUID_RE.test(c.msg_id))).toBe(
        true
      );
      expect(recovery.turn_id).toBeNull();

      // Releasing the park clears the recovery payload again.
      const confirm = await ws.chat.confirm({
        callId: "call-lc",
        conversationId: "conv-lc",
        data: "allow_once",
      });
      expect(confirm.settled).toBe(true);
      const cleared = await ws.chat.listConfirmations({
        conversationId: "conv-lc",
      });
      expect(cleared.confirmations).toEqual([]);

      const all = await subPromise;
      expect((all.at(-1) as { type: string }).type).toBe("finish");
    } finally {
      await server.close();
    }
  });

  it("80.10: a dropped subscriber stops the drain, not the turn", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-drop"),
      permission: {
        callId: "call-drop",
        options: ALLOW_ONCE_OPTION,
      },
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    const { resetDrainReads, getDrainReads } = await import(
      "../src/chat-store"
    );
    const { RPCLink } = await import("@orpc/client/websocket");
    const { createORPCClient } = await import("@orpc/client");
    try {
      // A second WS client the test owns (the harness `ws` link keeps its
      // socket open so it can settle the turn below): one RPCLink over a
      // socket this case can close.
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      const link = new RPCLink({
        connect: () => socket,
      }) as unknown as import("@orpc/client").ClientLink<
        typeof import("@manobu/api-contract").contract
      >;
      const local = createORPCClient(link, {
        context: server.context,
      } as never) as unknown as import("@manobu/api-contract").ContractClient;

      resetDrainReads();
      // Subscribe first: the server-side drain starts at call time, so
      // the send's live frames have a drain to land on (AC#1 shape).
      const iterator = await local.chat.subscribe({
        conversationId: "conv-drop",
      });
      await local.chat.send({
        conversationId: "conv-drop",
        messages: [{ content: "go", role: "user" }],
      });
      // The first live frame is the user row the drain just yielded
      // (TASK-107: the prompt is emitted ahead of the agent's `start`).
      const { value: first } = await iterator.next();
      expect((first as { type: string }).type).toBe("user_created");
      // The turn parks on the permission: it will outlive this socket.

      // Drop the subscriber: closing the socket aborts the in-flight
      // `chat.subscribe` (oRPC's per-request signal), and the drain must
      // stop re-reading the tail with it.
      socket.close();
      // Let the abort settle before the baseline: a read in flight at
      // close time is already counted (the counter bumps at read entry).
      await new Promise((resolve) => setTimeout(resolve, 100));
      const baseline = getDrainReads();

      // AC#4 preserved: the drop did not cancel the turn. Confirming over
      // the harness's still-open `ws` client settles the parked permission.
      const confirm = await server.clients.ws.chat.confirm({
        callId: "call-drop",
        conversationId: "conv-drop",
        data: "allow_once",
      });
      expect(confirm.settled).toBe(true);

      // The turn ran to completion: the terminal row persisted.
      let settled = false;
      for (let i = 0; i < 200 && !settled; i += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: poll the persisted tail for the turn's terminal row; the drain under test must not be the one that reads it.
        await new Promise((resolve) => setTimeout(resolve, 25));
        const { messages } = await server.clients.fetch.chat.listMessages({
          conversationId: "conv-drop",
        });
        settled = messages.some((m) => m.type === "finish");
      }
      expect(settled).toBe(true);

      // The drain stopped with the socket: no `listFramesAfter` read
      // after the baseline (a leaked drain re-reads the tail on the
      // permission-resolved + finish pulses the settling turn publishes).
      expect(getDrainReads()).toBe(baseline);
    } finally {
      await server.close();
    }
  }, 15_000);

  it("80.11: /rpc maps the chat error codes to 409 / 400 / 404 over HTTP", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      configOptions: [
        {
          currentValue: "sonnet",
          id: "model",
          options: [{ value: "sonnet" }, { value: "opus" }],
          type: "select",
        },
      ],
      handle: fakeHandle("fake", "fake-err"),
      permission: {
        callId: "call-err",
        options: ALLOW_ONCE_OPTION,
      },
      rejectConfigOption: { optionId: "model", value: "opus" },
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      // The raw-fetch wire shape of the /rpc link: a JSON
      // `{"json": <input>}` body (RPCJsonSerializer envelope); only the
      // status code is asserted.
      const rpcPost = async (path: string, body: unknown) =>
        await fetch(`http://127.0.0.1:${server.port}/rpc/${path}`, {
          body: JSON.stringify({ json: body }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });

      // (a) NOT_FOUND keeps 404 via the common map (a session-less
      // conversation; regression check on the spread).
      const notFound = await rpcPost("chat/slashCommands", {
        conversationId: "conv-err-nf",
      });
      expect(notFound.status).toBe(404);

      // (b) A second send on a parking turn is CONVERSATION_BUSY → 409.
      const subPromise = collectFrames(server.clients.ws, "conv-err");
      await server.clients.ws.chat.send({
        conversationId: "conv-err",
        messages: [{ content: "hold", role: "user" }],
      });
      // The parked permission holds the per-conversation gate.
      let busyCode: string | undefined;
      try {
        await server.clients.ws.chat.send({
          conversationId: "conv-err",
          messages: [{ content: "again", role: "user" }],
        });
      } catch (e) {
        busyCode = (e as { code?: string }).code;
      }
      expect(busyCode).toBe("CONVERSATION_BUSY");

      // The same gate over raw HTTP: the second send lands as a 409
      // response, not the 500 default.
      const busy = await rpcPost("chat/send", {
        conversationId: "conv-err",
        messages: [{ content: "again", role: "user" }],
      });
      expect(busy.status).toBe(409);

      // Release the park so the finally can settle the turn.
      const { settled } = await server.clients.ws.chat.confirm({
        callId: "call-err",
        conversationId: "conv-err",
        data: "allow_once",
      });
      expect(settled).toBe(true);
      await subPromise;

      // (c) A rejected config switch is CONFIG_SWITCH_FAILED → 400.
      const { ensureConversation, setUserAcpSessionId } = await import(
        "../src/chat-store"
      );
      await ensureConversation("conv-err-cfg", {});
      await setUserAcpSessionId("conv-err-cfg", "fake-err");

      const rejected = await rpcPost("chat/setConfigOption", {
        conversationId: "conv-err-cfg",
        optionId: "model",
        value: "opus",
      });
      expect(rejected.status).toBe(400);

      // Cross-check the body carries the typed code (defined + code),
      // not just a status.
      const rejectedBody = (await rejected.json()) as {
        json?: { code?: string };
      };
      expect(rejectedBody.json?.code).toBe("CONFIG_SWITCH_FAILED");
    } finally {
      await server.close();
    }
  }, 20_000);

  it("80.14 AC#1: a 25-frame burst (12 tool calls) streams fully and terminates — the opencode C1 wedge cannot recur", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      burst: { terminalId: "term-burst", texts: 10, toolCalls: 12 },
      handle: fakeHandle("fake", "fake-burst"),
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { ws } = server.clients;
      const subPromise = collectFrames(ws, "conv-burst");
      await ws.chat.send({
        conversationId: "conv-burst",
        messages: [{ content: "burst", role: "user" }],
      });
      // The 2026-09-19 wedge: a multi-tool burst finished server-side while
      // the drain sat in a lost-pulse wait — finish in the DB, iterator
      // silent forever. The ring design delivers every frame and terminates.
      const all = (await subPromise) as { type: string }[];
      // 24 = start + 12 tool cards + 10 collapsed text cards + finish; the
      // terminal-output snapshot rides the coalescing lane, so it may or
      // may not surface as its own frame (last-writer-wins with finish).
      expect(all.length).toBeGreaterThanOrEqual(24);
      expect(all.filter((f) => f.type === "acp_tool_call").length).toBe(12);
      expect(all.at(-1)?.type).toBe("finish");
      // Order: the turn opens with the learner's prompt (TASK-107) then the
      // agent's `start`, and every frame between start and finish arrives
      // exactly once, in order (the ring is the liveness source of truth).
      const kinds = all.map((f) => f.type);
      expect(kinds.slice(0, 2)).toEqual(["user_created", "start"]);
      expect(kinds.filter((k) => k === "finish").length).toBe(1);

      // Reload replay: the persisted history replays in the SAME order.
      const replay = (await collectFrames(ws, "conv-burst")) as {
        type: string;
      }[];
      expect(replay.at(-1)?.type).toBe("finish");
      expect(replay.filter((f) => f.type === "acp_tool_call").length).toBe(12);
    } finally {
      await server.close();
    }
  }, 15_000);

  it("delta truncation: a 5-chunk reply streams AND persists the FULL accumulated text (2026-09-21 live-smoke regression)", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      chunks: { texts: 5, thoughts: 2 },
      handle: fakeHandle("fake", "fake-chunky"),
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { ws } = server.clients;
      const live = (await (async () => {
        const subPromise = collectFrames(ws, "conv-chunky");
        await ws.chat.send({
          conversationId: "conv-chunky",
          messages: [{ content: "chunky", role: "user" }],
        });
        return subPromise;
      })()) as {
        data?: { text?: string };
        type: string;
      }[];
      const contentFrames = live.filter((f) => f.type === "content");
      // Every chunk surfaces as a live frame (the client's transcript
      // grows chunk by chunk via replace-frames).
      expect(contentFrames.length).toBe(5);
      // THE FIX: each live frame carries the snapshot so far — the last
      // one the FULL text (pre-fix: every frame carried only its delta,
      // so the visible reply was just "c4 ").
      expect(contentFrames[0]?.data?.text).toBe("c0 ");
      expect(contentFrames.at(-1)?.data?.text).toBe("c0 c1 c2 c3 c4 ");
      const thinkingFrames = live.filter((f) => f.type === "thinking");
      expect(thinkingFrames.at(-1)?.data?.text).toBe("t0 t1 ");
      expect(live.at(-1)?.type).toBe("finish");

      // The stored row holds the FULL text (reload replay reads this).
      const replay = (await collectFrames(ws, "conv-chunky")) as {
        data?: { text?: string };
        type: string;
      }[];
      const replayContent = replay.filter((f) => f.type === "content");
      expect(replayContent.length).toBe(1);
      expect(replayContent[0]?.data?.text).toBe("c0 c1 c2 c3 c4 ");
      const replayThinking = replay.filter((f) => f.type === "thinking");
      expect(replayThinking.length).toBe(1);
      expect(replayThinking[0]?.data?.text).toBe("t0 t1 ");
    } finally {
      await server.close();
    }
  }, 15_000);

  it("80.14 AC#2: a mid-turn subscriber catches history + the full live tail and terminates", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-mid"),
      permission: {
        callId: "call-mid",
        options: ALLOW_ONCE_OPTION,
      },
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { ws } = server.clients;
      // Subscriber 1 attaches before the turn (the mount-time bus).
      const earlyPromise = collectFrames(ws, "conv-mid");
      await ws.chat.send({
        conversationId: "conv-mid",
        messages: [{ content: "go", role: "user" }],
      });
      // The turn parks on the permission. Subscriber 2 connects MID-TURN
      // (the reload/reconnect case): it must get the persisted history
      // (empty here), the in-flight ring frames, then the live tail. It
      // dials its OWN RPCLink/socket — an oRPC WS link multiplexes one
      // event stream per REQUEST id, so a second subscribe over the shared
      // harness link gets its own stream anyway, but a dedicated socket
      // mirrors the real reload topology and keeps the drain isolated.
      const { RPCLink } = await import("@orpc/client/websocket");
      const { createORPCClient: createClient } = await import("@orpc/client");
      const lateSocket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      const lateLink = new RPCLink({
        connect: () => lateSocket,
      }) as unknown as import("@orpc/client").ClientLink<
        typeof import("@manobu/api-contract").contract
      >;
      const lateClient = createClient(lateLink, {
        context: server.context,
      } as never) as unknown as import("@manobu/api-contract").ContractClient;
      const lateIterator = await lateClient.chat.subscribe({
        conversationId: "conv-mid",
      });
      const late: unknown[] = [];
      const latePromise = (async () => {
        try {
          for (;;) {
            // biome-ignore lint/performance/noAwaitInLoops: an async iterator MUST be polled one `next()` at a time; the mid-turn subscriber terminates on the settle close.
            const { done, value } = await lateIterator.next();
            if (done) {
              break;
            }
            late.push(value);
          }
        } catch {
          // Socket torn down at test end; frames so far are the target.
        }
        return late;
      })();
      // Let the late subscriber attach and drain the ring so far.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const confirm = await ws.chat.confirm({
        callId: "call-mid",
        conversationId: "conv-mid",
        data: "allow_once",
      });
      expect(confirm.settled).toBe(true);

      const settledPair = await Promise.all([earlyPromise, latePromise]);
      const early = settledPair[0] ?? [];
      const lateFrames = settledPair[1] ?? [];
      // Both subscribers terminate on the terminal frame — no unbounded
      // gate wait (AC#2's "every case" bound).
      expect((late.at(-1) as { type: string }).type).toBe("finish");
      expect((early.at(-1) as { type: string }).type).toBe("finish");
      // The late subscriber saw the pre-confirm ring frames (start at
      // minimum — it attached before the confirm released the park).
      const lateTypes = lateFrames.map((f) => (f as { type: string }).type);
      expect(lateTypes).toContain("start");
      expect(lateTypes).toContain("acp_permission");
      lateSocket.close();
    } finally {
      await server.close();
    }
  }, 15_000);
});

describe("learner prompt persistence (TASK-107 AC#1/AC#5)", () => {
  it("persists the prompt as the turn's first row and replays user/agent frames in order", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-usertx"),
      script: new Map(),
    };
    const server = await bootFakeChat(db, agent);
    try {
      const { ws } = server.clients;
      const live = (await (async () => {
        const subPromise = collectFrames(ws, "conv-usertx");
        await ws.chat.send({
          conversationId: "conv-usertx",
          messages: [{ content: "  explain the difference  ", role: "user" }],
        });
        return subPromise;
      })()) as { type: string }[];

      // LIVE: the user_created frame is emitted on the ring before any
      // agent frame (the client folds the bubble with no optimistic append).
      expect(live[0]?.type).toBe("user_created");
      expect(live.at(-1)?.type).toBe("finish");

      // DURABLE: listMessages returns the user turn interleaved in turn
      // order — the prompt first, then the agent reply, then the terminal.
      const { messages } = await server.clients.fetch.chat.listMessages({
        conversationId: "conv-usertx",
      });
      expect(messages.map((m) => m.type)).toEqual([
        "user_created",
        "start",
        "content",
        "finish",
      ]);
      // The persisted user row carries the trimmed prompt text (matches the
      // wire content the client reads) and belongs to the same turn as the
      // agent frames it precedes.
      const userRow = messages[0] as {
        content: string;
        turn_id: string | null;
      };
      expect(JSON.parse(userRow.content)).toEqual({
        text: "explain the difference",
      });
      const finishTurn = messages.at(-1)?.turn_id ?? null;
      expect(userRow.turn_id).toBe(finishTurn);
    } finally {
      await server.close();
    }
  }, 15_000);
});

describe("chat handlers — in-process router client (TASK-80.8 AC#11)", () => {
  it("slashCommands: typed NOT_FOUND on a fresh conversation, live commands after a session", async () => {
    const { createRouterClient } = await import("@orpc/server");
    const { createChatContext } = await import("../src/chat-hub");
    const { ensureConversation, setUserAcpSessionId } = await import(
      "../src/chat-store"
    );
    const { isDefinedError, safe } = await import("@orpc/client");
    const agent: FakeAgent = {
      handle: fakeHandle("fake", "fake-sp"),
      script: new Map(),
    };
    agent.handle.slashCommands = [
      { description: "Review the diff", name: "review" },
    ];
    const controller = fakeController(agent);
    const router = createRpcHandlers({
      controller,
      resolveHandle: () => Promise.resolve(agent.handle),
    });
    // In-process server-side client: no socket, no HTTP. The oRPC testing
    // recipe — verify handler logic directly (backfills the 80.2 AC#5
    // "procedure logic via in-process call/createRouterClient" claim).
    const client = createRouterClient(router, {
      context: createChatContext(),
    });

    // Fresh conversation (a row, no stored session): the 80.5 data-feed
    // contract — the typed NOT_FOUND useSlashCommands must tolerate.
    await ensureConversation("conv-sp", {});
    const [freshError] = await safe(
      client.chat.slashCommands({ conversationId: "conv-sp" })
    );
    expect(isDefinedError(freshError)).toBe(true);
    if (isDefinedError(freshError)) {
      expect(freshError.code).toBe("NOT_FOUND");
    }

    // Seed the stored session + a live handle: the fake commands surface.
    await setUserAcpSessionId("conv-sp", "fake-sp");
    const ok = await client.chat.slashCommands({ conversationId: "conv-sp" });
    expect(ok.commands.map((c) => c.name)).toContain("review");
  });
});

describe("chat-store concurrency (TASK-80.7 AC#1)", () => {
  it("appendMessage never assigns two rows the same seq on one conversation", async () => {
    const { appendMessage, ensureConversation, getChatDb } = await import(
      "../src/chat-store"
    );
    const { messages } = await import("@manobu/db/schema/user");
    const { eq } = await import("drizzle-orm");

    await ensureConversation("conv-conc", {});
    const db = await getChatDb();

    // N concurrent writers on ONE conversation. Before TASK-80.7 AC#1
    // made seq atomic, each appendMessage read MAX(seq) in a separate
    // statement and then inserted, so all N racers read MAX=0 and landed
    // on seq=1 (32 rows, all seq 1). The fix computes seq inside the
    // INSERT via a subquery, so the invariant now holds without caller
    // discipline. This test asserts the 1..N permutation and no dupes.
    const N = 32;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendMessage({
          content: { i },
          conversationId: "conv-conc",
          frameType: "content",
          msgId: `m-${i}`,
          status: "work",
          turnId: "turn-conc",
        })
      )
    );

    const all = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, "conv-conc"))
      .all();
    const seqs = all.map((r) => r.seq).sort((a, b) => a - b);
    const expected = Array.from({ length: N }, (_, i) => i + 1);
    expect(JSON.stringify(seqs)).toBe(JSON.stringify(expected));

    // Belt-and-suspenders: no two rows share a seq.
    const seen = new Set<number>();
    for (const s of seqs) {
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
  }, 30_000);
});

/**
 * A scripted `SessionController` stand-in: the fake's frames + parked
 * permission/ask replace a real agent child. The chat layer drives this
 * through the same `prompt`/`confirm`/`answerAsk`/`cancel` path.
 */

/**
 * TASK-80.5 AC#2: apply the `setConfigOption` patch ({configId, value})
 * to a copy of the agent's advertised options; the `{modelId}`/`{modeId}`
 * dedicated-patch forms are runTurn-internal and not exercised by the
 * RPC surface. Pure (no await) so the fake `configOptions` below wraps
 * it in `Promise.resolve` (useAwait).
 */
function applyConfigPatch(
  agent: FakeAgent,
  patch?: unknown
): AcpConfigOption[] {
  const options = (agent.configOptions ?? []).map((o) => ({
    ...o,
    options: [...o.options],
  }));
  const p = patch as
    | { configId?: string; value?: string | boolean }
    | undefined;
  if (p?.configId !== undefined && p?.value !== undefined) {
    const target = options.find((o) => o.id === p.configId);
    if (target) {
      target.currentValue = p.value;
    }
  }
  return options;
}

/** Delta-truncation regression leg: ACP chunks are DELTAS. The bridge must
 * accumulate them into full snapshots before publish/persist — the pre-fix
 * bug lost everything except the last chunk, on the live wire AND in the
 * stored row (reload replay showed the truncation too). */
async function sinkChunkTurn(
  input: { sink: (event: AcpStreamEvent) => Promise<void> },
  chunks: { texts: number; thoughts: number }
): Promise<void> {
  await input.sink({
    session_id: "fake",
    type: "turn_start",
  } as unknown as AcpStreamEvent);
  for (let i = 0; i < chunks.thoughts; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: streaming cadence IS the test — deltas must arrive sequentially to accumulate.
    await input.sink({
      content: { text: `t${i} `, type: "text" },
      type: "thinking",
    } as unknown as AcpStreamEvent);
  }
  for (let i = 0; i < chunks.texts; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: streaming cadence IS the test — deltas must arrive sequentially to accumulate.
    await input.sink({
      content: { text: `c${i} `, type: "text" },
      message_id: "m1",
      type: "text",
    } as unknown as AcpStreamEvent);
  }
  await input.sink({
    stopReason: "end_turn",
    type: "turn_end",
    usage: null,
  } as unknown as AcpStreamEvent);
}

/** TASK-80.14 AC#1 burst leg: a dense multi-tool frame stream (the
 * opencode C1 wedge shape — many tool updates arriving faster than a
 * DB-poll drain could re-read them). */
async function sinkBurstTurn(
  input: { sink: (event: AcpStreamEvent) => Promise<void> },
  burst: { texts: number; toolCalls: number; terminalId: string }
): Promise<void> {
  await input.sink({
    session_id: "fake",
    type: "turn_start",
  } as unknown as AcpStreamEvent);
  for (let i = 0; i < burst.toolCalls; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: the burst IS the test — the wedge regression needs dense sequential tool-call frames, so each sink must await in the loop.
    await input.sink({
      session_id: "fake",
      type: "acp_tool_call",
      update: {
        kind: "read",
        sessionUpdate: "tool_call",
        status: "completed",
        title: `tool-${i}`,
        toolCallId: `burst-call-${i}`,
      },
    } as unknown as AcpStreamEvent);
  }
  for (let i = 0; i < burst.texts; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: same burst semantics — sequential awaited text frames replicate real agent cadence.
    await input.sink({
      content: { text: `chunk ${i}`, type: "text" },
      message_id: "m",
      type: "text",
    } as unknown as AcpStreamEvent);
  }
  await input.sink({
    command: "burst",
    exit_status: { exit_code: 0, signaled: false },
    output: "done",
    terminal_id: burst.terminalId,
    truncated: false,
    type: "acp_terminal_output",
  } as unknown as AcpStreamEvent);
  await input.sink({
    stopReason: "end_turn",
    type: "turn_end",
    usage: null,
  } as unknown as AcpStreamEvent);
}

function fakeController(agent: FakeAgent) {
  let parkedPermission: { callId: string } | null = null;
  let parkedAsk: { requestId: string; resolve: (text: string) => void } | null =
    null;
  const permissionGate = Promise.withResolvers<string>();

  const prompt = async (
    _handle: AcpSessionHandle,
    input: { content?: unknown; sink: (event: AcpStreamEvent) => Promise<void> }
  ): Promise<{ stopReason: string; usage: unknown }> => {
    // Delta-truncation regression (see sinkChunkTurn) then the 80.14
    // burst leg (see sinkBurstTurn): each scripted turn shape lives in
    // its own helper so `prompt` stays a linear dispatcher.
    if (agent.chunks) {
      await sinkChunkTurn(input, agent.chunks);
      return { stopReason: "end_turn", usage: null };
    }
    if (agent.burst) {
      await sinkBurstTurn(input, agent.burst);
      return { stopReason: "end_turn", usage: null };
    }
    await input.sink({
      session_id: "fake",
      type: "turn_start",
    } as unknown as AcpStreamEvent);
    await input.sink({
      content: { text: "reply", type: "text" },
      message_id: "m",
      type: "text",
    } as unknown as AcpStreamEvent);
    if (agent.permission) {
      parkedPermission = { callId: agent.permission.callId };
      await input.sink({
        options: agent.permission.options as unknown as AcpPermissionOption[],
        request_id: agent.permission.callId,
        session_id: "fake",
        tool_call: {
          status: "pending",
          title: "tool",
          toolCallId: agent.permission.callId,
        },
        type: "acp_permission",
      } as unknown as AcpStreamEvent);
      const optionId = await permissionGate.promise;
      await input.sink({
        option_id: optionId,
        request_id: agent.permission.callId,
        type: "acp_permission_resolved",
      } as unknown as AcpStreamEvent);
    }
    if (agent.ask) {
      const gate = Promise.withResolvers<string>();
      parkedAsk = { requestId: agent.ask.requestId, resolve: gate.resolve };
      await input.sink({
        questions: agent.ask.questions as unknown as AcpAskQuestion[],
        request_id: agent.ask.requestId,
        session_id: "fake",
        type: "ask",
      } as unknown as AcpStreamEvent);
      await gate.promise;
    }
    if (agent.terminal) {
      // Running snapshot first (no exit status yet)…
      await input.sink({
        command: agent.terminal.command,
        exit_status: null,
        output: agent.terminal.output,
        terminal_id: agent.terminal.id,
        truncated: false,
        type: "acp_terminal_output",
      } as unknown as AcpStreamEvent);
      // …then the exit snapshot (the cumulative buffer is final).
      await input.sink({
        command: agent.terminal.command,
        exit_status: { exit_code: 0, signaled: false },
        output: agent.terminal.output,
        terminal_id: agent.terminal.id,
        truncated: false,
        type: "acp_terminal_output",
      } as unknown as AcpStreamEvent);
    }
    await input.sink({
      stopReason: "end_turn",
      type: "turn_end",
      usage: null,
    } as unknown as AcpStreamEvent);
    return { stopReason: "end_turn", usage: null };
  };

  return {
    answerAsk: (
      requestId: string,
      payload: { answers?: unknown[]; decline?: boolean }
    ): boolean => {
      if (parkedAsk?.requestId !== requestId) {
        return false;
      }
      parkedAsk.resolve(payload.decline ? "declined" : "answered");
      parkedAsk = null;
      return true;
    },
    cancel: async (_sessionId: string, _turnId?: string): Promise<boolean> => {
      if (parkedPermission) {
        parkedPermission = null;
        permissionGate.resolve("cancelled");
      }
      await Promise.resolve();
      return true;
    },
    configOptions: (
      _handle: AcpSessionHandle,
      patch?: unknown
    ): Promise<AcpConfigOption[]> => {
      // TASK-80.11 seam: an agent that refuses the switch throws, and
      // the `setConfigOption` handler's catch maps it to the typed
      // CONFIG_SWITCH_FAILED error.
      const p = patch as { configId?: string; value?: unknown } | undefined;
      const reject = agent.rejectConfigOption;
      if (
        reject &&
        p?.configId === reject.optionId &&
        p?.value === reject.value
      ) {
        return Promise.reject(new Error("agent rejected the config switch"));
      }
      return Promise.resolve(applyConfigPatch(agent, patch));
    },
    confirm: (callId: string, _optionId: string): boolean => {
      if (parkedPermission?.callId !== callId) {
        return false;
      }
      parkedPermission = null;
      permissionGate.resolve("allow_once");
      return true;
    },
    dispose: (sessionId: string): Promise<void> => {
      // The fake has no real child; record the id so a delete test can
      // assert the conversation's session was disposed on the way out.
      agent.sessionDisposed = sessionId;
      return Promise.resolve();
    },
    handleFor: (_sessionId: string): AcpSessionHandle | null => agent.handle,
    killTerminal: (terminalId: string): boolean => {
      // The fake has no real child to kill; record the id so the test can
      // assert the RPC round-tripped the right terminal.
      agent.terminalKilled = terminalId;
      return true;
    },
    listConfirmations: (_sessionId: string): AcpStreamEvent[] => [
      ...(parkedPermission
        ? ([{ type: "acp_permission" }] as unknown as AcpStreamEvent[])
        : []),
      ...(parkedAsk ? ([{ type: "ask" }] as unknown as AcpStreamEvent[]) : []),
    ],
    prompt,
  } as unknown as ChatController;
}
