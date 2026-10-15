/**
 * Hosted terminal registry (TASK-80.1).
 *
 * ACP `terminal/*` is client-hosted: when an agent asks to run a command we
 * spawn it in our process tree, keep a cumulative output buffer, and stream
 * throttled snapshot frames (`acp_terminal_output`) to the owning session's
 * sink until exit — the AionUi `AcpTerminalOutput` contract. `kill` stops
 * the command but keeps the id valid (final output stays readable);
 * `release` drops the record.
 *
 * The registry never cancels a prompt turn: killing a terminal is a UI
 * "stop this command" affordance, orthogonal to the session turn (80.2 AC#4).
 *
 * TASK-102: every terminal child is spawned `detached` (own process group) and
 * torn down by group signal, so a command that itself forks leaves no orphan
 * behind; the optional `onSpawn`/`onRelease` hooks record the group with the
 * controller's durable child registry for the boot reap.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { commandBaseName, killGroupQuiet } from "./child-registry";
import type { AcpSessionHandle } from "./session-types";

/** Terminal-output snapshot cadence (AionUi parity). */
const TERMINAL_POLL_INTERVAL_MS = 250;
/** Cumulative terminal output byte cap before frames mark `truncated`. */
const DEFAULT_TERMINAL_OUTPUT_LIMIT = 256 * 1024;

export interface TerminalCreateParams {
  args?: string[];
  command: string;
  cwd?: string | null;
  env?: { name: string; value: string }[];
  outputByteLimit?: number | null;
}

interface HostedTerminal {
  bytes: number;
  child: ReturnType<typeof spawn>;
  chunks: string[];
  command: string;
  exited: Promise<void>;
  exitStatus: { exitCode: number | null; signal: string | null } | null;
  id: string;
  limit: number;
  /** Process-group id (== the detached child's pid), for tree teardown. */
  pgid: number | null;
  /** null once stopped (exit observed / released). */
  poller: ReturnType<typeof setInterval> | null;
  session: AcpSessionHandle;
  truncated: boolean;
}

/** Hooks the controller wires to its durable child registry (TASK-102). */
export interface TerminalRegistryOptions {
  defaultOutputLimit?: number;
  /** A group torn down for good: drop its durable record. */
  onRelease?: (pgid: number) => void;
  /** A group spawned: record it so a crash before release is still reaped. */
  onSpawn?: (pgid: number, marker: string) => void;
}

export class TerminalRegistry {
  readonly #defaultLimit: number;
  readonly #onRelease: ((pgid: number) => void) | undefined;
  readonly #onSpawn: ((pgid: number, marker: string) => void) | undefined;
  readonly #terminals = new Map<string, HostedTerminal>();

  constructor(options: TerminalRegistryOptions = {}) {
    this.#defaultLimit =
      options.defaultOutputLimit ?? DEFAULT_TERMINAL_OUTPUT_LIMIT;
    this.#onRelease = options.onRelease;
    this.#onSpawn = options.onSpawn;
  }

  /** Spawn the command; returns the ACP terminal id. */
  create(session: AcpSessionHandle, params: TerminalCreateParams): string {
    const terminal = this.#spawnTerminal(session, params);
    this.#attachOutputCapture(terminal);
    this.#startPoller(terminal);
    this.#awaitExit(terminal);
    this.#terminals.set(terminal.id, terminal);
    return terminal.id;
  }

  /** Spawn the child with the session env + per-call overrides. */
  #spawnTerminal(
    session: AcpSessionHandle,
    params: TerminalCreateParams
  ): HostedTerminal {
    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? undefined,
      // TASK-102: own process group so a command's own children die with it.
      detached: true,
      env: this.#childEnv(params.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pgid = child.pid ?? null;
    if (pgid !== null) {
      this.#onSpawn?.(pgid, commandBaseName(params.command));
    }
    return {
      bytes: 0,
      child,
      chunks: [],
      command: [params.command, ...(params.args ?? [])].join(" "),
      exited: Promise.resolve(),
      exitStatus: null,
      id: randomUUID(),
      limit: params.outputByteLimit ?? this.#defaultLimit,
      pgid,
      // Assigned below — the tick callback needs `terminal` bound.
      poller: null,
      session,
      truncated: false,
    };
  }

  /** SIGKILL a terminal's whole group, and drop its record when releasing. */
  #signalTree(terminal: HostedTerminal, release: boolean): void {
    if (terminal.pgid === null) {
      terminal.child.kill("SIGKILL");
    } else {
      killGroupQuiet(terminal.pgid);
      if (release) {
        this.#onRelease?.(terminal.pgid);
      }
    }
  }

  /** Process env overlaid with the call's per-variable overrides. */
  #childEnv(
    overrides?: ReadonlyArray<{ name: string; value: string }>
  ): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    for (const variable of overrides ?? []) {
      env[variable.name] = variable.value;
    }
    return env;
  }

  /** Pipe both output streams into the capture buffer. */
  #attachOutputCapture(terminal: HostedTerminal): void {
    const capture = (chunk: string): void => {
      this.#capture(terminal, chunk);
    };
    terminal.child.stdout?.setEncoding("utf8");
    terminal.child.stderr?.setEncoding("utf8");
    terminal.child.stdout?.on("data", capture);
    terminal.child.stderr?.on("data", capture);
  }

  /** Periodic cumulative snapshot frames while the child runs. */
  #startPoller(terminal: HostedTerminal): void {
    terminal.poller = setInterval(() => {
      this.emitFrame(terminal);
    }, TERMINAL_POLL_INTERVAL_MS);
    terminal.poller.unref?.();
  }

  /** Record the exit status on close and emit the final snapshot. */
  #awaitExit(terminal: HostedTerminal): void {
    terminal.exited = new Promise<void>((resolve) => {
      terminal.child.on("close", (code, signal) => {
        terminal.exitStatus = { exitCode: code, signal: signal ?? null };
        this.#stopPoller(terminal);
        this.emitFrame(terminal);
        resolve();
      });
    });
  }

  has(id: string): boolean {
    return this.#terminals.has(id);
  }

  /** Current cumulative snapshot (agent's terminal/output pull). */
  output(id: string): {
    exitStatus: { exitCode: number | null; signal: string | null } | null;
    output: string;
    truncated: boolean;
  } {
    const terminal = this.#require(id);
    return {
      exitStatus: terminal.exitStatus,
      output: terminal.chunks.join(""),
      truncated: terminal.truncated,
    };
  }

  /** Resolve once the command exited; returns its exit status. */
  async wait(id: string): Promise<{
    exitCode: number | null;
    signal: string | null;
  }> {
    const terminal = this.#require(id);
    await terminal.exited;
    return {
      exitCode: terminal.exitStatus?.exitCode ?? null,
      signal: terminal.exitStatus?.signal ?? null,
    };
  }

  /** Kill without releasing: id stays valid for a final output pull. */
  kill(id: string): boolean {
    const terminal = this.#terminals.get(id);
    if (!terminal) {
      return false;
    }
    this.#signalTree(terminal, false);
    return true;
  }

  /** Release: kill (if running), stop the poller, drop the record. */
  release(id: string): void {
    const terminal = this.#terminals.get(id);
    if (!terminal) {
      return;
    }
    this.#stopPoller(terminal);
    this.#signalTree(terminal, true);
    this.#terminals.delete(id);
  }

  /** Kill + drop every terminal owned by a session (dispose path). */
  releaseForSession(session: AcpSessionHandle): void {
    for (const [id, terminal] of [...this.#terminals]) {
      if (terminal.session === session) {
        this.#stopPoller(terminal);
        this.#signalTree(terminal, true);
        this.#terminals.delete(id);
      }
    }
  }

  #require(id: string): HostedTerminal {
    const terminal = this.#terminals.get(id);
    if (!terminal) {
      throw new Error(`unknown terminal ${id}`);
    }
    return terminal;
  }

  #stopPoller(terminal: HostedTerminal): void {
    if (terminal.poller) {
      clearInterval(terminal.poller);
      terminal.poller = null;
    }
  }

  #capture(terminal: HostedTerminal, chunk: string): void {
    if (terminal.truncated) {
      return;
    }
    const size = Buffer.byteLength(chunk, "utf8");
    if (terminal.bytes + size > terminal.limit) {
      const keep = terminal.limit - terminal.bytes;
      terminal.chunks.push(chunk.slice(0, Math.max(0, keep)));
      terminal.bytes = terminal.limit;
      terminal.truncated = true;
      return;
    }
    terminal.bytes += size;
    terminal.chunks.push(chunk);
  }

  /** Push a cumulative snapshot frame onto the owning session's sink. */
  private emitFrame(terminal: HostedTerminal): void {
    terminal.session.emitFrame({
      command: terminal.command,
      exit_status: terminal.exitStatus
        ? {
            exit_code: terminal.exitStatus.exitCode,
            signaled: terminal.exitStatus.signal !== null,
          }
        : null,
      output: terminal.chunks.join(""),
      terminal_id: terminal.id,
      truncated: terminal.truncated,
      type: "acp_terminal_output",
    });
  }
}
