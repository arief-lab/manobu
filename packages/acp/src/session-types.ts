/**
 * Shared session types (TASK-80.1) — the handle object and the public
 * option/result shapes exchanged between `SessionController`, the terminal
 * registry, the update translator, and `apps/server`.
 *
 * Lives apart from `session.ts` so the helper modules (`session-terminals`,
 * `session-translator`, `session-normalize`) can type against the handle
 * without importing the controller (no cycles).
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  AvailableCommand,
  ClientSideConnection,
} from "@agentclientprotocol/sdk";

/** ACP `McpServer` wire entry (http/stdio). Re-exported so apps/server's
 * host-tools attach list types against it without importing the ACP SDK —
 * session.ts consumes the same symbol for `extraMcpServers`. */
export type McpServer = import("@agentclientprotocol/sdk").McpServer;

import type {
  AcpConfigOption,
  AcpEventSink,
  AcpStreamEvent,
} from "./acp-events";
import type { AgentCapabilities } from "./registry";
import type { StderrTail } from "./session-child";

/** Per-session knobs for {@link SessionController.ensureSession}. */
export interface EnsureSessionOptions {
  /** Static registry MCP caps used when the agent advertises none. */
  agentCaps?: AgentCapabilities;
  /** Human-readable agent id (picker handle) carried on status frames. */
  agentId?: string;
  /** Raw ACP `McpServer` entries appended after negotiation (the host
   * `ask_user` tool server in apps/server; 80.2). */
  extraMcpServers?: McpServer[];
  /** Per-terminal cumulative output byte cap. */
  terminalOutputLimit?: number;
}

/** Raw ACP stop reasons plus the engine-synthesized `error` terminal. */
export type PromptStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled"
  | "error";

/** Per-turn token usage extracted from `PromptResponse.usage`. */
export interface PromptUsage {
  cachedReadTokens?: number | null;
  cachedWriteTokens?: number | null;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number | null;
  totalTokens: number;
}

/** One prompt turn's terminal result (the `session/prompt` response). */
export interface PromptTurnResult {
  stopReason: PromptStopReason;
  turnId: string;
  usage: PromptUsage | null;
}

/** A file attached to a prompt; mapped per negotiated promptCapabilities. */
export interface PromptFileAttachment {
  /** base64 payload — sent inline when the agent advertises image caps. */
  data?: string;
  mimeType?: string;
  name: string;
  size?: number;
  /** file:// or other URI — sent as a resource_link otherwise. */
  uri?: string;
}

/** Prompt body accepted by {@link SessionController.prompt}. */
export interface PromptInput {
  /** Plain text or ready ACP ContentBlock-shaped records. */
  content: string | Record<string, unknown>[];
  files?: PromptFileAttachment[];
  /** Frame sink for this turn (`turn_start` … `turn_end`). */
  sink: AcpEventSink;
  /** Caller's correlation id for the turn. `chat.cancel` guards against
   * this exact id, so a server that mints its own turn ids (chat-rpc's
   * `chat.send` ack) must pass it here or Stop can never match (TASK-86).
   * Defaults to an engine-minted UUID. */
  turnId?: string;
}

/** @internal One in-flight prompt turn, wired by the controller. */
export interface ArmedTurn {
  done: Promise<PromptTurnResult>;
  reject: (error: Error) => void;
  resolve: (result: PromptTurnResult) => void;
  settled: boolean;
  sink: AcpEventSink;
  turnId: string;
}

/** Session connection state surfaced on `agent_status` frames. */
export type AcpConnectionStatus =
  | "connecting"
  | "connected"
  | "session_active"
  | "disconnected"
  | "error";

/**
 * A live ACP session: one agent child process, one session id, the engine's
 * mutable view of its negotiated state.
 */
export class AcpSessionHandle {
  readonly agentId: string;
  /** TASK-102 AC#5: human-readable names of the `authMethods` advertised at
   * initialize, so an auth rejection can tell the learner HOW to sign in.
   * Presence alone is never treated as "must authenticate" (see
   * `isAuthRejection`); it only enriches the message once a real rejection
   * happens. */
  authMethodNames: string[];
  readonly configOptions: AcpConfigOption[] = [];
  currentModeId: string | null;
  /** ACP `session/prompt` capabilities from initialize. */
  readonly promptCapabilities = {
    audio: false,
    embeddedContext: false,
    image: false,
  };
  /** Slash commands from the latest `available_commands_update`. */
  slashCommands: AvailableCommand[];
  /** Process liveness + stream-failure marking (replaces watchAcpModelHealth). */
  healthy: boolean;
  /** True once initialize + session/new|load completed. */
  sessionActive: boolean;
  /** True when the agent advertised `loadSession`. */
  supportsLoadSession: boolean;
  /** True when the agent advertised `sessionCapabilities.close`. */
  supportsCloseSession: boolean;
  /** @internal Engine bookkeeping; not public API. */
  activeTurn: ArmedTurn | null;
  /** @internal */
  child: ChildProcessWithoutNullStreams | null;
  /** @internal */
  connection: ClientSideConnection | null;
  /** @internal TASK-99: bounded redacted stderr tail, pushed into failure
   * details so a dead child can explain itself. Null for direct-cli. */
  stderrTail: StderrTail | null;
  /** @internal Set after a successful open (new/load). */
  sessionId: string;
  /** @internal Replay-suppression guard during session/load. */
  suppressUiEvents: boolean;
  /** @internal Most recent turn sink; out-of-turn frames (slash commands
   * arriving during load) need somewhere to go until the next prompt arms. */
  lastSink: AcpEventSink | null;

  constructor(agentId: string) {
    this.activeTurn = null;
    this.agentId = agentId;
    this.authMethodNames = [];
    this.child = null;
    this.connection = null;
    this.currentModeId = null;
    this.healthy = true;
    this.lastSink = null;
    this.sessionActive = false;
    this.sessionId = "";
    this.slashCommands = [];
    this.stderrTail = null;
    this.suppressUiEvents = false;
    this.supportsCloseSession = false;
    this.supportsLoadSession = false;
  }

  /** Liveness contract used by the server pool (80.2). */
  isHealthy(): boolean {
    return this.healthy;
  }

  /** The sink frames should flow through right now, if any. */
  currentSink(): AcpEventSink | null {
    return this.activeTurn?.sink ?? this.lastSink;
  }

  /** @internal Route a translated frame, honoring the load-replay guard. */
  emitFrame(event: AcpStreamEvent): void {
    if (this.suppressUiEvents) {
      return;
    }
    this.currentSink()?.(event);
  }

  /** @internal Pushed by the controller on state transitions. */
  emitStatus(status: AcpConnectionStatus, detail?: string): void {
    this.currentSink()?.({
      agent_id: this.agentId,
      detail,
      session_id: this.sessionId.length > 0 ? this.sessionId : undefined,
      status,
      type: "agent_status",
    });
  }
}
