/**
 * `gen:reading-chuubun` is pinned on the properties the batch's trust rests on:
 * the lossy segmenter's refusals (kana-only surfaces, reading fragments, a
 * passage below the length floor), determinism, and one row per answer word.
 * Each test corresponds to a defect that shipped or nearly shipped: the こうし
 * key read out of こうした, the また kana answer, and a 21-rune heading printed
 * as a reading passage.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  buildBatch,
  buildEntry,
  buildStitchedEntry,
} from "../scripts/gen-reading-chuubun";
import {
  CHUUBUN_SIGNER,
  CHUUBUN_STEM,
  PASSAGE_BAND,
  stitchDocument,
  stitchedTopicOf,
} from "../scripts/reading-chuubun-corpus";
import {
  buildVocabIndex,
  type SourceSentence,
  type VocabEntry,
  type VocabIndex,
} from "../scripts/reading-n4-corpus";
import {
  stitchKey,
  stitchSentences,
  stitchTail,
} from "./reading-stitch-fixture";

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
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "どうぐ",
    senses: [["tool"]],
    word: "道具",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "でんしゃ",
    senses: [["train"]],
    word: "電車",
  },
  {
    level: "N5",
    partOfSpeech: "verb, intransitive verb",
    reading: "ふる",
    senses: [["fall"]],
    word: "降る",
  },
  { level: "N5", partOfSpeech: "particle", reading: "は", word: "は" },
  // A kana "noun" whose reading collides with a longer printed word: こうし is
  // 講師's reading, and the lossy segmenter read it out of こうした.
  {
    level: "N4",
    partOfSpeech: "noun",
    reading: "こうし",
    senses: [["lecturer"]],
    word: "講師",
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
 * shipped vocabulary (the fixture paragraph is kana + a listed noun, so the
 * real index changes nothing about the outcome). */
const REAL_DATA = join(import.meta.dir, "..", "data");

describe("slotsFor: the surface screen", () => {
  it("refuses a kana-only surface (the また answer)", () => {
    // また matched a kana word and blanked a connective. buildEntry only ever
    // reaches slots through slotsFor, so asserting on buildEntry's output is
    // asserting the screen.
    const entry = buildEntry(
      paragraph("p1", `また${FILLER}電車が降る。`),
      dataDir,
      "N2",
      INDEX,
      new Map()
    );
    // 電車 is the only maskable kanji noun in the passage, so a row (if any)
    // must key on it, never on また.
    expect(entry?.options[entry.answerIndex]).not.toBe("また");
  });

  it("refuses a reading fragment (こうし out of こうした)", () => {
    // こうし is 講師's reading, printed inside こうした. Requiring the listed
    // kanji form is what removes it.
    const entry = buildEntry(
      paragraph("p2", `こうした${FILLER}`),
      dataDir,
      "N2",
      INDEX,
      new Map()
    );
    expect(entry).toBeNull();
  });

  it("refuses a passage below the length floor (a heading)", () => {
    expect(
      buildEntry(
        paragraph("p3", "雨が降っている。"),
        dataDir,
        "N2",
        INDEX,
        new Map()
      )
    ).toBeNull();
  });

  it("skips a slot the fixed stem itself prints (the 一つ stem-leak)", () => {
    // The 中文 stem ends …を一つ選びなさい, so keying a 一つ slot prints the
    // answer inside the question; item-engine refuses such a row as
    // structural:stem-leak (the first 令和7年版 regeneration shipped exactly
    // this, from paragraph r07-1-1-4-17), so buildEntry must skip the slot and
    // fall through to the next noun. Its own index, so the shared fixture's
    // distractor draws are untouched.
    expect(CHUUBUN_STEM.includes("一つ")).toBe(true);
    const stemIndex = buildVocabIndex([
      ...VOCAB,
      {
        level: "N5",
        partOfSpeech: "noun",
        reading: "ひとつ",
        senses: [["one"]],
        word: "一つ",
      },
    ]);
    // 手紙 prints twice, so slotsFor drops it; 一つ is then the ONLY slot in
    // the paragraph — without the stem-leak skip this fixture emits a 一つ
    // row (the fixture index is passed directly, so the distractor pool is
    // the fixture's other nouns) and the expectation below fails.
    const entry = buildEntry(
      paragraph("p3b", `手紙は一つ。${FILLER}手紙だ。`),
      dataDir,
      "N2",
      stemIndex,
      new Map()
    );
    expect(entry).toBeNull();
  });
});

describe("buildEntry: the masked-slot construction", () => {
  // The verb is printed in its LISTED form (降る), so the frame window around
  // 電車 (`_|が|降る`) carries a content word and the solvability clause passes.
  const text = `${FILLER}電車が降る。`;

  it("blanks the kanji noun and signs the batch as generated", () => {
    const entry = buildEntry(
      paragraph("p4", text),
      dataDir,
      "N2",
      INDEX,
      new Map()
    );
    if (entry === null) {
      throw new Error("fixture must produce a row");
    }
    expect(entry.options[entry.answerIndex]).toBe("電車");
    expect(entry.passage).toContain("＿＿");
    expect(entry.passage).not.toContain("電車");
    expect(entry.validatedBy).toBe(CHUUBUN_SIGNER);
    expect(entry.stem).toBe(CHUUBUN_STEM);
    expect(entry.options).toHaveLength(4);
    expect(entry.level).toBe("N2");
    expect(entry.sourceIds).toEqual(["p4"]);
  });

  it("is deterministic: the same corpus yields byte-identical rows", () => {
    const corpus = [paragraph("p5", text)];
    expect(JSON.stringify(buildBatch(corpus, REAL_DATA, "N2", 1))).toBe(
      JSON.stringify(buildBatch(corpus, REAL_DATA, "N2", 1))
    );
  });
});

describe("buildBatch: one row per answer word", () => {
  it("keeps the batch to distinct answers", () => {
    const batch = buildBatch(
      [
        paragraph("p6", `${FILLER}電車が降る。`),
        paragraph("p7", `${FILLER}電車が行く。`),
      ],
      REAL_DATA,
      "N2",
      2
    );
    const answers = batch.map((entry) => entry.options[entry.answerIndex]);
    expect(new Set(answers).size).toBe(answers.length);
  });
});

/* ---------------------------------------------------------------------------
 * The SECOND 中文 construction (TASK-173.9.15, N4 大問5). The 白書 yields
 * nothing readable at N4, so the document is stitched from licensed in-level
 * sentences around one shared noun, and one of its OTHER nouns is the key. The
 * sentences themselves live in ./reading-stitch-fixture so the CI gate re-proves
 * the same document the generator built (see `check-reading-chuubun.test.ts`).
 * ------------------------------------------------------------------------- */

describe("stitchDocument: the assembled band", () => {
  it("gathers the topic's sentences into one 400-600 rune document", () => {
    const document = stitchDocument("手紙", stitchSentences());
    if (document === null) {
      throw new Error("fixture must fill the band");
    }
    const runes = [...document.text].length;
    const band = PASSAGE_BAND["stitched-in-level"];
    expect(runes).toBeGreaterThanOrEqual(band.min);
    expect(runes).toBeLessThanOrEqual(band.max);
    // The citation is per SENTENCE, which is what the gate restores against.
    expect(document.ids.length).toBeGreaterThan(1);
    expect(document.ids[0]).toBe("s0");
  });

  it("refuses a stitch whose closing sentence overshoots, never truncates one", () => {
    // A cut sentence is prose the corpus does not contain, and an authored
    // sentence is the one thing this construction may not print, so the whole
    // document is refused instead of trimmed to fit.
    const sentences = stitchSentences().slice(0, 20);
    sentences.push(
      stitchTail(
        `を${"ずいぶんながいぶんしょうをよみました。".repeat(20)}`,
        "s99"
      )
    );
    expect(stitchDocument("手紙", sentences)).toBeNull();
  });

  it("prints the shared noun in every sentence it cites", () => {
    const document = stitchDocument("手紙", stitchSentences());
    if (document === null) {
      throw new Error("fixture must fill the band");
    }
    expect(stitchedTopicOf(document.text, INDEX, 2)).toBe("手紙");
  });

  it("finds no topic in a stitch that shares nothing", () => {
    // The coherence screen is a measurement, not a comment: an arbitrary list of
    // unrelated sentences has no noun every sentence prints, so no row can claim
    // it is one document.
    expect(
      stitchedTopicOf("雨が降った。風が強い。雪が積もった。", INDEX, 2)
    ).toBeNull();
  });
});

describe("buildStitchedEntry: the stitched-in-level row", () => {
  it("blanks the key noun, cites every sentence and signs the pipeline", () => {
    const sentences = stitchSentences();
    stitchKey(sentences);
    const entry = buildStitchedEntry("手紙", sentences, "N4", INDEX);
    if (entry === null) {
      throw new Error("fixture must produce a row");
    }
    expect(entry.construction).toBe("stitched-in-level");
    expect(entry.provenance).toBe("composed");
    expect(entry.validatedBy).toBe(CHUUBUN_SIGNER);
    expect(entry.stem).toBe(CHUUBUN_STEM);
    expect(entry.level).toBe("N4");
    expect(entry.options).toHaveLength(4);
    expect(entry.options[entry.answerIndex]).toBe("電車");
    expect(entry.passage).toContain("＿＿");
    expect(entry.passage).not.toContain("電車");
    expect(entry.sourceIds).toContain("s4");
    // A stitched row is licensed per sentence, so it carries no 白書 credit line.
    expect(entry.sourceCredit).toBeUndefined();
    const band = PASSAGE_BAND["stitched-in-level"];
    const runes = [...entry.passage].length;
    expect(runes).toBeGreaterThanOrEqual(band.min);
    expect(runes).toBeLessThanOrEqual(band.max);
  });

  it("is deterministic: the same sentences yield byte-identical rows", () => {
    const sentences = stitchSentences();
    stitchKey(sentences);
    expect(
      JSON.stringify(buildStitchedEntry("手紙", sentences, "N4", INDEX))
    ).toBe(JSON.stringify(buildStitchedEntry("手紙", sentences, "N4", INDEX)));
  });

  it("refuses a document whose coverage falls under the N4 floor", () => {
    // A real 400-rune stitch could smuggle this in: the topic noun is printed
    // everywhere, the band is full, and none of the rest is on the list. The
    // floor is what refuses it, before any slot is tried.
    const noisy: SourceSentence[] = Array.from({ length: 25 }, (_, index) => ({
      en: "",
      id: `n${String(index)}`,
      jp: "手紙を漢字漢字漢字漢字漢字漢字漢字漢字。",
      linkedWords: [],
    }));
    if (stitchDocument("手紙", noisy) === null) {
      throw new Error("fixture must fill the band to test the floor");
    }
    expect(buildStitchedEntry("手紙", noisy, "N4", INDEX)).toBeNull();
  });
});
