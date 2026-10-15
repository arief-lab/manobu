/*
 * Weak-pattern → nextCards queue builder (TASK-18.5).
 *
 * Wires `deriveWeakPatterns` (the top-3 weak grammar patterns the learner
 * failed at in JLPT Mock) into the practice queue so AI generation is
 * guided by the learner's real weaknesses. The output is filtered to
 * corpus-anchored cards (no hallucinated vocab) via
 * `filterNextCardsByWeakPatterns`.
 *
 * Pure orchestration: no network, no Tauri. The caller passes in the
 * mistakes + candidate cards (from `useNextCards`) and gets back a
 * patterns-filtered queue. If no cards match any weak pattern, falls
 * back to the original cards so the queue never goes empty.
 */

import { deriveWeakPatterns, type Mistake } from "./mock";
import { filterNextCardsByWeakPatterns, type NextCardLike } from "./queue";

export interface WeakPatternQueue {
  cards: readonly NextCardLike[];
  weak: ReadonlyArray<{
    grammarId: string;
    pattern: string;
    total: number;
    wrong: number;
  }>;
}

/**
 * Build a weak-pattern-driven queue. `candidates` is the corpus-anchored
 * card set (from `useNextCards` or the offline fallback). The function
 * is pure + non-throwing: any failure inside `deriveWeakPatterns` is
 * caught and treated as "no weak patterns", in which case the original
 * candidates are returned unchanged.
 */
export const buildWeakPatternQueue = async (
  mistakes: readonly Mistake[],
  candidates: readonly NextCardLike[]
): Promise<WeakPatternQueue> => {
  let weak: ReadonlyArray<{
    grammarId: string;
    pattern: string;
    total: number;
    wrong: number;
  }> = [];
  try {
    const top = await deriveWeakPatterns(mistakes);
    weak = top.map((w) => ({
      grammarId: w.grammarId,
      pattern: w.pattern,
      total: w.total,
      wrong: w.wrong,
    }));
  } catch {
    weak = [];
  }
  const filtered = filterNextCardsByWeakPatterns(candidates, weak);
  const cards = filtered.length > 0 ? filtered : candidates;
  return { cards, weak };
};
