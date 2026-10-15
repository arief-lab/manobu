/**
 * `gen:reading-n4` is pinned on the properties the batch's trust rests on:
 * determinism (same corpus + same vocabulary produces byte-identical output),
 * the noun-only slot screen, and the refusals. Each test below corresponds to
 * a defect that shipped or nearly shipped: the shared distractor head, the
 * particle は answering as 葉, the affix ちゃん, and the answer index always
 * being 0.
 */

import { describe, expect, it } from "bun:test";
import { buildBatch, buildEntry } from "../scripts/gen-reading-n4";
import {
  buildVocabIndex,
  GENERATOR_SIGNER,
  READING_STEM,
  type SourceSentence,
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
    reading: "どうぐ",
    senses: [["tool", "implement"]],
    word: "道具",
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
    reading: "でんしゃ",
    senses: [["train", "electric train"]],
    word: "電車",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "ほん",
    senses: [["book"]],
    word: "本",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "まねき",
    senses: [["summons", "call"]],
    word: "招集",
  },
  {
    level: "N5",
    partOfSpeech: "verb, intransitive verb",
    reading: "ふる",
    word: "降る",
  },
  {
    level: "N5",
    partOfSpeech: "verb, intransitive verb",
    reading: "おくれる",
    word: "遅れる",
  },
  { level: "N5", partOfSpeech: "verb", reading: "とどく", word: "届く" },
  {
    level: "N5",
    partOfSpeech: "adjective",
    reading: "つめたい",
    word: "冷たい",
  },
  { level: "N5", partOfSpeech: "noun", reading: "かぜ", word: "風" },
  { level: "N5", partOfSpeech: "adverb", reading: "まだ", word: "まだ" },
  { level: "N5", partOfSpeech: "adverb", reading: "つよい", word: "強く" },
  { level: "N5", partOfSpeech: "verb", reading: "すわる", word: "坐る" },
  { level: "N5", partOfSpeech: "particle", reading: "は", word: "は" },
  { level: "N5", partOfSpeech: "particle", reading: "が", word: "が" },
  {
    level: "N4",
    partOfSpeech: "suf, noun",
    reading: "ちゃん",
    senses: [["chan"]],
    word: "ちゃん",
  },
  // 葉 shares its reading with the particle は: a reading-index slot lookup
  // turns 「高い山＿」 into an answer of は.
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "は",
    senses: [["leaf"]],
    word: "葉",
  },
];

const VOCAB_INDEX: VocabIndex = buildVocabIndex(VOCAB);
const sentence = (
  each: Partial<SourceSentence> & { jp: string }
): SourceSentence => ({
  en: each.en ?? "translation",
  id: each.id ?? "1",
  jp: each.jp,
  linkedWords: each.linkedWords ?? [],
});

describe("buildEntry: the masked-slot construction", () => {
  it("blanks the noun and keeps the key restorable to the source", () => {
    const entry = buildEntry(
      sentence({
        en: "It is raining.",
        id: "2001",
        jp: "雨が降っている。",
        linkedWords: ["雨", "が", "降る{降っている}"],
      }),
      VOCAB_INDEX
    );
    expect(entry?.passage).toBe("＿＿が降っている。");
    expect(entry?.options[entry.answerIndex]).toBe("雨");
    expect(entry?.sourceIds).toEqual(["2001"]);
    expect(entry?.validatedBy).toBe(GENERATOR_SIGNER);
    expect(entry?.stem).toBe(READING_STEM);
    expect(entry?.options).toHaveLength(4);
  });

  it("derives distractors from the pool instead of a shared head", () => {
    // Taking the head of the pool gave every item the same three words, which
    // made a bad distractor choice look identical on every row.
    const first = buildEntry(
      sentence({
        en: "It is raining.",
        id: "3001",
        jp: "雨が降っている。",
        linkedWords: ["雨", "が", "降る{降っている}"],
      }),
      VOCAB_INDEX
    );
    const second = buildEntry(
      sentence({
        en: "The train is late.",
        id: "3002",
        jp: "電車が遅れている。",
        linkedWords: ["電車", "が", "遅れる{遅れている}"],
      }),
      VOCAB_INDEX
    );
    // An explicit narrowing, not `expect(...).not.toBeNull()`: the assertion does
    // not narrow the type, and this row set is a fixed fixture.
    if (first === null || second === null) {
      throw new Error("fixture sentences must both produce a row");
    }
    const distractorsOf = (
      entry: NonNullable<typeof first>
    ): readonly string[] =>
      entry.options.filter((_, index) => index !== entry.answerIndex);
    expect(distractorsOf(first)).not.toEqual(distractorsOf(second));
  });

  it("varies the answer index across a batch", () => {
    const batch = buildBatch(
      [
        sentence({
          en: "It is raining.",
          id: "4001",
          jp: "雨が降っている。",
          linkedWords: ["雨", "が", "降る{降っている}"],
        }),
        sentence({
          en: "The train is late.",
          id: "4002",
          jp: "電車が遅れている。",
          linkedWords: ["電車", "が", "遅れる{遅れている}"],
        }),
        sentence({
          en: "The letter arrived.",
          id: "4003",
          jp: "手紙が届いた。",
          linkedWords: ["手紙", "が", "届く{届いた}"],
        }),
      ],
      VOCAB_INDEX,
      3
    );
    expect(batch).toHaveLength(3);
    const answerIndexes = batch.map((entry) => entry.answerIndex);
    expect(new Set(answerIndexes).size).toBeGreaterThan(1);
  });

  it("is deterministic: the same corpus yields byte-identical rows", () => {
    const corpus = [
      sentence({
        en: "It is raining.",
        id: "5001",
        jp: "雨が降っている。",
        linkedWords: ["雨", "が", "降る{降っている}"],
      }),
      sentence({
        en: "The train is late.",
        id: "5002",
        jp: "電車が遅れている。",
        linkedWords: ["電車", "が", "遅れる{遅れている}"],
      }),
    ];
    expect(JSON.stringify(buildBatch(corpus, VOCAB_INDEX, 2))).toBe(
      JSON.stringify(buildBatch(corpus, VOCAB_INDEX, 2))
    );
  });
});

describe("buildEntry: refusals", () => {
  it("declines a sentence whose only candidate slot is a particle", () => {
    // 葉 shares the reading は with the particle; a reading-index slot lookup
    // answered 「高い山＿」 with は, which is not a reading item at all.
    expect(
      buildEntry(
        sentence({
          id: "6001",
          jp: "山は高くない。",
          linkedWords: ["山", "は", "高くない{高くない}"],
        }),
        VOCAB_INDEX
      )
    ).toBeNull();
  });

  it("declines a slot that occurs more than once in the sentence", () => {
    // Two copies of the word would leave the answer readable in the passage.
    expect(
      buildEntry(
        sentence({
          id: "6002",
          jp: "電車に乗る。電車に揺れた。",
          linkedWords: [
            "電車",
            "に",
            "乗る{乗る}",
            "電車",
            "に",
            "揺れる{揺れた}",
          ],
        }),
        VOCAB_INDEX
      )
    ).toBeNull();
  });

  it("declines an affix that JMdict marks as a suffix", () => {
    // ちゃん is `suf, noun` in the vocabulary file; blanking it yields
    // 「愛＿は私のそばに座った。」, which no reader can answer from the sentence.
    expect(
      buildEntry(
        sentence({
          id: "6003",
          jp: "愛ちゃんは坐った。",
          linkedWords: ["愛", "ちゃん", "は", "坐る{坐った}"],
        }),
        VOCAB_INDEX
      )
    ).toBeNull();
  });

  it("declines when the vocabulary cannot fill three distractors", () => {
    const thin = buildVocabIndex([
      {
        level: "N5",
        partOfSpeech: "noun",
        reading: "あめ",
        senses: [["rain"]],
        word: "雨",
      },
    ]);
    expect(
      buildEntry(
        sentence({
          en: "It is raining.",
          id: "6004",
          jp: "雨が降っている。",
          linkedWords: ["雨", "が", "降る{降っている}"],
        }),
        thin
      )
    ).toBeNull();
  });

  it("keeps one row per answer word, so a paper asks four different things", () => {
    // Two sentences, both about 風. Without this the batch carried three 部屋
    // rows and one 大問4 printed them together.
    const batch = buildBatch(
      [
        sentence({
          en: "The wind is strong.",
          id: "8001",
          jp: "風がまだ強く吹きます。",
          linkedWords: ["風", "が", "まだ", "強く", "吹く{吹きます}"],
        }),
        sentence({
          en: "A cold wind was blowing.",
          id: "8002",
          jp: "冷たい風がふいていた。",
          linkedWords: ["冷たい", "風", "が", "吹く{ふいていた}"],
        }),
      ],
      VOCAB_INDEX,
      2
    );
    const answers = batch.map((entry) => entry.options[entry.answerIndex]);
    expect(new Set(answers).size).toBe(answers.length);
  });

  it("skips a sentence that carries a word above the level", () => {
    // 車 is absent from the fixture vocabulary, so the sentence is not
    // in-level and cannot become a difficulty claim.
    const batch = buildBatch(
      [
        sentence({
          id: "7001",
          jp: "電車に車がぶつかった。",
          linkedWords: ["電車", "に", "車", "が", "ぶつかる{ぶつかった}"],
        }),
      ],
      VOCAB_INDEX,
      1
    );
    expect(batch).toEqual([]);
  });
});
