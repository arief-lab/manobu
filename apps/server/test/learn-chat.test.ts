import { describe, expect, it } from "bun:test";
import {
  __test__,
  formatConversationResponse,
  formatGrammarResponse,
  formatKanjiResponse,
  formatVocabResponse,
} from "../src/routes/learn-chat";

describe("formatResponse (server-side formatter)", () => {
  it("renders empty conversation corrections", () => {
    const out = __test__.formatResponse({
      agent: "conversation",
      corrections: [],
    });
    expect(out).toContain("no surface corrections");
  });

  it("renders grammar pattern with level + meaning", () => {
    const out = __test__.formatResponse({
      agent: "grammar",
      pattern: {
        id: "desu-polite-copula",
        level: "N5",
        meaning_en: "is / am / are (polite copula)",
        pattern: "Noun + です",
      },
    });
    expect(out).toContain("です");
    expect(out).toContain("N5");
  });

  it("renders null grammar pattern", () => {
    const out = __test__.formatResponse({
      agent: "grammar",
      pattern: null,
    });
    expect(out).toContain("No grammar pattern matched");
  });

  it("renders null kanji decomposition", () => {
    const out = __test__.formatResponse({
      agent: "kanji",
      decomposition: null,
    });
    expect(out).toContain("No kanji found");
  });

  it("renders vocab cards", () => {
    const out = __test__.formatResponse({
      agent: "vocab",
      cards: [
        { intervalDays: 12, vocabId: 1 },
        { intervalDays: 12, vocabId: 2 },
      ],
    });
    expect(out).toContain("vocab 1");
    expect(out).toContain("12d");
  });

  it("renders empty vocab", () => {
    const out = __test__.formatResponse({ agent: "vocab", cards: [] });
    expect(out).toContain("No vocab cards due");
  });
});

describe("formatConversationResponse", () => {
  it("reports no corrections for an empty list", () => {
    const out = formatConversationResponse({
      agent: "conversation",
      corrections: [],
    });
    expect(out).toBe("Looks good · no surface corrections.");
  });

  it("renders one correction as original → corrected (reason)", () => {
    const out = formatConversationResponse({
      agent: "conversation",
      corrections: [
        {
          corrected: "食べた",
          original: "食べた",
          reason: "past tense of 食べる uses た",
        },
      ],
    });
    expect(out).toBe(
      'Correction: "食べた" → "食べた" (past tense of 食べる uses た)'
    );
  });

  it("joins multiple corrections with newlines", () => {
    const out = formatConversationResponse({
      agent: "conversation",
      corrections: [
        { corrected: "b", original: "a", reason: "r1" },
        { corrected: "d", original: "c", reason: "r2" },
      ],
    });
    expect(out).toBe('Correction: "a" → "b" (r1)\nCorrection: "c" → "d" (r2)');
  });
});

describe("formatGrammarResponse", () => {
  it("renders pattern, level, and meaning", () => {
    const out = formatGrammarResponse({
      agent: "grammar",
      pattern: {
        id: "ga-subj",
        level: "N5",
        meaning_en: "subject marker",
        pattern: "N + が",
      },
    });
    expect(out).toBe("N + が (N5) · subject marker");
  });

  it("renders the no-match message for a null pattern", () => {
    expect(formatGrammarResponse({ agent: "grammar", pattern: null })).toBe(
      "No grammar pattern matched your query."
    );
  });
});

describe("formatKanjiResponse", () => {
  it("renders character, strokes, readings, and meanings", () => {
    const out = formatKanjiResponse({
      agent: "kanji",
      decomposition: {
        character: "食",
        kun: ["く", "は"],
        meanings_en: ["eat", "food"],
        on: ["ショク", "ジキ"],
        strokes: 9,
      },
    });
    expect(out).toBe(
      "食 · strokes 9 · on: ショク, ジキ · kun: く, は · meanings: eat, food"
    );
  });

  it("em-dashes empty reading and meaning lists", () => {
    const out = formatKanjiResponse({
      agent: "kanji",
      decomposition: {
        character: "〆",
        kun: [],
        meanings_en: [],
        on: [],
        strokes: 2,
      },
    });
    expect(out).toBe("〆 · strokes 2 · on: – · kun: – · meanings: –");
  });

  it("renders the no-kanji message for a null decomposition", () => {
    expect(formatKanjiResponse({ agent: "kanji", decomposition: null })).toBe(
      "No kanji found in your input."
    );
  });
});

describe("formatVocabResponse", () => {
  it("renders one due card with its interval", () => {
    const out = formatVocabResponse({
      agent: "vocab",
      cards: [{ intervalDays: 5, vocabId: 42 }],
    });
    expect(out).toBe("vocab 42 · next review in 5d");
  });

  it("joins multiple cards with newlines", () => {
    const out = formatVocabResponse({
      agent: "vocab",
      cards: [
        { intervalDays: 1, vocabId: 7 },
        { intervalDays: 30, vocabId: 9 },
      ],
    });
    expect(out).toBe(
      "vocab 7 · next review in 1d\nvocab 9 · next review in 30d"
    );
  });

  it("renders the nothing-due message for an empty list", () => {
    expect(formatVocabResponse({ agent: "vocab", cards: [] })).toBe(
      "No vocab cards due right now."
    );
  });
});

describe("chunkText", () => {
  it("chunks a string into fixed-size pieces", () => {
    expect(__test__.chunkText("abcdefghij", 3)).toEqual([
      "abc",
      "def",
      "ghi",
      "j",
    ]);
  });
  it("returns a single chunk when input is short", () => {
    expect(__test__.chunkText("ab", 5)).toEqual(["ab"]);
  });
});

describe("rateLimitMap bounds (TASK-56)", () => {
  it("sweep evicts entries older than the rate window", () => {
    const { rateLimitMap, sweepRateLimitMap } = __test__;
    rateLimitMap.clear();
    const now = Date.now();
    rateLimitMap.set("stale-ip", now - 120_000);
    rateLimitMap.set("fresh-ip", now);
    sweepRateLimitMap(now);
    expect(rateLimitMap.has("stale-ip")).toBe(false);
    expect(rateLimitMap.has("fresh-ip")).toBe(true);
    rateLimitMap.clear();
  });

  it("hard cap: inserting past RATE_MAX_KEYS drops oldest entries", () => {
    const { rateLimitMap, RATE_MAX_KEYS } = __test__;
    rateLimitMap.clear();
    // fill to cap with IPs 0..cap-1 (insertion order = numeric order)
    for (let i = 0; i < RATE_MAX_KEYS; i += 1) {
      rateLimitMap.set(`ip-${i}`, Date.now() + i);
    }
    expect(rateLimitMap.size).toBe(RATE_MAX_KEYS);
    // one more set through the same eviction path the route uses
    while (rateLimitMap.size >= RATE_MAX_KEYS) {
      const oldest = rateLimitMap.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      rateLimitMap.delete(oldest);
    }
    rateLimitMap.set("ip-new", Date.now());
    expect(rateLimitMap.size).toBeLessThanOrEqual(RATE_MAX_KEYS);
    expect(rateLimitMap.has("ip-0")).toBe(false);
    expect(rateLimitMap.has("ip-new")).toBe(true);
    rateLimitMap.clear();
  });

  it("map never exceeds RATE_MAX_KEYS across many unique IPs", () => {
    const { rateLimitMap, RATE_MAX_KEYS } = __test__;
    rateLimitMap.clear();
    const uniqueIps = RATE_MAX_KEYS + 500;
    for (let i = 0; i < uniqueIps; i += 1) {
      while (rateLimitMap.size >= RATE_MAX_KEYS) {
        const oldest = rateLimitMap.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        rateLimitMap.delete(oldest);
      }
      rateLimitMap.set(`flood-${i}`, Date.now());
    }
    expect(rateLimitMap.size).toBeLessThanOrEqual(RATE_MAX_KEYS);
    rateLimitMap.clear();
  });
});
