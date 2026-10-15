/*
 * Typed oRPC client for chat-session (TASK-71 phase 4 + TASK-80.3).
 *
 * Two links live here:
 * - `orpc` — the fetch link (`/rpc`, shared factory `createFetchRpcClient`
 *   re-exported by apps/desktop, TASK-80.8 AC#9) — catalog fetches,
 *   persisted-state reads (`chat.listMessages`, `chat.listConversations`,
 *   …). The full `ContractClient`: every procedure over HTTP.
 * - `getChatWsClient()` — the WebSocket link (`/ws`) — the live-turn
 *   surface (`chat.subscribe` / `chat.send` / `chat.cancel`). Narrowed to
 *   the `chat` subtree (TASK-80.8 AC#2), lazy-created so module import
 *   has no socket side effect.
 */

import type { ContractClient } from "@manobu/api-contract";
import { env } from "@manobu/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RPCLink as WsRPCLink } from "@orpc/client/websocket";

const serverOrigin = env.VITE_SERVER_URL ?? "";
const rpcOrigin = serverOrigin === "" ? undefined : serverOrigin;
type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

// ── Fetch link (TASK-71 phase 4) ───────────────────────────────────────

/**
 * The ONE shared fetch-link factory (TASK-80.8 AC#9): the sidecar URL
 * lives here, and `apps/desktop` re-exports the client from this module
 * so the non-chat desktop consumers (kanji/sensei/next-cards) and the
 * chat surface share one link. `origin` is same-origin in the browser
 * and an explicit host under Tauri (`VITE_SERVER_URL`).
 */
export function createFetchRpcClient(): ContractClient {
  const link = new RPCLink({
    origin: rpcOrigin,
    url: "/rpc",
  });
  return createORPCClient(link);
}

export function createKeepaliveFetchRpcClient(
  fetchImpl: FetchImplementation = (input, init) =>
    globalThis.fetch(input, init)
): ContractClient {
  const link = new RPCLink({
    fetch: (url, init) => fetchImpl(url, { ...init, keepalive: true }),
    origin: rpcOrigin,
    url: "/rpc",
  });
  return createORPCClient(link);
}

export const orpc: ContractClient = createFetchRpcClient();

// ── WS link (live-turn surface, TASK-80.3) ─────────────────────────────

/** `http(s)://host:port` → `ws(s)://host:port/ws`. */
function wsUrlFor(origin: string): string {
  const wsBase = origin.startsWith("https")
    ? origin.replace("https", "wss")
    : origin.replace("http", "ws");
  return `${wsBase}/ws`;
}

/**
 * The narrow WS client type (TASK-80.8 AC#2): the live-turn surface is
 * ONLY the `chat` subtree, so the link cannot be used for non-chat
 * procedures (the full `ContractClient` stays on the fetch link).
 */
type ChatWsClient = Pick<ContractClient, "chat">;

let wsClient: ChatWsClient | null = null;

/**
 * The shared WS live-turn client. Lazily created on first call so
 * importing this module opens no socket (`WsRPCLink` defaults to
 * `connectOnInit: false`); `reconnect` is on (AionUi bus semantics:
 * the socket survives turns and auto-recovers on drop — no
 * cancel-on-drop, resubscribe carries `lastEventId`).
 */
export function getChatWsClient(): ChatWsClient {
  if (!wsClient) {
    let origin = serverOrigin;
    if (origin === "") {
      origin =
        typeof window === "undefined"
          ? "http://127.0.0.1:4317"
          : window.location.origin;
    }
    const link = new WsRPCLink({
      connect: () => new WebSocket(wsUrlFor(origin)),
      reconnect: {
        enabled: true,
        onClose: { enabled: true },
      },
    });
    wsClient = createORPCClient(link) as ChatWsClient;
  }
  return wsClient;
}
