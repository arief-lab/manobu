/**
 * The context-usage reading (TASK-103): a pure derivation from the card
 * list to the number the header shows. Kept out of React so the fold →
 * selector → value path is unit-testable and the route stays thin.
 *
 * AC#4 discipline: `used` and `size` are the agent's OWN reported figures
 * (the wire `acp_context_usage` payload). A percentage is only ever
 * `used / size`; the UI never substitutes a guessed window size, so a
 * missing/zero `size` yields no percentage rather than a fabricated one.
 */

import type { TMessage, TMessageContextUsage } from "./types";

/** How full the context is, as a tier the header colours. `unknown` when
 * the agent reported no usable window (size 0/absent). */
export type ContextUsageTier = "danger" | "normal" | "unknown" | "warning";

export interface ContextUsage {
  cost?: { amount: number; currency: string } | null;
  size: number;
  used: number;
}

export interface ContextUsageView extends ContextUsage {
  /** Rounded 0–100 percentage, or null when no window size was reported. */
  percent: number | null;
  tier: ContextUsageTier;
}

// The window is "getting full" before it is exhausted: warn at 70%, turn
// danger at 90%. Named constants, not magic numbers at the call site.
const WARNING_PERCENT = 70;
const DANGER_PERCENT = 90;

/** The tier for a clamped 0–100 percentage (danger first, so the edge
 * case is the most urgent). */
function tierForPercent(percent: number): ContextUsageTier {
  if (percent >= DANGER_PERCENT) {
    return "danger";
  }
  if (percent >= WARNING_PERCENT) {
    return "warning";
  }
  return "normal";
}

/** The conversation's current context reading, or null when no
 * `acp_context_usage` card has folded yet. There is at most one usage card
 * (singleton id `usage:{conversation_id}`), but a merge of persisted + live
 * lists could briefly hold two, so the newest `created_at` wins. */
export function latestContextUsage(
  cards: readonly TMessage[]
): ContextUsage | null {
  let newest: TMessageContextUsage | undefined;
  for (const card of cards) {
    if (card.type !== "acp_context_usage") {
      continue;
    }
    if (
      newest === undefined ||
      (card.created_at ?? 0) >= (newest.created_at ?? 0)
    ) {
      newest = card;
    }
  }
  if (newest === undefined) {
    return null;
  }
  return { cost: newest.cost, size: newest.size, used: newest.used };
}

/** Add the derived percentage + tier to a usage reading. `used` is clamped
 * to `size` for the display percentage (a turn can report slightly over);
 * a non-positive `size` yields `percent: null` / `tier: "unknown"`. */
export function contextUsageView(usage: ContextUsage): ContextUsageView {
  if (usage.size <= 0) {
    return { ...usage, percent: null, tier: "unknown" };
  }
  const percent = Math.min(100, Math.round((usage.used / usage.size) * 100));
  return { ...usage, percent, tier: tierForPercent(percent) };
}
