/**
 * `gen:reading-chuushou` is pinned on determinism and the readable-source
 * screens (length band, coverage floor, three distinct distractors, the claim
 * term printed by its own paragraph, no distractor printed by the source).
 * The claim+distractor authoring is a freeze-time step fed INTO this
 * generator as the claims file, and the semantic question (does the passage
 * really assert the claim) is what `check-reading-chuushou` re-proves after
 * the blind-judge pass.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { buildBatch, buildEntry } from "../scripts/gen-reading-chuushou";
import {
  CHUSHOU_SIGNER,
  CHUSHOU_STEM,
} from "../scripts/reading-chuushou-corpus";
import {
  buildVocabIndex,
  type VocabEntry,
  type VocabIndex,
} from "../scripts/reading-n4-corpus";

const VOCAB: readonly VocabEntry[] = [
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "あめ",
    senses: [["rain"]],
    word: "雨",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "かぜ",
    senses: [["wind"]],
    word: "風",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "ゆき",
    senses: [["snow"]],
    word: "雪",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "てがみ",
    senses: [["letter"]],
    word: "手紙",
  },
];

const INDEX: VocabIndex = buildVocabIndex(VOCAB);

/** Padded with kana so the passage clears the length floor without adding any
 * listable word to the corpus. */
const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。".repeat(
    6
  );

const paragraph = (id: string, text: string) => ({
  id,
  license: "PDL-1.0",
  pageId: "t",
  pageUrl: "https://example.test/",
  source: "credit",
  text,
  title: "t",
});

const dataDir = "/nonexistent";
/** `buildBatch` reads the index off disk itself, so its tests use the real
 * shipped vocabulary (the fixture passage is kana + listed nouns, so the real
 * index changes nothing about the outcome). */
const REAL_DATA = join(import.meta.dir, "..", "data");

describe("buildEntry: the readable-source screens", () => {
  it("refuses a passage below the length floor (a heading)", () => {
    expect(
      buildEntry(
        paragraph("p1", "雨が降っている。"),
        dataDir,
        "N2",
        "雨",
        ["風", "雪", "手紙"],
        INDEX
      )
    ).toBeNull();
  });

  it("refuses a passage over the cap", () => {
    const tooLong = "雨が降っている。".repeat(200);
    expect(
      buildEntry(
        paragraph("p2", tooLong),
        dataDir,
        "N2",
        "雨",
        ["風", "雪", "手紙"],
        INDEX
      )
    ).toBeNull();
  });

  it("refuses when the distractor pool is too small", () => {
    expect(
      buildEntry(
        paragraph("p3", `${FILLER}雨が降る。`),
        dataDir,
        "N2",
        "雨",
        ["風"],
        INDEX
      )
    ).toBeNull();
  });

  it("refuses a claim the source does not print", () => {
    // The authored claim must be anchored to a term the paragraph prints:
    // 雪 does not occur in this passage, so the pair cannot ship.
    expect(
      buildEntry(
        paragraph("p4", `${FILLER}雨が降る。`),
        dataDir,
        "N2",
        "雪",
        ["風", "雨", "手紙"],
        INDEX
      )
    ).toBeNull();
  });

  it("refuses a distractor the source prints", () => {
    // これは opens the FILLER, so it is readable off the page: a second
    // defensible answer, not a distractor.
    expect(
      buildEntry(
        paragraph("p5", `${FILLER}雨が降る。`),
        dataDir,
        "N2",
        "雨",
        ["これは", "雪", "手紙"],
        INDEX
      )
    ).toBeNull();
  });
});

describe("buildEntry: the authored-key row shape", () => {
  const text = `${FILLER}雨が降る。`;

  it("prints the passage whole and the stem is the fixed 主張理解 stem", () => {
    const entry = buildEntry(
      paragraph("p6", text),
      dataDir,
      "N2",
      "雨",
      ["風", "雪", "手紙"],
      INDEX
    );
    if (entry === null) {
      throw new Error("fixture must produce a row");
    }
    expect(entry.passage).toBe(text);
    expect(entry.passage).not.toContain("＿＿");
    expect(entry.stem).toBe(CHUSHOU_STEM);
    expect(entry.validatedBy).toBe(CHUSHOU_SIGNER);
    expect(entry.construction).toBe("authored-key");
    expect(entry.options).toHaveLength(4);
    expect(entry.options[entry.answerIndex]).toBe("雨");
    expect(entry.level).toBe("N2");
    expect(entry.sourceIds).toEqual(["p6"]);
    expect(entry.block).toBe("shuchou-rikai-choubun");
    expect(entry.validated).toBe(true);
  });
});

describe("buildBatch: one row per distinct claim", () => {
  const text = `${FILLER}雨が降る。`;

  it("is deterministic: the same corpus + claims yield byte-identical rows", () => {
    const corpus = [paragraph("p7", text)];
    const claims = [{ claim: "雨", distractors: ["風", "雪", "手紙"] }];
    expect(JSON.stringify(buildBatch(corpus, REAL_DATA, "N2", 1, claims))).toBe(
      JSON.stringify(buildBatch(corpus, REAL_DATA, "N2", 1, claims))
    );
  });

  it("keeps the batch to distinct claims", () => {
    const corpus = [paragraph("p8", text)];
    const claims = [
      { claim: "雨", distractors: ["風", "雪", "手紙"] },
      { claim: "雨", distractors: ["風", "雪", "手紙"] },
    ];
    const batch = buildBatch(corpus, REAL_DATA, "N2", 2, claims);
    expect(batch).toHaveLength(1);
  });

  it("spends each paragraph once, so one text cannot back two 小問", () => {
    const corpus = [paragraph("p9", text)];
    const claims = [
      { claim: "雨", distractors: ["風", "雪", "手紙"] },
      { claim: "これは", distractors: ["風", "雪", "手紙"] },
    ];
    const batch = buildBatch(corpus, REAL_DATA, "N2", 2, claims);
    expect(batch).toHaveLength(1);
  });
});
