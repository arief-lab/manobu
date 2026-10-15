/**
 * The review row names the entry, never the join key (TASK-160).
 *
 * `ExamDebriefItem.anchors` is a corpus id: `vocab:N5:<word>:<reading>`, or
 * `vocab:N5:05d1e396…` when the surface is a digest, and `grammar:<id>`. The
 * row used to interpolate that string into "Built from {anchor}", so a learner
 * was told the paper was built from a hash. The server now sends
 * `anchorLabels` beside `anchors` and this seam renders only those.
 *
 * Called, not read: the desktop has no DOM env, so `ReviewRow` cannot be
 * mounted here (it lives inside `PaperScope`, which needs a QueryClient and
 * eleven mutations). `reviewAnchorLine` is exported through `__test__` for
 * exactly this, the same way `shouldRenderExplanation` is.
 */
import { describe, expect, it } from "bun:test";
import type { ExamDebriefItem } from "@manobu/api-contract";
import { t } from "@manobu/ui/lib/copy";
import { __test__ } from "@/features/exam/exam-paper-pane";

/** A corpus id in the shape `exam-corpus.ts:143-147` mints. */
const ANCHOR_SHAPE = /(?:vocab|grammar|kanji):/;

const { reviewAnchorLine } = __test__;

/** Both debrief fields: an implementation that fell back to `anchors` has to
 * be given the chance to, which a labels-only fixture would deny it. */
const debriefFields = (
  anchorLabels: string[],
  anchors: string[]
): Pick<ExamDebriefItem, "anchorLabels" | "anchors"> => ({
  anchorLabels,
  anchors,
});

describe("reviewAnchorLine (TASK-160)", () => {
  it("builds the sentence from the labels and nothing else", () => {
    expect(
      reviewAnchorLine(
        debriefFields(
          ["村（むら）", "～を"],
          ["vocab:N5:村:むら", "grammar:3f9a"]
        )
      )
    ).toBe(t("exam.review.anchor", { anchor: "村（むら） · ～を" }));
  });

  it("says nothing when the corpus could not name the anchors", () => {
    // An unresolvable anchor yields no label (AC#3). Printing the id instead
    // is the same defect wearing a label, so the row stays silent.
    expect(
      reviewAnchorLine(debriefFields([], ["vocab:N5:05d1e396"]))
    ).toBeNull();
  });

  it("never puts a corpus id in the rendered sentence", () => {
    for (const item of [
      debriefFields(
        ["村（むら）", "～を"],
        ["vocab:N5:村:むら", "grammar:3f9a"]
      ),
      debriefFields(["テスト"], ["vocab:N5:テスト:テスト"]),
      debriefFields([], ["vocab:N5:05d1e396"]),
    ]) {
      expect(reviewAnchorLine(item) ?? "").not.toMatch(ANCHOR_SHAPE);
    }
  });
});
