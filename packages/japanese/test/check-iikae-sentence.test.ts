/**
 * TASK-173.9.28 AC#6: the `check:iikae-sentence` gate is pinned with real
 * assertions over the exported per-row screens, not source-text checks. A clean
 * row passes; each defect the gate exists to catch is a separate fixture that
 * must fail; the last group runs the screens over the shipped stores.
 *
 * What this form is mechanically falsifiable about: the paper underlines a WHOLE
 * ぶん and offers four COMPLETE sentences, so every option must be that same
 * sentence with one piece swapped (the frame algebra in `swapOf`), the sentence
 * may not print its own answer, and the row must carry the N4/N5 instruction line
 * rather than the word form's. What NO fixture can check is whether the swapped-in
 * sentence MEANS the underlined one, which is exactly why nothing ships without
 * the two blind judge passes stamping the cert trio.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type IikaeSentenceRow,
  iikaeSentenceRowIssues,
  swapOf,
} from "../scripts/check-iikae-sentence";

const NO_REJECTIONS = new Set<string>();

/** The instruction line both booklets print at もんだい４ (N4V.pdf p.6, N5V.pdf
 * p.7), transcribed here rather than imported from the gate, so a drift in
 * `IIKAE_SENTENCE_STEMS` fails instead of agreeing with itself. */
const SENTENCE_STEM =
  "＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。";

/** A row that clears every screen, written out here so the test does not grade
 * the store against itself: the underlined sentence, four re-said sentences of
 * which exactly one keeps the meaning, that one frozen in the first slot, and an
 * evidence line that names the swapped surface. */
const baseRow = (): IikaeSentenceRow => ({
  answerIndex: 0,
  block: "iikae-ruiji",
  construction: "authored",
  evidence:
    "ゆうべ、という言葉はきのうのよる、という意味ですから、この二つの文はおなじ話をしています。",
  id: "n5-is-900",
  key: ["きのうのよる、しゅくだいをしました。"],
  level: "N5",
  options: [
    "きのうのよる、しゅくだいをしました。",
    "きのうのあさ、しゅくだいをしました。",
    "きょうのひる、しゅくだいをしました。",
    "ゆうべ、しゅくだいをしませんでした。",
  ],
  passage: "ゆうべ、しゅくだいをしました。",
  provenance: "composed",
  stem: SENTENCE_STEM,
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

const screen = (
  row: IikaeSentenceRow,
  rejectedIds: ReadonlySet<string> = NO_REJECTIONS
): string[] => iikaeSentenceRowIssues(row, rejectedIds);

describe("iikaeSentenceRowIssues", () => {
  it("passes a clean row", () => {
    expect(screen(baseRow())).toEqual([]);
  });

  it("rejects a row whose construction is not authored", () => {
    const row = baseRow();
    row.construction = "sourced";
    expect(screen(row)).toContain("construction-is-sourced");
  });

  it("rejects a composed row that claims no blind-cert", () => {
    const row = baseRow();
    row.validated = false;
    expect(screen(row)).toContain("not-validated");
  });

  it("rejects a row certified by anything other than the two blind passes", () => {
    const row = baseRow();
    row.validatedBy = "authored:draft";
    expect(screen(row)).toContain("validatedBy-is-authored:draft");
  });

  it("rejects a row the verdict record rejected", () => {
    expect(screen(baseRow(), new Set(["n5-is-900"]))).toContain(
      "row-judge-rejected"
    );
  });

  it("rejects a two-sentence passage", () => {
    // The paper underlines ONE ぶん; two sentences in the slot is a 読解 row.
    const row = baseRow();
    row.passage = "ゆうべ、しゅくだいをしました。あさもしました。";
    expect(screen(row)).toContain("passage-not-one-sentence");
  });

  it("rejects the word form's bracket marking, which this shape does not carry", () => {
    const row = baseRow();
    row.passage = "ゆうべ、「しゅくだい」をしました。";
    expect(screen(row)).toContain("passage-carries-brackets");
  });

  it("rejects a blank, which belongs to a cloze and not to this 大問", () => {
    const row = baseRow();
    row.passage = "＿＿＿、しゅくだいをしました。";
    expect(screen(row)).toContain("passage-carries-blank");
  });

  it("rejects a passage outside the level's length band", () => {
    const row = baseRow();
    row.passage =
      "ゆうべ、学校で出したしゅくだいすべてと、明日のテストのためのれんしゅうを、家にかえってから夜中まで続けました。";
    expect(screen(row).some((issue) => issue.includes("runes-outside"))).toBe(
      true
    );
  });

  it("rejects a fifth option", () => {
    const row = baseRow();
    row.options.push("おとといのよる、しゅくだいをしました。");
    expect(screen(row)).toContain("options-count-5");
  });

  it("rejects two options that say the same sentence", () => {
    const row = baseRow();
    row.options[2] = row.options[1] as string;
    expect(screen(row)).toContain("options-not-distinct");
  });

  it("rejects an option with no sentence terminator", () => {
    const row = baseRow();
    row.options[1] = "きのうのあさ、しゅくだいをしました";
    expect(screen(row)).toContain("option1-not-one-sentence");
  });

  it("rejects an option carrying the word form's marking", () => {
    const row = baseRow();
    row.options[1] = "きのうのあさ、「しゅくだい」をしました。";
    expect(screen(row)).toContain("option1-carries-marking");
  });

  it("rejects the answer leak: an option the sentence already prints", () => {
    // `sentence-paraphrase` is absent from `STIMULUS_ANSWER_TYPES`, so
    // `hasStemLeak` searches prompt+passage for the ANSWER TEXT and a row whose
    // passage contains one of its options is dropped by assembly in silence.
    const row = baseRow();
    row.options[1] = "しゅくだいをしました。";
    expect(screen(row)).toContain("option-in-passage:しゅくだいをしました。");
  });

  it("rejects the passage offered back as one of its own options", () => {
    // A copy answers the sentence by repeating it, which asks nothing.
    const row = baseRow();
    row.options[2] = row.passage;
    expect(screen(row)).toContain("option2-copies-the-passage");
  });

  it("rejects a distractor that only deletes a piece of the sentence", () => {
    // The four options are four WAYS OF SAYING the sentence; a sentence that just
    // drops a piece paraphrases nothing.
    const row = baseRow();
    row.options[1] = "しゅくだいをしました。";
    expect(screen(row)).toContain("option1-deletes-without-replacement");
  });

  it("rejects an option that is an unrelated sentence, not a re-said one", () => {
    // THE screen that stops four unrelated sentences passing themselves off as one
    // 言い換え類義 小問: only the full stop is shared, so the frame is 1.
    const row = baseRow();
    row.options[1] = "今日はいい天気です。";
    expect(screen(row)).toContain("option1-frame-1runes-below-6");
  });

  it("rejects a swap so long the option became a rewrite", () => {
    const row = baseRow();
    row.options[1] = "ゆうべ、算数の宿題と社会のプリントも全部しました。";
    expect(screen(row)).toContain("option1-swap-16runes-above-14");
  });

  it("rejects an answer whose swapped-in piece is still printed by the sentence", () => {
    // The leak at span level: the key sits in the passage in plain sight.
    const row = baseRow();
    row.passage = "ゆうべ、つまりきのうのよるに、しゅくだいをしました。";
    expect(screen(row)).toContain("answer-swap-in-passage:きのうのよる");
  });

  it("rejects an answerIndex moved off the frozen key slot", () => {
    const row = baseRow();
    row.answerIndex = 1;
    expect(screen(row)).toContain("answerIndex-1");
  });

  it("rejects a key that is not the option the grader reads", () => {
    const row = baseRow();
    row.key = ["きのうのあさ、しゅくだいをしました。"];
    expect(screen(row)).toContain("key-not-one-answer-matching-options-0");
  });

  it("rejects a stem that drifted from the official instruction line", () => {
    const row = baseRow();
    row.stem =
      "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。";
    expect(screen(row)).toContain("stem-not-official-instruction-line");
  });

  it("rejects a row filed under another 大問's block", () => {
    const row = baseRow();
    row.block = "hyouki";
    expect(screen(row)).toContain("block-is-hyouki");
  });

  it("rejects Latin script in the authored material", () => {
    const row = baseRow();
    row.passage = "ゆうべ、homework をしました。";
    expect(screen(row)).toContain("latin-in-passage");
  });

  it("rejects evidence too short to be one Japanese sentence", () => {
    const row = baseRow();
    row.evidence = "同じです。";
    expect(screen(row)).toContain("evidence-not-one-japanese-sentence");
  });

  it("rejects evidence that names neither of the two swapped surfaces", () => {
    // Prose about some other 小問: the row must justify ITSELF.
    const row = baseRow();
    row.evidence =
      "この文は場所を変えているだけの選択肢があるので答えは一つです。";
    expect(screen(row)).toContain("evidence-names-neither-swap");
  });

  it("reads a swap surface through its spacing, so a spaced quotation still counts", () => {
    const row = baseRow();
    row.evidence =
      "きのうの よる、という 言い方が ゆうべ、と おなじ 意味です。";
    expect(screen(row)).toEqual([]);
  });
});

describe("swapOf", () => {
  it("names the piece a sentence removes and the piece it puts in", () => {
    const swap = swapOf(
      "ゆうべ、しゅくだいをしました。",
      "きのうのよる、しゅくだいをしました。"
    );
    // The punctuation the two sentences share belongs to the FRAME, so what
    // `swapOf` reports is the two surfaces that actually differ.
    expect(swap?.after).toBe("きのうのよる");
    expect(swap?.before).toBe("ゆうべ");
    expect(swap?.frame).toBe(12);
  });

  it("returns null when the option is the sentence itself", () => {
    expect(swapOf("ゆうべ、ねました。", "ゆうべ、ねました。")).toBeNull();
  });

  it("counts the frame in runes, not in bytes", () => {
    // 台所 (2 runes) re-said as キッチン (4) leaves the shared tail
    // にてつだいます。 standing on both sides; measured in bytes the same frame
    // would read inflated and the screen would pass a frame it should refuse.
    const swap = swapOf(
      "母は台所にてつだいます。",
      "母はキッチンにてつだいます。"
    );
    expect(swap?.before).toBe("台所");
    expect(swap?.after).toBe("キッチン");
    expect(swap?.frame).toBe(10);
  });
});

describe("the shipped 言い換え類義 sentence stores", () => {
  const DATA_DIR = join(import.meta.dir, "..", "data", "reading");

  /** 小問数 × 4 papers from the blueprint: N4 prints 5 and N5 prints 5. */
  const SHIPPED = [
    { floor: 20, level: "N4" },
    { floor: 20, level: "N5" },
  ] as const;

  const load = (level: string): IikaeSentenceRow[] =>
    JSON.parse(
      readFileSync(
        join(DATA_DIR, `${level.toLowerCase()}-iikae-sentence.json`),
        "utf8"
      )
    ) as IikaeSentenceRow[];

  it("holds the floor of rows at each level and every row clears the gate", () => {
    for (const { floor, level } of SHIPPED) {
      const rows = load(level);
      expect(rows.length).toBeGreaterThanOrEqual(floor);
      for (const row of rows) {
        expect(iikaeSentenceRowIssues(row, NO_REJECTIONS)).toEqual([]);
      }
    }
  });

  it("carries every row of a level file under that level's stamp", () => {
    for (const { level } of SHIPPED) {
      for (const row of load(level)) {
        expect(row.level).toBe(level);
      }
    }
  });

  it("prints the same instruction line at both levels, as the two booklets do", () => {
    for (const { level } of SHIPPED) {
      for (const row of load(level)) {
        expect(row.stem).toBe(SENTENCE_STEM);
      }
    }
  });

  it("offers each option as the same sentence with one piece swapped", () => {
    // The store-wide face of the frame screen: a row whose options drifted apart
    // is four 小問, not one.
    for (const { level } of SHIPPED) {
      for (const row of load(level)) {
        for (const [index, option] of row.options.entries()) {
          const swap = swapOf(row.passage, option);
          expect(swap, `${row.id} option${index}`).not.toBeNull();
          expect((swap?.after.length ?? 0) > 0).toBe(true);
          expect((swap?.frame ?? 0) >= 6).toBe(true);
        }
      }
    }
  });

  it("never spends one passage or one 言い換え twice, across the two levels", () => {
    // The swapped pair is the 小問's identity: a 言い換え the store already asked
    // is not a new 小問, whatever level it is filed at.
    const seenPassage = new Map<string, string>();
    const seenSwap = new Map<string, string>();
    const clashes: string[] = [];
    for (const { level } of SHIPPED) {
      for (const row of load(level)) {
        const swap = swapOf(row.passage, row.options[0] ?? "");
        const entries: readonly (readonly [Map<string, string>, string])[] = [
          [seenPassage, row.passage],
          [seenSwap, swap === null ? "" : `${swap.before}→${swap.after}`],
        ];
        for (const [owner, text] of entries) {
          const prior = owner.get(text);
          if (prior !== undefined) {
            clashes.push(`${row.id} reuses material from ${prior}`);
          }
          owner.set(text, row.id);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps the sentence form out of the word-form store", () => {
    // The two forms share one 大問 heading and one record shape, so a row filed
    // into the wrong store is the mistake this pair of files makes easiest to
    // make. The word form brackets a word; this one never does.
    for (const { level } of SHIPPED) {
      for (const row of load(level)) {
        expect(row.passage.includes("「")).toBe(false);
        expect(row.passage.includes("＿")).toBe(false);
      }
    }
  });
});
