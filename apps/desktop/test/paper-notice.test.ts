import { describe, expect, it } from "bun:test";

import { type PaperBuildResult, paperBuildNotice } from "@/lib/paper-notice";

/*
 * TASK-148 AC#6: when a level runs out of content the learner has not seen, the
 * surface says what happened instead of serving a silently shorter paper.
 *
 * The receipt, not a hand-written flag, drives the notice, so these three cases
 * are the three states the assembler can actually report.
 */

const receipt = (over: Partial<PaperBuildResult>): PaperBuildResult => ({
  contentExhausted: false,
  mode: "shortened",
  ready: true,
  totalSlots: 30,
  unfilledBlocks: [],
  validatedSlots: 30,
  ...over,
});

/** One of the 大問 a real paper asks for and the app cannot ask yet. */
const hole = (
  bigQuestion: number,
  name: string,
  requestedItems: number,
  section: PaperBuildResult["unfilledBlocks"][number]["section"] = "vocabulary"
): PaperBuildResult["unfilledBlocks"][number] => ({
  bigQuestion,
  name,
  requestedItems,
  section,
});

describe("paperBuildNotice (TASK-148 AC#6)", () => {
  it("names the size of a full paper rather than only claiming it is ready", () => {
    expect(paperBuildNotice(receipt({})).text).toBe(
      "Paper ready: 30 items. It is in the conversation."
    );
    // TASK-163's plural agreement applies to a one-item paper too.
    expect(
      paperBuildNotice(receipt({ totalSlots: 1, validatedSlots: 1 })).text
    ).toBe("Paper ready: 1 item. It is in the conversation.");
  });

  it("states that the level ran dry, with both numbers, when the build is short for that reason", () => {
    expect(
      paperBuildNotice(
        receipt({
          contentExhausted: true,
          ready: false,
          totalSlots: 10,
          validatedSlots: 6,
        })
      ).text
    ).toBe("Short paper: 6/10 items. This level has no new questions left.");
  });

  it("names the 大問 a real paper is missing, rather than telling the learner to retry (TASK-173.4)", () => {
    // The hole is in the plan, not in this attempt: "Try again?" would send the
    // learner back for the same short paper.
    expect(
      paperBuildNotice(
        receipt({
          ready: false,
          totalSlots: 35,
          unfilledBlocks: [hole(2, "表記", 8), hole(3, "文脈規定", 10)],
          validatedSlots: 12,
        })
      ).text
    ).toBe(
      "Not a full paper: 12/35 items. The app cannot ask these parts of a real paper yet: Vocabulary 大問 2 (表記), Vocabulary 大問 3 (文脈規定). A practice paper asks what it has."
    );

    // The two facts can be true of the same paper. The hole in the plan is the
    // one the learner can act on, and blaming their own history for it is not
    // honest, so the missing 大問 wins the sentence.
    expect(
      paperBuildNotice(
        receipt({
          contentExhausted: true,
          ready: false,
          unfilledBlocks: [hole(2, "表記", 8)],
        })
      ).text
    ).toContain("大問 2");
  });

  it("names the missing 大問 in Japanese on a real paper (TASK-173.3 AC#4)", () => {
    // The same hole the shortened notice spells "Vocabulary"; a real-mode
    // learner reads the 科目 name the paper itself prints.
    expect(
      paperBuildNotice(
        receipt({
          mode: "real",
          ready: false,
          totalSlots: 35,
          unfilledBlocks: [hole(2, "表記", 8)],
          validatedSlots: 12,
        })
      ).text
    ).toContain("言語知識（文字・語彙） 大問 2 (表記)");
  });

  it("names a 読解 大問 that has no store at this level, in both modes (TASK-173.4.1)", () => {
    // A 読解 大問 is a hole for either of two reasons (no question kind, or no
    // store for the level), and the sentence the learner reads must carry it the
    // same way: a real-mode learner gets the 科目 name the paper itself prints,
    // a practice paper the English label. Before this case only 語彙 holes were
    // ever rendered, so the reading half of the hole list was unasserted.
    const readingHole = [hole(5, "内容理解（中文）", 2, "grammar-reading")];
    expect(
      paperBuildNotice(
        receipt({
          mode: "real",
          ready: false,
          totalSlots: 35,
          unfilledBlocks: readingHole,
          validatedSlots: 12,
        })
      ).text
    ).toContain("言語知識（文法）・読解 大問 5 (内容理解（中文）)");
    expect(
      paperBuildNotice(
        receipt({
          ready: false,
          totalSlots: 35,
          unfilledBlocks: readingHole,
          validatedSlots: 12,
        })
      ).text
    ).toContain("Grammar·Reading 大問 5 (内容理解（中文）)");
  });

  it("reports a build failure when the paper is short for a reason that is not exhaustion", () => {
    // A validator rejection or a missing corpus is not a statement about how
    // much of the level the learner has seen, so it must not borrow that
    // sentence.
    expect(
      paperBuildNotice(
        receipt({ ready: false, totalSlots: 10, validatedSlots: 6 })
      ).text
    ).toBe("The paper could not be built. Try again?");
  });

  it("never says a paper is ready when the receipt says it is not", () => {
    for (const candidate of [
      receipt({ ready: false }),
      receipt({ contentExhausted: true, ready: false }),
      receipt({ ready: false, unfilledBlocks: [hole(2, "表記", 8)] }),
    ]) {
      expect(paperBuildNotice(candidate).text).not.toContain("Paper ready");
    }
  });

  it("tones a ready paper as a success and a short one as not", () => {
    // The colour the composer notice paints by: a full paper must not arrive
    // in the error red, and the short states are distinct (dry level and
    // missing 大問 are both actionable warnings, other is a failure).
    expect(paperBuildNotice(receipt({})).tone).toBe("success");
    expect(
      paperBuildNotice(receipt({ contentExhausted: true, ready: false })).tone
    ).toBe("warning");
    expect(
      paperBuildNotice(
        receipt({ ready: false, unfilledBlocks: [hole(2, "表記", 8)] })
      ).tone
    ).toBe("warning");
    expect(paperBuildNotice(receipt({ ready: false })).tone).toBe("error");
  });
});
