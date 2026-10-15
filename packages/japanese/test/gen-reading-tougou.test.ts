/**
 * `gen:reading-tougou` is pinned on the two-document screens: the pair band, the
 * different-page rule, the pair-specific key, the one-sided distractors, the
 * cross-document paraphrase exclusion, the once-per-paragraph spend and
 * byte-identical determinism. The fixtures go through the real screens
 * (`prepareTougouCorpus` and `admissiblePairs`) with an injected vocabulary
 * index, so a test row is produced exactly the way the shipped store is produced.
 */

import { describe, expect, it } from "bun:test";
import {
  admissiblePairs,
  buildBatch,
  buildEntry,
  type SelectedPair,
} from "../scripts/gen-reading-tougou";
import {
  buildVocabIndex,
  type VocabEntry,
  type VocabIndex,
} from "../scripts/reading-n4-corpus";
import {
  nounIndex,
  oneSidedNouns,
  prepareTougouCorpus,
  TOUGOU_BLOCK,
  TOUGOU_CONSTRUCTION,
  TOUGOU_SIGNER,
  TOUGOU_STEM,
  type TougouDocument,
} from "../scripts/reading-tougou-corpus";

/** Every option has to be a two-rune all-kanji noun, so a 1-rune word like 雨
 * cannot be a key or a distractor here the way it can in an authored-key store. */
const VOCAB: readonly VocabEntry[] = [
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
    reading: "でんわ",
    senses: [["telephone"]],
    word: "電話",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "ひよう",
    senses: [["cost"]],
    word: "費用",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "せいど",
    senses: [["system"]],
    word: "制度",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "かんきょう",
    senses: [["environment"]],
    word: "環境",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "こうこう",
    senses: [["senior high school"]],
    word: "高校",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "こうとうがっこう",
    senses: [["senior high school"]],
    word: "高等学校",
  },
  {
    level: "N5",
    partOfSpeech: "noun, adverb",
    reading: "あした",
    senses: [["tomorrow"]],
    word: "明日",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "むかえ",
    senses: [["meeting", "greeting"]],
    word: "迎え",
  },
  // 原価 and 費用 carry the same dominant English sense under different kanji.
  // That is the pair of surfaces no rune-level screen can tell apart, and the
  // reason `oneSidedNouns` reads the vocabulary rather than only the text.
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "げんか",
    senses: [["cost"]],
    word: "原価",
  },
];

const INDEX: VocabIndex = buildVocabIndex(VOCAB);

/** Kana filler: it clears the length and coverage floors without adding any
 * listable noun to the document. */
const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。".repeat(
    4
  );

/** 手紙 is the topic BOTH print; 環境 is printed by both too, so it must never
 * become a distractor; 電話 is only the first document's, 費用 and 制度 only the
 * second's. */
const TEXT_A = `${FILLER}手紙を書く。電話をかける。環境が良くなる。`;
const TEXT_B = `${FILLER}手紙が届く。費用がかかる。制度が変わる。環境が良くなる。`;

const doc = (id: string, pageId: string, text: string) => ({
  id,
  license: "PDL-1.0",
  pageId,
  pageUrl: `https://example.test/${pageId}`,
  source: `credit ${pageId}`,
  text,
  title: pageId,
});

const clearing = (
  paragraphs: readonly ReturnType<typeof doc>[]
): readonly TougouDocument[] => prepareTougouCorpus(paragraphs, INDEX, "N2");

const pairOf = (
  paragraphs: readonly ReturnType<typeof doc>[]
): readonly SelectedPair[] => {
  const docs = clearing(paragraphs);
  return admissiblePairs(docs, nounIndex(docs));
};

const basePair = (
  paragraphs?: readonly ReturnType<typeof doc>[]
): SelectedPair => {
  const found = pairOf(
    paragraphs ?? [doc("a", "pa", TEXT_A), doc("b", "pb", TEXT_B)]
  );
  const [pair] = found;
  if (pair === undefined) {
    throw new Error("fixture must produce a pair");
  }
  return pair;
};

describe("admissiblePairs: the two-document screens", () => {
  it("pairs the two documents on the topic both of them print", () => {
    const found = pairOf([doc("a", "pa", TEXT_A), doc("b", "pb", TEXT_B)]);
    expect(found).toHaveLength(1);
    expect(basePair().key).toBe("手紙");
    expect(basePair().distractors).toEqual(["電話", "費用", "制度"]);
  });

  it("refuses two paragraphs from the same page (they are one text, not two)", () => {
    expect(
      pairOf([doc("a", "same", TEXT_A), doc("b", "same", TEXT_B)])
    ).toEqual([]);
  });

  it("refuses a pair whose total is over the 合計600字程度 band", () => {
    // Each document is still inside 200–1200, so only the PAIR is too long: the
    // 中文 band alone would let a 主張理解-length pair through.
    const long = FILLER.repeat(7);
    expect(
      pairOf([
        doc("a", "pa", `${long}手紙を書く。電話をかける。`),
        doc("b", "pb", `${long}手紙が届く。費用がかかる。制度が変わる。`),
      ])
    ).toEqual([]);
  });

  it("walks off a topic a third document also prints, to one that is still specific", () => {
    // 手紙 belongs to the corpus rather than to this pair, so the key moves to
    // 環境, which only these two print. The third document must itself clear the
    // document band to count as a clearing document.
    const found = pairOf([
      doc("a", "pa", TEXT_A),
      doc("b", "pb", TEXT_B),
      doc("c", "pc", `${FILLER}手紙の話。`),
    ]);
    const moved = found.find((pair) => pair.key === "環境");
    expect(moved).toBeDefined();
    expect(moved?.distractors).toEqual(["電話", "費用", "制度"]);
  });

  it("refuses a pair without three one-sided nouns", () => {
    // Only 電話 on one side and 費用 on the other: two distractors is not a 小問.
    expect(
      pairOf([
        doc("a", "pa", `${FILLER}手紙を書く。電話をかける。`),
        doc("b", "pb", `${FILLER}手紙が届く。費用がかかる。`),
      ])
    ).toEqual([]);
  });

  it("never offers a noun both documents print as a distractor", () => {
    const pair = basePair();
    expect(
      oneSidedNouns({ a: pair.a, b: pair.b, key: pair.key }, 4)
    ).not.toContain("環境");
  });

  it("keeps a nominalized verb stem and a temporal noun out of the options", () => {
    // 迎え is a masu-stem and 明日 doubles as an adverb: neither names a topic,
    // so a pair whose ONLY shared noun is one of them has no key at all
    // (TASK-173.9.3). Rarity is not topicality: pair-specificity alone would
    // have kept both, because the corpus hardly leans on them.
    expect(
      pairOf([
        doc(
          "a",
          "pa",
          `${FILLER}迎えが来る。電話をかける。費用がかかる。制度が変わる。`
        ),
        doc("b", "pb", `${FILLER}迎えが来る。手紙を書く。環境が良くなる。`),
      ])
    ).toEqual([]);
    expect(
      pairOf([
        doc("a", "pa", `${FILLER}明日になる。電話をかける。費用がかかる。`),
        doc(
          "b",
          "pb",
          `${FILLER}明日になる。手紙を書く。環境が良くなる。制度が変わる。`
        ),
      ])
    ).toEqual([]);
  });

  it("does not print two distractors that name the same thing", () => {
    // 高校 and 高等学校 are one option written twice, and BOTH are printed by the
    // first document, so this is the within-list dedupe rather than the
    // cross-document paraphrase screen below: a distractor is screened against
    // the distractors already chosen, not only against the key.
    const pair = basePair([
      doc("a", "pa", `${FILLER}手紙を書く。高校に行く。高等学校が増える。`),
      doc("b", "pb", `${FILLER}手紙が届く。費用がかかる。環境が良くなる。`),
    ]);
    expect(pair.distractors).toEqual(["高校", "費用", "環境"]);
    expect(pair.distractors).not.toContain("高等学校");
  });

  it("drops a distractor the other document paraphrases", () => {
    // 費用 is printed by the second document only, so it clears every surface
    // screen, but the first prints 原価 and the vocabulary gives both the
    // dominant English sense "cost". A learner who says cost appears twice is not
    // wrong, and a distractor a reader can defend from both texts is a second
    // key. The pair still carries a 小問 on 電話, 制度 and 環境 (TASK-173.9.3).
    const pair = basePair([
      doc("a", "pa", `${FILLER}手紙を書く。電話をかける。原価が下がる。`),
      doc("b", "pb", TEXT_B),
    ]);
    expect(pair.key).toBe("手紙");
    expect(pair.distractors).toEqual(["電話", "制度", "環境"]);
    expect(pair.distractors).not.toContain("費用");
  });
});

describe("buildEntry: the frozen 統合理解 row", () => {
  it("prints both documents whole, in order, under the fixed stem", () => {
    const entry = buildEntry("N2", basePair());
    if (entry === null) {
      throw new Error("fixture must produce a row");
    }
    expect(entry.passages).toEqual([TEXT_A, TEXT_B]);
    expect(entry.sourceIds).toEqual(["a", "b"]);
    expect(entry.sourceUrls).toEqual([
      "https://example.test/pa",
      "https://example.test/pb",
    ]);
    expect(entry.sourceCredits).toEqual(["credit pa", "credit pb"]);
    expect(entry.stem).toBe(TOUGOU_STEM);
    expect(entry.block).toBe(TOUGOU_BLOCK);
    expect(entry.construction).toBe(TOUGOU_CONSTRUCTION);
    expect(entry.level).toBe("N2");
    expect(entry.provenance).toBe("composed");
    expect(entry.validated).toBe(true);
    expect(entry.validatedBy).toBe(TOUGOU_SIGNER);
    expect(entry.id).toBe("n2t-a+b");
  });

  it("draws four options with the shared topic at the drawn index", () => {
    const entry = buildEntry("N2", basePair());
    if (entry === null) {
      throw new Error("fixture must produce a row");
    }
    expect(entry.options).toHaveLength(4);
    expect(entry.options[entry.answerIndex]).toBe("手紙");
    expect(new Set(entry.options).size).toBe(4);
  });

  it("keeps every distractor on one side of the pair", () => {
    const entry = buildEntry("N2", basePair());
    if (entry === null) {
      throw new Error("fixture must produce a row");
    }
    for (const [at, option] of entry.options.entries()) {
      if (option === undefined || at === entry.answerIndex) {
        continue;
      }
      const inFirst = TEXT_A.includes(option);
      const inSecond = TEXT_B.includes(option);
      expect(inFirst === inSecond).toBe(false);
    }
  });

  it("refuses a handed-in pair whose option the other document paraphrases", () => {
    // `admissiblePairs` screens this on the walk, so a colliding row only exists
    // if something bypassed the walk. `buildEntry` re-runs the screen on the
    // options it was actually given, which is what keeps a hand-built or
    // future-refactored caller from shipping the ambiguity.
    const docs = clearing([
      doc("a", "pa", `${FILLER}手紙を書く。電話をかける。原価が下がる。`),
      doc("b", "pb", TEXT_B),
    ]);
    const [first, second] = docs;
    if (first === undefined || second === undefined) {
      throw new Error("fixture must clear the corpus screens");
    }
    expect(
      buildEntry("N2", {
        a: first,
        b: second,
        distractors: ["電話", "費用", "制度"],
        key: "手紙",
      })
    ).toBeNull();
    // The same pair builds the moment the collision goes out of the option list.
    expect(
      buildEntry("N2", {
        a: first,
        b: second,
        distractors: ["電話", "制度", "環境"],
        key: "手紙",
      })
    ).not.toBeNull();
  });

  it("is deterministic: the same corpus yields byte-identical rows", () => {
    expect(JSON.stringify(buildEntry("N2", basePair()))).toBe(
      JSON.stringify(buildEntry("N2", basePair()))
    );
  });
});

describe("buildBatch: spend and depth", () => {
  it("spends each paragraph once, so one text cannot back two 小問", () => {
    // c shares 電話 with a and 費用 with b, so all three pairs screen, and every
    // one of them needs a paragraph the first row already spent.
    const paragraphs = [
      doc("a", "pa", TEXT_A),
      doc("b", "pb", TEXT_B),
      doc("c", "pc", `${FILLER}電話をかける。費用がかかる。`),
    ];
    expect(pairOf(paragraphs)).toHaveLength(3);
    const batch = buildBatch(paragraphs, "/nonexistent", "N2", 2, INDEX);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.sourceIds).toEqual(["a", "b"]);
  });

  it("returns nothing when the corpus is smaller than a pair", () => {
    const single = [doc("a", "pa", TEXT_A)];
    expect(clearing(single)).toHaveLength(1);
    expect(buildBatch(single, "/nonexistent", "N2", 2, INDEX)).toEqual([]);
  });
});
