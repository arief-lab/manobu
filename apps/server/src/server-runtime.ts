/*
 * The sidecar runtime (TASK-80.2): the explicit Bun.serve fetch+websocket
 * hooks, extracted from index.ts so the live-WS test suite boots the exact
 * production wiring. index.ts calls `startSidecar()` with the app + router;
 * the test calls it with a test router + a free port.
 *
 * Split rule honored here: anything participating in the live turn rides
 * the WebSocket RPCHandler (the `websocket.message`/`close` hooks; the
 * fetch handler calls `server.upgrade` on /ws). Anything reading or
 * writing persisted state rides the fetch /rpc route on the same router.
 */

import type { Router } from "@orpc/server";
import { RPCHandler as WsRPCHandler } from "@orpc/server/websocket";
import type { Hono } from "hono";

import type { ChatContext } from "./chat-hub";

export interface SidecarServer {
  close: () => Promise<void>;
  /** The shared chat context: hubs + turn gates, live across both links. */
  context: ChatContext;
  port: number;
}

/**
 * Boot the sidecar: one Hono app + one oRPC router, served by BOTH a fetch
 * RPCHandler (persisted-state procedures, /rpc) and a WebSocket RPCHandler
 * (live-turn procedures, /ws). Returns the handle to stop it.
 */
/**
 * The live-turn chat procedures served over /ws (TASK-80.8 AC#1):
 * everything persisted-state (cards FSRS writes, learn/acp catalog
 * reads, chat.listMessages/history (getConversation, listConversations,
 * renameConversation, deleteConversation)/setConfigOption/
 * slashCommands) stays on the fetch /rpc link ONLY - the WS handler
 * filter drops it so no WS connection can reach it.
 */
const LIVE_TURN_PROCEDURES: ReadonlySet<string> = new Set([
  "chat.answerAsk",
  "chat.answerDrillItem",
  "chat.cancel",
  "chat.confirm",
  "chat.killTerminal",
  "chat.listConfirmations",
  "chat.send",
  "chat.skipDrill",
  "chat.startDrill",
  "chat.stopDrill",
  "chat.subscribe",
]);

export function startSidecar(
  app: Hono,
  router: Router<ChatContext>,
  port: number,
  context: ChatContext
): SidecarServer {
  const wsRpcHandler = new WsRPCHandler(router, {
    filter: (_procedure, path) => LIVE_TURN_PROCEDURES.has(path.join(".")),
  });
  const WS_PATH = "/ws";

  const server = Bun.serve({
    fetch(req) {
      // Disable Bun's 10s idle timeout — a live chat turn can be quiet
      // longer than that (cold-spawn first token, an agent parked on a
      // permission/ask). Non-streaming routes finish in ms, so applying
      // it to every request is harmless.
      server.timeout(req, 0);
      // TASK-80.2: the live-turn surface upgrades here; everything else
      // (including /rpc) rides the Hono app, which applies the shared
      // cors()/secureHeaders()/etag()/bodyLimit() middlewares.
      if (new URL(req.url).pathname === WS_PATH) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return app.fetch(req);
    },
    hostname: "127.0.0.1",
    port,
    websocket: {
      async close(ws) {
        await wsRpcHandler.close(ws);
      },
      async message(ws, message) {
        await wsRpcHandler.message(ws, message as string, { context });
      },
    },
  });
  return {
    close: () => Promise.resolve(server.stop(true)),
    context,
    port,
  };
}
