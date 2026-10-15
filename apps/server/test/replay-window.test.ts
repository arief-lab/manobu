/*
 * Replay window edge test (TASK-82 follow-up): chat.subscribe replays
 * persisted history with `limit: 200` (listMessages's hard cap). This
 * pins the documented window behavior on a conversation LONGER than the
 * window:
 * 1. the replay carries exactly the NEWEST 200 rows (not the first 200,
 *    not zero) — a reloaded client reconnects to the tail of the
 *    conversation, which is the transcript edge the UI displays;
 * 2. the terminal row is inside the window, so the subscribe still
 *    closes cleanly for a settled conversation (no hang);
 * 3. rows are seq-ordered across the window.
 */

import { describe, expect, it } from "bun:test";

process.env.CORS_ORIGIN = "http://localhost:3000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider, getUserDb } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("replay-window");
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
const { bootChatServer } = await import("./harness");
const { ensureConversation, appendMessage } = await import("../src/chat-store");
const { closeHub, hubFor } = await import("../src/chat-hub");
type FakeAgent = import("./harness").FakeAgent;
type ChatServer = import("./harness").ChatServer;

const REPLAY_LIMIT = 200;
/** Rows written: comfortably past the window (200) with terminal included. */
const TOTAL_ROWS = REPLAY_LIMIT + 60;
/** Content rows carry "row N" text; the N is the row's 1-based index. */
const ROW_INDEX_RE = /row (\d+)$/;

function fakeHandle(): import("@manobu/acp/session-types").AcpSessionHandle {
  const { AcpSessionHandle } =
    require("@manobu/acp/session-types") as typeof import("@manobu/acp/session-types");
  const handle = new AcpSessionHandle("fake");
  handle.sessionId = "fake-window";
  handle.sessionActive = true;
  handle.healthy = true;
  return handle;
}

/** Collect the replay frames: poll the iterator one next() at a time
 * (an async iterator cannot be Promise.all'd); it closes on the replay
 * boundary of a settled conversation. */
async function collectReplay(
  server: ChatServer,
  conversationId: string
): Promise<Array<{ type: string; data: { text?: string } }>> {
  const iterator = await server.clients.ws.chat.subscribe({ conversationId });
  const frames: Array<{ type: string; data: { text?: string } }> = [];
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: an async iterator MUST be polled one next() at a time; it closes on the replay boundary.
    const { done, value } = await iterator.next();
    if (done) {
      break;
    }
    frames.push(value as { type: string; data: { text?: string } });
  }
  return frames;
}

/**
 * A no-op ChatController: this suite never runs a turn (the conversation
 * is pre-seeded and settled), but createRpcHandlers requires the full
 * structural shape. Every method is a non-call.
 */
function fakeWindowController(): import("../src/chat-rpc").ChatController {
  const handle = fakeHandle();
  return {
    answerAsk: () => false,
    cancel: () => Promise.resolve(true),
    configOptions: () => Promise.resolve([]),
    confirm: () => false,
    dispose: () => Promise.resolve(),
    disposeAll: () => Promise.resolve(),
    handleFor: () => handle,
    killTerminal: () => false,
    pendingAsks: () => [],
    pendingPermissions: () => [],
    prompt: () =>
      Promise.resolve({ stopReason: "end_turn", usage: null }) as never,
    sessionIds: () => [],
  } as never;
}

describe("replay window edge (>200-row conversation)", () => {
  it("replays the NEWEST 200 rows with the terminal inside the window", async () => {
    const db = await getUserDb();
    const agent: FakeAgent = {
      handle: fakeHandle(),
      script: new Map(),
    };
    const server: ChatServer = await bootChatServer({
      agent,
      db,
      router: createRpcHandlers({
        controller: fakeWindowController(),
        resolveHandle: () => Promise.resolve(agent.handle),
      }),
    });
    try {
      const conversationId = "conv-window";
      await ensureConversation(conversationId, {});

      // Seed TOTAL_ROWS rows: content frames, with a `finish` terminal as
      // the LAST row — the shape a long settled conversation has.
      for (let i = 1; i <= TOTAL_ROWS; i += 1) {
        const terminal = i === TOTAL_ROWS;
        // biome-ignore lint/performance/noAwaitInLoops: seq assignment is per-insert; sequential awaited inserts guarantee the 1..N order the window assertions walk.
        await appendMessage({
          content: terminal
            ? { stopReason: "end_turn", usage: null }
            : { text: `row ${i}`, type: "text" },
          conversationId,
          frameType: terminal ? "finish" : "content",
          msgId: `m-${i}`,
          status: terminal ? "finish" : "work",
          turnId: `turn-${Math.ceil(i / 10)}`,
        });
      }

      // The hub settle boundary is part of the real turn path (the sink
      // closes the hub after the terminal row commits). The seeded rows
      // alone leave a fresh hub (no turn ran in this process), so settle
      // it explicitly — this IS the reconnect-after-restart shape: rows
      // durable, hub state gone, replay + close must not depend on hub
      // memory. (Found by this test: a never-settled hub keeps the
      // subscribe OPEN for a one-shot consumer — the desktop client only
      // survives it because it treats an open stream as live mode.)
      closeHub(hubFor(server.context, conversationId));

      const frames = await collectReplay(server, conversationId);

      // 1. Exactly the window size replayed — not TOTAL_ROWS, not zero.
      expect(frames.length).toBe(REPLAY_LIMIT);

      // 2. The terminal is the LAST replayed row, so a reloaded client
      //    sees a settled conversation (the close above proves this, but
      //    assert the tail shape explicitly).
      expect(frames.at(-1)?.type).toBe("finish");

      // 3. Frames arrive in row-id (seq) order: the window is the TAIL
      //    (rows 61..260), not the head.
      const rowIndexes = frames.map((f) => {
        const match = ROW_INDEX_RE.exec(f.data.text ?? "");
        return match ? Number(match[1]) : 0;
      });
      // The window holds rows 61..259 (content) and 260 (finish last).
      expect(rowIndexes[0]).toBe(TOTAL_ROWS - REPLAY_LIMIT + 1);
      // Explicit length guard satisfies noUncheckedIndexedAccess for .at():
      expect(rowIndexes.length).toBe(REPLAY_LIMIT);
      // Sequential-content assertion: after the length guard above, slice
      // out the content window (all but the trailing finish frame) and
      // walk pairs — noUncheckedIndexedAccess-safe via slice + every.
      const contentRows = rowIndexes.slice(0, -1);
      expect(contentRows).toHaveLength(REPLAY_LIMIT - 1);
      expect(contentRows[0]).toBe(TOTAL_ROWS - REPLAY_LIMIT + 1);
      expect(contentRows.at(-1)).toBe(TOTAL_ROWS - 1);
      const isSequential = contentRows.every((value, i) => {
        if (i === 0) {
          return true;
        }
        const prev = contentRows[i - 1] ?? Number.NaN;
        return value === prev + 1;
      });
      expect(isSequential).toBe(true);

      // 4. The head of the conversation (rows 1..60) is OUTSIDE the
      //    window: the documented edge. A chat-history viewer remains
      //    the deep-traversal path.
      expect(rowIndexes).not.toContain(1);
    } finally {
      await server.close();
    }
  }, 20_000);
});
