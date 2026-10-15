/**
 * Direct-CLI adapter — Tier 2.1 (`research/agent-stack-gaps-vs-aionui.md`).
 *
 * Shells out to a non-ACP agent CLI in single-shot mode (`agy --print`).
 * `agy` has no ACP server mode, so the native session engine (`session.ts`)
 * reaches it through the `DirectCliSession` facade (`direct-cli-session.ts`),
 * which consumes `runSingleShot` below and shapes its result into ACP
 * frames. The AI-SDK model layer that once wrapped this (the V3 model
 * builder + prompt flattening) was deleted in TASK-80.6: the native engine
 * speaks `@agentclientprotocol/sdk` wire frames directly, not AI-SDK parts.
 *
 * ## Streaming honesty
 *
 * `agy --print` is single-shot: it runs the prompt to completion and prints
 * the reply. No tool-call surface — direct-cli agents are plain text
 * generators; the jlpt-vocab MCP tools stay on the ACP agents.
 */

import { spawn } from "node:child_process";

import { killGroupQuiet } from "./child-registry";

interface SpawnedProcess {
  kill: (signal?: string) => void;
  on: {
    (event: "close", listener: (code: number | null) => void): void;
    (event: "error", listener: (error: Error) => void): void;
    (event: string, listener: (...args: unknown[]) => void): void;
  };
  /** Group id for a detached child; see `killGroupQuiet`. */
  pid?: number;
  stderr: NodeJS.ReadableStream | null;
  stdout: NodeJS.ReadableStream | null;
}

/** Cast a real `spawn()` result to the minimal surface we consume. */
function asSpawned(proc: unknown): SpawnedProcess {
  return proc as SpawnedProcess;
}

export interface DirectCliModelOptions {
  /** Binary resolved against `$PATH` (registry `command`). */
  command: string;
  /** Working directory for the child process. */
  cwd: string;
}

/**
 * argv for `agy --print` — flags first, prompt last (Go flag parsing stops at
 * the first positional).
 *
 * Deliberately ONLY `--print` + the prompt: agy v1.1.11 breaks single-shot
 * answers when extra flags are present. `--disable-slash-commands` makes it
 * reply with just the flag-acknowledgement preamble and never answer the
 * prompt; `--output-format text` alone can hang. Verified live (2026-08-07):
 * the bare form answers correctly from the model's own knowledge.
 */
function buildArgs(promptText: string, currentModel?: string | null): string[] {
  const args = ["--print"];
  if (currentModel) {
    args.push("--model", currentModel);
  }
  args.push(promptText);
  return args;
}

/**
 * Run `agy --print` once and resolve the full stdout text. The child is
 * always killed; a 5-minute guard (agy's own default `--print-timeout`)
 * prevents a hung process from leaking.
 */
export function runSingleShot(
  options: DirectCliModelOptions,
  promptText: string,
  abortSignal?: AbortSignal,
  currentModel?: string | null
): Promise<{ text: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const args = buildArgs(promptText, currentModel);
    const child = asSpawned(
      spawn(options.command, args, {
        cwd: options.cwd,
        // TASK-102: own group, so any process agy itself spawns dies with it.
        detached: true,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      })
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const guard = setTimeout(
      () => {
        killGroupQuiet(child.pid);
      },
      5 * 60 * 1000
    );

    const onAbort = (): void => {
      clearTimeout(guard);
      killGroupQuiet(child.pid);
      reject(new Error(`[direct-cli] ${options.command}: aborted`));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      clearTimeout(guard);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(
        new Error(
          `[direct-cli] failed to spawn "${options.command}": ${String(error)}`
        )
      );
    });
    child.on("close", (code) => {
      clearTimeout(guard);
      abortSignal?.removeEventListener("abort", onAbort);
      if (code !== 0 && !stdout.trim()) {
        reject(
          new Error(
            `[direct-cli] "${options.command}" exited ${code ?? "null"}: ${stderr.trim() || "no output"}`
          )
        );
        return;
      }
      resolve({ exitCode: code, text: stdout });
    });
  });
}

/** Tab (or whitespace) separates `agy models` lines: `<id>\t<description>`. */
const MODEL_COLUMN_RE = /[\t\s]+/;

/** Line splitter for `agy models` output (hoisted — used per call). */
const LINE_RE = /\n/;

/**
 * Run `agy models` (a subcommand, NOT `--print`) and return the model ids.
 * Returns `[]` on any failure — the chat still works with agy's default
 * model; only the picker list is affected.
 *
 * Two agy quirks handled here:
 * - It writes a progress line ("Fetching available models...") to **stderr**;
 *   the model table is on stdout — parse stdout only.
 * - It hangs when stdin is an open pipe, so stdin is `ignore` (the server
 *   must never leave an orphaned agy waiting on a pipe).
 */
export function probeAgyModels(
  command: string,
  cwd: string
): Promise<string[]> {
  return new Promise((resolve) => {
    const child = asSpawned(
      spawn(command, ["models"], {
        cwd,
        detached: true,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      })
    );

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.resume();
    const guard = setTimeout(() => {
      killGroupQuiet(child.pid);
    }, 20_000);
    child.on("error", () => {
      clearTimeout(guard);
      resolve([]);
    });
    child.on("close", (code) => {
      clearTimeout(guard);
      if (code !== 0) {
        resolve([]);
        return;
      }
      // Each line is `<id>\t<description>` — keep the id (first column).
      resolve(
        stdout
          .split(LINE_RE)
          .map((line) => line.split(MODEL_COLUMN_RE)[0]?.trim() ?? "")
          .filter(Boolean)
      );
    });
  });
}
