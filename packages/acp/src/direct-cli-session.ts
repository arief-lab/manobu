/**
 * Direct-CLI session facade (TASK-80.6): the `agy` (Google Antigravity)
 * dialect adapter.
 *
 * AionUi's AionCore carries one orchestrator over several wire dialects
 * (ACP, claude JSONL, codex app-server); the wire shape is a detail hidden
 * behind per-adapter connections. This module is manobu's analogue for the
 * ONE dialect the native session engine (`session.ts`) does not speak:
 * `agy` has no ACP server mode (its subcommands are changelog/help/install/
 * models/plugin/update only — no `acp` flag), so it rides single-shot
 * `agy --print` (Tier 2.1 direct-cli route).
 *
 * The controller (`SessionController`) owns one `DirectCliSession` per
 * agy pool entry and dispatches `prompt`/`configOptions`/`cancel` to it by
 * session id — the same shape as AionCore's per-dialect `*_conn` adapters.
 * No ACP child is spawned: each `prompt` spawns its own `agy --print`
 * child, so the handle's `child`/`connection` stay null and the pool's
 * health/evict path works unchanged.
 *
 * Accepted degradation (vs the ACP path, documented in AGENTS.md):
 * - no streaming: the reply arrives in one `text` frame at end (agy
 *   `--print` has no incremental output; the chat UI renders it as a
 *   single growing card, which is exactly what a one-block `text` frame
 *   does).
 * - no tools / no permission cards: agy's proprietary `agentapi` sidecar
 *   protocol is not bridged; `acp_tool_call` / `acp_permission` frames
 *   never appear for direct-cli sessions.
 * - no hosted terminals: `killTerminal` reports not-found (there is no
 *   child to kill between turns).
 * - no session resume: agy is single-shot, so `resume` is ignored and every
 *   prompt carries the full conversation in one `--print` body.
 */

import { randomUUID } from "node:crypto";

import type { AcpConfigOption } from "./acp-events";
import { runSingleShot } from "./direct-cli";
import {
  AcpSessionHandle,
  type PromptInput,
  type PromptTurnResult,
} from "./session-types";

/** One direct-cli session (agy) held by the server's warm-session pool. */
export interface DirectCliSessionOptions {
  /** The registry agent id the handle reports on status frames. */
  agentId: string;
  /** Binary resolved against `$PATH` (registry `command`, e.g. `agy`). */
  command: string;
  /** Working directory for the single-shot child. */
  cwd: string;
  /** Optional model override carried to `--model` on every prompt. */
  model?: string | null;
}

/**
 * Join the engine's `content` blocks (string or `Record` array) into the
 * single conversational body `agy --print` takes. Text blocks travel in
 * order; non-text blocks are dropped (the single-shot CLI takes one body).
 */
export function flattenDirectCliPrompt(
  content: string | Record<string, unknown>[]
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block) => block.type === "text")
    .map((block) => String(block.text ?? "").trim())
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * The `agy` dialect session. The `SessionController` constructs one per
 * pool entry and registers it; `handle` is what the pool + chat layer see
 * (an `AcpSessionHandle` with the single-shot fields pre-seeded).
 */
export class DirectCliSession {
  readonly handle: AcpSessionHandle;
  private readonly opts: DirectCliSessionOptions;

  constructor(
    opts: DirectCliSessionOptions,
    sessionId = `directcli-${opts.agentId}-${randomUUID()}`
  ) {
    this.opts = opts;
    const handle = new AcpSessionHandle(opts.agentId);
    handle.sessionId = sessionId;
    handle.sessionActive = true;
    handle.healthy = true;
    handle.slashCommands = [];
    handle.supportsLoadSession = false;
    handle.supportsCloseSession = false;
    this.handle = handle;
  }

  /**
   * Run one single-shot `agy --print` and emit the ACP frame vocabulary:
   * `turn_start` → `text` (the full reply as one block) → `turn_end`.
   * The reply is awaited before the terminal frame so the sink's persisted
   * rows commit in order.
   */
  async prompt(input: PromptInput): Promise<PromptTurnResult> {
    const { handle } = this;
    const promptText = flattenDirectCliPrompt(input.content);
    await input.sink({ session_id: handle.sessionId, type: "turn_start" });
    try {
      const { text } = await runSingleShot(
        { command: this.opts.command, cwd: this.opts.cwd },
        promptText,
        undefined,
        this.opts.model ?? undefined
      );
      // ACP content-block shape ({ type, text }) so the frame validates
      // against the contract's `ContentBlockSchema` (`type` required).
      // Awaited BEFORE the terminal: the drain exits on the terminal
      // frame, so an un-awaited sink races its own persist and the
      // content row can commit after the `finish` row (out-of-order
      // seq), which the live drain never replays.
      await input.sink({ content: { text, type: "text" }, type: "text" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await input.sink({
        error: { message },
        stopReason: "error",
        type: "turn_end",
      });
      throw new Error(`direct-cli prompt failed: ${message}`, {
        cause: error,
      });
    }
    await input.sink({ stopReason: "end_turn", type: "turn_end", usage: null });
    return { stopReason: "end_turn", turnId: randomUUID(), usage: null };
  }

  /** Read-only model catalog: agy's models are probed out-of-band
   * (`probeAgyModels`), not per session, so the picker degrades to a
   * read-only display. */
  configOptions(): Promise<AcpConfigOption[]> {
    return Promise.resolve(this.handle.configOptions);
  }

  /**
   * There is no in-flight child to abort between turns: a running
   * `agy --print` finishes on its own. Report success so the chat layer's
   * Stop button stays responsive (the accepted direct-cli degradation).
   */
  cancel(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
