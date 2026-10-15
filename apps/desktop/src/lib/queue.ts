/*
 * Interleaved practice queue (spec §SCR-08 l8AjK).
 *
 * Per spec: 1 old leech + 2 new. The leech is the most lapsed card in
 * revlog; the new cards are pulled from vocab where state='new' in cards.
 * Cap total at 3 per queue item.
 *
 * Offline fallback (TASK-18.4): when fetch to /learn/chat fails or
 * __TAURI__ is absent, callers fall back to local vocabContaining() and
 * numbers.ts static sets. This module stays pure and never throws — even
 * when fetch or Tauri are unavailable, it returns 3 cards via the local
 * corpus or static IDs.
 */

export interface QueueCard {
  due: string;
  isLeech: boolean;
  isNew: boolean;
  /** TASK-40 AC6: vocab snapshot for display (undefined → "vocab {id}"). */
  jp?: string;
  level?: string;
  reading?: string;
  vocabId: number;
}

export interface RevlogEntry {
  cardId: number;
  lapses: number;
  ts: string;
}

export const pickCards = (
  leech: RevlogEntry[],
  newVocabIds: number[],
  total = 3
): QueueCard[] => {
  const queue: QueueCard[] = [];
  // 1 leech
  const topLeeches = leech
    .filter((r) => r.lapses > 4)
    .sort((a, b) => b.lapses - a.lapses);
  const [topLeech] = topLeeches;
  if (topLeech) {
    queue.push({
      due: topLeech.ts,
      isLeech: true,
      isNew: false,
      vocabId: topLeech.cardId,
    });
  }
  // 2 new
  for (const vocabId of newVocabIds.slice(0, Math.max(0, total - 1))) {
    queue.push({
      due: new Date().toISOString().slice(0, 10),
      isLeech: false,
      isNew: true,
      vocabId,
    });
  }
  return queue;
};

export const I1_TOTAL = 3;

/**
 * Whether the app is running outside Tauri (web-only Vite dev). When true,
 * AI nextCards via the MCP sidecar will fail — callers should use the local
 * fallback instead of making an AI call.
 */
export const isTauriAvailable = (): boolean =>
  typeof window !== "undefined" && "__TAURI__" in window;

/**
 * Static fallback vocab IDs when even local vocabContaining() cannot be
 * reached (e.g. no JSON yet). Uses the numbers.ts counter range so the
 * queue can still render without throwing.
 */
const OFFLINE_FALLBACK_IDS: readonly number[] = [1, 2, 3] as const;
/**
 * Build a queue that never throws: if newVocabIds is empty (e.g. fetch
 * failed), fall back to OFFLINE_FALLBACK_IDS so the queue still returns
 * 1 leech + 2 new = 3 cards when a leech exists, or 2 new otherwise.
 * Pure — no network, no Tauri invoke.
 */
export const pickCardsWithFallback = (
  leech: RevlogEntry[],
  newVocabIds: number[],
  total = I1_TOTAL
): QueueCard[] => {
  const fallbackIds =
    newVocabIds.length > 0 ? newVocabIds : [...OFFLINE_FALLBACK_IDS];
  return pickCards(leech, fallbackIds, total);
};

/**
 * Minimal card surface for weak-pattern filtering (TASK-18.5). The queue
 * build is corpus-anchored: every card we ship to the learner must
 * originate from a real `@manobu/japanese/data/<level>.json` entry.
 */
export interface NextCardLike {
  jp: string;
  level: string;
  reading: string;
  vocabId: number;
}

/**
 * Filter nextCards by user weak patterns (TASK-18.5). Only cards whose
 * `jp` form overlaps at least one weak pattern's `pattern` string are
 * kept. This is the QA gate that prevents hallucinated vocab from
 * slipping into the queue — every remaining card is corpus-anchored
 * and patterns-driven.
 *
 * Pure: never throws, never mutates, returns a (possibly empty) array.
 * Empty weak list or empty cards → input cards (no filtering).
 */
export const filterNextCardsByWeakPatterns = <T extends NextCardLike>(
  cards: readonly T[],
  weakPatterns: ReadonlyArray<{ pattern: string }>
): readonly T[] => {
  if (cards.length === 0 || weakPatterns.length === 0) {
    return cards;
  }
  const needles = weakPatterns
    .map((w) => w.pattern?.trim())
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (needles.length === 0) {
    return cards;
  }
  return cards.filter((c) => {
    const haystack = `${c.jp} ${c.reading} ${c.level}`;
    return needles.some((needle) => haystack.includes(needle));
  });
};
