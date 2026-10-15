/**
 * Drill answer-mode selection (TASK-162).
 *
 * A learner arriving with no stored preference must land on a mode that offers
 * an answer surface, and that mode must say what it asks. Pure seams only:
 * this package has no DOM env, so the contract is the resolved mode and the
 * instruction text, not markup.
 */
import { describe, expect, it } from "bun:test";
import type { DrillChar } from "@/features/drill/drill-lab";
import { __test__ as drill } from "@/features/drill/drill-lab";

/** Framing the pick instruction must not claim, now that the card hides the form. */
const ANSWER_ON_SCREEN_RE = /the one above|matches the/iu;

describe("first-run answer mode", () => {
  it("defaults to pick, the one mode that answers with a tap anywhere", () => {
    expect(drill.DEFAULT_MODE).toBe("pick");
    expect(drill.resolveMode(null)).toBe("pick");
  });

  it("a stored preference outranks the default", () => {
    // The whole point of the sticky mode: the learner's choice wins, even the
    // choice this default replaced.
    expect(drill.resolveMode("draw")).toBe("draw");
    expect(drill.resolveMode("say")).toBe("say");
    expect(drill.resolveMode("pick")).toBe("pick");
  });

  it("garbage or an unreadable store falls back to the default", () => {
    for (const stored of ["", "draww", "DROP", "PICK", " draw "]) {
      expect(drill.resolveMode(stored)).toBe("pick");
    }
    // No localStorage in this environment, so this is the private-mode path.
    expect(drill.loadMode()).toBe("pick");
  });
});

describe("mode instruction", () => {
  const modes = ["draw", "pick", "say"] as const;

  it("names what every mode asks, in the learner's words", () => {
    for (const mode of modes) {
      expect(drill.MODE_INSTRUCTION[mode].length).toBeGreaterThan(0);
    }
    expect(Object.keys(drill.MODE_INSTRUCTION).sort()).toStrictEqual(
      [...modes].sort()
    );
  });

  it("describes pick as the recall it now asks for", () => {
    // TASK-168 took the target off the card until the verdict, so the line must
    // send the learner to the cue, not to an answer printed above the buttons.
    expect(drill.MODE_INSTRUCTION.pick).toContain("cue");
    expect(drill.MODE_INSTRUCTION.pick).not.toMatch(ANSWER_ON_SCREEN_RE);
  });

  it("keeps the voice clean of em dashes", () => {
    for (const mode of ["draw", "pick", "say"] as const) {
      expect(drill.MODE_INSTRUCTION[mode]).not.toContain("—");
    }
  });
});

describe("pick cue (TASK-168)", () => {
  const kana: DrillChar = {
    char: "あ",
    kind: "gojuon",
    level: "N5",
    romaji: "a",
  };
  const kanji: DrillChar = {
    char: "日",
    gloss: "day; sun",
    level: "N5",
    on: ["ニチ"],
    romaji: "nichi",
    strokeCount: 4,
  };

  it("asks a kana card by its reading", () => {
    expect(drill.pickCue(kana)).toBe("a");
  });

  it("asks a kanji card by its meaning", () => {
    expect(drill.pickCue(kanji)).toBe("day; sun");
  });

  it("never prints the form it is asking for", () => {
    for (const card of [kana, kanji]) {
      expect(drill.pickCue(card)).not.toContain(card.char);
    }
  });

  it("falls back to the reading when a kanji entry has no gloss", () => {
    // A thin deck row still cannot hand over the answer: the reading is sound,
    // the choices are shapes.
    const noGloss: DrillChar = { ...kanji, gloss: undefined };
    expect(drill.pickCue(noGloss)).toBe("nichi");
  });
});

describe("what the square shows (TASK-168)", () => {
  const base = {
    introVisible: 2,
    strokeCount: 4,
    strokeIndex: 1,
  } as const;

  it("holds the strokes back for the verdict in pick", () => {
    for (const phase of ["loading", "ready"] as const) {
      expect(drill.ghostStrokes({ ...base, mode: "pick", phase })).toBe(0);
    }
    for (const phase of ["correct", "wrong"] as const) {
      expect(drill.ghostStrokes({ ...base, mode: "pick", phase })).toBe(4);
    }
  });

  it("leaves draw and say alone: the form is their prompt, not their answer", () => {
    expect(drill.ghostStrokes({ ...base, mode: "draw", phase: "intro" })).toBe(
      2
    );
    expect(drill.ghostStrokes({ ...base, mode: "draw", phase: "ready" })).toBe(
      1
    );
    expect(drill.ghostStrokes({ ...base, mode: "say", phase: "ready" })).toBe(
      1
    );
  });
});
