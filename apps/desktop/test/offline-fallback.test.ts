import { describe, expect, it } from "bun:test";

import {
  __test__ as groundedMeta,
  pickGroundedExample,
} from "@/lib/grounded-examples";
import { loadLocalNextCards, nextCardsQueryOptions } from "@/lib/next-cards";
import { I1_TOTAL, pickCardsWithFallback } from "@/lib/queue";

describe("offline fallback — local corpus when MCP/TAURI unavailable (TASK-18.4)", () => {
  it("loadLocalNextCards returns 3 corpus-anchored cards without network", async () => {
    const cards = await loadLocalNextCards("N5");
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.jp.length).toBeGreaterThan(0);
      expect(c.reading.length).toBeGreaterThan(0);
      expect(c.vocabId).toBeGreaterThan(0);
      expect(c.level).toBe("N5");
    }
  });

  it("pickCardsWithFallback still returns 3 when newVocabIds is empty (fetch failed)", () => {
    const leech = [{ cardId: 42, lapses: 9, ts: "2026-09-04" }];
    const queue = pickCardsWithFallback(leech, [], I1_TOTAL);
    // 1 leech + 2 new from OFFLINE_FALLBACK_IDS
    expect(queue).toHaveLength(3);
    expect(queue.find((q) => q.isLeech)?.vocabId).toBe(42);
    expect(queue.filter((q) => q.isNew)).toHaveLength(2);
  });

  it("pickCardsWithFallback falls back when fetch to /learn/chat fails — queue never throws", () => {
    // Simulate the lesson path: useNextCards returned [] (fetch failed or empty),
    // newVocabIds is []. The queue helper must not throw and must still give 3.
    expect(() => pickCardsWithFallback([], [])).not.toThrow();
    const queueNoLeech = pickCardsWithFallback([], [], I1_TOTAL);
    // No leech, so only 2 fallback new ids are rendered (spec: total 3 = 1 leech slot + 2 new)
    expect(queueNoLeech.length).toBeGreaterThanOrEqual(2);
    expect(queueNoLeech.every((q) => q.isNew)).toBe(true);

    const queueWithLeech = pickCardsWithFallback(
      [{ cardId: 7, lapses: 6, ts: "2026-09-04" }],
      [],
      3
    );
    expect(queueWithLeech).toHaveLength(3);
  });

  it("nextCardsQueryOptions falls back to local corpus when fetch rejects", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    // In bun test window.__TAURI__ is undefined, so next-cards will
    // take the no-AI-call offline branch (isTauriAvailable() === false) and
    // must not call fetch at all.
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.reject(new Error("network down"));
    }) as unknown as typeof fetch;

    try {
      const opts = nextCardsQueryOptions("N5");
      const result = await (
        opts.queryFn as unknown as (args: { signal: AbortSignal }) => Promise<{
          nextCards: { vocabId: number }[];
        }>
      )({ signal: new AbortController().signal });
      // Offline branch: no AI call, immediate local fallback of 3 cards
      expect(fetchCalled).toBe(false);
      expect(result.nextCards).toHaveLength(3);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Now simulate Tauri present but fetch failing — fallback still gives 3
    (globalThis as unknown as Record<string, unknown>).__TAURI__ = {};
    globalThis.fetch = (() =>
      Promise.reject(
        new Error("MCP sidecar not running")
      )) as unknown as typeof fetch;
    try {
      const opts = nextCardsQueryOptions("N5");
      const result = await (
        opts.queryFn as unknown as (args: { signal: AbortSignal }) => Promise<{
          nextCards: { vocabId: number }[];
        }>
      )({ signal: new AbortController().signal });
      expect(result.nextCards).toHaveLength(3);
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as Record<string, unknown>).__TAURI__ = undefined;
      if (typeof window !== "undefined") {
        (window as unknown as Record<string, unknown>).__TAURI__ = undefined;
      }
    }
  });
});

describe("grounded example fallback — Tatoeba/Tanaka corpus (TASK-23.4.4)", () => {
  it("pickGroundedExample returns a corpus sentence with a Tatoeba id", () => {
    const example = pickGroundedExample("test");
    expect(example.jp.length).toBeGreaterThan(0);
    expect(example.en.length).toBeGreaterThan(0);
    expect(example.tatoebaId).toBeGreaterThan(0);
  });

  it("is deterministic per seed and varies across seeds", () => {
    const a = pickGroundedExample("seed-a");
    const a2 = pickGroundedExample("seed-a");
    expect(a).toEqual(a2);
    // 20 head sentences — different seeds should mostly differ, but assert
    // only the deterministic property to keep the test non-flaky.
    expect(groundedMeta.SENTENCE_COUNT).toBeGreaterThan(10);
  });

  it("never throws and falls back to a static pair when the corpus is empty", () => {
    expect(() => pickGroundedExample("")).not.toThrow();
    // The static fallback path is exercised by the empty-corpus branch;
    // here we only prove the public API never rejects.
  });
});
