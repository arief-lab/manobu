/**
 * Terminal-error retry policy (TASK-104).
 *
 * The turn fails when the upstream agent hiccups. This module is the PURE
 * decision surface: given a terminal `ChatFrame` (an `error` frame or a
 * `finish` that closed with `stopReason: "error"`), say whether the hook
 * should re-drive the turn once, and what short reason label the retry
 * notice carries. No I/O, no React — the classification matrix is unit-
 * tested directly (`retry-policy.test.ts`), and the hook's orchestrator
 * (`createRetryOrchestrator` in `use-chat-engine.ts`) consults it.
 *
 * Policy (AC#1/#3, mirrored in packages/chat-session/AGENTS.md):
 * - A typed engine code that means "the learner must act" (AUTH_REQUIRED,
 *   CONFIG_SWITCH_FAILED) is NEVER retried: the failure is real and ends
 *   the turn immediately with its reason.
 * - A blank message, or a message matching a transient class (rate limit,
 *   timeout, empty response, connection reset), is retryable ONCE.
 * - Anything else is treated as a genuine, unclassified failure and is NOT
 *   retried — an unbounded retry loop on a real error is worse than one
 *   wasted auto-retry.
 */

import type { ChatFrame } from "@manobu/api-contract";

/** The two facts this policy reads off a terminal frame. */
export interface TerminalError {
  /** Typed engine error code (TASK-102); absent for a generic failure. */
  code?: string;
  /** Human-readable reason from the wire (`error.data.text` /
   * `finish.data.error.message`). Empty for a bare error finish. */
  message: string;
}

/**
 * A transient upstream class the learner should not have to re-ask for.
 * `label` is the short reason the retry notice shows (never the raw
 * message); `pattern` matches the message case-insensitively. The classes
 * are deliberately narrow (AC#1's three: rate limit, timeout, empty
 * response) plus the connection-reset wording the ACP child emits.
 */
const TRANSIENT_CLASSES: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  { label: "rate limit", pattern: /rate.?limit|too many requests|\b429\b/ },
  { label: "timeout", pattern: /timed?.?out|\btimeout\b|deadline exceeded/ },
  {
    label: "empty response",
    pattern: /empty response|no (?:content|response)/,
  },
  {
    label: "connection reset",
    pattern:
      /connection (?:reset|closed)|socket hang ?up|econnreset|econnrefused/,
  },
];

/** Codes that mean the learner must intervene, never the transport failed.
 * Kept as a set so a new non-retryable code is one line, not an edit to the
 * decision body. */
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "AUTH_REQUIRED",
  "CONFIG_SWITCH_FAILED",
]);

/** Extract the policy's inputs from a frame, or null when the frame is not
 * a terminal error. Mirrors the two error-bearing wire shapes
 * (`chat-frames.ts`): an `error` frame carries `data.text`; a `finish` that
 * closed with `stopReason: "error"` carries `data.error.{code,message}`. */
export function terminalError(frame: ChatFrame): TerminalError | null {
  if (frame.type === "error") {
    return { message: frame.data.text };
  }
  if (frame.type === "finish") {
    const { error, stopReason } = frame.data as {
      error?: { code?: string; message?: string };
      stopReason?: string;
    };
    if (stopReason !== "error") {
      return null;
    }
    return { code: error?.code, message: error?.message ?? "" };
  }
  return null;
}

/** Match a message against the transient classes; the first hit's label
 * wins. Null when no transient class matches (a genuine/unclassified error). */
function transientLabel(message: string): string | null {
  const lower = message.toLowerCase();
  for (const entry of TRANSIENT_CLASSES) {
    if (entry.pattern.test(lower)) {
      return entry.label;
    }
  }
  return null;
}

export interface RetryDecision {
  /** The transient label when retryable; null otherwise. */
  reason: string | null;
  /** True when the hook should re-drive the turn (subject to the once
   * budget the caller owns — this predicate is stateless). */
  retryable: boolean;
}

/**
 * The single decision: retry this terminal error or not. A learner-action
 * code is final; a transient class (or a bare message-less error, which the
 * ACP child emits on an aborted/empty upstream) is retryable; an
 * unclassified message is final (no loop).
 */
export function classifyTerminalError(frame: ChatFrame): RetryDecision | null {
  const error = terminalError(frame);
  if (error === null) {
    return null;
  }
  if (error.code && NON_RETRYABLE_CODES.has(error.code)) {
    return { reason: null, retryable: false };
  }
  const label = transientLabel(error.message);
  if (label) {
    return { reason: label, retryable: true };
  }
  // A bare error finish with no message and no code is the "empty
  // response" shape (session.ts failTurn with an empty detail); retry it.
  if (error.message.trim() === "") {
    return { reason: "empty response", retryable: true };
  }
  return { reason: null, retryable: false };
}
