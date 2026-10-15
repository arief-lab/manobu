/**
 * Test harness for the native-ACP chat surface (TASK-80.2).
 *
 * The suite runs over a REAL live WebSocket: it boots the production
 * Bun.serve fetch+websocket hooks via `startSidecar`, dials `/ws` through
 * `@orpc/client/websocket`, and exercises `send` → ack, `subscribe` →
 * frames, the permission/ask round trips, `cancel`, and restart
 * persistence. The fake agent's handle resolves through the chat
 * layer's `resolveHandle` seam so no real CLI is spawned — everything
 * from the sink onward is production code.
 */

import { afterAll } from "bun:test";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpSessionHandle } from "@manobu/acp/session-types";
import type { ContractClient, contract } from "@manobu/api-contract";
import { applyContentMigrations } from "@manobu/db/migrate";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { Router } from "@orpc/server";
import { Hono } from "hono";
import type { ChatContext } from "../src/chat-hub";
import { createChatContext } from "../src/chat-hub";
import type { ChatDb } from "../src/chat-store";
import { chatErrorStatusMap } from "../src/rpc";
import { startSidecar } from "../src/server-runtime";

export interface ChatClients {
  fetch: ContractClient;
  ws: ContractClient;
}

/**
 * A database URL belonging to ONE test file, cleaned up when the process exits.
 *
 * `bun test` loads every spec file before running any of them, so a spec that
 * relies on `process.env.DATABASE_URL` reads whatever the LAST-loaded file set.
 * Nine server specs used `file::memory:` on that assumption and shared one
 * database, which is why they passed together and failed the moment a spec with
 * a real path joined the run. A spec should therefore name its own database, and
 * say so through `setUserDbProvider` so that application modules agree - see
 * src/user-db.ts.
 *
 * Cleanup is registered by `isolatedDbUrl` itself, per path, so each database is
 * unlinked when the file that named it finishes. It used to be one process-wide
 * `afterAll` over a shared set (to avoid editing nine import lines), but that
 * set is shared by every spec: the FIRST file's `afterAll` unlinked databases
 * belonging to files that had not run yet, so a later spec wrote through a
 * handle still open on the deleted inode while any fresh connection to the same
 * path opened a new empty file beside it (`no such table: messages`).
 *
 * `applyContentMigrations` is the caller's job; this only names and cleans.
 */
const pendingPaths = new Set<string>();

export const isolatedDbUrl = (name: string): string => {
  const path = join(tmpdir(), `manobu-${name}-${Date.now()}.db`);
  pendingPaths.add(path);
  // Registered from the caller's module scope, so the hook belongs to THAT
  // spec file and removes only the file's own database.
  afterAll(() => {
    removeDatabase(path);
  });
  return `file:${path}`;
};

/** Unlink a database and its WAL/SHM siblings. Never throws. */
const removeDatabase = (path: string): void => {
  // Unlink only. Do NOT close the application singleton here: `afterAll` in an
  // imported module does not reliably run at end-of-process, so it can fire
  // while later specs are still using the handle. Measured, not assumed -
  // closing here gave 40 pass / 29 fail across the same ten specs that are
  // 70 pass / 0 fail without it.
  //
  // Handles ARE closed where it is safe and correct: src/user-db.ts closes the
  // outgoing handle whenever a test switches provider. Leaked descriptors come
  // from provider switches, not from unlinking.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${path}${suffix}`, { force: true });
    } catch {
      // A database still held open by a live server is not worth failing a
      // green run over, and the OS clears tmp regardless.
    }
  }
};

/** Delete every database not yet claimed by a file's `afterAll`. Never throws. */
export const removeTestDatabases = (): void => {
  for (const path of pendingPaths) {
    removeDatabase(path);
  }
  pendingPaths.clear();
};

/** Unlink a SQLite database file and its WAL/SHM siblings, skipping any that
 * are absent. The teardown every spec that names its own `DB_PATH` repeats. */
export const removeSqliteDbFiles = (path: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const databasePath = `${path}${suffix}`;
    if (existsSync(databasePath)) {
      unlinkSync(databasePath);
    }
  }
};

/** Close the drizzle handle, then remove the database files behind it. Used
 * by specs that own the connection and can safely tear it down in `afterAll`. */
export const closeAndRemoveSqliteDb = (
  database: { $client: { close: () => void } },
  path: string
): void => {
  database.$client.close();
  removeSqliteDbFiles(path);
};

/** A SQLite database a spec names ITSELF (not `isolatedDbUrl`'s registry): the
 * path, `DATABASE_URL` pointed at it, and the content migrations applied to the
 * EXPLICIT url. `bun test` loads every spec in one process, so a sibling
 * file's env write can win the read; `createUserDb(url)` takes the path
 * directly, which is what keeps these specs race-free. The caller unlinks the
 * files in its own `afterAll`. */
export const manualContentDb = (
  name: string
): { DB_PATH: string; DB_URL: string } => {
  const DB_PATH = join(tmpdir(), `manobu-${name}-${Date.now()}.db`);
  const DB_URL = `file:${DB_PATH}`;
  process.env.CORS_ORIGIN ??= "http://localhost:3000";
  process.env.DATABASE_URL = DB_URL;
  applyContentMigrations(DB_URL);
  return { DB_PATH, DB_URL };
};

/**
 * A fake agent handle injected in place of a real CLI. The chat layer's
 * `resolveHandle` seam returns it; the controller drives the turn through
 * the real `prompt` path (a scripted sink emits the frame sequence).
 */
export interface FakeAgent {
  /** Park one ask mid-turn (resolves on `answerAsk`). */
  ask?: { requestId: string; questions: unknown[] };
  /** TASK-80.14 AC#1: emit a dense frame burst (texts + tool calls, then
   * a terminal-output snapshot + turn_end) instead of the 3-frame script —
   * the multi-tool opencode wedge shape. */
  burst?: { texts: number; toolCalls: number; terminalId: string };
  /** Delta-truncation regression (2026-09-21): emit `thoughts` thinking
   * deltas then `texts` text deltas (true ACP chunk cadence — each event
   * carries ONLY the new text) before turn_end. */
  chunks?: { texts: number; thoughts: number };
  /** The session's live config options (model/mode); the fake
   * `configOptions` controller applies a patch to a copy of these. */
  configOptions?: Array<{
    currentValue: string | boolean;
    id: string;
    options: Array<{ value: string }>;
    type: "boolean" | "select";
  }>;
  handle: AcpSessionHandle;
  /** Park one permission mid-turn (resolves on `confirm`). */
  permission?: {
    callId: string;
    options: Array<{ kind: string; name?: string; optionId: string }>;
  };
  /**
   * Reject a config switch mid-`setConfigOption` (the chat layer's
   * `CONFIG_SWITCH_FAILED` typed error when the agent refuses to
   * switch): matches on the requested option id + value.
   */
  rejectConfigOption?: { optionId: string; value: unknown };
  /** Scripted turns keyed by conversationId; replayed per `send`. */
  script: Map<
    string,
    Array<{
      event: unknown;
      /** Await before emitting (permission/ask parks). */
      wait?: Promise<unknown>;
    }>
  >;
  /** Set by the fake `dispose` so a delete test can assert the session
   * owned by a removed conversation was torn down. */
  sessionDisposed?: string;
  /** When set, the scripted turn emits terminal-output snapshots
   * (`acp_terminal_output`) before `turn_end`: running, then exit. */
  terminal?: { id: string; command: string; output: string };
  /** Set by the fake `killTerminal` so a test can assert the round-trip. */
  terminalKilled?: string;
}

export interface BootOptions {
  agent: FakeAgent;
  db: ChatDb;
  /** The oRPC router (chat + cards + jap + learn + acp) under test. */
  router: Router<ChatContext>;
}

export interface ChatServer {
  clients: ChatClients;
  close: () => Promise<void>;
  context: ChatContext;
  db: ChatDb;
  /** The port the sidecar bound (4500 + serverCounter % 80). */
  port: number;
  /** Boot a second server on the SAME db to prove restart persistence. */
  restart: () => Promise<ChatServer>;
}

/** The oRPC context type the router serves (chat hubs + turn gates). */

let serverCounter = 0;

/**
 * Boot the production Bun.serve fetch+websocket hooks against the test
 * router. Both links share one chat context (a `send` on WS publishes to
 * a `subscribe` on either link).
 */
export async function bootChatServer(opts: BootOptions): Promise<ChatServer> {
  serverCounter += 1;
  const port = 4500 + (serverCounter % 80);
  const context = createChatContext();
  // A minimal Hono app: /rpc dispatches through the router (persisted-state
  // procedures); the live-turn surface is the WS link. 404 elsewhere.
  const { RPCHandler } = await import("@orpc/server/fetch");
  const rpcHandler = new RPCHandler(opts.router, {
    errorStatusMap: chatErrorStatusMap,
  });
  const app = new Hono().all("/rpc/*", async (c) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      context,
      prefix: "/rpc",
    });
    return matched ? response : c.text("Not Found", 404);
  });

  const running = startSidecar(app, opts.router, port, context);
  const { RPCLink: FetchRPCLink } = await import("@orpc/client/fetch");
  const fetchLink = new FetchRPCLink({
    origin: `http://127.0.0.1:${port}`,
    url: "/rpc",
  }) as unknown as import("@orpc/client").ClientLink<typeof contract>;
  const wsLink = new RPCLink({
    connect: () => new WebSocket(`ws://127.0.0.1:${port}/ws`),
  }) as unknown as import("@orpc/client").ClientLink<typeof contract>;

  return {
    clients: {
      fetch: createORPCClient(fetchLink, {
        context,
      } as never) as unknown as ContractClient,
      ws: createORPCClient(wsLink, {
        context,
      } as never) as unknown as ContractClient,
    },
    close: running.close,
    context,
    db: opts.db,
    port,
    restart: async () => bootChatServer(opts),
  };
}
