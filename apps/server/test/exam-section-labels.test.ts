import { describe, expect, it } from "bun:test";

import {
  EXAM_MODES,
  EXAM_SCORING_SECTION_IDS,
  type ExamSectionId,
  examScoringSectionLabel,
  examScoringSectionLabelForMode,
  examSectionLabel,
  examSectionLabelForMode,
} from "@manobu/api-contract";
import { PAPER_LEVELS, paperBlueprintFor } from "@manobu/item-engine/paper";

/** The official column names a submitted paper must render (doc-12 §2.6). */
const OFFICIAL_SCORING_SECTIONS = {
  N1: ["Language Knowledge", "Reading", "Listening"],
  N2: ["Language Knowledge", "Reading", "Listening"],
  N3: ["Language Knowledge", "Reading", "Listening"],
  N4: ["Language Knowledge·Reading", "Listening"],
  N5: ["Language Knowledge·Reading", "Listening"],
} as const;

/** The official test-section names, in blueprint order. */
const OFFICIAL_SECTIONS = {
  N1: ["Language Knowledge·Reading", "Listening"],
  N2: ["Language Knowledge·Reading", "Listening"],
  N3: ["Vocabulary", "Grammar·Reading", "Listening"],
  N4: ["Vocabulary", "Grammar·Reading", "Listening"],
  N5: ["Vocabulary", "Grammar·Reading", "Listening"],
} as const;

/** The same two facts under the names the paper itself prints, in the SAME
 * blueprint order, so a real-mode column is checked against the English one it
 * replaces rather than a hand-written list that could drift from the ids. Each
 * string is read off the official 問題の構成 page for that level (doc-26 §8). */
const OFFICIAL_SCORING_SECTIONS_JA = {
  N1: ["言語知識（文字・語彙・文法）", "読解", "聴解"],
  N2: ["言語知識（文字・語彙・文法）", "読解", "聴解"],
  N3: ["言語知識（文字・語彙・文法）", "読解", "聴解"],
  N4: ["言語知識（文字・語彙・文法）・読解", "聴解"],
  N5: ["言語知識（文字・語彙・文法）・読解", "聴解"],
} as const;

const OFFICIAL_SECTIONS_JA = {
  N1: ["言語知識（文字・語彙・文法）・読解", "聴解"],
  N2: ["言語知識（文字・語彙・文法）・読解", "聴解"],
  N3: ["言語知識（文字・語彙）", "言語知識（文法）・読解", "聴解"],
  N4: ["言語知識（文字・語彙）", "言語知識（文法）・読解", "聴解"],
  N5: ["言語知識（文字・語彙）", "言語知識（文法）・読解", "聴解"],
} as const;

/**
 * The label table lives on the contract side because `api-contract` and
 * `item-engine` are both `"allow": []` boundary leaves that may not import
 * each other, so the two declarations are checked the way `ExamLevelSchema`
 * is (`test/level-vocabulary.test.ts`): pinned equal, never shared.
 * TASK-137: five private id->name copies had drifted, and the incomplete ones
 * renamed the folded N4/N5 column "Vocabulary" in the chat column while the
 * result pane beside it said "Language Knowledge·Reading".
 */
describe("paper section labels (TASK-137)", () => {
  it("names every scoring column the blueprint scores, for every level", () => {
    for (const level of PAPER_LEVELS) {
      const { scoringSections } = paperBlueprintFor(level);
      for (const section of scoringSections) {
        expect(EXAM_SCORING_SECTION_IDS).toContain(section.id);
      }
      expect(
        scoringSections.map((section) =>
          examScoringSectionLabel({ id: section.id, level })
        )
      ).toEqual([...OFFICIAL_SCORING_SECTIONS[level]]);
    }
  });

  it("names every test section the blueprint runs, for every level", () => {
    for (const level of PAPER_LEVELS) {
      const { sections } = paperBlueprintFor(level);
      expect(
        sections.map((section) =>
          examSectionLabel(section.id satisfies ExamSectionId)
        )
      ).toEqual([...OFFICIAL_SECTIONS[level]]);
    }
  });

  it("keeps the one ambiguous scoring id level-dependent", () => {
    // `language-knowledge` is the 60-point vocabulary-plus-grammar column at
    // N1/N2 and the 120-point column with reading folded in at N4/N5, so the
    // id alone cannot decide the name.
    expect(
      examScoringSectionLabel({ id: "language-knowledge", level: "N2" })
    ).toBe("Language Knowledge");
    expect(
      examScoringSectionLabel({ id: "language-knowledge", level: "N4" })
    ).toBe("Language Knowledge·Reading");
    // A name that is a function of the id alone must stay that way.
    expect(examScoringSectionLabel({ id: "reading", level: "N5" })).toBe(
      "Reading"
    );
  });

  it("prints the official Japanese 科目 for every real-mode section (TASK-173.3)", () => {
    for (const level of PAPER_LEVELS) {
      const { sections } = paperBlueprintFor(level);
      expect(
        sections.map((section) =>
          examSectionLabelForMode({
            id: section.id satisfies ExamSectionId,
            mode: "real",
          })
        )
      ).toEqual([...OFFICIAL_SECTIONS_JA[level]]);
    }
  });

  it("prints the official Japanese 科目 for every real-mode scoring column (TASK-173.3)", () => {
    for (const level of PAPER_LEVELS) {
      const { scoringSections } = paperBlueprintFor(level);
      expect(
        scoringSections.map((section) =>
          examScoringSectionLabelForMode({
            id: section.id,
            level,
            mode: "real",
          })
        )
      ).toEqual([...OFFICIAL_SCORING_SECTIONS_JA[level]]);
    }
  });

  it("keeps the ambiguous scoring id level-dependent in Japanese too", () => {
    // The same fold the English table applies: N1/N2/N3 score a standalone
    // 言語知識 column, N4/N5 fold reading into it and take the longer name.
    expect(
      examScoringSectionLabelForMode({
        id: "language-knowledge",
        level: "N2",
        mode: "real",
      })
    ).toBe("言語知識（文字・語彙・文法）");
    expect(
      examScoringSectionLabelForMode({
        id: "language-knowledge",
        level: "N5",
        mode: "real",
      })
    ).toBe("言語知識（文字・語彙・文法）・読解");
  });

  it("keeps the English name for every mode that is not a real paper (AC#2)", () => {
    // Only `real` switches language; `shortened` and `exam-conditions` are this
    // app's own formats and every internal caller reads them through the same
    // chooser, so a mode leaking Japanese here would rename the practice paper.
    for (const mode of EXAM_MODES) {
      if (mode === "real") {
        continue;
      }
      for (const level of PAPER_LEVELS) {
        const { sections, scoringSections } = paperBlueprintFor(level);
        for (const section of sections) {
          expect(examSectionLabelForMode({ id: section.id, mode })).toBe(
            examSectionLabel(section.id)
          );
        }
        for (const section of scoringSections) {
          expect(
            examScoringSectionLabelForMode({ id: section.id, level, mode })
          ).toBe(examScoringSectionLabel({ id: section.id, level }));
        }
      }
    }
  });
});
