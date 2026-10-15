import { describe, expect, it } from "bun:test";

import {
  firstStimulusText,
  itemStimuli,
  parseStimuli,
  stimulusPassageText,
} from "@manobu/item-engine/stimuli";
import type {
  ItemCorpusView,
  ItemRejectionReason,
  OptionSource,
  QuestionItem,
} from "@manobu/item-engine/types";
import { validateQuestionItem } from "@manobu/item-engine/validation";

const baseItem = (): QuestionItem => ({
  anchors: ["vocab:N5:1", "sentence:1"],
  answerIndex: 1,
  id: "item-1",
  itemType: "word-in-context",
  level: "N5",
  options: ["水", "本", "音", "車"],
  prompt: "___を読みます。",
  surface: "exam",
});

const baseSources = (): OptionSource[] => [
  { anchorId: "vocab:N5:1", kind: "corpus", relation: "same-pos" },
  { anchorId: "vocab:N5:1", kind: "answer" },
  { anchorId: "vocab:N5:1", kind: "corpus", relation: "same-pos" },
  {
    anchorId: "sentence:1",
    kind: "authored",
    relation: "stimulus",
    sourceId: "s1",
  },
];

const corpusView = (
  overrides: Partial<ItemCorpusView> = {}
): ItemCorpusView => ({
  isOptionSourceValid: () => true,
  resolveAnchor: (anchorId) => {
    if (anchorId === "vocab:N5:1") {
      return { id: anchorId, level: "N5", surfaces: ["水", "本", "音", "車"] };
    }
    if (anchorId === "sentence:1") {
      return { id: anchorId, level: "N5", surfaces: ["___を読みます。"] };
    }
    return null;
  },
  satisfies: (item, optionIndex) =>
    optionIndex === item.answerIndex ? "yes" : "no",
  ...overrides,
});

const expectReason = (
  item: QuestionItem,
  sources: OptionSource[],
  corpus: ItemCorpusView,
  reason: ItemRejectionReason
): void => {
  const result = validateQuestionItem(item, sources, corpus);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe(reason);
  }
};

describe("validateQuestionItem", () => {
  it("rejects each named anchoring and option reason", () => {
    expectReason(
      { ...baseItem(), anchors: [] },
      baseSources(),
      corpusView(),
      "no-anchor"
    );
    expectReason(
      { ...baseItem(), anchors: ["missing:1"] },
      [
        {
          anchorId: "missing:1",
          kind: "corpus",
          relation: "same-pos",
        },
      ],
      corpusView(),
      "anchor-missing"
    );
    expectReason(
      baseItem(),
      baseSources(),
      corpusView({
        resolveAnchor: (anchorId) => ({
          id: anchorId,
          level: anchorId === "vocab:N5:1" ? "N4" : "N5",
          surfaces: [],
        }),
      }),
      "anchor-level"
    );
    expectReason(
      { ...baseItem(), options: ["水", "本", "本", "車"] },
      baseSources(),
      corpusView(),
      "duplicate-option"
    );
    const invalidSources = baseSources();
    invalidSources[3] = {
      anchorId: "vocab:N5:1",
      kind: "derived",
      rule: "wrong-form",
    };
    expectReason(
      baseItem(),
      invalidSources,
      corpusView({
        isOptionSourceValid: (_item, source) => source.kind !== "derived",
      }),
      "unlucky-distractor"
    );
    expectReason(
      { ...baseItem(), prompt: "本を読みます。" },
      baseSources(),
      corpusView(),
      "stem-leak"
    );
    expectReason(
      { ...baseItem(), itemType: "listening-detail" },
      baseSources(),
      corpusView(),
      "script-missing"
    );
  });

  it("rejects mismatched answer provenance and FSRS links", () => {
    const sources = baseSources();
    sources[0] = { anchorId: "vocab:N5:1", kind: "answer" };
    expectReason(baseItem(), sources, corpusView(), "answer-provenance");
    expectReason(
      { ...baseItem(), fsrsVocabId: 1, itemType: "grammar-form" },
      baseSources(),
      corpusView(),
      "fsrs-link"
    );
  });

  it("rejects malformed option counts, answer indexes and keyless items", () => {
    expectReason(
      { ...baseItem(), options: ["水", "本", "音"] },
      baseSources().slice(0, 3),
      corpusView(),
      "option-count"
    );
    expectReason(
      { ...baseItem(), answerIndex: 4 },
      baseSources(),
      corpusView(),
      "answer-index"
    );
    expectReason(
      baseItem(),
      baseSources(),
      corpusView({
        satisfies: () => "no",
      }),
      "no-correct-answer"
    );
  });

  it("rejects two satisfying options as ambiguous", () => {
    expectReason(
      baseItem(),
      baseSources(),
      corpusView({
        satisfies: (_item, optionIndex) =>
          optionIndex === 1 || optionIndex === 2 ? "yes" : "no",
      }),
      "ambiguous"
    );
  });

  it("accepts a wrong-form sibling only for its intended target", () => {
    const sources = baseSources();
    sources[3] = {
      anchorId: "vocab:N5:1",
      kind: "derived",
      rule: "wrong-form",
    };
    const targetCorpus = corpusView({
      satisfies: (item, optionIndex) =>
        item.prompt === "te-form target" && optionIndex === item.answerIndex
          ? "yes"
          : "no",
    });
    expect(
      validateQuestionItem(
        { ...baseItem(), prompt: "te-form target" },
        sources,
        targetCorpus
      )
    ).toEqual({ assurance: "deterministic", ok: true });
    expectReason(
      { ...baseItem(), prompt: "different target" },
      sources,
      targetCorpus,
      "no-correct-answer"
    );
  });

  it("does not treat intentional reading evidence as a stem leak", () => {
    const result = validateQuestionItem(
      {
        ...baseItem(),
        itemType: "reading-info",
        options: ["水", "おにぎり", "音", "車"],
        passage: "朝ごはんはおにぎりでした。",
        prompt: "何を食べましたか。",
      },
      baseSources(),
      corpusView({
        satisfies: (_item, optionIndex) => (optionIndex === 1 ? "yes" : "no"),
      })
    );
    expect(result.ok).toBe(true);
  });

  it("requires a passage for long reading and accepts an anchored one", () => {
    expectReason(
      { ...baseItem(), itemType: "long-reading" },
      baseSources(),
      corpusView(),
      "passage-missing"
    );
    expectReason(
      {
        ...baseItem(),
        anchors: [],
        itemType: "long-reading",
        passage: "長い文章を読み、内容を答えてください。",
      },
      baseSources(),
      corpusView(),
      "no-anchor"
    );
    const result = validateQuestionItem(
      {
        ...baseItem(),
        itemType: "long-reading",
        passage: "長い文章を読み、内容を答えてください。",
      },
      baseSources(),
      corpusView()
    );
    expect(result).toEqual({ assurance: "deterministic", ok: true });
  });

  it("enforces an injected passage limit", () => {
    expectReason(
      { ...baseItem(), passage: "これは長すぎる読み gearbox です。" },
      baseSources(),
      corpusView({ maxPassageLength: () => 5 }),
      "passage-length"
    );
  });

  it("budgets the whole passage set against one length limit", () => {
    expectReason(
      {
        ...baseItem(),
        itemType: "integrated-reading",
        stimuli: [
          { kind: "passage", text: "最初のパッセージです。" },
          { kind: "passage", text: "つぎのパッセージです。" },
        ],
      },
      baseSources(),
      corpusView({ maxPassageLength: () => 20 }),
      "passage-length"
    );
    const result = validateQuestionItem(
      {
        ...baseItem(),
        itemType: "integrated-reading",
        stimuli: [
          { kind: "passage", text: "最初のパッセージです。" },
          { kind: "passage", text: "つぎのパッセージです。" },
        ],
      },
      baseSources(),
      corpusView({ maxPassageLength: () => 40 })
    );
    expect(result).toEqual({ assurance: "deterministic", ok: true });
  });
});

describe("integrated stimulus requirements (TASK-132)", () => {
  const integrated = (overrides: Partial<QuestionItem>): QuestionItem => ({
    ...baseItem(),
    itemType: "integrated-reading",
    prompt: "二つの文章から読み取ってください。",
    ...overrides,
  });

  const scriptItem = (overrides: Partial<QuestionItem>): QuestionItem => ({
    ...baseItem(),
    itemType: "integrated-listening",
    prompt: "録音を聞いて答えてください。",
    ...overrides,
  });

  it("requires two passages for integrated reading", () => {
    expectReason(
      integrated({ stimuli: [{ kind: "script", text: "台本" }] }),
      baseSources(),
      corpusView(),
      "stimuli-kind"
    );
    expectReason(
      integrated({ stimuli: [{ kind: "passage", text: "一つの文章。" }] }),
      baseSources(),
      corpusView(),
      "stimuli-count"
    );
  });

  it("requires a script for integrated listening and allows a passage with it", () => {
    expectReason(
      scriptItem({ stimuli: [{ kind: "passage", text: "資料" }] }),
      baseSources(),
      corpusView(),
      "stimuli-kind"
    );
    const result = validateQuestionItem(
      scriptItem({
        stimuli: [
          { kind: "script", text: "録音された台本です。" },
          { kind: "passage", text: "付随する資料の説明です。" },
        ],
      }),
      baseSources(),
      corpusView()
    );
    expect(result).toEqual({ assurance: "deterministic", ok: true });
  });

  it("reads a legacy single-stimulus item as a one-passage set", () => {
    const result = validateQuestionItem(
      integrated({ passage: "最初のパッセージ。" }),
      baseSources(),
      corpusView()
    );
    // One legacy passage is not the two an integrated item owes, and the reason
    // names the shortfall rather than the missing field.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("stimuli-count");
    }
  });

  it("reads an integrated item as stimulus-answered, not stem-leaked", () => {
    // The answer belongs in the passage of a reading item, so only the stem is
    // leak evidence there.
    const found = validateQuestionItem(
      integrated({
        stimuli: [
          { kind: "passage", text: "最初の文章です。" },
          { kind: "passage", text: "第二で本を買いました。" },
        ],
      }),
      baseSources(),
      corpusView()
    );
    expect(found).toEqual({ assurance: "deterministic", ok: true });
    expectReason(
      integrated({
        prompt: "何を買いましたか。本",
        stimuli: [
          { kind: "passage", text: "最初の文章です。" },
          { kind: "passage", text: "第二の文章です。" },
        ],
      }),
      baseSources(),
      corpusView(),
      "stem-leak"
    );
    // A type without a stimulus is still checked against its passage.
    expectReason(
      {
        ...baseItem(),
        passage: "この文には本 Shortlyあります。",
        prompt: "文中の語を選びます。",
      },
      baseSources(),
      corpusView(),
      "stem-leak"
    );
  });
});

/**
 * TASK-173.9.3. 統合理解 is the first REAL-mode reading block that is answered
 * from two documents, and it is the reason `text-comparison` exists as its own
 * kind instead of reusing `integrated-reading`: the server prints the canned
 * `INTEGRATED_READING_PASSAGES` for that type whenever it is asked, so a real
 * 統合理解 item sharing the name could silently be fabricated.
 */
describe("text-comparison stimulus requirements (TASK-173.9.3)", () => {
  const comparison = (overrides: Partial<QuestionItem>): QuestionItem => ({
    ...baseItem(),
    itemType: "text-comparison",
    prompt: "二つの文章の両方に挙げられているものはどれか。",
    ...overrides,
  });

  const pair = (): readonly { kind: "passage"; text: string }[] => [
    { kind: "passage", text: "第一の文章です。" },
    { kind: "passage", text: "第二の文章です。" },
  ];

  it("requires two passages and refuses one", () => {
    expectReason(
      comparison({ stimuli: [] }),
      baseSources(),
      corpusView(),
      "stimuli-kind"
    );
    expectReason(
      comparison({ stimuli: [{ kind: "passage", text: "一つの文章です。" }] }),
      baseSources(),
      corpusView(),
      "stimuli-count"
    );
    const result = validateQuestionItem(
      comparison({ stimuli: pair() }),
      baseSources(),
      corpusView()
    );
    expect(result).toEqual({ assurance: "deterministic", ok: true });
  });

  it("reads a legacy single passage as a one-document shortfall, not a leak", () => {
    expectReason(
      comparison({ passage: "文章が一つしかありません。" }),
      baseSources(),
      corpusView(),
      "stimuli-count"
    );
  });

  it("lets the answer sit in both documents, which is the construction", () => {
    // 両方に挙げられている means the key is printed twice, so the stimulus can
    // never be leak evidence here; only the stem could name the key, and the
    // shipped stem is fixed text.
    const found = validateQuestionItem(
      comparison({
        stimuli: [
          { kind: "passage", text: "二つとも水について書いています。" },
          { kind: "passage", text: "水の話題だけが共通しています。" },
        ],
      }),
      baseSources(),
      corpusView()
    );
    expect(found).toEqual({ assurance: "deterministic", ok: true });
    expectReason(
      comparison({
        prompt: "両方に挙げられているのは本です。",
        stimuli: pair(),
      }),
      baseSources(),
      corpusView(),
      "stem-leak"
    );
  });
});

describe("stimulus normalization (TASK-132)", () => {
  it("prefers the declared set and folds the singular fields otherwise", () => {
    expect(
      itemStimuli({
        passage: "古い文章",
        script: "古い台本",
        stimuli: [
          { kind: "passage", text: "一つ目" },
          { kind: "passage", text: "二つ目" },
        ],
      })
    ).toEqual([
      { kind: "passage", text: "一つ目" },
      { kind: "passage", text: "二つ目" },
    ]);
    expect(itemStimuli({ passage: "文章", script: "台本" })).toEqual([
      { kind: "passage", text: "文章" },
      { kind: "script", text: "台本" },
    ]);
    expect(itemStimuli({ stimuli: [] })).toEqual([]);
  });

  it("projects the first stimulus of a kind onto the singular fields", () => {
    const item: Pick<QuestionItem, "stimuli"> = {
      stimuli: [
        { kind: "passage", text: "一つ目" },
        { kind: "passage", text: "二つ目" },
        { kind: "script", text: "台本" },
      ],
    };
    expect(firstStimulusText(item, "passage")).toBe("一つ目");
    expect(firstStimulusText(item, "script")).toBe("台本");
    expect(stimulusPassageText(item)).toBe("一つ目\n\n二つ目");
  });

  it("narrows a stored payload and rejects what it does not understand", () => {
    expect(parseStimuli([{ kind: "passage", text: "文章" }])).toEqual([
      { kind: "passage", text: "文章" },
    ]);
    expect(parseStimuli([{ kind: "script", text: "" }])).toBeNull();
    expect(parseStimuli([{ kind: "audio", text: "文章" }])).toBeNull();
    expect(parseStimuli([{ text: "文章" }])).toBeNull();
    expect(parseStimuli("not json")).toBeNull();
  });
});
