import { describe, expect, it } from "bun:test";

import { type CopyKey, copy, t } from "@manobu/ui/lib/copy";

const TODO_RE = /to do|to-do/i;
const EM_DASH_RE = /—/;

/** The string fields of a `Copy` entry. `t()` reads `primary` alone; the
 *  other two are rendered directly off `copy[key]`, so all three are copy. */
const COPY_FIELDS = ["primary", "edge", "error"] as const;

const REQUIRED_KEYS: readonly CopyKey[] = [
  "error.action",
  "error.api_key",
  "error.audio",
  "error.disk_full",
  "error.download",
  "error.offline",
  "error.quota",
  "error.what",
  "error.why",
  "mock.start_plan",
  "mock.mistakes",
  "mock.submit.fail",
  "review.empty",
  "review.save_toast",
  "review.save_toast.error",
  "review.optimize.fail",
  "reset.confirm",
  "set.privacy",
  "voice.no_output",
];

const DRILL_KEYS: readonly CopyKey[] = [
  "drill.start",
  "drill.verdict.correct",
  "drill.verdict.wrong",
  "drill.explain.action",
  "drill.explain.generated",
  "drill.skip",
  "drill.stop",
  "drill.next",
  "drill.pending",
  "drill.summary.counts",
  "drill.summary.schedule",
  "drill.summary.next",
  "drill.suspended",
];

const PAPER_KEYS: readonly CopyKey[] = [
  "paper.mode.shortened",
  "paper.mode.examConditions",
  "paper.mode.real",
  "paper.build.running",
  "paper.build.failed",
  "paper.build.ready",
  "paper.build.exhausted",
  "paper.build.unfilled",
  "paper.result.rawOnly",
  "paper.result.twoGates",
  "paper.result.estimate",
  "paper.result.overall",
  "paper.result.markValue",
  "paper.result.reachesMark",
  "paper.result.belowMark",
  "paper.debrief.weak",
  "paper.debrief.notSaved",
];

const OFFLINE_PAPER_KEYS: readonly CopyKey[] = [
  "paper.offline.seed",
  "paper.offline.empty",
];

const EXAM_KEYS: readonly CopyKey[] = [
  "exam.paused.composer",
  "exam.pause.action",
  "exam.pause.recorded",
  "exam.section.submit",
  "exam.section.timeUp",
  "exam.timer.fiveMin",
  "exam.timer.oneMin",
  "exam.abandon.confirm",
  "exam.abandon.done",
  "exam.review.title",
  "exam.review.yourPick",
  "exam.review.answer",
  "exam.review.anchor",
  "exam.review.replay",
  "exam.review.sendToDesk",
  "exam.review.dispute",
  "exam.collapse.toggle",
];

describe("copy matrix snapshot", () => {
  it("every required key is registered", () => {
    for (const key of REQUIRED_KEYS) {
      expect(copy[key]).toBeDefined();
    }
  });

  it("registers the thirteen drill keys with their exact copy", () => {
    expect(DRILL_KEYS).toHaveLength(13);
    expect(
      Object.keys(copy).filter((key) => key.startsWith("drill."))
    ).toHaveLength(13);
    for (const key of DRILL_KEYS) {
      expect(copy[key]).toBeDefined();
    }
    expect(t("drill.start")).toBe(
      "Starting a 10-question set on particles: say stop any time."
    );
    expect(t("drill.verdict.wrong", { answer: "に" })).toBe(
      "Not quite. The answer is に."
    );
    expect(t("drill.suspended", { answered: 3, declared: 10 })).toBe(
      "3/10 paused. Resume or end?"
    );
  });

  it("registers the seventeen paper keys and offline labels with exact copy", () => {
    expect(PAPER_KEYS).toHaveLength(17);
    expect(
      Object.keys(copy).filter((key) => key.startsWith("paper."))
    ).toHaveLength(19);
    for (const key of OFFLINE_PAPER_KEYS) {
      expect(copy[key]).toBeDefined();
    }
    expect(PAPER_KEYS.map((key) => copy[key].primary)).toEqual([
      "shortened paper",
      "exam conditions",
      "real exam paper",
      "Building your paper. {n}/{total} {total, plural, one {item} other {items}} ready.",
      "The paper could not be built. Try again?",
      "Paper ready: {total} {total, plural, one {item} other {items}}. It is in the conversation.",
      "Short paper: {validated}/{total} {total, plural, one {item} other {items}}. This level has no new questions left.",
      "Not a full paper: {validated}/{total} {total, plural, one {item} other {items}}. The app cannot ask these parts of a real paper yet: {missing}. A practice paper asks what it has.",
      "Shortened paper: item counts only.",
      "Total {total}/{max} against {mark}, plus each section.",
      "This score is an estimate from your answers, not the official JLPT result or a pass prediction.",
      "Overall {score}/{max}",
      "mark {mark}",
      "Reaches the mark",
      "Below the mark",
      "Missed: {anchors}",
      "Your last result was not saved.",
    ]);
    expect(
      t("paper.build.running", {
        n: 18,
        total: 30,
      })
    ).toBe("Building your paper. 18/30 items ready.");
    expect(
      t("paper.result.twoGates", {
        mark: 90,
        max: 180,
        total: 102,
      })
    ).toBe("Total 102/180 against 90, plus each section.");
    expect(t("paper.debrief.weak", { anchors: "grammar:particle" })).toBe(
      "Missed: grammar:particle"
    );
    expect(t("paper.offline.seed", { total: 9, validated: 9 })).toBe(
      "Built-in seed · 9/9 items ready offline"
    );
    expect(t("paper.build.ready", { total: 30 })).toBe(
      "Paper ready: 30 items. It is in the conversation."
    );
    expect(t("paper.build.exhausted", { total: 10, validated: 6 })).toBe(
      "Short paper: 6/10 items. This level has no new questions left."
    );
    expect(
      t("paper.build.unfilled", {
        missing: "Vocabulary 大問 2 (表記)",
        total: 35,
        validated: 12,
      })
    ).toBe(
      "Not a full paper: 12/35 items. The app cannot ask these parts of a real paper yet: Vocabulary 大問 2 (表記). A practice paper asks what it has."
    );
  });

  it("registers the seventeen exam workspace keys with exact copy", () => {
    expect(EXAM_KEYS).toHaveLength(17);
    // The exam WORKSPACE keys stay seventeen; the prefix count also carries the
    // TASK-173.11 dashboard launch strings (`exam.launch.*`), which live in the
    // same namespace the way `paper.offline.*` rides the `paper.` count.
    expect(
      Object.keys(copy).filter((key) => key.startsWith("exam."))
    ).toHaveLength(27);
    for (const key of EXAM_KEYS) {
      expect(copy[key]).toBeDefined();
    }
    expect(t("exam.paused.composer")).toBe(
      "Your paper is running. Questions unlock at submit."
    );
    expect(t("exam.pause.recorded", { count: 2, total: "3m 40s" })).toBe(
      "Paused 2 times, 3m 40s total."
    );
    expect(copy["exam.collapse.toggle"].primary).toBe("Hide chat");
    expect(copy["exam.collapse.toggle"].edge).toBe("Show chat");
    // TASK-137: the review row renders this on every item, including ones the
    // learner got right, so it has to read as an action. The deck's old value
    // ("This answer is wrong") read as a verdict about the learner's pick.
    expect(copy["exam.review.dispute"].primary).toBe("Report a wrong answer");
    expect(copy["exam.review.dispute"].edge).toBeUndefined();
  });

  it("<400 reviews copy (dJFEG) carries the defaults message", () => {
    const msg = t("review.optimize.fail");
    expect(msg).toContain("<400 reviews");
    expect(msg).toContain("defaults");
    expect(msg).toContain("better than SM-2");
  });

  it("error pattern is What + Why + What-to-do", () => {
    expect(t("error.what")).toContain("What");
    expect(t("error.why")).toContain("Why");
    expect(t("error.action")).toMatch(TODO_RE);
  });

  it("save-fail copy (mock.submit.fail) prompts retry + mentions FSRS write", () => {
    const msg = t("mock.submit.fail");
    expect(msg.toLowerCase()).toContain("retry");
    expect(msg.toLowerCase()).toContain("fsrs");
  });

  it("voice.no_output offers a graceful path", () => {
    const msg = t("voice.no_output");
    expect(msg).toContain("pitch");
    expect(msg.toLowerCase()).toContain("fallback");
    // TASK-171: the no-voice state is expected, not an error. The 🔇/🚫 glyphs
    // render as a red prohibition circle in the emoji font, so the copy must
    // not carry one; the muted text treatment is the whole signal.
    expect(msg).not.toContain("🔇");
    expect(msg).not.toContain("🚫");
  });

  it("reset.confirm requires typed RESET (FTC click-to-cancel equivalent)", () => {
    const msg = t("reset.confirm");
    expect(msg).toContain("RESET");
    expect(msg.toLowerCase()).toContain("confirm");
  });

  it("interpolation works for variables", () => {
    expect(t("review.empty", { duration: "1d 4h" })).toContain("1d 4h");
  });
});

describe("plural agreement (TASK-163)", () => {
  it("a one-item paper reads one item, not 1 items", () => {
    expect(t("paper.build.running", { n: 1, total: 1 })).toBe(
      "Building your paper. 1/1 item ready."
    );
    expect(t("paper.offline.seed", { total: 1, validated: 1 })).toBe(
      "Built-in seed · 1/1 item ready offline"
    );
  });

  it("keeps the plural arm for every other count, so the fraction still reads", () => {
    // "1/30 items" is the natural English of a build in progress: the noun
    // counts the paper's items (total), not the ones validated so far.
    expect(t("paper.build.running", { n: 1, total: 30 })).toBe(
      "Building your paper. 1/30 items ready."
    );
    expect(t("exam.pause.recorded", { count: 1, total: "40s" })).toBe(
      "Paused 1 time, 40s total."
    );
    expect(t("review.header", { due: 1, pct: 90, total: 12 })).toContain(
      "1 card due"
    );
    expect(t("review.header", { due: 7, pct: 90, total: 12 })).toContain(
      "7 cards due"
    );
  });

  it("a count that is not a number takes the plural arm and never leaks the clause", () => {
    const rendered = t("paper.build.running", { n: 1, total: "thirty" });
    expect(rendered).not.toContain("plural");
    expect(rendered).toContain("items ready.");
  });
});

describe("R-02 copy voice: no em dash in user-visible strings", () => {
  it("every string in the deck is em-dash free", () => {
    // R-02 allows `:`, `.`, `·` and parentheses instead. Comments in copy.ts
    // may use em dashes; only the rendered values are checked here.
    const offenders: string[] = [];
    for (const [key, entry] of Object.entries(copy)) {
      for (const field of COPY_FIELDS) {
        const value = entry[field];
        if (value !== undefined && EM_DASH_RE.test(value)) {
          offenders.push(`${key}.${field}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("walks the whole deck rather than a hand-kept subset", () => {
    // Keeps the guard above from passing vacuously if the deck is emptied or
    // renamed. The deck is the typed contract every surface reads from.
    expect(Object.keys(copy).length).toBeGreaterThan(50);
  });
});
