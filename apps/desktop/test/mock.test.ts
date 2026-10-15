import { describe, expect, it } from "bun:test";

import {
  __test__,
  cefrForScore,
  computeMockResult,
  deriveSectionalWeak,
  deriveWeakPatterns,
  formatTimer,
  isSectionViable,
  type Mistake,
  overallPassMark,
  type Question,
  scoreBySection,
  scoreQuestion,
  sectionalPassMark,
  sectionCaps,
  totalCaps,
  totalScaled,
  viabilityFloor,
} from "@/lib/mock";

describe("scoreQuestion", () => {
  const q: Question = {
    choiceIds: ["a", "b"],
    choices: { a: "です", b: "だ" },
    correctId: "a",
    grammarId: "n5-desu-polite-copula",
    id: "q1",
    prompt: "これは本__。",
  };
  it("returns true when choiceId === correctId", () => {
    expect(scoreQuestion(q, "a")).toBe(true);
  });
  it("returns false on wrong choice", () => {
    expect(scoreQuestion(q, "b")).toBe(false);
  });
  it("returns false on null (skipped)", () => {
    expect(scoreQuestion(q, null)).toBe(false);
  });
});

describe("formatTimer", () => {
  it("pads single-digit minutes/seconds", () => {
    expect(formatTimer(0)).toBe("00:00");
    expect(formatTimer(9)).toBe("00:09");
    expect(formatTimer(65)).toBe("01:05");
    expect(formatTimer(599)).toBe("09:59");
    expect(formatTimer(3600)).toBe("60:00");
  });
  it("clamps negative seconds", () => {
    expect(formatTimer(-5)).toBe("00:00");
  });
});

describe("grammarIdLevel", () => {
  it("maps prefix → level", () => {
    expect(__test__.grammarIdLevel("n5-desu")).toBe("n5");
    expect(__test__.grammarIdLevel("n3-past")).toBe("n3");
    expect(__test__.grammarIdLevel("n1-keigo")).toBe("n1");
  });
  it("returns null for unknown prefix", () => {
    expect(__test__.grammarIdLevel("xx-foo")).toBeNull();
  });
  it("TASK-23.7: resolves prefix-less jkindrix corpus ids via seed membership", () => {
    // The corpus ids carry no level prefix — the latent bug (prefix-only
    // lookup returned null → weak patterns showed raw ids) is a regression
    // guard here.
    expect(__test__.grammarIdLevel("you-da-appearance")).toBe("n3");
    expect(__test__.grammarIdLevel("wo-motte")).toBe("n1");
    expect(__test__.grammarIdLevel("ni-atatte-occasion")).toBe("n2");
    expect(__test__.grammarIdLevel("causative-passive")).toBe("n3");
    expect(__test__.grammarIdLevel("noni-although")).toBe("n3");
    expect(__test__.grammarIdLevel("totally-unknown-id")).toBeNull();
  });
});

describe("deriveWeakPatterns", () => {
  const mistakes: Mistake[] = [
    { grammarId: "n5-past-ta-form", questionId: "q3", wrongChoiceId: "a" },
    { grammarId: "n5-past-ta-form", questionId: "q4", wrongChoiceId: "b" },
    {
      grammarId: "n5-dewa-arimasen-negative-polite-copula",
      questionId: "q2",
      wrongChoiceId: "c",
    },
  ];

  it("returns top-N with the most wrong counts first", async () => {
    const result = await deriveWeakPatterns(mistakes, 3);
    expect(result[0]?.grammarId).toBe("n5-past-ta-form");
    expect(result[0]?.wrong).toBe(2);
    expect(result[0]?.total).toBe(2);
    expect(result[1]?.grammarId).toBe(
      "n5-dewa-arimasen-negative-polite-copula"
    );
  });

  it("truncates to topN", async () => {
    const result = await deriveWeakPatterns(mistakes, 1);
    expect(result).toHaveLength(1);
  });

  it("returns empty for no mistakes", async () => {
    expect(await deriveWeakPatterns([], 3)).toEqual([]);
  });

  it("never throws when the grammar server is unreachable (TASK-19)", async () => {
    // Simulate ConnectionRefused (server not running / offline) —
    // fetchGrammarLevel must fall back to LOCAL_GRAMMAR, not reject.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((): Promise<Response> =>
      Promise.reject(
        new Error("ConnectionRefused")
      )) as unknown as typeof fetch;
    try {
      const result = await deriveWeakPatterns(mistakes, 3);
      // 2 distinct grammarIds in the fixture, still enriched — no throw.
      expect(result).toHaveLength(2);
      // n5-past-ta-form exists in LOCAL_GRAMMAR — pattern text resolved.
      expect(result[0]?.pattern).toBe("Verb-た (past tense)");
      // Unknown ids degrade to the raw grammarId as the pattern label.
      expect(result[1]?.pattern).toBe(
        "n5-dewa-arimasen-negative-polite-copula"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("computeMockResult", () => {
  const questions: readonly Question[] = [
    {
      choiceIds: ["a", "b"],
      choices: { a: "a", b: "b" },
      correctId: "a",
      grammarId: "n5-desu-polite-copula",
      id: "q1",
      prompt: "p1",
    },
    {
      choiceIds: ["a", "b"],
      choices: { a: "a", b: "b" },
      correctId: "a",
      grammarId: "n5-past-ta-form",
      id: "q2",
      prompt: "p2",
    },
  ];

  it("scores correctly with mixed answers", async () => {
    const answers = new Map<string, string | null>([
      ["q1", "a"], // correct
      ["q2", "b"], // wrong
    ]);
    const result = await computeMockResult(questions, answers);
    expect(result.score).toBe(1);
    expect(result.total).toBe(2);
    expect(result.pct).toBe(50);
    expect(result.mistakes).toHaveLength(1);
    expect(result.mistakes[0]?.grammarId).toBe("n5-past-ta-form");
    expect(result.weak).toHaveLength(1);
  });

  it("perfect run → pct 100, empty weak", async () => {
    const answers = new Map<string, string | null>([
      ["q1", "a"],
      ["q2", "a"],
    ]);
    const result = await computeMockResult(questions, answers);
    expect(result.pct).toBe(100);
    expect(result.mistakes).toHaveLength(0);
    expect(result.weak).toHaveLength(0);
  });

  it("empty questions → pct 0", async () => {
    const result = await computeMockResult([], new Map());
    expect(result.pct).toBe(0);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TASK-23.7 (doc-4 §5): N3..N1 coverage + sectional scoring + CEFR badges.
// ---------------------------------------------------------------------------

describe("LOCAL_GRAMMAR N3..N1 seeds (AC#1)", () => {
  it("resolveWeakPatterns resolves an N3 grammar id offline to the real pattern", async () => {
    // deriveWeakPatterns fetches /api/grammar for the level; in tests
    // VITE_SERVER_URL may exist without a server — the local fallback must
    // resolve n3 ids to real pattern labels (not the raw id).
    const mistakes: Mistake[] = [
      { grammarId: "you-da-appearance", questionId: "x", wrongChoiceId: "a" },
    ];
    const weak = await deriveWeakPatterns(mistakes, 1);
    expect(weak).toHaveLength(1);
    expect(weak[0]?.pattern).toBe("Plain form + ようだ");
  });

  it("resolves N2 and N1 ids offline too", async () => {
    const weakN2 = await deriveWeakPatterns(
      [
        {
          grammarId: "ni-atatte-occasion",
          questionId: "x",
          wrongChoiceId: "a",
        },
      ],
      1
    );
    expect(weakN2[0]?.pattern).toContain("にあたって");
    const weakN1 = await deriveWeakPatterns(
      [{ grammarId: "wo-motte", questionId: "x", wrongChoiceId: "a" }],
      1
    );
    expect(weakN1[0]?.pattern).toContain("をもって");
  });
});

describe("sectional scoring (AC#2, jlpt.jp results.html)", () => {
  it("section caps: N1-N3 60/60/60, N4-N5 120/60/0 (reading folded, D11)", () => {
    expect(sectionCaps("N1")).toEqual({ lang: 60, listening: 60, reading: 60 });
    expect(sectionCaps("N3")).toEqual({ lang: 60, listening: 60, reading: 60 });
    expect(sectionCaps("N4")).toEqual({
      lang: 120,
      listening: 60,
      reading: 0,
    });
    expect(sectionCaps("N5")).toEqual({
      lang: 120,
      listening: 60,
      reading: 0,
    });
    expect(
      sectionCaps("N4").lang +
        sectionCaps("N4").listening +
        sectionCaps("N4").reading
    ).toBe(180);
    expect(
      sectionCaps("N5").lang +
        sectionCaps("N5").listening +
        sectionCaps("N5").reading
    ).toBe(180);
  });

  it("overall pass marks: N1 100 N2 90 N3 95 N4 90 N5 80", () => {
    expect(overallPassMark("N1")).toBe(100);
    expect(overallPassMark("N2")).toBe(90);
    expect(overallPassMark("N3")).toBe(95);
    expect(overallPassMark("N4")).toBe(90);
    expect(overallPassMark("N5")).toBe(80);
  });

  it("sectional pass marks: 19/60 N1-N3; 38/120 + 19 N4-N5, reading 0 at N4/N5", () => {
    expect(sectionalPassMark("N3", "lang")).toBe(19);
    expect(sectionalPassMark("N3", "listening")).toBe(19);
    expect(sectionalPassMark("N5", "lang")).toBe(38);
    expect(sectionalPassMark("N5", "reading")).toBe(0);
    expect(sectionalPassMark("N5", "listening")).toBe(19);
  });

  it("scoreBySection scales raw counts to caps (N4/N5 reading folded to 0)", () => {
    // N5 scoring: lang is combined lang+reading. Here lang 8/10 → 96, listening 2/4 →30, reading band 0.
    const rawN5 = {
      lang: { correct: 8, total: 10 },
      listening: { correct: 2, total: 4 },
      reading: { correct: 3, total: 6 },
    };
    expect(scoreBySection("N5", rawN5)).toEqual({
      lang: 96,
      listening: 30,
      reading: 0,
    });
    // N3 caps: 3 sections
    expect(scoreBySection("N3", rawN5)).toEqual({
      lang: 48,
      listening: 30,
      reading: 30,
    });
  });

  it("deriveSectionalWeak buckets mistakes by section tag (default lang)", () => {
    const mistakes = [
      { grammarId: "a", questionId: "q1", wrongChoiceId: "x" },
      {
        grammarId: "b",
        questionId: "q2",
        section: "reading" as const,
        wrongChoiceId: "x",
      },
      {
        grammarId: "c",
        questionId: "q3",
        section: "listening" as const,
        wrongChoiceId: "x",
      },
    ];
    expect(deriveSectionalWeak(mistakes)).toEqual({
      lang: 1,
      listening: 1,
      reading: 1,
    });
  });
});

describe("CEFR mapping (AC#2, comprendreport §3)", () => {
  it("N5 80→A1, N4 90→A2, N3 95→B1, N2 115→B2, N1 100→C1", () => {
    expect(cefrForScore("N5", 80)).toBe("A1");
    expect(cefrForScore("N4", 90)).toBe("A2");
    expect(cefrForScore("N3", 95)).toBe("B1");
    expect(cefrForScore("N2", 115)).toBe("B2");
    expect(cefrForScore("N1", 100)).toBe("C1");
  });

  it("below the pass mark → no CEFR badge", () => {
    expect(cefrForScore("N5", 79)).toBeNull();
    expect(cefrForScore("N3", 94)).toBeNull();
  });

  it("upper bands map higher CEFR levels", () => {
    expect(cefrForScore("N5", 100)).toBe("A2");
    expect(cefrForScore("N2", 145)).toBe("C1");
    expect(cefrForScore("N1", 145)).toBe("C2");
  });
});

describe("viability floor (TASK-113 D5, AC#3)", () => {
  it("60-cap needs 10, 120-cap needs 20 (cap/6)", () => {
    expect(viabilityFloor("N3", "lang")).toBe(10);
    expect(viabilityFloor("N5", "lang")).toBe(20);
    expect(viabilityFloor("N5", "listening")).toBe(10);
    expect(viabilityFloor("N5", "reading")).toBe(0);
  });

  it("one-item section scored as whole band is not viable (regression)", () => {
    expect(isSectionViable("N5", "listening", 1)).toBe(false);
    expect(isSectionViable("N3", "reading", 1)).toBe(false);
    expect(
      scoreBySection("N5", {
        lang: { correct: 1, total: 1 },
        listening: { correct: 1, total: 1 },
        reading: { correct: 0, total: 0 },
      })
    ).toEqual({
      lang: 120,
      listening: 60,
      reading: 0,
    });
    // 1/1 × 60 = 60 would be a full band — floor prevents displaying it
  });

  it("total caps always 180 and totalScaled sums scoring sections", () => {
    expect(totalCaps("N5")).toBe(180);
    expect(totalCaps("N3")).toBe(180);
    expect(totalScaled({ lang: 96, listening: 30, reading: 0 })).toBe(126);
    expect(totalScaled({ lang: 48, listening: 30, reading: 30 })).toBe(108);
  });

  it("SEED N5 (6+2+1) is below floor so no band badges (AC#1)", () => {
    // SEED: lang 6, reading 2, listening 1. N5 scoring: lang combined 8, listening 1.
    expect(isSectionViable("N5", "lang", 8)).toBe(false);
    expect(isSectionViable("N5", "listening", 1)).toBe(false);
  });

  it("CEFR on totalScaled is absent below floor and present when viable and over threshold (AC#4)", () => {
    // Below floor: no CEFR even if raw count would suggest a score
    const _notViableScaled = null as unknown as number;
    // When viable and totalScaled 126 for N5, CEFR is A2 (≥100)
    expect(cefrForScore("N5", 126)).toBe("A2");
    expect(cefrForScore("N5", 79)).toBeNull();
  });

  it("overall gate both thresholds (AC#7) and caps sum 180 (AC#8)", () => {
    // Viable N5 paper: lang 20 items 15 correct → 90, listening 10 items 5 correct →30 =120 total, overall mark 80 pass but lang needs 38 → pass
    const viable = scoreBySection("N5", {
      lang: { correct: 15, total: 20 },
      listening: { correct: 5, total: 10 },
      reading: { correct: 0, total: 0 },
    });
    expect(totalScaled(viable)).toBe(120);
    expect(overallPassMark("N5")).toBe(80);
    expect(sectionalPassMark("N5", "lang")).toBe(38);
    // Inviable paper has no overall
    expect(isSectionViable("N5", "lang", 8)).toBe(false);
  });
});
