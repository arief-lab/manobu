import { existsSync } from "node:fs";
import { join } from "node:path";
import { listAgentCandidates } from "@manobu/acp";
import { type AgentSpec, listAgents } from "@manobu/acp/registry";
import { env } from "@manobu/env/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { createFactory, type Factory } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "hono/types";
import { assistantResolution } from "./assistant-loader";
import {
  askTool,
  chatContext,
  childRegistryPath,
  controller,
  DEFAULT_PERSONA_ID,
  personas,
} from "./context";
import { resolveDataDir } from "./data-dir";
import { startParentWatchdog } from "./parent-watchdog";
import { bootstrapAgentPath } from "./path-bootstrap";
import { createCardsRoute } from "./routes/cards";
import { createJapDataRoute } from "./routes/jap-data";
import { createLearnChatRoute } from "./routes/learn-chat";
import { chatErrorStatusMap, createRpcHandlers } from "./rpc";
import { startSidecar } from "./server-runtime";
import { buildSystemInfoReport } from "./system-info";

// TASK-153 AC#4: before anything walks process.env.PATH (agent discovery in
// the /agents route, agentChildEnv copies at spawn time), make the per-user
// version-manager bin dirs visible to a desktop-launched process. Idempotent
// and a no-op when the dirs are already on PATH.
bootstrapAgentPath();

/**
 * App environment — shared across app, middleware, and route handlers.
 * Variables carry request-scoped values set via c.set / read via c.get.
 */
type AppEnv = Env & {
  Variables: {
    /** Request ID assigned by hono/request-id middleware. */
    requestId: string;
  };
};

const factory: Factory<AppEnv> = createFactory<AppEnv>();

const app = factory.createApp();

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error("[server] unhandled error:", err);
  return c.json({ message: "Internal Server Error" }, 500);
});
app.notFound((c) => c.json({ message: "Not Found" }, 404));

const requestIdMiddleware = factory.createMiddleware(requestId());
// Dev trap this fixes: vite falls to :3002/:3003 whenever :3001 is busy,
// and a strict CORS_ORIGIN list silently blocks every RPC — the client
// then shows "the server may be offline" while the server is up. In
// development any localhost port is allowed on top of the configured
// list; production stays strict.
const ALLOWED_ORIGINS = env.CORS_ORIGIN.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DEV_LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const corsMiddleware = factory.createMiddleware(
  cors({
    allowMethods: ["GET", "POST", "OPTIONS"],
    origin: (origin) => {
      if (ALLOWED_ORIGINS.includes(origin)) {
        return origin;
      }
      if (env.NODE_ENV === "development" && DEV_LOCALHOST.test(origin)) {
        return origin;
      }
      return null;
    },
  })
);

/**
 * Copy the request ID from the response header (set by hono/request-id)
 * into the request context Variables so handlers can read it via c.get("requestId").
 */
app.use("/*", requestIdMiddleware);
app.use("/*", logger());
app.use("/*", corsMiddleware);
app.use("/*", secureHeaders());
app.use("/*", etag());
app.use("/*", async (c, next) => {
  await next();
  const reqId = c.res.headers.get("x-request-id");
  if (reqId) {
    c.set("requestId", reqId);
  }
});
app.use("/*", bodyLimit({ maxSize: 64 * 1024 }));

/**
 * Host MCP tools (TASK-80.2): the agent's `ask_user` reaches this loopback
 * endpoint instead of the provider-era tool handoff. ask parks on the live
 * session and `chat.answerAsk` resolves it (see chat-rpc.ts).
 */
const HOST_TOOLS_PATH = "/internal/host-tools";

/**
 * Chained routes — RPC type inference via `export type AppType = typeof aiRoutes`.
 * The chain (post().get().get()...) gives hc a single typed route object to
 * infer Endpoints/Linked from, instead of N separate unchained app.post() calls.
 */
const aiRoutes = app
  .post(`${HOST_TOOLS_PATH}/:token`, (c) => askTool.handleRequest(c.req.raw))
  .get("/agents", (c) => {
    /**
     * Agent catalog for the picker UI — the AionUi `agent_status` analogue.
     * Lists every registry agent with whether its CLI is installed on `$PATH`.
     * The client greys out uninstalled agents.
     */
    const installed = new Set(
      listAgentCandidates().map((candidate) => candidate.name)
    );
    const agents = listAgents().map((spec: AgentSpec) => ({
      command: spec.command,
      displayName: spec.displayName,
      id: spec.id,
      installed: installed.has(spec.command),
    }));
    return c.json({ agents });
  })
  .get("/assistants", (c) => {
    const assistants = [...personas.values()].map((persona) => ({
      description: persona.description ?? null,
      id: persona.slug,
      name: persona.name,
    }));
    return c.json({ assistants, default: DEFAULT_PERSONA_ID });
  })
  /**
   * TASK-153 AC#3: which explicit paths is this process serving? Reports
   * the launcher-passed data/cache/log/assistant dirs and the derived db +
   * registry locations — never a cwd-derived guess. `cwd` is included as
   * its own field precisely so a divergence from the passed dirs is visible.
   */
  .get("/api/system/info", (c) =>
    c.json(
      buildSystemInfoReport({
        assistant: assistantResolution(),
        childRegistryPath,
        cwd: process.cwd(),
        env: process.env,
        pid: process.pid,
      })
    )
  )
  .get("/", (c) => c.text("OK"));

export type AppType = typeof aiRoutes;
export { aiRoutes };

// Teacher Agent orchestrator — POST /learn/chat SSE (spec §TASK-1.16).
// Routes through @manobu/agent's intent classifier + 4 sub-agents.
// v1 has an empty provider registry (no LLM adapter yet); the orchestrator
// returns a typed `AgentResponse` rendered as SSE tokens.
/**
 * API routes — grouped under /api base path.
 * jap-data (/kanji, /grammar) + cards (/cards, /cards/due, /cards/grade).
 */
const apiRoute = factory.createApp();
apiRoute.route("/", createJapDataRoute());
apiRoute.route("/", createCardsRoute());
app.route("/api", apiRoute);

/**
 * Learn routes — grouped under /learn base path.
 * learn-chat (POST /chat, GET /nextCards).
 */
const learnRoute = factory.createApp();
learnRoute.route("/", createLearnChatRoute());
app.route("/learn", learnRoute);

/**
 * oRPC contract endpoint at /rpc (TASK-71 phase 3) — mounted as a Hono
 * route so the shared cors()/secureHeaders()/etag()/bodyLimit() middlewares
 * cover it like every other surface. (It used to be dispatched in
 * Bun.serve.fetch BEFORE Hono; /rpc responses skipped those middlewares
 * and the browser silently blocked them — no ACAO header → net::ERR_FAILED,
 * and every orpc.* call fell into its offline fallback unnoticed.)
 */
const rpcHandler = new RPCHandler(createRpcHandlers(), {
  errorStatusMap: chatErrorStatusMap,
});

app.all("/rpc/*", async (c) => {
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    context: chatContext,
    prefix: "/rpc",
  });
  return matched ? response : c.json({ message: "Not Found" }, 404);
});

// ---------------------------------------------------------------------------
// Production / sidecar runtime — explicit Bun.serve with the idle timeout
// reset (found 2026-08-07 with a probe matrix): Bun's HTTP server enforces a
// default 10s idle timeout on connections. The ACP chat stream can be quiet
// for >10s — cold-spawn first-token latency, a dead session producing
// nothing, or a long model stall — and Bun resets the connection exactly
// then.
//
// Verified: a 15s-quiet SSE probe resets 4/4 with the exact production error
// and passes 4/4 with `server.timeout(req, 0)`. The latest Bun canary
// (revision 45ee9556, 2026-08-07) still has the 10s default — upgrading is
// NOT the fix. See research/ for the writeup.
//
// Port: `BUN_PORT` (sidecar :4317, smoke :4399) or :3000 in dev.
const PORT = Number(process.env.BUN_PORT ?? 3000);

// TASK-44: apply schema migrations to the user/content db BEFORE serving —
// a fresh install points DATABASE_URL at an empty file and every /api/cards
// route 500s with "no such table: cards" until this runs. Drizzle's journal
// is not consulted by the native applier; `createContentDatabase` is
// idempotent (CREATE TABLE IF NOT EXISTS-style drizzle DDL + FTS rebuild
// statements are safe to re-run). The vaporetto extension is optional here:
// when the loadable .so is absent (packaged resource missing), migrations
// fall back to unicode61 FTS — search quality degrades, boot does not fail.
try {
  const { applyContentMigrations } = await import("@manobu/db/migrate");
  const { tokenizer, vaporettoLoaded } = applyContentMigrations(
    env.DATABASE_URL
  );
  console.log(
    `[db] migrations applied (tokenizer=${tokenizer}, vaporetto=${vaporettoLoaded})`
  );
} catch (error) {
  // Never block boot on migration failure — the UI degrades route-by-route
  // (cards/grade 500) instead of the whole sidecar dying.
  console.error("[db] migration failed:", error);
}

// TASK-178: a store file missing from `bundle.resources` does not fail the
// build, does not fail resolution (`n5.json`, the probe file, ships), and does
// not fail the read (`readJson` returns null), so an absent 読解/聴解 store
// surfaced only as a short paper months later. Name it here instead. This is a
// diagnostic, not the guard: `apps/server/test/bundle-resources.test.ts` is
// what fails when a read site outruns the bundle.
const dataDir = resolveDataDir();
if (dataDir !== null) {
  for (const leg of ["reading/n5.json", "verbs-n5.json"]) {
    if (!existsSync(join(dataDir, leg))) {
      console.warn(`[data] ${join(dataDir, leg)} is missing from this bundle`);
    }
  }
}

// TASK-107 AC#3: before serving, name existing untitled conversations from
// their first persisted prompt. A one-shot, idempotent backfill; a
// conversation with no stored user turn (created before prompt persistence) is
// left untitled and renameable rather than given a fabricated name (AC#4).
// Never block boot on it, same rule as the migration above.
try {
  const { backfillConversationTitles } = await import("./chat-store");
  const named = await backfillConversationTitles();
  if (named > 0) {
    console.log(`[chat] backfilled titles for ${named} conversation(s)`);
  }
} catch (error) {
  console.error("[chat] title backfill failed:", error);
}

// TASK-105 AC#1/#2: before serving, settle rows a previous run stranded in
// `work`. The sidecar dies with its turn (Tauri RunEvent::Exit) and nothing
// else ever reconciles those rows, so a tool card left mid-run would replay
// as running forever. No turn of THIS process is live yet (the pass runs
// before startSidecar), so every work row is by definition stranded.
// Never block boot on it, same rule as the two passes above.
try {
  const { recoverStrandedWorkRows } = await import("./chat-store");
  const { interrupted, settled } = await recoverStrandedWorkRows();
  if (interrupted > 0 || settled > 0) {
    console.log(
      `[chat] boot recovery: ${interrupted} stranded tool row(s) marked interrupted, ${settled} work row(s) settled`
    );
  }
} catch (error) {
  console.error("[chat] stranded-row recovery failed:", error);
}

// TASK-109: before serving, expire parked cards a crash orphaned. An ask or
// permission engine park dies with the process, but its `pending` row
// survives and replayed as a tappable card whose answer could never reach a
// park. The pass settles those rows to `error` (the same outcome as the
// in-process onExpire settle) without touching content — no fabricated
// answer. Never block boot on it, same rule as the passes above.
try {
  const { recoverStrandedPendingCards } = await import("./chat-store");
  const { asks, drills, permissions } = await recoverStrandedPendingCards();
  if (asks > 0 || drills > 0 || permissions > 0) {
    console.log(
      `[chat] boot recovery: ${asks} stranded ask card(s), ${drills} drill card(s), and ${permissions} permission card(s) expired`
    );
  }
} catch (error) {
  console.error("[chat] stranded-park recovery failed:", error);
}

// TASK-48: EADDRINUSE must fail LOUD and FAST. Reproduced failure mode: an
// orphaned sidecar from an unclean dev shutdown squats :4317, the new
// sidecar dies with Bun's generic "Is port 4317 in use?", and the tauri
// health-wait burns 30s before reporting a vague timeout — /api/cards/*
// dead the whole boot with no hint why. There is no safe recovery here
// (we must never kill an unknown listener), so: bind once, on failure log
// the offender and exit nonzero immediately.
const EADDRINUSE_RE = /in use|EADDRINUSE/i;
const rpcRouter = createRpcHandlers();

// TASK-102: before serving, kill the agent/terminal process groups a previous
// run left behind. A crash orphans them to init (detached children outlive the
// sidecar) and no in-memory handle survives, so the durable group registry is
// the only thing that can find them. Reaping here bounds the per-restart
// accumulation — each leftover jlpt-mcp carries a multi-megabyte predictor cache.
const { reaped, skipped } = controller.reapLeftoverChildren();
if (reaped > 0 || skipped > 0) {
  console.log(
    `[acp] boot reap: ${reaped} orphan process group(s) killed, ${skipped} skipped`
  );
}

try {
  startSidecar(app as unknown as Hono, rpcRouter, PORT, chatContext);

  console.log(`[ai] listening on :${PORT} (ws at /ws)`);

  // TASK-102: agent children spawn detached (their own process group), so they
  // SURVIVE this process exiting. Without a teardown on the way out, every
  // graceful quit leaks the whole forest that the boot reap above only catches
  // after the fact. Dispose every session (which group-kills its tree) before
  // we stop, so a clean exit leaves nothing behind.
  let tearingDown = false;
  const tearDown = (signal: string): void => {
    if (tearingDown) {
      return;
    }
    tearingDown = true;
    console.log(`[sidecar] ${signal}: disposing agent sessions before exit`);
    controller
      .disposeAll()
      .catch((error: unknown) => {
        console.warn(`[sidecar] disposeAll failed: ${String(error)}`);
      })
      .finally(() => {
        process.exit(0);
      });
  };
  process.on("SIGINT", () => {
    tearDown("SIGINT");
  });
  process.on("SIGTERM", () => {
    tearDown("SIGTERM");
  });

  // TASK-153 AC#2: a `kill -9` of the Tauri parent sends us no signal at all
  // — without this watch the sidecar would squat the port and leave its
  // detached agent children orphaned until the next boot's reap. The
  // watchdog polls the launcher-passed parent pid and runs the SAME
  // teardown here (unref'd timer, so it never keeps the process alive).
  startParentWatchdog({
    onParentGone: () => {
      tearDown("parent-exit");
    },
    parentPid: process.env.MANOBU_PARENT_PID,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (EADDRINUSE_RE.test(message)) {
    console.error(
      `[sidecar] port ${PORT} is already in use — an orphaned sidecar ` +
        "from a previous boot is likely squatting it. Find it: " +
        `ss -tlnp | grep ${PORT}; then kill it or reboot cleanly. Exiting.`
    );
  } else {
    console.error(`[sidecar] failed to bind :${PORT}:`, error);
  }
  process.exit(1);
}
