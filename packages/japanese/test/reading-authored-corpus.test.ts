import { describe, expect, it } from "bun:test";
import {
  type AuthoredConfig,
  type AuthoredRow,
  authoredFileIssues,
  authoredRowIssues,
  isAuthoredConstruction,
  mixedConstructionIssue,
} from "../scripts/reading-authored-corpus";

/** A 中文-shaped passage: connected prose, ONE paragraph, 252 runes. The point of
 * this file is that the shared screens accept it for a block that writes one
 * paragraph and refuse it for a block that does not, so nothing about the row has
 * to change to move between the two. */
const SENTENCE = "歩道に樹を植えると、昼は日陰ができて、夜は照り返しが減る。";
const PASSAGE = SENTENCE.repeat(9);
const EVIDENCE = SENTENCE;

const row = (overrides: Partial<AuthoredRow> = {}): AuthoredRow => ({
  answerIndex: 1,
  construction: "authored",
  evidence: EVIDENCE,
  id: "n2t-1",
  level: "N2",
  options: [
    "歩く人が増える。",
    "夜の照り返しが減る。",
    "樹の値段が下がる。",
    "昼の温度が上がる。",
  ],
  passage: PASSAGE,
  stem: "歩道に樹を植えると、どんな効果が期待されると説明しているか。",
  ...overrides,
});

/** The 中文 / 短文 shape: a band of its own and no paragraph minimum. */
const singleParagraphConfig: AuthoredConfig = {
  bandFor: (level) => (level === "N2" ? { max: 1200, min: 200 } : undefined),
  evidence: { maxRatio: 0.5, minRunes: 20 },
  intentFor: (stem) => (stem.includes("説明している") ? "explanation" : null),
  minIntents: 4,
  minParagraphs: 0,
  optionCount: 4,
};

/** The 長文 shape the 内容理解（長文）gate passes: same screens, different numbers. */
const multiParagraphConfig: AuthoredConfig = {
  ...singleParagraphConfig,
  minParagraphs: 2,
};

describe("authoredRowIssues: the screens belong to no block", () => {
  it("accepts a one-paragraph row for a block that sets no paragraph minimum", () => {
    expect(
      authoredRowIssues(row(), "N2", singleParagraphConfig, new Set())
    ).toEqual([]);
  });

  it("refuses the same row for a block that demands a multi-paragraph passage", () => {
    expect(
      authoredRowIssues(row(), "N2", multiParagraphConfig, new Set())
    ).toContain("passage-single-paragraph");
  });

  it("measures the passage against the band the caller passes, not against a baked one", () => {
    const wide = {
      ...singleParagraphConfig,
      bandFor: () => ({ max: 1200, min: 300 }),
    };
    expect(authoredRowIssues(row(), "N2", wide, new Set())).toContain(
      "passage-too-short"
    );
    const narrow = {
      ...singleParagraphConfig,
      bandFor: () => ({ max: 200, min: 100 }),
    };
    expect(authoredRowIssues(row(), "N2", narrow, new Set())).toContain(
      "passage-too-long"
    );
  });

  it("refuses a level this block does not write at instead of borrowing another band", () => {
    expect(
      authoredRowIssues(row(), "N1", singleParagraphConfig, new Set())
    ).toEqual(["authored-band-unknown"]);
  });

  it("reads the evidence bounds and the ねらい table from the config", () => {
    const strictEvidence = {
      ...singleParagraphConfig,
      evidence: { maxRatio: 0.5, minRunes: 40 },
    };
    expect(authoredRowIssues(row(), "N2", strictEvidence, new Set())).toContain(
      "evidence-too-short"
    );
    const otherIntent = { ...singleParagraphConfig, intentFor: () => null };
    expect(authoredRowIssues(row(), "N2", otherIntent, new Set())).toContain(
      "stem-intent-unclassified"
    );
  });

  it("keeps the provenance and judge screens on every block", () => {
    expect(
      authoredRowIssues(
        row({ sourceIds: ["p-1"] }),
        "N2",
        singleParagraphConfig,
        new Set()
      )
    ).toContain("authored-row-carries-sourceIds");
    expect(
      authoredRowIssues(row(), "N2", singleParagraphConfig, new Set(["n2t-1"]))
    ).toContain("row-judge-rejected");
  });
});

describe("authoredFileIssues and the construction rules", () => {
  it("counts the ねらい floor from the caller's own number", () => {
    expect(
      authoredFileIssues(new Set(["a", "b"]), singleParagraphConfig)
    ).toEqual(["intents-below-floor:2<4"]);
    const deeper = { ...singleParagraphConfig, minIntents: 2 };
    expect(authoredFileIssues(new Set(["a", "b"]), deeper)).toEqual([]);
  });

  it("refuses a store carrying both constructions and accepts one carrying neither mix", () => {
    expect(
      mixedConstructionIssue([
        { construction: "authored" },
        { construction: "masked-slot" },
      ])
    ).toBe("mixed-constructions");
    expect(mixedConstructionIssue([{ construction: "authored" }])).toBeNull();
    expect(
      mixedConstructionIssue([{ construction: "masked-slot" }])
    ).toBeNull();
  });

  it("treats an untagged row as the stricter branch, never the authored one", () => {
    expect(isAuthoredConstruction(undefined)).toBeFalse();
    expect(isAuthoredConstruction("authored")).toBeTrue();
  });
});
