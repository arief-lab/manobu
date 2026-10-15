/**
 * Conversation guard · AionUi ACP-V2 last-mile adoption (TASK-22 Tier A).
 *
 * Three pieces ported from AionUi's proven shapes (`conversationBusyError.ts`,
 * `useConversationCommandQueue.ts`, `buildSendFailureError.ts`):
 *
 * 1. {@link classifyConversationBusyError} · recognizes the upstream
 *    "conversation busy / already processing" failure so callers can wait
 *    instead of erroring.
 * 2. {@link SessionCommandQueue} · serializes prompt execution per session:
 *    overlapping sends (rapid Next taps, cron tick + user send) enqueue and
 *    drain one-by-one instead of interleaving in one ACP session.
 * 3. {@link buildSendFailureError} · structured error taxonomy
 *    (`reconnect_agent | wait | fix_path | retry`) that UI error cards
 *    render instead of `String(e)`.
 *
 * Invariants (doc-1 §6): queue before concurrency; errors are data, never
 * thrown strings; everything degrades without a live agent.
 */

/** Resolution the UI should offer for a failed send. */
export type SendFailureResolution =
  | "fix_path"
  | "reconnect_agent"
  | "retry"
  | "wait";

/** Structured send-failure payload · render this, not `String(e)`. */
export interface SendFailureError {
  code: SendFailureCode;
  /** Human-readable detail (already-classified upstream message). */
  detail: string;
  resolution: SendFailureResolution;
  /** Upstream error text (for diagnostics expansion). */
  upstream: string;
}

/** Stable error codes · mirrors AionUi `buildSendFailureError`. */
export type SendFailureCode =
  | "conversation_busy"
  | "path_unavailable"
  | "unknown_upstream"
  | "user_agent_disconnected";

/** Classify one thrown upstream failure into the taxonomy. Never throws. */
export const buildSendFailureError = (error: unknown): SendFailureError => {
  const upstream =
    error instanceof Error ? error.message : String(error ?? "unknown");
  const classification = classifyUpstream(upstream);
  return {
    code: classification.code,
    detail: classification.detail,
    resolution: classification.resolution,
    upstream,
  };
};

interface UpstreamClassification {
  code: SendFailureCode;
  detail: string;
  resolution: SendFailureResolution;
}

/**
 * One classification rule: `any` is a list of alternative keyword groups,
 * each an AND-set of substrings that must ALL appear in the lowercased
 * upstream message (groups match OR-wise). Order matters · first match wins.
 */
interface UpstreamRule {
  any: readonly (readonly string[])[];
  classification: UpstreamClassification;
}

/**
 * The "conversation busy" keyword groups · one flat OR-list of AND-groups,
 * shared by the busy classifier and the busy row of `UPSTREAM_RULES` below,
 * so the two classifiers can never drift apart.
 */
const BUSY_GROUPS: readonly (readonly string[])[] = [
  ["busy"],
  ["already processing"],
  ["in progress"],
  ["aionui_conversation_busy"],
];

/**
 * Keyword → code/resolution table mirroring the AionUi taxonomy. Connection
 * death first (process exit, socket reset, transport closed · spawn ENOENT is
 * a path problem and matches the fix_path rule below), then busy, then path.
 */
const UPSTREAM_RULES: readonly UpstreamRule[] = [
  {
    any: [
      ["connection closed"],
      ["socket connection"],
      ["process exited"],
      ["user_agent_disconnected"],
    ],
    classification: {
      code: "user_agent_disconnected",
      detail: "The agent process disconnected. Reconnect and try again.",
      resolution: "reconnect_agent",
    },
  },
  {
    any: BUSY_GROUPS,
    classification: {
      code: "conversation_busy",
      detail: "The agent is still answering. Queued · it will run next.",
      resolution: "wait",
    },
  },
  {
    // Either a bare missing-path keyword, or the pair marking a lost
    // workspace ("workspace" AND "unavailable").
    any: [
      ["not found"],
      ["enoent"],
      ["no such file"],
      ["workspace", "unavailable"],
    ],
    classification: {
      code: "path_unavailable",
      detail: "Agent binary or workspace path not found. Fix the path.",
      resolution: "fix_path",
    },
  },
];

const UNKNOWN_UPSTREAM: UpstreamClassification = {
  code: "unknown_upstream",
  detail: "Send failed. Retry · if it persists, reconnect the agent.",
  resolution: "retry",
};

/** True when `lower` contains every keyword of at least one AND-group. */
const matchesAnyGroup = (
  lower: string,
  groups: readonly (readonly string[])[]
): boolean =>
  groups.some((group) => group.every((keyword) => lower.includes(keyword)));

const classifyUpstream = (upstream: string): UpstreamClassification => {
  const lower = upstream.toLowerCase();
  for (const rule of UPSTREAM_RULES) {
    if (matchesAnyGroup(lower, rule.any)) {
      return rule.classification;
    }
  }
  return UNKNOWN_UPSTREAM;
};

/**
 * Recognize the upstream "conversation busy" failure (AionUi
 * `conversationBusyError.ts` analog). Callers use this to *wait* (or enqueue)
 * rather than surfacing an error for a normal condition.
 */
export const classifyConversationBusyError = (
  error: unknown
): { busy: boolean } => {
  if (error === null || error === undefined) {
    return { busy: false };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { busy: matchesAnyGroup(message.toLowerCase(), BUSY_GROUPS) };
};

/** One queued command. */
export interface QueuedCommand<T> {
  run: () => Promise<T>;
}

/** Result of an enqueue: either ran now or queued behind the active one. */
export type EnqueueOutcome = "ran" | "queued";

/**
 * Serialize command execution per session. The AionUi
 * `useConversationCommandQueue` invariant, server-side: a prompt that lands
 * while the agent is still streaming waits instead of interleaving, then
 * auto-drains when the active command settles.
 *
 * A bounded drop-oldest policy (`maxPending`) protects against runaway
 * growth (e.g. a cron loop whose ticks fire faster than the agent
 * answers): the oldest pending command is rejected with a busy
 * {@link SendFailureError} instead of queued.
 */
export class SessionCommandQueue {
  private active: Promise<unknown> = Promise.resolve();
  private readonly maxPending: number;
  private pending = 0;

  constructor(opts?: { maxPending?: number }) {
    this.maxPending = opts?.maxPending ?? 8;
  }

  /** Number of commands waiting or executing. */
  get depth(): number {
    return this.pending;
  }

  /**
   * Run `command` immediately if idle, else enqueue behind the active one.
   * Resolves with how the command was admitted. Admission rejections carry
   * a structured busy {@link SendFailureError}; command failures propagate
   * as-is. The chain settles FIFO, so `pending > 0` at admission time is
   * exactly the busy signal.
   */
  async enqueue<T>(
    command: () => Promise<T>
  ): Promise<{ outcome: EnqueueOutcome; result: T }> {
    if (this.pending >= this.maxPending) {
      // Backpressure: reject the newcomer with a busy error rather than
      // growing unbounded (e.g. a cron loop ticking faster than the agent
      // answers). AionUi's queue-protection toggle has the same shape.
      throw buildSendFailureError(
        new Error(
          "AIONUI_CONVERSATION_BUSY: command queue full · try again when the agent catches up"
        )
      );
    }
    const wasBusy = this.pending > 0;
    this.pending += 1;
    const chained = this.active.then(command, command);
    this.active = chained.then(
      () => undefined,
      () => undefined
    );
    try {
      const result = await chained;
      return { outcome: wasBusy ? "queued" : "ran", result };
    } finally {
      this.pending -= 1;
    }
  }
}
