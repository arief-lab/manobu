/*
 * Shared server context (TASK-71 phase 3) — process-level singletons that
 * both the legacy Hono routes (index.ts) and the oRPC implementation
 * (rpc.ts) consume. One ACP pool, one persona table, one db factory: the
 * alternative is two pools spawning duplicate agent child processes.
 *
 * TASK-80.2: the pool keys `AcpSessionHandle`s from the native engine
 * (`@manobu/acp/session`) instead of the provider-era `AcpModelResource`.
 */

import { dirname, join, resolve } from "node:path";

import { resolveSpawnTarget } from "@manobu/acp";
import { DirectCliSession } from "@manobu/acp/direct-cli-session";
import { applyLaunchPolicy } from "@manobu/acp/launch-policy";
import { parseMcpServers } from "@manobu/acp/mcp";
import { SessionController } from "@manobu/acp/session";
import type { AcpSessionHandle } from "@manobu/acp/session-types";
import { createItemStore } from "@manobu/db/item-store";
import { env } from "@manobu/env/server";
import { AskToolServer } from "./ask-tool";
import { loadPersonasAtBoot } from "./assistant-loader";
import { createChatContext } from "./chat-hub";
import {
  getChatDb,
  getUserAcpSessionId,
  settlePending,
  setUserAcpSessionId,
} from "./chat-store";
import { createDrillBridge, type DrillBridge } from "./services/drill-bridge";
import { createDrillLifecycle } from "./services/drill-lifecycle";
import { createCorpusDrillBatchProvider } from "./services/drill-provider";
import { createExamService } from "./services/exam-service";
import { getUserDb } from "./user-db";

// ── Persona table (assistants-as-markdown, loaded at boot) ────────

export const personas = loadPersonasAtBoot();
export const DEFAULT_PERSONA_ID = "sensei";

// ── Native ACP engine ──────────────────────────────────────────────

/** A `scheme://` prefix marks a URL-ish DATABASE_URL, not a local file. */
const URL_SCHEME_RE = /^[a-z]+:\/\//i;

/**
 * Where the spawned-agent process-group registry lives (TASK-102). Kept next to
 * the chat DB so a packaged app writes inside its own data directory and the
 * next boot finds the leftovers a crash orphaned. ACP_CHILD_REGISTRY overrides;
 * a non-file DATABASE_URL (memory/URL) falls back to the engine's tmpdir
 * default. The path is derived, never stored, so it tracks a moved db.
 * `childRegistryPath` below is the export the system-info route reports (TASK-153 AC#3).
 */
function acpChildRegistryPath(databaseUrl: string): string | undefined {
  const override = process.env.ACP_CHILD_REGISTRY;
  if (override) {
    return override;
  }
  const file = databaseUrl.startsWith("file:")
    ? databaseUrl.slice("file:".length)
    : databaseUrl;
  // Reject a bare in-memory db and any remaining URL-ish scheme.
  if (file.length === 0 || file === ":memory:" || URL_SCHEME_RE.test(file)) {
    return undefined;
  }
  return join(dirname(resolve(file)), ".acp-children.json");
}

/**
 * The one session engine; every conversation shares its child registry.
 * TASK-88: CONFIRMATION_TIMEOUT_MS tunes the engine backstop for parked
 * asks and permission cards; unset keeps the 30-min default.
 * TASK-102: childRegistryPath makes the engine's teardown + boot reap durable.
 */
export const childRegistryPath = acpChildRegistryPath(env.DATABASE_URL);

export const controller = new SessionController({
  childRegistryPath,
  confirmationTimeoutMs: env.CONFIRMATION_TIMEOUT_MS,
});

const handlesByConversation = new Map<string, AcpSessionHandle>();

let drillBridgePromise: Promise<DrillBridge> | null = null;

export function getDrillBridge(): Promise<DrillBridge> {
  drillBridgePromise ??= (async () => {
    const db = await getChatDb();
    const lifecycle = createDrillLifecycle(db, {
      batches: createCorpusDrillBatchProvider(),
      validateItem: async () => true,
    });
    return createDrillBridge({
      controller,
      getConversationSession: async (conversationId) => {
        const sessionId = await getUserAcpSessionId(conversationId);
        if (!sessionId) {
          return null;
        }
        const handle = controller.handleFor(sessionId);
        return handle ? { handle, sessionId } : null;
      },
      getDrillSessionOwner: async (drillSessionId) => {
        try {
          const state =
            await createItemStore(db).getDrillSessionState(drillSessionId);
          return state ? { conversationId: state.conversationId } : null;
        } catch {
          return null;
        }
      },
      lifecycle,
    });
  })();
  return drillBridgePromise;
}

/**
 * The one live-frame hub registry for the process (TASK-80.14). `/rpc` and
 * `/ws` are both served off it, so a frame published here reaches the
 * transcript that is streaming. It is built here rather than in `index.ts`
 * because the host `start_exam` tool needs it too (TASK-147 AC#1): the paper
 * card has to land in the conversation that asked for it, mid-turn, not only in
 * the durable row a reload would find.
 */
export const chatContext = createChatContext();

/**
 * The deterministic exam service. `start_exam` is a TRIGGER for it, never an
 * implementation of it: request and assemble are the same code an `/rpc`
 * client calls, so the agent's paper is the paper the model-free path builds
 * (doc-21 §5 keeps that path authoritative).
 */
const examService = createExamService(getUserDb);

/**
 * The host `ask_user` MCP server (TASK-80.2): sessions attach its
 * per-conversation endpoint, a blocking tools/call parks an ask frame on
 * the live handle, and the REST answer endpoint resolves it.
 *
 * TASK-86: when the tool-side deadline wins the race or the park rejects,
 * no answer will ever reach the agent, so the parked row settles to
 * "error" and replays as an expired card instead of staying interactive
 * forever.
 *
 * TASK-88: ASK_TIMEOUT_MS tunes the tool-side deadline (default 25 min).
 * Note the agent's own MCP client usually abandons a blocking tools/call
 * far earlier (60 s in the reference SDK) — this deadline only bounds how
 * long the parked row can linger before it settles.
 */
export const askTool = new AskToolServer({
  askTimeoutMs: env.ASK_TIMEOUT_MS,
  drillTimeoutMs: env.CONFIRMATION_TIMEOUT_MS,
  onDrillExpire: (conversationId, requestId) => {
    settlePending(conversationId, requestId, "error").catch(
      (error: unknown) => {
        console.warn(
          `[drill] settle expired item failed for ${conversationId}/${requestId}: ${String(error)}`
        );
      }
    );
  },
  onExpire: (conversationId, requestId) => {
    settlePending(conversationId, requestId, "error").catch(
      (error: unknown) => {
        console.warn(
          `[ai] settle expired ask failed for ${conversationId}/${requestId}: ${String(error)}`
        );
      }
    );
  },
  park: (conversationId, questions, key) => {
    const handle = handlesByConversation.get(conversationId);
    if (!handle) {
      throw new Error(
        `ask_user: no live session for conversation ${conversationId}`
      );
    }
    // TASK-92: key forwards the content hash so re-calls attach to the
    // same park instead of minting a duplicate card.
    return controller.parkAsk(handle, questions, key);
  },
  parkDrillItem: async (conversationId, drillSessionId) => {
    const bridge = await getDrillBridge();
    return bridge.park({ conversationId, drillSessionId });
  },
  // TASK-94: the tool-side deadline is authoritative — retire the engine
  // park so a late tap can never answer an expired row.
  retire: (requestId) => {
    controller.retireAsk(requestId);
  },
  retireDrillItem: (requestId) => {
    controller.retireDrillItem(requestId);
  },
  /**
   * TASK-147: build the paper and hand back what the agent may say about it.
   * The projection is the whole point: sections and counts, never an item. The
   * agent never sees a stem it could read aloud, and it never gets a field it
   * could set the size of.
   *
   * TASK-156: because the host owns the size, the agent is the only thing that
   * can tell a learner who asked for ten questions that they are getting thirty.
   * `sizeStatement` says it in the result, so the reply repeats a fact instead
   * of inventing one. doc-21 §9.2 stands: the count is still not settable from
   * here; learner-sized papers are TASK-167.
   *
   * TASK-148: a paper that came up short is not `ready`, and `start` refuses it,
   * so returning it as if it were usable told the agent to advertise a paper the
   * learner can never open. Throw instead, and `examFailure` (ask-tool.ts) turns
   * it into "the paper could not be built". The two reasons are distinguished
   * because they are different sentences to the learner: this level ran out of
   * new questions versus something went wrong building this one.
   */
  startExam: async (conversationId, { focus, level, mode }) => {
    const requested = await examService.request({
      conversationId,
      focus,
      level,
      mode,
    });
    const built = await examService.assemble(requested.examId, chatContext);
    if (!built.ready) {
      // TASK-173.4 AC#4: a `real` paper is short for a third reason and it is now
      // the common one. The official 大問 shape asks for question kinds the item
      // engine does not have, or for 読解 kinds whose level has no store behind
      // them, so the section cannot be filled by ANY content and `unfilledBlocks`
      // names which parts of the paper those are. This is neither
      // TASK-148 exhaustion (the learner has not run the level dry) nor the
      // TASK-173.1 refusal (nothing was turned down); it is the app saying which
      // part of the real paper it cannot ask yet.
      if (built.unfilledBlocks.length > 0) {
        const missing = built.unfilledBlocks
          .map(
            (block) =>
              `${block.section} 大問 ${String(block.bigQuestion)} (${block.name})`
          )
          .join(", ");
        throw new Error(
          `the ${built.level} real paper cannot be built yet: ${missing} ask for a part of the official paper the app cannot ask yet, so only ${String(
            built.validatedSlots
          )} of ${String(built.totalSlots)} items could be real. Tell the learner exactly which parts of the real paper the app cannot ask, and offer a practice paper instead of a mock that is missing whole 大問.`
        );
      }
      // TASK-173.1 AC#4: the other way a `real` paper comes up short. Not
      // exhaustion (the content is there) and not a broken build: the mode turned
      // down candidates it could only have fabricated, and `refusedSections` says
      // where.
      if (built.refusedSections.length > 0) {
        throw new Error(
          `the real paper refused to fill ${built.refusedSections.join(
            " and "
          )} from content it could only have invented: only ${String(
            built.validatedSlots
          )} of ${String(built.totalSlots)} items were authentic enough to ask. Tell the learner which part the app cannot yet ask for real, and offer a practice paper instead of one padded with made-up options.`
        );
      }
      throw new Error(
        built.contentExhausted
          ? `the ${built.level} level has no unseen content left for this learner: only ${String(
              built.validatedSlots
            )} of ${String(built.totalSlots)} items could be filled. Tell the learner that, and offer a different level.`
          : `the paper came up short: ${String(
              built.validatedSlots
            )} of ${String(built.totalSlots)} items were filled.`
      );
    }
    return {
      examId: built.examId,
      level: built.level,
      mode: built.mode,
      sections: built.sections.map((section) => ({
        id: section.id,
        items: section.requestedItems,
        validated: section.validatedItems,
      })),
      sizeStatement: `${String(built.totalSlots)} items, sized by the host from the ${built.level} default budget.`,
      totalItems: built.totalSlots,
    };
  },
});

/**
 * Absolute loopback origin the agent children can dial for host MCP calls
 * (ask-tool endpoint). Bun's sidecar port comes from BUN_PORT (4317 packaged,
 * 4399 smoke, 3000 dev) — same source of truth as index.ts.
 */
function sidecarOrigin(): string {
  const port = Number(process.env.BUN_PORT ?? 3000);
  return `http://127.0.0.1:${port}`;
}

// ── ACP warm-session pool ─────────────────────────────────────────
// Warm ACP sessions, keyed by `agentId` or `agentId::conversationId` — the
// AionUi-style per-conversation pool. The agent child for each key stays
// alive between calls so TTFT stays low, and switching agents/conversations
// is a hot map lookup instead of a restart. LRU-capped at AGENT_POOL_LIMIT.

const AGENT_POOL_LIMIT = 3;

const acpPool = new Map<string, AcpSessionHandle>();
const acpInit = new Map<string, Promise<AcpSessionHandle>>();

/**
 * Composite pool key: `agentId` alone (shared chat) or
 * `agentId::conversationId` when the caller binds a conversation (AionUi
 * per-conversation session pool). Sharing is opt-in — no conversationId
 * keeps the single-session behaviour.
 */
function poolKeyFor(agentId?: string, conversationId?: string): string {
  const agentKey = resolveSpawnTarget(agentId ?? env.ACP_AGENT_BIN).id;
  const conv = conversationId?.trim();
  return conv ? `${agentKey}::${conv}` : agentKey;
}

/**
 * Evict least-recently-used warm sessions past the pool cap. Disposal is
 * concurrent (Promise.all) — eviction is best-effort cleanup.
 */
async function evictIfOverLimit(): Promise<void> {
  const overflow: [string, AcpSessionHandle | undefined][] = [];
  for (const key of acpPool.keys()) {
    if (acpPool.size - overflow.length <= AGENT_POOL_LIMIT) {
      break;
    }
    overflow.push([key, acpPool.get(key)]);
    acpPool.delete(key);
  }
  await Promise.all(
    overflow.map(async ([key, evicted]) => {
      await (evicted
        ? controller.dispose(evicted.sessionId).catch((error: unknown) => {
            console.warn(
              `[ai] dispose failed for evicted session ${key}: ${String(error)}`
            );
          })
        : Promise.resolve());
      console.log(`[ai] evicted warm ACP session: ${key}`);
    })
  );
}

/**
 * User-configured MCP servers, read once from `ACP_MCP_SERVERS` (TASK-96).
 * The Tauri shell renders its whole catalog into this literal
 * (`src-tauri/src/mcp.rs::resolve_acp_mcp_servers`, precedence env literal →
 * `config/mcp-servers.json` → bundled `jlpt-mcp`), so the sidecar parses one
 * string rather than reading the file. The provider-era reader died in
 * TASK-80.6 and nothing replaced it, which left the literal write-only: no
 * configured server reached any `session/new`. `applyLaunchPolicy` still drops
 * the list for agents with `forwardMcp: false`.
 */
const configuredMcpServers = parseMcpServers(env.ACP_MCP_SERVERS);

/**
 * Get (or spawn) the warm session for one agent + optional conversation.
 * `agentId` is a registry id/command (`opencode`, `claude-code`, …) or
 * `undefined` for the env-pinned default. Concurrent callers for the same
 * key share one spawn promise. Cached sessions are health-checked: a dead
 * agent child is disposed and respawned rather than handed to the request.
 *
 * The ACP sessionId is persisted per conversation (chat-store) so a server
 * restart resumes with `session/load` when the agent supports it.
 */
export async function ensureAcp(
  agentId?: string,
  conversationId?: string
): Promise<AcpSessionHandle> {
  const key = poolKeyFor(agentId, conversationId);
  const cached = acpPool.get(key);
  if (cached) {
    if (cached.isHealthy() && cached.sessionActive) {
      // refresh LRU recency
      acpPool.delete(key);
      acpPool.set(key, cached);
      return cached;
    }
    acpPool.delete(key);
    console.warn(
      `[ai] warm ACP session "${key}" is dead — evicting and respawning`
    );
    await controller.dispose(cached.sessionId).catch(() => undefined);
  }
  let pending = acpInit.get(key);
  if (!pending) {
    pending = (async (): Promise<AcpSessionHandle> => {
      const target = resolveSpawnTarget(agentId ?? env.ACP_AGENT_BIN);
      const spec = applyLaunchPolicy({
        agent: target,
        cwd: process.cwd(),
        mcpServers: configuredMcpServers,
      });
      const resumeSessionId = conversationId
        ? await getUserAcpSessionId(conversationId)
        : null;
      const extraMcpServers = conversationId
        ? await askTool.mcpServersFor(
            conversationId,
            target.capabilities.mcpHttp,
            sidecarOrigin()
          )
        : [];
      let handle: AcpSessionHandle;
      if (target.transport === "direct-cli") {
        // The agy dialect adapter (TASK-80.6): single-shot `agy --print`
        // wrapped in an AcpSessionHandle-shaped session; no ACP child.
        const directCli = new DirectCliSession({
          agentId: target.id,
          command: spec.command,
          cwd: spec.cwd,
          model: spec.model ?? null,
        });
        controller.registerDirectCli(directCli);
        const { handle: directCliHandle } = directCli;
        handle = directCliHandle;
      } else {
        handle = await controller.ensureSession(
          { ...spec, resume: resumeSessionId ?? undefined },
          { agentId: target.id, extraMcpServers }
        );
      }
      if (conversationId) {
        handlesByConversation.set(conversationId, handle);
        await setUserAcpSessionId(conversationId, handle.sessionId);
      }
      acpPool.set(key, handle);
      console.log(
        `[ai] ${target.transport === "direct-cli" ? "direct-CLI agent ready" : "ACP agent ready"}: ${handle.agentId} (${key})`
      );
      await evictIfOverLimit();
      return handle;
    })();
    acpInit.set(key, pending);
  }
  try {
    return await pending;
  } finally {
    acpInit.delete(key);
  }
}

/** Drop a conversation's warm session (delete/cleanup paths). */
