import { describe, expect, it } from "bun:test";
import {
  MASK_BLANK,
  maskFragmentSpan,
  maskRealization,
  type TokenSplitter,
  targetLiteralOf,
} from "../src/services/exam-mask";

/**
 * TASK-142. The pure masker, with the tokenizer injected.
 *
 * The real splitter is `vaporetto_split`, which lives on the CONTENT database
 * handle (`createContentDatabase` loads the extension); the exam path holds the
 * USER database, whose libsql client has no `loadExtension` and no
 * `vaporetto_*` functions. So the integration currently has no tokenizer and
 * every item degrades to unmaskable - which is the correct behaviour and the
 * reason this file tests the function rather than the pipeline. The tests that
 * matter are the failure paths: an unverifiable mask must never be reported as
 * a mask.
 */

/** A stand-in segmenter with Japanese-realistic boundaries. Good enough to
 * exercise the gate and the verification, and deliberately not clever: the
 * point of the injection is that the mask logic never has to trust it. */
const splitterOf = (boundaries: (readonly string[])[]): TokenSplitter => {
  let call = 0;
  return () => {
    const preset = boundaries[call];
    call += 1;
    return Promise.resolve(preset ?? null);
  };
};

describe("targetLiteralOf", () => {
  it("takes the surface a pattern names, from after the last plus", () => {
    expect(targetLiteralOf("Verb stem + ました")).toBe("ました");
    expect(targetLiteralOf("X + を")).toBe("を");
    expect(targetLiteralOf("Noun + でした")).toBe("でした");
  });

  it("has no literal for a pattern that names no surface", () => {
    // These are the 55 shipped patterns with no "+" at all: morphological
    // descriptions and alternation lists, not strings that appear in a
    // sentence. They are unmaskable by this rule, not maskable-ish.
    expect(targetLiteralOf("Verb-て")).toBeNull();
    expect(targetLiteralOf("X と Y")).toBeNull();
    expect(targetLiteralOf("これ / それ / あれ / どれ")).toBeNull();
  });
});

describe("maskRealization", () => {
  it("masks a trailing literal and verifies the literal is gone", async () => {
    const result = await maskRealization({
      pattern: "X + から",
      // Split twice: once on the original, once on the masked sentence.
      sentence: "日本から来ました。",
      split: splitterOf([
        ["日本", "から", "来ました", "。"],
        ["日本", MASK_BLANK, "来ました", "。"],
      ]),
    });
    expect(result.strategy).toBe("trailing-literal");
    expect(result.verified).toBe(true);
    expect(result.literal).toBe("から");
    expect(result.masked).toBe(`日本${MASK_BLANK}来ました。`);
    // The rest of the sentence survived, which is the property that makes it
    // a question rather than a deletion.
    expect(result.masked).toContain("日本");
    expect(result.masked).toContain("来ました");
  });

  it("masks every occurrence, so a later one cannot give it away", async () => {
    const result = await maskRealization({
      pattern: "Noun + でした",
      sentence: "先生は元気でした。先生はお元気でした。",
      split: splitterOf([
        [
          "先生",
          "は",
          "元気",
          "でした",
          "。",
          "先生",
          "は",
          "お元気",
          "でした",
          "。",
        ],
        ["先生", "は", "元気", MASK_BLANK, "。"],
      ]),
    });
    expect(result.verified).toBe(true);
    expect(result.masked).not.toContain("でした");
    expect(result.masked).toContain("元気");
  });

  it("reports unmaskable when the pattern names no literal", async () => {
    const result = await maskRealization({
      pattern: "Verb-て",
      sentence: "食べます。",
      split: splitterOf([]),
    });
    expect(result.strategy).toBe("no-literal-in-pattern");
    expect(result.verified).toBe(false);
    // The sentence is returned intact rather than blanked: an unmaskable item
    // is visibly unmasked.
    expect(result.masked).toBe("食べます。");
  });

  it("reports unmaskable when the literal is absent from the sentence", async () => {
    // Real case: the pattern names ではない and the example spells it
    // ではありません, so the literal never occurs.
    const result = await maskRealization({
      pattern: "Noun + ではない",
      sentence: "今日は月曜日ではありません。",
      split: splitterOf([["今日", "は", "月曜日", "では", "ありません", "。"]]),
    });
    expect(result.strategy).toBe("literal-absent-from-sentence");
    expect(result.verified).toBe(false);
    expect(result.masked).toBe("今日は月曜日ではありません。");
  });

  it("refuses to mask a literal that is only part of a longer token", async () => {
    // The case that motivates the gate. ですが is one token, so replacing ですか
    // inside it would cut a word in half and produce a corrupt sentence.
    const result = await maskRealization({
      pattern: "Noun + です",
      sentence: "学校に行coalです。",
      split: splitterOf([["学校", "に", "行き", "ます", "。"]]),
    });
    expect(result.strategy).toBe("literal-not-a-token");
    expect(result.verified).toBe(false);
  });

  it("refuses to report a mask it could not verify", async () => {
    // The second tokenization still contains the literal, so the mask is not
    // trustworthy and must not be claimed. This is the outcome AC#3 exists to
    // prevent: an item that says it was masked when the blank was not found.
    const result = await maskRealization({
      pattern: "X + を",
      sentence: "本を読みます。",
      split: splitterOf([
        ["本", "を", "読みます", "。"],
        ["本", MASK_BLANK, "読みます", "。", "を"],
      ]),
    });
    expect(result.strategy).toBe("unverified-after-masking");
    expect(result.verified).toBe(false);
  });

  it("degrades to unmaskable when no tokenizer is available", async () => {
    // The state the integration is actually in today: the exam path has no
    // `vaporetto_split`, so nothing is masked rather than something masked
    // blind.
    const result = await maskRealization({
      pattern: "X + を",
      sentence: "本を読みます。",
      split: () => Promise.resolve(null),
    });
    expect(result.verified).toBe(false);
    expect(result.strategy).toBe("literal-not-a-token");
    expect(result.masked).toBe("本を読みます。");
  });
});

/**
 * TASK-173.6. The star-ordering mask: the whole four-fragment region becomes
 * equal-width cells with a ★ over the answer slot. The gates are the ones the
 * cloze masker does not have, because the masked literal here is a run of
 * tokens rather than a single token.
 */
describe("maskFragmentSpan", () => {
  // prefix + fragments.join("") + suffix === this, and the span occurs once.
  const sentence = "私は公園で友達と遊びました。";

  it("blanks the whole region, marks the ★ slot, and verifies the span is gone", async () => {
    const result = await maskFragmentSpan({
      fragments: ["公園", "で", "友達", "と"],
      prefix: "私は",
      sentence,
      // One call: the re-tokenization of the masked sentence.
      split: splitterOf([
        ["私", "は", "＿", "★", "＿", "遊び", "ました", "。"],
      ]),
      starSlot: 2,
      suffix: "遊びました。",
    });
    expect(result.strategy).toBe("fragment-span");
    expect(result.verified).toBe(true);
    expect(result.literal).toBe("公園で友達と");
    // The answer fragment is not printed anywhere in the passage.
    expect(result.masked).not.toContain("公園");
    expect(result.masked).not.toContain("友達");
    // Surrounding context survives, so it is still a sentence to read.
    expect(result.masked).toContain("私は");
    expect(result.masked).toContain("遊びました。");
  });

  it("marks exactly one cell with ★ and gives every cell the same width", async () => {
    const result = await maskFragmentSpan({
      fragments: ["公園", "で", "友達", "と"],
      prefix: "私は",
      sentence,
      split: splitterOf([
        ["私", "は", "＿", "★", "＿", "遊び", "ました", "。"],
      ]),
      starSlot: 2,
      suffix: "遊びました。",
    });
    // One star marker, over exactly one cell.
    expect(result.masked.split("★").length - 1).toBe(1);
    expect(result.masked).toContain(`★${MASK_BLANK}`);
    // Four cells, none of them revealing a fragment's length: they are all the
    // shared blank width regardless of how many morae the fragment had.
    const cells = result.masked
      .replace("私は", "")
      .replace("遊びました。", "")
      .trim()
      .split(" ");
    expect(cells.length).toBe(4);
    for (const cell of cells) {
      expect(cell.replace("★", "")).toBe(MASK_BLANK);
    }
  });

  it("declines when the fragments do not reconstruct the sentence", async () => {
    // A split that leaves a token out: prefix + span + suffix !== sentence.
    const result = await maskFragmentSpan({
      fragments: ["公園"],
      prefix: "私は",
      sentence,
      split: splitterOf([[]]),
      starSlot: 0,
      suffix: "遊びました。",
    });
    expect(result.verified).toBe(false);
    expect(result.strategy).toBe("literal-absent-from-sentence");
    // The sentence is returned intact, not corrupted into a partial blank.
    expect(result.masked).toBe(sentence);
  });

  it("declines when the region also occurs inside the surrounding context", async () => {
    // The span 学校に lives in both the region and the printed suffix, so
    // blanking the region would still leave it readable: a leak.
    const result = await maskFragmentSpan({
      fragments: ["学校", "に"],
      prefix: "",
      sentence: "学校に学校に行きました。",
      split: splitterOf([[]]),
      starSlot: 0,
      suffix: "学校に行きました。",
    });
    expect(result.verified).toBe(false);
    expect(result.strategy).toBe("unverified-after-masking");
    expect(result.masked).toBe("学校に学校に行きました。");
  });

  it("degrades to unmaskable when no tokenizer is available", async () => {
    // The integration state today: no vaporetto in the exam path, so nothing
    // is claimed masked rather than something masked blind.
    const result = await maskFragmentSpan({
      fragments: ["公園", "で", "友達", "と"],
      prefix: "私は",
      sentence,
      split: () => Promise.resolve(null),
      starSlot: 2,
      suffix: "遊びました。",
    });
    expect(result.verified).toBe(false);
    expect(result.strategy).toBe("unverified-after-masking");
    expect(result.masked).toBe(sentence);
  });
});
