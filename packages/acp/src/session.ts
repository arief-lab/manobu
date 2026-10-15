/**
 * Native ACP session engine (TASK-80.1) — `SessionController`.
 *
 * Speaks ACP directly over child-process stdio via
 * `@agentclientprotocol/sdk`'s `ClientSideConnection` (NDJSON JSON-RPC),
 * with zero AI SDK involvement. Semantics mirror aioncore's `acp_conn.rs`
 * and `aionui-ai-agent/src/protocol/acp.rs`:
 *
 * - `initialize` advertises `terminal: true` and `fs: false` (file access
 *   is never granted to agents) plus a non-empty `clientInfo` (required by
 *   some agents, e.g. Mistral Vibe).
 * - `session/new` attaches MCP servers negotiated through `mcp.ts` (this is
 *   where jlpt-mcp is served).
 * - `session/load` resumes under a replay-suppression guard: history the
 *   agent streams back during load updates internal state but is NOT
 *   emitted as UI events (our message table is the source of truth).
 * - `session/prompt` blocks until the turn's terminal response; that
 *   response (stopReason + usage) IS the turn terminal, and the SDK's
 *   single ordered reader guarantees every update folded before it.
 * - `session/cancel` is a bare notification; its ack is the in-flight
 *   prompt's `stopReason: "cancelled"`.
 * - `session/request_permission` parks a Confirmation keyed by
 *   `toolCallId` until `confirm()` echoes a REAL offered optionId
 *   (kind-based fallback, then `cancelled`).
 * - asks and drill items park via `parkAsk()` / `parkDrillItem()`; host MCP
 *   tools resolve them through `answerAsk()` / `answerDrillItem()`.
 * - `terminal/*` is hosted by `session-terminals.ts` (TerminalRegistry).
 * - inbound `session/update` translation lives in `session-translator.ts`.
 *
 * The public surface is exactly TASK-80.1 AC#2:
 *   ensureSession, prompt, cancel, confirm, answerAsk, answerDrillItem,
 *   killTerminal, configOptions, dispose.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import {
  type Client,
  ClientSideConnection,
  type McpServer,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

import {
  type AcpAskAnswer,
  type AcpAskQuestion,
  type AcpConfigOption,
  type AcpDrillItem,
  type AcpDrillItemEvent,
  type AcpDrillResolution,
  type AcpDrillSnapshot,
  type AcpEventSink,
  type AcpPermissionOption,
  type AcpStreamEvent,
  type AcpToolCallUpdatePayload,
  projectAcpDrillResolution,
} from "./acp-events";
import {
  ChildRegistry,
  commandBaseName,
  killGroupQuiet,
} from "./child-registry";
import type { DirectCliSession } from "./direct-cli-session";
import type { CommandSpec } from "./launch-policy";
import {
  capabilitiesFromRegistry,
  capabilitiesFromRuntime,
  negotiateMcpServers,
  toMcpServer,
} from "./mcp";
import type { AgentCapabilities } from "./registry";
import {
  AcpHandshakeTimeoutError,
  acpAuthRequiredError,
  acpConfigSwitchError,
  agentChildEnv,
  captureStderr,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  failureDetail,
  isAuthRejection,
  tolerantStdout,
  withTimeout,
} from "./session-child";
import {
  applyConfigOptions,
  configOptionRequest,
  contentBlocks,
  errorMessage,
  foldLegacyModelMode,
  formatAskAnswer,
  normalizeConfigOptions,
  normalizeToolCallUpdate,
  type OpenSessionResult,
} from "./session-normalize";
import { TerminalRegistry } from "./session-terminals";
import { translateSessionUpdate } from "./session-translator";
import {
  AcpSessionHandle,
  type ArmedTurn,
  type EnsureSessionOptions,
  type PromptInput,
  type PromptStopReason,
  type PromptTurnResult,
  type PromptUsage,
} from "./session-types";

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 30 * 60 * 1000;
/** Fallback MCP caps for agents that advertise none. */
const BASELINE_AGENT_CAPS: AgentCapabilities = {
  mcpHttp: false,
  mcpSse: false,
  mcpStdio: true,
  streaming: true,
};
/** Reject-ish option ids echo reject options; everything else allow (aioncore). */
const REJECT_OPTION_PATTERN = /reject|deny/i;

interface ParkedPermission {
  emit: AcpEventSink | null;
  options: AcpPermissionOption[];
  requestId: string;
  resolve: (response: RequestPermissionResponse) => void;
  sessionId: string;
  timer: ReturnType<typeof setTimeout>;
  toolCall: AcpToolCallUpdatePayload;
  toolCallId: string;
}

interface ParkedAsk {
  /** The waiter itself, kept so a settle can retire it for re-attachers. */
  promise: Promise<string>;
  questions: AcpAskQuestion[];
  reject: (error: Error) => void;
  requestId: string;
  resolve: (text: string) => void;
  sessionId: string;
  /** Composed park identity (TASK-92); absent for un-keyed parks. */
  stableKey: string | null;
  /** TASK-94: how long the settled outcome keeps replaying. */
  terminalReplayMs: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Settled park kept for late re-callers: same waiter, already resolved. */
interface TerminalAsk {
  /** TASK-94: entries older than this settle no longer replay (ms epoch). */
  expiresAt: number;
  promise: Promise<string>;
  requestId: string;
}

interface ParkedDrill {
  drillSessionId: string;
  handle: AcpSessionHandle;
  item: AcpDrillItem;
  promise: Promise<AcpDrillResolution>;
  reject: (error: Error) => void;
  requestId: string;
  resolve: (resolution: AcpDrillResolution, snapshot: AcpDrillSnapshot) => void;
  sessionId: string;
  snapshot: AcpDrillSnapshot;
  stableKey: string | null;
  terminalReplayMs: number;
  timer: ReturnType<typeof setTimeout>;
}

interface TerminalDrill {
  expiresAt: number;
  promise: Promise<AcpDrillResolution>;
  requestId: string;
}

/** Terminal-replay cache bound per controller (FIFO eviction). */
const TERMINAL_ASK_CACHE_LIMIT = 64;
/**
 * TASK-94: how long a settled park keeps replaying. Covers abandonment
 * retries (seconds to minutes after a client timeout) while a verbatim
 * re-ask much later (e.g. "drill the same 3 questions again") parks fresh.
 */
const TERMINAL_ASK_REPLAY_MS = 5 * 60 * 1000;

/**
 * The native ACP engine. One instance per server process; sessions are
 * keyed by their ACP `sessionId`. All agent children, hosted terminals,
 * parked permissions, asks and drill items live here.
 */
export class SessionController {
  readonly #asks = new Map<string, ParkedAsk>();
  /** TASK-92: live parks by stable key (compose sessionId + question hash). */
  readonly #asksByStableKey = new Map<string, string>();
  readonly #drills = new Map<string, ParkedDrill>();
  readonly #drillsByStableKey = new Map<string, string>();
  readonly #confirmationTimeoutMs: number;
  /** TASK-99: budget for initialize + session/new|load + policy switches. */
  readonly #handshakeTimeoutMs: number;
  /** TASK-102: durable record of spawned group leaders, reaped at next boot. */
  readonly #children: ChildRegistry;
  readonly #permissions = new Map<string, ParkedPermission>();
  readonly #sessions = new Map<string, AcpSessionHandle>();
  /**
   * The direct-cli dialect adapters (agy, TASK-80.6): one per session id,
   * keyed by the handle's sessionId. `prompt`/`configOptions`/`cancel`
   * dispatch to the adapter when present — the AionCore per-dialect
   * connection pattern (ACP vs single-shot CLI).
   */
  readonly #directCli = new Map<string, DirectCliSession>();
  readonly #terminals: TerminalRegistry;
  /** TASK-92: settled parks replayed to late re-callers, FIFO-bounded. */
  readonly #terminalAsksByStableKey = new Map<string, TerminalAsk>();
  readonly #terminalDrillsByStableKey = new Map<string, TerminalDrill>();

  constructor(
    options: {
      /** TASK-102: where the spawned-group registry persists. A server points
       * this into its data directory; a bare controller uses the tmpdir. */
      childRegistryPath?: string;
      confirmationTimeoutMs?: number;
      /** Handshake budget; `0` disables it (a child that is slow to start
       * should fail visibly rather than wedge the caller). */
      handshakeTimeoutMs?: number;
    } = {}
  ) {
    this.#confirmationTimeoutMs =
      options.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
    this.#handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.#children = new ChildRegistry({
      filePath: options.childRegistryPath,
    });
    // Hosted terminals share the agent's fate: each spawns as its own group
    // leader so a command's own subprocesses die with it, and registers so a
    // crash between spawn and teardown still gets reaped at the next boot.
    this.#terminals = new TerminalRegistry({
      onRelease: (pgid) => {
        this.#children.unregister(pgid);
      },
      onSpawn: (pgid, marker) => {
        this.#children.register(pgid, "terminal", marker);
      },
    });
  }

  /** Live session ids (health sweeps, pool reconciliation). */
  sessionIds(): string[] {
    return [...this.#sessions.keys()];
  }

  get(sessionId: string): AcpSessionHandle | null {
    return this.#sessions.get(sessionId) ?? null;
  }

  /** Parked-permission payloads for one session (recovery projection, 80.2). */
  pendingPermissions(sessionId: string): AcpStreamEvent[] {
    const out: AcpStreamEvent[] = [];
    for (const parked of this.#permissions.values()) {
      if (parked.sessionId === sessionId) {
        out.push({
          options: parked.options,
          request_id: parked.requestId,
          session_id: sessionId,
          tool_call: parked.toolCall,
          type: "acp_permission",
        });
      }
    }
    return out;
  }

  /** Parked-ask payloads for one session (recovery projection, 80.2). */
  pendingAsks(sessionId: string): AcpStreamEvent[] {
    const out: AcpStreamEvent[] = [];
    for (const ask of this.#asks.values()) {
      if (ask.sessionId === sessionId) {
        out.push({
          questions: ask.questions,
          request_id: ask.requestId,
          session_id: sessionId,
          type: "ask",
        });
      }
    }
    return out;
  }

  pendingDrills(sessionId: string): AcpStreamEvent[] {
    const out: AcpStreamEvent[] = [];
    for (const drill of this.#drills.values()) {
      if (drill.sessionId === sessionId) {
        out.push(this.#pendingDrillEvent(drill));
      }
    }
    return out;
  }

  /**
   * The handle backing a conversation (80.2's chat layer looks sessions up
   * by the ACP sessionId it persisted, not by engine internals).
   */
  handleFor(sessionId: string): AcpSessionHandle | null {
    return this.#sessions.get(sessionId) ?? null;
  }

  /**
   * Register a direct-cli dialect adapter (agy) so `prompt` /
   * `configOptions` / `cancel` dispatch to it by session id. The handle is
   * also indexed in `#sessions` so `handleFor` / `listConfirmations` /
   * `dispose` all see it.
   */
  registerDirectCli(session: DirectCliSession): void {
    this.#sessions.set(session.handle.sessionId, session.handle);
    this.#directCli.set(session.handle.sessionId, session);
  }

  /**
   * Pending permission, ask and drill cards for one session, oldest-first,
   * as the chat layer projects them onto `chat.listConfirmations` (recovery after
   * a reload: the parks are in-memory engine state, not persisted rows).
   */
  listConfirmations(sessionId: string): AcpStreamEvent[] {
    return [
      ...this.pendingPermissions(sessionId),
      ...this.pendingAsks(sessionId),
      ...this.pendingDrills(sessionId),
    ];
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Spawn an agent child from a `CommandSpec`, run the handshake, open a
   * session (`session/load` when `spec.resume` is set and the agent supports
   * it, else `session/new`), then apply any requested model/mode from the
   * launch policy. Resolves once the session is `session_active`.
   */
  async ensureSession(
    spec: CommandSpec,
    opts: EnsureSessionOptions = {}
  ): Promise<AcpSessionHandle> {
    const handle = new AcpSessionHandle(opts.agentId ?? spec.command);
    handle.emitStatus("connecting");
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(spec.command, spec.args, {
        // TASK-102: own process group, so teardown can signal the whole tree
        // the agent spawns (its jlpt-mcp sidecar + tool subprocesses), not just
        // the direct child we hold a handle to.
        cwd: spec.cwd,
        detached: true,
        env: agentChildEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      handle.emitStatus("error", errorMessage(error));
      throw error;
    }
    // TASK-99: drain stderr (so a chatty agent can't block on a full pipe,
    // the way the old provider did) but keep a bounded redacted tail, so a
    // handshake failure can report what the child actually said.
    const stderr = captureStderr(child.stderr);
    handle.stderrTail = stderr;
    handle.child = child;
    // TASK-102: record the group leader before anything can fail, so a crash
    // between here and teardown still leaves a reaper that finds this process.
    if (child.pid !== undefined) {
      this.#children.register(
        child.pid,
        "agent",
        commandBaseName(spec.command)
      );
    }
    child.on("error", (error) => {
      this.#markDead(handle, `spawn error: ${String(error)}`);
    });
    child.on("exit", (code, signal) => {
      this.#markDead(handle, `agent exited (${code ?? signal})`);
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      tolerantStdout(child.stdout)
    );
    const connection = new ClientSideConnection(
      () => this.#buildClient(handle),
      stream
    );
    handle.connection = connection;
    connection.signal.addEventListener("abort", () => {
      // The SDK aborts this signal with the cause of the transport close
      // (stream error, child death); surface it instead of a bare
      // "connection closed" so a junk-flood or crash is legible.
      const { reason } = connection.signal;
      this.#markDead(
        handle,
        reason instanceof Error && reason.message.length > 0
          ? `connection closed: ${reason.message}`
          : "connection closed"
      );
    });

    try {
      await withTimeout({
        ms: this.#handshakeTimeoutMs,
        onTimeout: () =>
          new AcpHandshakeTimeoutError(
            handle.agentId,
            this.#handshakeTimeoutMs,
            stderr.tail()
          ),
        work: this.#openSession(handle, spec, opts),
      });
    } catch (error) {
      this.#teardown(handle);
      handle.emitStatus("error", failureDetail(errorMessage(error), stderr));
      throw error;
    }
    return handle;
  }

  /**
   * The handshake orchestration (TASK-81.4): one linear step per phase —
   * initialize → MCP negotiation → open (new or load) → snapshot/switches.
   * Every step failure propagates to `ensureSession`, which tears the child
   * down; no step may swallow errors (pinned by the failure table test).
   */
  async #openSession(
    handle: AcpSessionHandle,
    spec: CommandSpec,
    opts: EnsureSessionOptions
  ): Promise<void> {
    const caps = await this.#initialize(handle);
    const mcpServers = this.#negotiateMcp(spec, opts, caps);
    const opened = await this.#openChannel(handle, spec, mcpServers);
    const sessionId = opened.sessionId ?? spec.resume;
    if (!sessionId) {
      throw new Error(
        `agent "${handle.agentId}" opened a session without an id`
      );
    }
    handle.sessionId = sessionId;
    this.#sessions.set(sessionId, handle);

    this.#applyOpenSnapshot(handle, opened);
    await this.#applyRequestedSwitches(handle, spec);
    handle.sessionActive = true;
    handle.emitStatus("session_active");
  }

  /** Handshake step 1: `initialize`; fold advertised caps onto the handle. */
  async #initialize(
    handle: AcpSessionHandle
  ): Promise<Record<string, unknown>> {
    const { connection } = handle;
    if (!connection) {
      throw new Error("connection missing during openSession");
    }
    const init = await connection.initialize({
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: true,
      },
      clientInfo: { name: "manobu-acp", version: "0.1.0" },
      protocolVersion: PROTOCOL_VERSION,
    });
    const caps = (init.agentCapabilities ?? {}) as Record<string, unknown>;
    const promptCaps = (caps.promptCapabilities ?? {}) as Record<
      string,
      unknown
    >;
    handle.promptCapabilities.audio = promptCaps.audio === true;
    handle.promptCapabilities.embeddedContext =
      promptCaps.embeddedContext === true;
    handle.promptCapabilities.image = promptCaps.image === true;
    handle.supportsLoadSession = caps.loadSession === true;
    const closeCap = caps.sessionCapabilities as Record<string, unknown> | null;
    handle.supportsCloseSession =
      closeCap?.close !== undefined && closeCap?.close !== null;
    // TASK-102 AC#5: keep the advertised auth-method names. This is a fact
    // about what the agent SUPPORTS, not a verdict that it requires auth —
    // that only becomes known when a session open is actually rejected
    // (see `isAuthRejection`), so agents that advertise yet chat anonymously
    // are unaffected.
    const authMethods = init.authMethods ?? [];
    handle.authMethodNames = authMethods
      .map((method) => method.name)
      .filter((name) => name.length > 0);
    handle.emitStatus("connected", init.agentInfo?.name);
    return caps;
  }

  /** Handshake step 2: negotiate which MCP servers to attach. */
  #negotiateMcp(
    spec: CommandSpec,
    opts: EnsureSessionOptions,
    caps: Record<string, unknown>
  ): McpServer[] {
    const capsView =
      capabilitiesFromRuntime(
        caps.mcpCapabilities as
          | Parameters<typeof capabilitiesFromRuntime>[0]
          | null
      ) ?? capabilitiesFromRegistry(opts.agentCaps ?? BASELINE_AGENT_CAPS);
    const negotiation = negotiateMcpServers(spec.mcpServers, capsView);
    const mcpServers: McpServer[] = negotiation.attached.map(toMcpServer);
    // Host-provided servers (apps/server's ask_user MCP, 80.2) bypass the
    // registry negotiation filter — the caller already shaped them.
    mcpServers.push(...(opts.extraMcpServers ?? []));
    for (const skipped of negotiation.skipped) {
      console.warn(
        `[acp] skipping MCP server "${skipped.server.id}": ${skipped.reason}`
      );
    }
    return mcpServers;
  }

  /** Handshake step 3: `session/load` (with the replay-suppression guard)
   * when resuming a supported session, else `session/new`. A rejection the
   * agent phrases as an auth failure is re-thrown as the tagged
   * `acpAuthRequiredError` (TASK-102 AC#4) so the client shows a sign-in
   * prompt, not a generic send failure. Classification is on the agent's
   * actual words, never on advertised `authMethods` (non-regressive). */
  async #openChannel(
    handle: AcpSessionHandle,
    spec: CommandSpec,
    mcpServers: McpServer[]
  ): Promise<OpenSessionResult> {
    const { connection } = handle;
    if (!connection) {
      throw new Error("connection missing during openSession");
    }
    try {
      if (spec.resume && handle.supportsLoadSession) {
        // Replay-suppression guard: history streamed during load updates
        // internal state but never reaches the UI sink.
        handle.suppressUiEvents = true;
        try {
          return await connection.loadSession({
            cwd: spec.cwd,
            mcpServers,
            sessionId: spec.resume,
          });
        } finally {
          handle.suppressUiEvents = false;
        }
      }
      return await connection.newSession({ cwd: spec.cwd, mcpServers });
    } catch (error) {
      if (isAuthRejection(error)) {
        throw acpAuthRequiredError(
          handle.agentId,
          handle.authMethodNames,
          error
        );
      }
      throw error;
    }
  }

  // ── Turns ──────────────────────────────────────────────────────────

  /**
   * Run one prompt turn: emits `turn_start`, every translated update (via
   * `sink`), terminal usage, then the `turn_end` terminal event; resolves
   * with the stop reason. Throws `AIONUI_CONVERSATION_BUSY` when a turn is
   * already in flight — the server's queue normally prevents this; the
   * throw is the race guard.
   */
  async prompt(
    handle: AcpSessionHandle,
    input: PromptInput
  ): Promise<PromptTurnResult> {
    // Direct-cli dialect (agy): a single-shot child per prompt, no ACP
    // connection — the adapter owns the frame sequence.
    const directCli = this.#directCli.get(handle.sessionId);
    if (directCli) {
      return directCli.prompt(input);
    }
    const { connection } = handle;
    if (!connection) {
      throw new Error("agent connection is closed");
    }
    if (!handle.sessionActive) {
      throw new Error("session is not active");
    }
    if (handle.activeTurn) {
      throw new Error(
        "AIONUI_CONVERSATION_BUSY: a prompt turn is already running for this session"
      );
    }
    const { sink } = input;
    const turn = armTurn(handle, sink, input.turnId);
    handle.lastSink = sink;

    sink({ session_id: handle.sessionId, type: "turn_start" });
    const blocks = contentBlocks(handle.promptCapabilities, input);

    connection
      .prompt({ prompt: blocks, sessionId: handle.sessionId })
      .then((response) => {
        this.#settleTurn(handle, turn, {
          stopReason: response.stopReason,
          usage: (response.usage ?? null) as PromptUsage | null,
        });
      })
      .catch((error: unknown) => {
        this.#failTurn(handle, turn, error);
      });

    return await turn.done;
  }

  #settleTurn(
    handle: AcpSessionHandle,
    turn: ArmedTurn,
    terminal: { stopReason: PromptStopReason; usage: PromptUsage | null }
  ): void {
    if (turn.settled) {
      return;
    }
    turn.settled = true;
    // The turn is over: release the session claim so the next prompt is not
    // rejected by the busy race guard. The `===` check keeps a late settle of
    // a superseded turn from clearing a newer in-flight one.
    if (handle.activeTurn === turn) {
      handle.activeTurn = null;
    }
    const { usage } = terminal;
    if (usage) {
      turn.sink({
        data: {
          // Terminal token breakdown rides under _meta (AionUi convention).
          _meta: { ...usage },
          size: 0,
          used: usage.totalTokens,
        },
        type: "acp_context_usage",
      });
    }
    turn.sink({ stopReason: terminal.stopReason, type: "turn_end", usage });
    turn.resolve({
      stopReason: terminal.stopReason,
      turnId: turn.turnId,
      usage,
    });
  }

  #failTurn(handle: AcpSessionHandle, turn: ArmedTurn, error: unknown): void {
    if (turn.settled) {
      return;
    }
    turn.settled = true;
    if (handle.activeTurn === turn) {
      handle.activeTurn = null;
    }
    const message = errorMessage(error);
    turn.sink({ error: { message }, stopReason: "error", type: "turn_end" });
    turn.reject(new Error(message));
  }

  /**
   * Cancel an in-flight turn. `turnId` guards against cancelling a newer
   * turn by race. Parked permissions, asks and drills are force-resolved
   * (ACP: cancel MUST answer outstanding permission requests with
   * `cancelled`). The terminal `turn_end` arrives as the prompt response
   * (`stopReason: "cancelled"`).
   */
  /**
   * Cancel an in-flight turn (TASK-81.4): a linear guard chain over
   * session-state predicates, then force-resolve parks and send the wire
   * notification. `turnId` guards against cancelling a newer turn by race.
   */
  async cancel(sessionId: string, turnId?: string): Promise<boolean> {
    if (await this.#cancelDirectCli(sessionId)) {
      return true;
    }
    const handle = this.#sessions.get(sessionId);
    if (!this.#canCancel(handle, turnId)) {
      return false;
    }
    this.#forceResolveParks(sessionId);
    await handle.connection.cancel({ sessionId });
    return true;
  }

  /** Direct-cli dialect: single-shot children finish on their own; the Stop
   * button stays responsive by reporting success regardless of the (ignored)
   * `turnId` — the accepted direct-cli degradation. */
  async #cancelDirectCli(sessionId: string): Promise<boolean> {
    const directCli = this.#directCli.get(sessionId);
    return directCli ? await directCli.cancel() : false;
  }

  /** Guard chain: unknown/disconnected session, or a stale `turnId` race. */
  #canCancel(
    handle: AcpSessionHandle | undefined,
    turnId?: string
  ): handle is AcpSessionHandle & {
    connection: NonNullable<AcpSessionHandle["connection"]>;
  } {
    if (!handle?.connection) {
      return false;
    }
    if (turnId && handle.activeTurn && handle.activeTurn.turnId !== turnId) {
      return false;
    }
    return true;
  }

  /** ACP: cancel MUST answer outstanding permission requests with
   * `cancelled` and reject parked asks and drills on the session. */
  #forceResolveParks(sessionId: string): void {
    for (const [key, parked] of [...this.#permissions]) {
      if (parked.sessionId === sessionId) {
        this.#resolvePermission(key, parked, null);
      }
    }
    for (const ask of this.#asks.values()) {
      if (ask.sessionId === sessionId) {
        // reject funnels through #clearAsk (timer + index + TASK-92 retire).
        ask.reject(new Error("ask cancelled"));
      }
    }
    for (const drill of this.#drills.values()) {
      if (drill.sessionId === sessionId) {
        drill.reject(new Error("drill item cancelled"));
      }
    }
  }

  // ── Confirmations ──────────────────────────────────────────────────

  /**
   * Answer a parked permission. An unknown `optionId` echoes the nearest
   * REAL offered option by kind (aioncore rule): reject-ish ids fall back to
   * reject_once → reject_always, everything else to allow_once →
   * allow_always. Returns false when nothing is parked under `callId`.
   */
  confirm(callId: string, optionId: string): boolean {
    const parked = this.#permissions.get(callId);
    if (!parked) {
      return false;
    }
    const offered = parked.options.find(
      (option) => option.optionId === optionId
    );
    if (offered) {
      this.#resolvePermission(callId, parked, offered.optionId);
      return true;
    }
    const rejecting = REJECT_OPTION_PATTERN.test(optionId);
    const order = rejecting
      ? ["reject_once", "reject_always"]
      : ["allow_once", "allow_always"];
    for (const kind of order) {
      const fallback = parked.options.find((option) => option.kind === kind);
      if (fallback) {
        this.#resolvePermission(callId, parked, fallback.optionId);
        return true;
      }
    }
    this.#resolvePermission(callId, parked, null);
    return true;
  }

  /**
   * Park an `ask_user` question set on a session and surface it as an `ask`
   * frame (TASK-80.2's host MCP tool server calls this from its blocking
   * tools/call). Returns the parked correlation `requestId` alongside the
   * waiter promise, which resolves with the answer text delivered by
   * `answerAsk()` (TASK-86: the server needs the id up front to settle the
   * persisted row when its own shorter timeout races ahead of the engine's).
   *
   * TASK-92 resumable long-poll: passing a `key` makes the park idempotent.
   * A re-call with the same key attaches to the LIVE park (same promise +
   * requestId, no duplicate frame), and after settle it replays the TERMINAL
   * outcome — an answered late caller gets the answer text as a resolved
   * promise, an expired/cancelled one gets the same rejection. A client that
   * abandoned the call at its own 60s timeout can therefore come back for
   * the result. Terminal replays live TERMINAL_ASK_REPLAY_MS (TASK-94): a
   * verbatim re-ask after that window is treated as genuinely new. Without
   * a key the old one-shot behaviour stands.
   */
  parkAsk(
    handle: AcpSessionHandle,
    questions: AcpAskQuestion[],
    key?: string,
    /** TEST SEAM: shorten the TASK-94 terminal-replay window. */
    replayMs?: number
  ): { promise: Promise<string>; requestId: string } {
    const stableKey = key ? `${handle.sessionId}:${key}` : null;
    if (stableKey) {
      const liveId = this.#asksByStableKey.get(stableKey);
      if (liveId !== undefined) {
        const live = this.#asks.get(liveId);
        if (live) {
          return { promise: live.promise, requestId: live.requestId };
        }
      }
      const terminal = this.#terminalAsksByStableKey.get(stableKey);
      if (terminal) {
        if (terminal.expiresAt <= Date.now()) {
          // TASK-94: outside the replay window, a verbatim re-ask is a
          // genuinely new question, not a long-poll recovery.
          this.#terminalAsksByStableKey.delete(stableKey);
        } else {
          return { promise: terminal.promise, requestId: terminal.requestId };
        }
      }
    }
    const requestId = randomUUID();
    // Deferred so the ParkedAsk record can carry the waiter (the executor
    // runs before `promise` binds — a plain self-reference is a TDZ hit).
    let settleResolve: (text: string) => void = () => undefined;
    let settleReject: (error: Error) => void = () => undefined;
    const promise = new Promise<string>((resolve, reject) => {
      settleResolve = resolve;
      settleReject = reject;
    });
    const ask: ParkedAsk = {
      promise,
      questions,
      reject: (error) => {
        this.#clearAsk(requestId, ask);
        settleReject(error);
      },
      requestId,
      resolve: (text) => {
        this.#clearAsk(requestId, ask);
        settleResolve(text);
      },
      sessionId: handle.sessionId,
      stableKey,
      terminalReplayMs: replayMs ?? TERMINAL_ASK_REPLAY_MS,
      timer: setTimeout(() => {
        ask.reject(
          new Error("ask timed out: the learner did not answer in time")
        );
      }, this.#confirmationTimeoutMs),
    };
    this.#asks.set(requestId, ask);
    if (stableKey) {
      this.#asksByStableKey.set(stableKey, requestId);
    }
    handle.emitFrame({
      questions,
      request_id: requestId,
      session_id: handle.sessionId,
      type: "ask",
    });
    return { promise, requestId };
  }

  /**
   * Answer a parked ask. `decline: true` resolves the waiter with an
   * explicit deny text. Returns false for unknown/already-settled requests.
   */
  answerAsk(requestId: string, payload: AcpAskAnswer): boolean {
    const ask = this.#asks.get(requestId);
    if (!ask) {
      return false;
    }
    ask.resolve(formatAskAnswer(payload));
    return true;
  }

  /**
   * TASK-94: retire a live park WITHOUT answering it (the host's tool-side
   * deadline fired). Rejects through the park's own wrapper, so the timer
   * is cleared, the live index released, and the outcome retired to the
   * terminal replay cache — a late learner tap gets `answerAsk` false and a
   * re-calling agent replays the expiry. True only when something retired.
   */
  retireAsk(requestId: string): boolean {
    const ask = this.#asks.get(requestId);
    if (!ask) {
      return false;
    }
    ask.reject(
      new Error("ask expired: the host tool deadline fired before an answer")
    );
    return true;
  }

  parkDrillItem(
    handle: AcpSessionHandle,
    drillSessionId: string,
    item: AcpDrillItem,
    snapshot: AcpDrillSnapshot,
    key?: string,
    replayMs?: number
  ): { promise: Promise<AcpDrillResolution>; requestId: string } {
    const stableKey = key
      ? `${handle.sessionId}:${drillSessionId}:${key}`
      : null;
    if (stableKey) {
      const liveId = this.#drillsByStableKey.get(stableKey);
      if (liveId !== undefined) {
        const live = this.#drills.get(liveId);
        if (live) {
          return { promise: live.promise, requestId: live.requestId };
        }
      }
      const terminal = this.#terminalDrillsByStableKey.get(stableKey);
      if (terminal) {
        if (terminal.expiresAt <= Date.now()) {
          this.#terminalDrillsByStableKey.delete(stableKey);
        } else {
          return { promise: terminal.promise, requestId: terminal.requestId };
        }
      }
    }
    const requestId = randomUUID();
    let settleResolve: (resolution: AcpDrillResolution) => void = () =>
      undefined;
    let settleReject: (error: Error) => void = () => undefined;
    const promise = new Promise<AcpDrillResolution>((resolve, reject) => {
      settleResolve = resolve;
      settleReject = reject;
    });
    const clientItem = toAcpDrillItem(item);
    const drill: ParkedDrill = {
      drillSessionId,
      handle,
      item: clientItem,
      promise,
      reject: (error) => {
        this.#clearDrill(requestId, drill);
        settleReject(error);
      },
      requestId,
      resolve: (resolution, nextSnapshot) => {
        this.#clearDrill(requestId, drill);
        this.#emitDrillResolution(drill, resolution, nextSnapshot);
        settleResolve(resolution);
      },
      sessionId: handle.sessionId,
      snapshot,
      stableKey,
      terminalReplayMs: replayMs ?? TERMINAL_ASK_REPLAY_MS,
      timer: setTimeout(() => {
        drill.reject(
          new Error("drill item timed out: the learner did not answer in time")
        );
      }, this.#confirmationTimeoutMs),
    };
    this.#drills.set(requestId, drill);
    if (stableKey) {
      this.#drillsByStableKey.set(stableKey, requestId);
    }
    handle.emitFrame(this.#pendingDrillEvent(drill));
    return { promise, requestId };
  }

  answerDrillItem(
    requestId: string,
    resolution: AcpDrillResolution,
    snapshot?: AcpDrillSnapshot
  ): boolean {
    const drill = this.#drills.get(requestId);
    if (!drill) {
      return false;
    }
    drill.resolve(
      projectAcpDrillResolution(resolution),
      snapshot ?? drill.snapshot
    );
    return true;
  }

  emitDrillEvent(sessionId: string, event: AcpDrillItemEvent): boolean {
    const handle = this.#sessions.get(sessionId);
    if (!handle) {
      return false;
    }
    handle.emitFrame(event);
    return true;
  }

  stopDrillItem(requestId: string, snapshot?: AcpDrillSnapshot): boolean {
    const drill = this.#drills.get(requestId);
    if (!drill) {
      return false;
    }
    drill.resolve(
      {
        chosenIndex: -1,
        correct: false,
        correctIndex: -1,
        itemId: drill.item.id,
        skipped: true,
      },
      snapshot ?? drill.snapshot
    );
    return true;
  }

  retireDrillItem(requestId: string): boolean {
    const drill = this.#drills.get(requestId);
    if (!drill) {
      return false;
    }
    drill.reject(
      new Error(
        "drill item expired: the host tool deadline fired before an answer"
      )
    );
    return true;
  }

  #pendingDrillEvent(drill: ParkedDrill): AcpDrillItemEvent {
    return {
      drill_session_id: drill.drillSessionId,
      item: drill.item,
      phase: "pending",
      request_id: drill.requestId,
      session_id: drill.sessionId,
      snapshot: drill.snapshot,
      type: "drill_item",
    };
  }

  #emitDrillResolution(
    drill: ParkedDrill,
    resolution: AcpDrillResolution,
    snapshot: AcpDrillSnapshot
  ): void {
    drill.handle.emitFrame({
      drill_session_id: drill.drillSessionId,
      item: drill.item,
      phase: "answered",
      request_id: drill.requestId,
      resolution,
      session_id: drill.sessionId,
      snapshot,
      type: "drill_item",
    });
  }

  #clearAsk(requestId: string, ask: ParkedAsk): void {
    clearTimeout(ask.timer);
    this.#asks.delete(requestId);
    if (ask.stableKey) {
      this.#retireAsk(ask);
    }
  }

  /**
   * TASK-92: a settled keyed park moves from the live index to the terminal
   * replay cache (FIFO-bounded, TASK-94: and TTL-bounded). The no-op catch
   * marks the stored rejection as handled so a learner who never re-calls
   * cannot produce an unhandled-rejection; re-attachers still see the real
   * outcome.
   */
  #retireAsk(ask: ParkedAsk): void {
    if (!ask.stableKey) {
      return;
    }
    if (this.#asksByStableKey.get(ask.stableKey) === ask.requestId) {
      this.#asksByStableKey.delete(ask.stableKey);
      const now = Date.now();
      this.#terminalAsksByStableKey.set(ask.stableKey, {
        expiresAt: now + ask.terminalReplayMs,
        promise: ask.promise,
        requestId: ask.requestId,
      });
      ask.promise.catch(() => undefined);
      for (const [key, entry] of this.#terminalAsksByStableKey) {
        if (entry.expiresAt <= now) {
          this.#terminalAsksByStableKey.delete(key);
        }
      }
      while (this.#terminalAsksByStableKey.size > TERMINAL_ASK_CACHE_LIMIT) {
        const oldest = this.#terminalAsksByStableKey.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.#terminalAsksByStableKey.delete(oldest);
      }
    }
  }

  #clearDrill(requestId: string, drill: ParkedDrill): void {
    clearTimeout(drill.timer);
    this.#drills.delete(requestId);
    if (drill.stableKey) {
      this.#retireDrill(drill);
    }
  }

  #retireDrill(drill: ParkedDrill): void {
    if (!drill.stableKey) {
      return;
    }
    if (this.#drillsByStableKey.get(drill.stableKey) === drill.requestId) {
      this.#drillsByStableKey.delete(drill.stableKey);
      const now = Date.now();
      this.#terminalDrillsByStableKey.set(drill.stableKey, {
        expiresAt: now + drill.terminalReplayMs,
        promise: drill.promise,
        requestId: drill.requestId,
      });
      drill.promise.catch(() => undefined);
      for (const [key, entry] of this.#terminalDrillsByStableKey) {
        if (entry.expiresAt <= now) {
          this.#terminalDrillsByStableKey.delete(key);
        }
      }
      while (this.#terminalDrillsByStableKey.size > TERMINAL_ASK_CACHE_LIMIT) {
        const oldest = this.#terminalDrillsByStableKey.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.#terminalDrillsByStableKey.delete(oldest);
      }
    }
  }

  #resolvePermission(
    toolCallId: string,
    parked: ParkedPermission,
    optionId: string | null
  ): void {
    clearTimeout(parked.timer);
    this.#permissions.delete(toolCallId);
    const response: RequestPermissionResponse = optionId
      ? { outcome: { optionId, outcome: "selected" } }
      : { outcome: { outcome: "cancelled" } };
    if (optionId) {
      parked.emit?.({
        option_id: optionId,
        request_id: parked.requestId,
        type: "acp_permission_resolved",
      });
    }
    parked.resolve(response);
  }

  // ── Terminals (delegated to TerminalRegistry) ──────────────────────

  /**
   * Kill a hosted terminal without cancelling the turn (UI stop button).
   * Returns false for unknown ids. The id stays valid until `release` so the
   * agent can still read final output (ACP kill/release split).
   */
  killTerminal(terminalId: string): boolean {
    return this.#terminals.kill(terminalId);
  }

  // ── Config / model / mode ──────────────────────────────────────────

  /**
   * Read (and optionally change) session config options. `patch` selects
   * one of `{ configId, value }`, `{ modelId }`, `{ modeId }`. The RPC
   * response is authoritative for the new snapshot (success proves the
   * agent applied it — echoes may or may not follow; opencode sends none).
   */
  async configOptions(
    handle: AcpSessionHandle,
    patch?:
      | { configId: string; value: string | boolean }
      | { modelId: string }
      | { modeId: string }
  ): Promise<AcpConfigOption[]> {
    const directCli = this.#directCli.get(handle.sessionId);
    if (directCli) {
      return directCli.configOptions();
    }
    const { connection } = handle;
    if (!connection) {
      throw new Error(`session ${handle.sessionId} is not connected`);
    }
    if (!patch) {
      return handle.configOptions;
    }
    if ("modeId" in patch) {
      await this.#setSelectOption(handle, "mode", patch.modeId, (value) =>
        connection.setSessionMode({
          modeId: value,
          sessionId: handle.sessionId,
        })
      );
      handle.currentModeId = patch.modeId;
      return handle.configOptions;
    }
    if ("modelId" in patch) {
      await this.#setSelectOption(handle, "model", patch.modelId, (value) =>
        connection.unstable_setSessionModel({
          modelId: value,
          sessionId: handle.sessionId,
        })
      );
      return handle.configOptions;
    }
    const response = await connection.setSessionConfigOption(
      configOptionRequest(handle.sessionId, patch.configId, patch.value)
    );
    applyConfigOptions(handle, response.configOptions);
    return handle.configOptions;
  }

  /** Switch via the `model`/`mode` config option when the agent exposes it
   * (aioncore: configOptions is the modern path), else the dedicated RPC. */
  async #setSelectOption(
    handle: AcpSessionHandle,
    optionId: "model" | "mode",
    value: string,
    fallback: (value: string) => Promise<unknown>
  ): Promise<void> {
    const { connection } = handle;
    if (!connection) {
      throw new Error(`session ${handle.sessionId} is not connected`);
    }
    const option = handle.configOptions.find((item) => item.id === optionId);
    if (option?.type === "select") {
      const response = await connection.setSessionConfigOption({
        configId: optionId,
        sessionId: handle.sessionId,
        value,
      });
      applyConfigOptions(handle, response.configOptions);
      return;
    }
    await fallback(value);
  }

  // ── Teardown / health ──────────────────────────────────────────────

  /** Tear down one session: parks, terminals, child. */
  async dispose(sessionId: string): Promise<void> {
    const handle = this.#sessions.get(sessionId);
    if (!handle) {
      return;
    }
    this.#sessions.delete(sessionId);
    this.#directCli.delete(sessionId);
    if (handle.supportsCloseSession && handle.connection && handle.healthy) {
      try {
        await handle.connection.closeSession({ sessionId });
      } catch {
        // best effort — teardown kills the child anyway
      }
    }
    this.#teardown(handle);
    handle.emitStatus("disconnected", "disposed");
  }

  /** Tear down every session (process shutdown). */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((id) => this.dispose(id)));
  }

  /**
   * TASK-102: at boot, kill the agent/terminal process groups a previous run
   * left behind. A crash orphans them to init and no in-memory handle survives,
   * so the durable group registry is the only thing that can find them. Runs
   * before the sidecar serves, so there is never a live session to protect.
   * Returns how many groups were reaped and how many were skipped (recycled or
   * unkillable), for a boot log line.
   */
  reapLeftoverChildren(): { reaped: number; skipped: number } {
    return this.#children.reapLeftovers();
  }

  #teardown(handle: AcpSessionHandle): void {
    this.#releaseParks(handle);
    this.#terminals.releaseForSession(handle);
    handle.activeTurn = null;
    handle.sessionActive = false;
    handle.connection = null;
    const { child } = handle;
    if (child) {
      // TASK-102: signal the whole group, then drop the durable record so a
      // recycled pid can never be targeted by a later boot reap.
      if (child.pid === undefined) {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      } else {
        this.#children.unregister(child.pid);
        killGroupQuiet(child.pid);
      }
      handle.child = null;
    }
    handle.healthy = false;
  }

  #markDead(handle: AcpSessionHandle, reason: string): void {
    if (!handle.healthy) {
      return;
    }
    handle.healthy = false;
    const detail = failureDetail(reason, handle.stderrTail);
    const turn = handle.activeTurn;
    if (turn && !turn.settled) {
      this.#failTurn(handle, turn, new Error(detail));
    }
    this.#releaseParks(handle);
    this.#terminals.releaseForSession(handle);
    handle.sessionActive = false;
    handle.emitStatus("disconnected", detail);
  }

  #releaseParks(handle: AcpSessionHandle): void {
    for (const [key, parked] of [...this.#permissions]) {
      if (parked.sessionId === handle.sessionId) {
        this.#resolvePermission(key, parked, null);
      }
    }
    for (const ask of this.#asks.values()) {
      if (ask.sessionId === handle.sessionId) {
        // reject funnels through #clearAsk (timer + index + TASK-92 retire).
        ask.reject(new Error("ask cancelled: session disposed"));
      }
    }
    for (const drill of this.#drills.values()) {
      if (drill.sessionId === handle.sessionId) {
        drill.reject(new Error("drill item cancelled: session disposed"));
      }
    }
  }

  // ── Inbound (Client callbacks) ─────────────────────────────────────

  #buildClient(handle: AcpSessionHandle): Client {
    const terminals = this.#terminals;
    return {
      createTerminal: (params) => {
        const terminalId = terminals.create(handle, {
          args: params.args ?? [],
          command: params.command,
          cwd: params.cwd,
          env: params.env,
          outputByteLimit: params.outputByteLimit,
        });
        return Promise.resolve({ terminalId });
      },
      killTerminal: (params) => {
        terminals.kill(params.terminalId);
        return Promise.resolve({});
      },
      // fs is never advertised (caps false). Handlers exist only to answer
      // a misbehaving agent with a clean JSON-RPC error instead of the
      // SDK's empty-result fallthrough.
      readTextFile: () =>
        Promise.reject(
          new Error("manobu does not grant agents file read access")
        ),
      releaseTerminal: (params) => {
        terminals.release(params.terminalId);
        return Promise.resolve({});
      },
      requestPermission: (params) =>
        this.#handleRequestPermission(handle, params),
      sessionUpdate: (notification) => {
        translateSessionUpdate(handle, notification);
        return Promise.resolve();
      },
      terminalOutput: (params) => {
        if (!terminals.has(params.terminalId)) {
          return Promise.reject(
            new Error(`unknown terminal ${params.terminalId}`)
          );
        }
        const { exitStatus, output, truncated } = terminals.output(
          params.terminalId
        );
        return Promise.resolve({
          exitStatus: exitStatus
            ? {
                exitCode: exitStatus.exitCode,
                ...(exitStatus.signal ? { signal: exitStatus.signal } : {}),
              }
            : null,
          output,
          truncated,
        });
      },
      waitForTerminalExit: (params) => terminals.wait(params.terminalId),
      writeTextFile: () =>
        Promise.reject(
          new Error("manobu does not grant agents file write access")
        ),
    };
  }

  async #handleRequestPermission(
    handle: AcpSessionHandle,
    params: Parameters<Client["requestPermission"]>[0]
  ): Promise<RequestPermissionResponse> {
    const { options, toolCall } = params;
    const requestId = toolCall.toolCallId || randomUUID();
    const toolCallPayload = normalizeToolCallUpdate({
      content: toolCall.content ?? null,
      kind: toolCall.kind ?? null,
      locations: toolCall.locations ?? null,
      rawInput: toolCall.rawInput,
      rawOutput: toolCall.rawOutput,
      status: toolCall.status ?? "pending",
      title: toolCall.title ?? "",
      toolCallId: toolCall.toolCallId,
    });
    return await new Promise<RequestPermissionResponse>((resolve) => {
      const parked: ParkedPermission = {
        emit: handle.currentSink(),
        options,
        requestId,
        resolve,
        sessionId: handle.sessionId,
        timer: setTimeout(() => {
          this.#resolvePermission(toolCall.toolCallId, parked, null);
        }, this.#confirmationTimeoutMs),
        toolCall: toolCallPayload,
        toolCallId: toolCall.toolCallId,
      };
      // A second request for the same call replaces the first.
      const existing = this.#permissions.get(toolCall.toolCallId);
      if (existing) {
        this.#resolvePermission(toolCall.toolCallId, existing, null);
      }
      this.#permissions.set(toolCall.toolCallId, parked);
      handle.emitFrame({
        options,
        request_id: requestId,
        session_id: handle.sessionId,
        tool_call: toolCallPayload,
        type: "acp_permission",
      });
    });
  }

  /** Snapshot the open response: generic config options, plus the legacy
   * top-level models/modes shapes folded in when ids are missing. */
  #applyOpenSnapshot(
    handle: AcpSessionHandle,
    opened: OpenSessionResult
  ): void {
    const normalized = normalizeConfigOptions(opened.configOptions);
    const folded = foldLegacyModelMode(normalized, opened.models, opened.modes);
    handle.configOptions.length = 0;
    handle.configOptions.push(...folded.options);
    if (handle.currentModeId === null) {
      handle.currentModeId = folded.currentModeId;
    }
  }

  async #applyRequestedSwitches(
    handle: AcpSessionHandle,
    spec: CommandSpec
  ): Promise<void> {
    // TASK-102 AC#6: a rejected switch fails the open LOUDLY. Swallowing it
    // here meant the learner's answer silently came from a model they did
    // not pick. The typed error carries the reason; `runTurn` projects its
    // `code` onto the turn's terminal frame, matching the hot
    // `CONFIG_SWITCH_FAILED` path.
    if (spec.model) {
      try {
        await this.configOptions(handle, { modelId: spec.model });
      } catch (error) {
        throw acpConfigSwitchError(
          "model",
          spec.model,
          errorMessage(error),
          error
        );
      }
    }
    if (spec.mode) {
      try {
        await this.configOptions(handle, { modeId: spec.mode });
      } catch (error) {
        throw acpConfigSwitchError(
          "mode",
          spec.mode,
          errorMessage(error),
          error
        );
      }
    }
  }
}

const toAcpDrillItem = (item: AcpDrillItem): AcpDrillItem => ({
  anchors: [...item.anchors],
  id: item.id,
  itemType: item.itemType,
  level: item.level,
  options: [...item.options],
  ...(item.passage === undefined ? {} : { passage: item.passage }),
  prompt: item.prompt,
});

// ── Turn wiring ──────────────────────────────────────────────────────

/** Attach a fresh turn to the handle; the done promise settles at terminal. */
function armTurn(
  handle: AcpSessionHandle,
  sink: AcpEventSink,
  turnId?: string
): ArmedTurn {
  let rejectTurn: (error: Error) => void = () => {
    throw new Error("turn promise never wired");
  };
  let resolveTurn: (result: PromptTurnResult) => void = () => {
    throw new Error("turn promise never wired");
  };
  const done = new Promise<PromptTurnResult>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  const turn: ArmedTurn = {
    done,
    reject: (error) => rejectTurn(error),
    resolve: (result) => resolveTurn(result),
    settled: false,
    sink,
    turnId: turnId ?? randomUUID(),
  };
  handle.activeTurn = turn;
  return turn;
}
