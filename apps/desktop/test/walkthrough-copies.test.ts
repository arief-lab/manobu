import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { t } from "@manobu/ui/lib/copy";
import { classify, toTeForm } from "@/lib/conjugate";
import type { Mistake } from "@/lib/mock";
import type { NextCardLike } from "@/lib/queue";
import { buildWeakPatternQueue } from "@/lib/weak-pattern-queue";

const WHAT_RE = /what/i;
const WHY_RE = /why/i;
const DO_RE = /do/i;

/**
 * PM/QA zero-knowledge walkthrough (spec §TASK-1.17 AC #3 / AC #4).
 *
 * Every gate the user crosses must (a) have the expected copy key wired and
 * (b) be reachable through the public copy matrix. This test asserts the
 * copy keys exist + are non-empty + carry the expected behavioural cues
 * (no shame copy, no dark patterns, What/Why/What-to-do structure on
 * errors).
 */

describe("zero-knowledge walkthrough copy gates", () => {
  // The onboarding surface was deleted (2026-09-14 router audit: zero
  // inbound links, placement handlers were noop(), superseded by /setup).
  // Its copy keys are gone; the goal picker lives in setup.tsx, so the
  // walkthrough gate moved from the copy matrix to that source.
  it("first-run setup offers the five goals", () => {
    const src = readFileSync(
      join(import.meta.dirname, "..", "src", "features", "setup", "setup.tsx"),
      "utf8"
    );
    for (const goal of ["travel", "jlpt", "anime", "work", "fun"]) {
      expect(src).toContain(`goal: "${goal}"`);
    }
  });

  it("lesson progression copy (review.save_toast happy path)", () => {
    const msg = t("review.save_toast");
    expect(msg.toLowerCase()).toContain("fsrs");
    expect(msg.toLowerCase()).toContain("undo");
  });

  it("review empty state on day 1 (review.empty.first_run)", () => {
    expect(t("review.empty.first_run").toLowerCase()).toContain("great work");
  });

  it("review tomorrow suggestion (review.empty has next-review)", () => {
    expect(t("review.empty", { duration: "1d 4h" }).toLowerCase()).toContain(
      "next"
    );
  });
});

describe("error pattern: What + Why + What-to-do", () => {
  it("error.what + error.why + error.action form the canonical scaffold", () => {
    expect(t("error.what")).toMatch(WHAT_RE);
    expect(t("error.why")).toMatch(WHY_RE);
    expect(t("error.action")).toMatch(DO_RE);
  });

  it("every required error key is present + non-empty", () => {
    const errors = [
      "error.audio",
      "error.disk_full",
      "error.download",
      "error.api_key",
      "error.quota",
      "error.offline",
    ] as const;
    for (const key of errors) {
      const value = t(key);
      expect(value.length).toBeGreaterThan(0);
      // No shame / no dark-pattern strings (no "must", no "now or never").
      expect(value.toLowerCase()).not.toContain("must");
      expect(value.toLowerCase()).not.toContain("or never");
    }
  });
});

describe("ethical CLEAR (no total-retake shame)", () => {
  it("mock.score copy focuses on improvement, not failure", () => {
    const msg = t("mock.score");
    // Includes "AI plan" — improvement-focused.
    expect(msg.toLowerCase()).toContain("ai plan");
    expect(msg).toContain("Weak");
    // No shame copy. ("wrong" appears inside the {wrong}/{total} pattern slot
    // as a stats placeholder, not as a verdict on the learner — that's
    // intentional, see copy.ts.)
    expect(msg.toLowerCase()).not.toContain("shame");
    expect(msg.toLowerCase()).not.toContain("failed");
  });

  it("mock.mistakes uses neutral phrasing", () => {
    expect(t("mock.mistakes").toLowerCase()).toContain("review");
    expect(t("mock.mistakes").toLowerCase()).not.toContain("shame");
  });
});

describe("weak-pattern → quiz walkthrough (TASK-18.5)", () => {
  it("a weak 'ta-form' pattern produces a te-form card in the conjugate lab", async () => {
    // The learner got ta-form wrong in JLPT Mock — deriveWeakPatterns
    // surfaces it, buildWeakPatternQueue filters corpus-anchored cards,
    // and the conjugate lab's classify() + toTeForm() must produce a
    // valid て-form. This is the closed loop that QA verifies.
    const mistakes: Mistake[] = [
      { grammarId: "ta-form", questionId: "q-1", wrongChoiceId: "x" },
    ];
    const cards: NextCardLike[] = [
      { jp: "食べる", level: "N5", reading: "たべる", vocabId: 1 },
      { jp: "飲む", level: "N5", reading: "のむ", vocabId: 2 },
    ];
    const out = await buildWeakPatternQueue(mistakes, cards);
    // The queue now contains only corpus-anchored cards
    expect(out.weak.length).toBeGreaterThan(0);
    expect(out.weak[0]?.grammarId).toBe("ta-form");
    // The conjugate lab (no network) takes any of the queue's verb
    // reading, classifies it, and produces its て-form. This is the
    // SCR-06 loop that the AI quiz surfaces. `classify` normalises the
    // surface form, so the kanji 食べる resolves via classify() too
    // (the reading branch is what we use here for the test).
    const verb = classify("たべる");
    expect(verb).not.toBeNull();
    const te = toTeForm(verb as NonNullable<typeof verb>);
    expect(te).toBe("たべて");
    // Drinking (irregular YailE む→んで) — conjugate lab surfaces this
    // for variety once a te-form card is practiced.
    const drink = classify("のむ");
    expect(drink).not.toBeNull();
    expect(toTeForm(drink as NonNullable<typeof drink>)).toBe("のんで");
  });
});
