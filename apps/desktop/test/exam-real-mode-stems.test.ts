import { describe, expect, it } from "bun:test";
import type {
  ExamComposedItem,
  ExamPaperBlock,
  ExamSectionState,
} from "@manobu/api-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { __test__ } from "@/features/exam/exam-paper-pane";
import { ExamQuestion } from "@/features/exam/exam-question";

/**
 * TASK-173.2 AC#2: no English stem reaches the desktop exam view in real mode.
 *
 * The desktop has no DOM env, so the behaviour is pinned at the pure seams the
 * pane calls (`questionFromComposedItem`, `largeQuestionInstruction`,
 * `reviewQuestionLine`) and at what `renderToStaticMarkup` of the question
 * component actually prints. The property that matters is not "the Japanese is
 * there" but "the English is not": a real paper that fell back to `prompt`
 * whenever a stem was missing would look like a paper and be a different test.
 */

/** The line a rendered question prints, and the script a real paper never
 * uses for one. */
const LEGEND_LINE_RE = /<legend[^>]*>([^<]*)<\/legend>/g;
const LATIN_RE = /[A-Za-z]/;

/** The 大問1 instruction the N5 paper prints, quoted in paper.test.ts. */
const KANJI_YOMI_INSTRUCTION =
  "＿＿＿ の ことばは ひらがなで どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。";

const englishPrompt = "Choose the correct reading of 生かす.";

const realItem = ({
  bigQuestion,
  id,
  stem,
}: {
  bigQuestion: number | null;
  id: string;
  stem: string | null;
}): ExamComposedItem => ({
  bigQuestion,
  item: {
    anchors: ["vocabulary:kanji"],
    id,
    itemType: "kanji-reading",
    level: "N5",
    options: ["いかす", "せいかす", "しょうかする", "こうする"],
    passage: null,
    prompt: englishPrompt,
    seedPart: null,
    speech: null,
    stem,
    stimuli: [],
    surface: "exam",
  },
  order: 0,
  requestedSlotIndex: 0,
  section: "vocabulary",
});

const kanjiYomiBlocks: ExamPaperBlock[] = [
  {
    bigQuestion: 1,
    instruction: KANJI_YOMI_INSTRUCTION,
    itemCount: 1,
    name: "漢字読み",
    requestedItems: 1,
  },
  {
    bigQuestion: 2,
    instruction: null,
    itemCount: 1,
    name: "表記",
    requestedItems: 1,
  },
];

const realSection = (
  items: ExamComposedItem[],
  blocks: ExamPaperBlock[] = kanjiYomiBlocks
): ExamSectionState => ({
  answers: [],
  blocks,
  id: "vocabulary",
  items,
  minutes: 5,
  pauseCount: 0,
  paused: false,
  pausedMs: 0,
  position: 0,
  remainingSeconds: null,
  requestedItems: items.length,
  scoringSectionIds: ["language-knowledge"],
  startedAt: "2026-09-25T00:00:00.000Z",
  status: "in_progress",
  submittedAt: null,
  timeLimitSeconds: null,
});

describe("TASK-173.2 no English stem reaches the real-mode view (AC#2)", () => {
  it("asks a real 小問 with the Japanese material it carries", () => {
    const entry = realItem({ bigQuestion: 1, id: "r1", stem: "「生かす」" });
    expect(__test__.questionFromComposedItem(entry, "real").prompt).toBe(
      "「生かす」"
    );
  });

  it("prints nothing rather than falling back to the English prompt", () => {
    // The stem-or-nothing rule. A 文の文法1 小問 has no stem because its
    // sentence is the passage, and the paper prints no material line for it.
    const stemless = realItem({ bigQuestion: 1, id: "r2", stem: null });
    expect(
      __test__.questionFromComposedItem(stemless, "real").prompt
    ).toBeNull();
    const html = renderToStaticMarkup(
      createElement(ExamQuestion, {
        question: __test__.questionFromComposedItem(stemless, "real"),
      })
    );
    expect(html).not.toContain(englishPrompt);
    // No line to print, so no legend element at all.
    expect(html).not.toContain("<legend");
  });

  it("keeps every daily mode on its English prompt", () => {
    for (const mode of ["shortened", "exam-conditions"] as const) {
      const entry = realItem({
        bigQuestion: null,
        id: `d-${mode}`,
        stem: null,
      });
      expect(__test__.questionFromComposedItem(entry, mode).prompt).toBe(
        englishPrompt
      );
    }
  });

  it("renders a real 小問 whose printed line carries no Latin script", () => {
    const entry = realItem({ bigQuestion: 1, id: "r3", stem: "「生かす」" });
    const html = renderToStaticMarkup(
      createElement(ExamQuestion, {
        question: __test__.questionFromComposedItem(entry, "real"),
      })
    );
    expect(html).toContain("「生かす」");
    expect(html).not.toContain("Choose the correct reading of");
    // AC#4, the desktop half: the line the learner reads is the paper's, so
    // every legend in the rendered question is Japanese.
    for (const [, line] of html.matchAll(LEGEND_LINE_RE)) {
      expect(line).not.toMatch(LATIN_RE);
    }
  });

  it("prints the instruction once, from the 大問 the item belongs to", () => {
    const withStem = realItem({ bigQuestion: 1, id: "r4", stem: "「生かす」" });
    const section = realSection([withStem]);
    expect(__test__.largeQuestionInstruction(section, 0)).toBe(
      KANJI_YOMI_INSTRUCTION
    );
    // A 大問 with no wording this repo can name a paper for prints no
    // instruction rather than inventing one.
    const kaiji = realItem({ bigQuestion: 2, id: "r5", stem: "「かく」" });
    expect(
      __test__.largeQuestionInstruction(realSection([kaiji]), 0)
    ).toBeNull();
    // No 大問 structure at all, which is every mode but `real`.
    const daily = realItem({ bigQuestion: null, id: "r6", stem: null });
    expect(
      __test__.largeQuestionInstruction(realSection([daily]), 0)
    ).toBeNull();
    expect(
      __test__.largeQuestionInstruction(realSection([], []), 0)
    ).toBeNull();
    expect(__test__.largeQuestionInstruction(null, 0)).toBeNull();
  });

  it("selects the active question through the mode, not the fallback", () => {
    const section = realSection([
      realItem({ bigQuestion: 1, id: "a1", stem: "「生かす」" }),
      realItem({ bigQuestion: 1, id: "a2", stem: "「会社」" }),
    ]);
    const active = __test__.activeQuestionFor(section, "real", 1);
    expect(active?.question.prompt).toBe("「会社」");
    expect(active?.question.prompt).not.toBe(englishPrompt);
    // The same section read by a daily mode still asks in English.
    expect(
      __test__.activeQuestionFor(section, "shortened", 1)?.question.prompt
    ).toBe(englishPrompt);
  });

  it("debriefs a real item with the line it was asked with", () => {
    const { item } = realItem({
      bigQuestion: 1,
      id: "v1",
      stem: "「生かす」",
    });
    expect(__test__.reviewQuestionLine(item, "real")).toBe("「生かす」");
    expect(__test__.reviewQuestionLine(item, "shortened")).toBe(englishPrompt);
    const { item: stemless } = realItem({
      bigQuestion: 1,
      id: "v2",
      stem: null,
    });
    expect(__test__.reviewQuestionLine(stemless, "real")).toBeNull();
  });
});

/*
 * TASK-173.6 AC#3: the 文の組み立て star item reaches the desktop view through
 * the SAME generic path every real item uses, with no new render branch. The
 * markers (★ over one blank cell, ＿＿ for each of the four fragment slots) ride
 * the passage string, which the paper pane prints through `questionStimuli`, and
 * the four fragments render as ordinary A-D radios that capture the chosen index.
 * These tests prove that wiring; the desktop ships no star-specific code.
 */
const STAR_PASSAGE = "きのう、＿＿ ＿＿ ★＿＿ ＿＿。";
const STAR_FRAGMENTS = ["友達", "公園", "で", "遊びました"];

const starEntry = (id: string): ExamComposedItem => ({
  bigQuestion: 2,
  item: {
    anchors: ["grammar:g-star"],
    id,
    itemType: "star-ordering",
    level: "N5",
    options: STAR_FRAGMENTS,
    passage: STAR_PASSAGE,
    prompt: "Put the fragments in order to build the sentence.",
    seedPart: null,
    speech: null,
    stem: null,
    stimuli: [],
    surface: "exam",
  },
  order: 0,
  requestedSlotIndex: 0,
  section: "grammar-reading",
});

describe("TASK-173.6 the star item renders through the generic view (AC#3)", () => {
  it("prints the marked sentence as the stimulus, not an English line", () => {
    const question = __test__.questionFromComposedItem(starEntry("s1"), "real");
    // Real mode asks with the stem, which a star item has none of, so no English
    // legend reaches the page: the blanked sentence is the whole question.
    expect(question.prompt).toBeNull();
    // The passage the pane prints carries exactly one ★ over four equal cells.
    const passages = __test__.questionStimuli(question);
    expect(passages).toEqual([STAR_PASSAGE]);
    expect(STAR_PASSAGE.split("★").length - 1).toBe(1);
    expect(STAR_PASSAGE.split("＿＿").length - 1).toBe(4);
    // No fragment is readable off the passage, so the item is a real reordering
    // question rather than a copy-the-visible-word task.
    for (const fragment of STAR_FRAGMENTS) {
      expect(STAR_PASSAGE).not.toContain(fragment);
    }
  });

  it("renders the four fragments as selectable radios that capture the index", () => {
    const html = renderToStaticMarkup(
      createElement(ExamQuestion, {
        question: __test__.questionFromComposedItem(starEntry("s2"), "real"),
      })
    );
    // The fragments appear as the lettered options, in order.
    expect(html).toContain("A. 友達");
    expect(html).toContain("D. 遊びました");
    // Each radio carries its own index, which is what `onSelect` reports back, so
    // the assembled answer is captured by position, exactly as every other type.
    for (const index of [0, 1, 2, 3]) {
      expect(html).toContain(`data-option-index="${String(index)}"`);
    }
    // No English prompt leaked into a real 文の組み立て item.
    expect(html).not.toContain("Put the fragments in order");
  });

  it("keeps the star item on the English prompt in a daily mode", () => {
    // The absence of a legend is the real-mode rule, not a star gap: a daily
    // paper asks this same item in English.
    const question = __test__.questionFromComposedItem(
      starEntry("s3"),
      "shortened"
    );
    expect(question.prompt).toBe(
      "Put the fragments in order to build the sentence."
    );
  });
});

/*
 * TASK-173.7 AC#3: the 内容理解（短文） item reaches the desktop view through the
 * SAME generic path every real item uses, with no new render branch. It is the
 * first real 小問 that carries BOTH a passage (the reading text) and a stem (the
 * Japanese comprehension question): the pane prints the passage through
 * `questionStimuli` and the stem through `questionFromComposedItem`'s real-mode
 * branch, so the learner reads the text and its question with no English line.
 * A star or cloze has no stem, and a 漢字読み has no passage, so this proves the
 * two columns render together rather than one suppressing the other.
 */
const SHORT_PASSAGE = "わたしは 学生です。まいあさ 七時に おきます。";
const SHORT_STEM = "わたしは まいあさ どこへ 行きますか。";

const shortEntry = (id: string): ExamComposedItem => ({
  bigQuestion: 4,
  item: {
    anchors: [`reading:dokkai-1.1-${id}`],
    id,
    itemType: "short-reading",
    level: "N5",
    options: ["学校", "公園", "図書館", "病院"],
    passage: SHORT_PASSAGE,
    prompt: "Read the passage and choose the answer that matches its content.",
    seedPart: null,
    speech: null,
    stem: SHORT_STEM,
    stimuli: [],
    surface: "exam",
  },
  order: 0,
  requestedSlotIndex: 0,
  section: "grammar-reading",
});

describe("TASK-173.7 the 短文 renders passage + question through the generic view", () => {
  it("prints the sourced passage as the stimulus and the Japanese question as the prompt", () => {
    const question = __test__.questionFromComposedItem(
      shortEntry("x1"),
      "real"
    );
    // Real mode asks with the stem, which a 短文 carries: the comprehension
    // question, not the English prompt.
    expect(question.prompt).toBe(SHORT_STEM);
    // The reading text is the passage; with no stimulus set it prints through
    // the singular column, exactly as the star and cloze do.
    expect(__test__.questionStimuli(question)).toEqual([SHORT_PASSAGE]);
  });

  it("renders the question with no English legend", () => {
    // `ExamQuestion` prints the prompt line and the options; the pane prints the
    // passage separately through `questionStimuli` (asserted above), so this test
    // pins only that the reading QUESTION reaches the page in Japanese and the
    // English prompt never does.
    const html = renderToStaticMarkup(
      createElement(ExamQuestion, {
        question: __test__.questionFromComposedItem(shortEntry("x2"), "real"),
      })
    );
    expect(html).toContain(SHORT_STEM);
    expect(html).not.toContain(
      "Read the passage and choose the answer that matches its content."
    );
    // Every legend the learner reads is the paper's Japanese, never a Latin line.
    for (const [, line] of html.matchAll(LEGEND_LINE_RE)) {
      expect(line).not.toMatch(LATIN_RE);
    }
  });

  it("keeps a daily 短文 on its English prompt", () => {
    // The two-column behaviour is the real-mode rule, not a 短文 gap: a daily
    // paper asks this same item in English, with the passage still shown.
    const question = __test__.questionFromComposedItem(
      shortEntry("x3"),
      "shortened"
    );
    expect(question.prompt).toBe(
      "Read the passage and choose the answer that matches its content."
    );
    expect(__test__.questionStimuli(question)).toEqual([SHORT_PASSAGE]);
  });
});
