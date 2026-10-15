/**
 * Per-conversation live frame hub (TASK-80.14 live/durable split).
 *
 * The hub owns the LIVE plane of a conversation: an in-memory `ring` of the
 * in-flight turn's wire frames plus a coalesced `lane` of stream-only
 * terminal-output snapshots. Live frames are pushed by the turn's sink
 * (`publishFrame`); the DB is NOT on the live path (the persistence write is
 * fire-and-forget, awaited only for the terminal row).
 *
 * Settle boundary: `closeHub` marks the terminal row durable, wakes every
 * live-waiting subscriber exactly once, and re-arms the gate. A closed hub
 * never re-opens; the next `send` replaces it with a fresh one (the settled
 * transcript then lives on in the DB as history, read by `listHistory`).
 */

import type { ChatFrame } from "@manobu/api-contract";

/** Wire frame = the contract's ChatFrame (AionUi IResponseMessage envelope). */
export type WireFrame = ChatFrame;

/** Frame types that terminate a conversation stream. */
export const TERMINAL_FRAME_TYPES = ["finish", "error"] as const;

/** How many ring entries a subscriber may fall behind before it is
 * flagged lagged (AionCore `Lagged{skipped}` parity; logged loud, the
 * subscriber keeps its coarse-replay recovery via the next resubscribe). */
export const RING_LAG_LIMIT = 256;

export interface LaneEntry {
  frame: WireFrame;
  seq: number;
}

export interface FrameHub {
  /**
   * Resolved when frames are available; replaced after each drain. A
   * FRESH hub arms a pending gate: a no-turn conversation idles in
   * `waitSettled` until the next `send`'s first `publishFrame` (the
   * long-lived bus, TASK-80.2 AC#1 shape), and a settled hub never
   * re-arms (the flag is sticky, the drain exits on the ring tail).
   */
  gate: Promise<void>;
  /** Resolves the current gate (set by the publisher). */
  release: () => void;
  /** In-memory live ring: the in-flight turn's wire frames, in order. */
  ring: WireFrame[];
  /** Sticky: true once the terminal frame is settled. Never re-opens. */
  terminal: boolean;
  /**
   * In-memory live lane for terminal-output frames (stream-only, never
   * persisted per the 0006 DDL). Cumulative snapshots, one entry per
   * `terminal_id` (last writer wins). Bounded by the number of concurrent
   * hosted terminals, not by output volume. `seq` advances on every
   * publish so subscriber lane cursors stay monotonic.
   */
  terminalLane: Map<string, LaneEntry>;
  /** Monotonic seq allocator for lane entries (per-subscriber cursors). */
  terminalSeq: number;
}

export interface ChatContext {
  hubs: Map<string, FrameHub>;
  turns: Map<string, { msgId: string; turnId: string }>;
}

/** Build the shared chat context (hubs + turn gates) for one process. */
export function createChatContext(): ChatContext {
  return { hubs: new Map(), turns: new Map() };
}

/**
 * Per-conversation hub accessor (create-on-miss). The fresh hub arms a
 * PENDING gate: a no-turn conversation parks in `waitSettled` (zero CPU)
 * until the next `send`'s first `publishFrame` resolves it. A resolved
 * idle gate here would spin the drain loop as a microtask starver — the
 * 2026-09-19 e2e hang — so the gate must ALWAYS be armed pending when
 * nothing has been published yet.
 */
export function hubFor(ctx: ChatContext, conversationId: string): FrameHub {
  let hub = ctx.hubs.get(conversationId);
  if (!hub) {
    hub = freshHub();
    ctx.hubs.set(conversationId, hub);
  }
  return hub;
}

function freshHub(): FrameHub {
  const hub: FrameHub = {
    gate: Promise.resolve(),
    release: (): void => undefined,
    ring: [],
    terminal: false,
    terminalLane: new Map(),
    terminalSeq: 0,
  };
  armGate(hub);
  return hub;
}

/**
 * Arm the next `gate` promise + its resolver. Re-arming AFTER a release is
 * what makes the lost-pulse window unrepresentable: a publisher that closes
 * the hub resolves the captured gate and re-arms a fresh one; a subscriber
 * that just captured the settled gate wakes, sees `terminal`, and exits.
 */
function armGate(hub: FrameHub): void {
  hub.gate = new Promise<void>((resolve) => {
    hub.release = resolve;
  });
}

/**
 * Push one in-flight live frame onto the hub's ring and wake drains.
 * Terminal frames (`finish`/`error`) carry the in-order ring content; the
 * settled boundary is applied separately by the sink after the terminal
 * row is durably committed (`closeHub`).
 */
export function publishFrame(hub: FrameHub, frame: WireFrame): void {
  hub.ring.push(frame);
  pulse(hub);
}

/**
 * Push one terminal-output wire frame onto the hub's live lane and wake
 * drains. Cumulative-snapshot semantics: one entry per `terminalId` (last
 * writer wins), so the lane stays bounded by the number of concurrent
 * hosted terminals.
 */
export function pushTerminalFrame(
  hub: FrameHub,
  frame: WireFrame,
  terminalId: string
): void {
  hub.terminalSeq += 1;
  hub.terminalLane.set(terminalId, { frame, seq: hub.terminalSeq });
  pulse(hub);
}

/**
 * Settle the conversation's live plane: the terminal row is durable (the
 * sink awaited it before calling this), so wake every live drain exactly
 * once. Sticky: a second call is a no-op (the gate re-arm is idempotent
 * and the flag never clears).
 */
export function closeHub(hub: FrameHub): void {
  if (hub.terminal) {
    return;
  }
  hub.terminal = true;
  hub.release();
  armGate(hub);
}

/** Wake everyone waiting on the hub's gate, then re-arm it. */
function pulse(hub: FrameHub): void {
  hub.release();
  armGate(hub);
}

/**
 * Wait until the hub publishes a frame or settles. Parks on the gate's
 * PENDING promise (the idle state — a fresh or reset hub is always armed
 * pending). Resolves immediately when `terminal` is already set (a settled
 * hub's re-armed gate would otherwise park a drain that must exit).
 */
export async function waitSettled(hub: FrameHub): Promise<void> {
  if (hub.terminal) {
    return;
  }
  await hub.gate;
}

/**
 * Reopen the hub for a NEW turn: the previous turn's ring is dropped (it
 * lives on in the DB as history), the lane snapshots are stale for the new
 * turn, and the sticky settle flag clears. The SAME hub object is reused
 * (not replaced) so a subscriber parked on the gate wakes on the new
 * turn's first `publishFrame` instead of stranding on a dead object. The
 * gate is re-armed PENDING so the reopened idle hub parks drains again
 * (same spin-starvation rule as `freshHub`).
 */
export function resetHub(hub: FrameHub): void {
  hub.terminal = false;
  hub.ring = [];
  hub.terminalLane.clear();
  // Release-then-rearm: a subscriber parked on the PREVIOUS gate (idle
  // attach, or parked across turns) must wake, drain the empty ring, and
  // park again on the fresh pending gate — otherwise the old gate never
  // resolves and the subscriber strands.
  pulse(hub);
}
