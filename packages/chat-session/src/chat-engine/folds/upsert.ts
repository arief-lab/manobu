/**
 * Shared fold primitives (TASK-81.2). Every fold builds on these two
 * helpers, which is what kills the card-envelope clone group: the
 * per-card literals stay in the folds (each card's contract fields are
 * explicit), but the "append or full-replace by id" tail is written once.
 */

import type { TMessage } from "../types";

/** Insert `card` if no card with the same id exists, else full-replace
 * it in place (AionUi snapshot parity). Pure: returns a new array. */
export function upsertCard(prev: TMessage[], card: TMessage): TMessage[] {
  const idx = prev.findIndex((m) => m.id === card.id);
  if (idx < 0) {
    return [...prev, card];
  }
  const next = prev.slice();
  next[idx] = card;
  return next;
}
