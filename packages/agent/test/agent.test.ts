import { describe, expect, it } from "bun:test";

import {
  __subagentTest__,
  conversationCoachGrammarCheck,
  grammarExplainerLookupPattern,
  kanjiTutorDecompose,
  route,
  vocabSrsDueCards,
} from "@manobu/agent";

describe("conversationCoachGrammarCheck", () => {
  it("flags missing end punctuation", async () => {
    const out = await conversationCoachGrammarCheck("hello");
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("punctuation");
  });

  it("flags double spaces", async () => {
    const out = await conversationCoachGrammarCheck("hello  world.");
    expect(out.some((c) => c.reason.includes("Collapse"))).toBe(true);
  });

  it("returns empty when input is fine", async () => {
    expect(await conversationCoachGrammarCheck("hello.")).toEqual([]);
  });
});

describe("grammarExplainerLookupPattern", () => {
  it("matches by id", async () => {
    const out = await grammarExplainerLookupPattern("desu-polite-copula");
    expect(out?.id).toBe("desu-polite-copula");
    expect(out?.level).toBe("N5");
  });

  it("matches by meaning substring", async () => {
    const out = await grammarExplainerLookupPattern("polite copula");
    expect(out?.id).toBe("desu-polite-copula");
  });

  it("returns null on no match", async () => {
    expect(
      await grammarExplainerLookupPattern("xxxxxxxxx-no-such-thing")
    ).toBeNull();
  });
});

describe("kanjiTutorDecompose", () => {
  it("extracts the first CJK ideograph", async () => {
    const out = await kanjiTutorDecompose("What does 食 mean?");
    expect(out?.character).toBe("食");
    expect(out?.strokes).toBe(9);
    expect(out?.on).toContain("ショク");
  });

  it("returns null without CJK input", async () => {
    expect(await kanjiTutorDecompose("hello world")).toBeNull();
  });
});

describe("vocabSrsDueCards", () => {
  it("returns one card per vocab id with demo interval", async () => {
    const out = await vocabSrsDueCards([10, 11]);
    expect(out).toHaveLength(2);
    expect(out[0]?.vocabId).toBe(10);
    expect(out[0]?.intervalDays).toBeGreaterThan(0);
  });

  it("returns empty for empty input", async () => {
    expect(await vocabSrsDueCards([])).toEqual([]);
  });
});

describe("route (intent classifier)", () => {
  it("routes to kanji when input contains CJK", async () => {
    const out = await route({ learnerLevel: "N5", message: "Explain 食" });
    expect(out.agent).toBe("kanji");
  });

  it("routes to grammar when input mentions grammar terms", async () => {
    const out = await route({
      learnerLevel: "N5",
      message: "What is the polite copula?",
    });
    expect(out.agent).toBe("grammar");
  });

  it("routes to vocab when input mentions SRS", async () => {
    const out = await route({
      learnerLevel: "N5",
      message: "Show my due review cards",
      vocabIds: [1, 2],
    });
    expect(out.agent).toBe("vocab");
  });

  it("defaults to conversation", async () => {
    const out = await route({ learnerLevel: "N5", message: "Hi there" });
    expect(out.agent).toBe("conversation");
  });
});

describe("__subagentTest__ exports", () => {
  it("exposes the CJK regex", () => {
    expect(__subagentTest__.CJK_RE.test("食")).toBe(true);
    expect(__subagentTest__.CJK_RE.test("a")).toBe(false);
  });
});
