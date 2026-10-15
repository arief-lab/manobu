/*
 * Today plan (dashboard bento redesign) · the PURE decision layer of the
 * returning-user page. Same shape as deriveSensei: react-query +
 * localStorage own the effects, this module owns the transitions.
 *
 * Stage ladder (approved mockup; hard invariant: a user who never
 * practiced is never offered "Lesson 4" · every string derives from real
 * inputs):
 *   new          due=0, practicedDays=0  → Lesson 1 is the whole plan
 *   first-review due>0, practicedDays<2  → reviews are the new part
 *   mid          due>0, practicedDays>=2 → reviews first, then the path
 *   ahead        due=0, practicedDays>=1 → nothing due, want more?
 *
 * Weak-spot copy is NOT here on purpose: no revlog persistence yet, so
 * the Weak tile renders nothing (data-honesty rule · the grid collapses
 * instead of showing a placeholder).
 */

import type { JlptLevel } from "@manobu/api-contract";
import type { GoalId } from "./learner-setup";

export type TodayStage = "ahead" | "first-review" | "mid" | "new";

export interface TodayInput {
  dueCount: number;
  goal: GoalId | null;
  level: JlptLevel;
  /** Distinct practice days within the trailing 7 (inclusive of today). */
  practicedDays: number;
}

export interface TodayPlan {
  /** Due tile: giant number when cards exist, prose when they don't. */
  due: { big: boolean; line: string; sub: string };
  /** Echo of the input · tiles render the count without parsing copy. */
  dueCount: number;
  /** Estimated review minutes (~10s/card, min 1). */
  estReviewMin: number;
  /** Rail greeting · one honest sentence, generated from inputs. */
  greeting: string;
  /** The one loud action. `to` is a real route; no dead CTAs. */
  hero: { cta: string; to: "/lesson" | "/review" };
  /** Optional touch-practice bubble (stage D only). null = no tile. */
  nudge: string | null;
  stage: TodayStage;
}

const PATH_LABEL: Record<GoalId, string> = {
  anime: "Immersion",
  fun: "Free Roam",
  jlpt: "JLPT",
  travel: "Travel",
  work: "Business",
};

/* Goal-aware "next lesson" flavor. Each string names a surface that
 * actually exists behind /learn/lesson's goal branch (next-cards); no
 * invented content. */
const NEXT_LESSON: Record<GoalId, string> = {
  anime: "a new reader story",
  fun: "a rabbit-hole word",
  jlpt: "a grammar drill",
  travel: "ordering at a café",
  work: "a keigo drill",
};

const plural = (n: number, word: string): string =>
  `${n} ${n === 1 ? word : `${word}s`}`;

const nextLessonLabel = (goal: GoalId | null, level: JlptLevel): string => {
  if (goal === null) {
    return "the next lesson";
  }
  if (goal === "jlpt") {
    return `an ${level} grammar drill`;
  }
  return NEXT_LESSON[goal];
};

const estReviewMinutes = (dueCount: number): number =>
  Math.max(1, Math.round(dueCount / 6));

const pathName = (goal: GoalId | null): string =>
  goal === null ? "your path" : PATH_LABEL[goal];

/* Per-stage copy builders · one tiny pure function per rung, so the
 * ladder itself stays a lookup (complexity lives in the table, not a
 * switch). Each returns everything except stage/dueCount. */
type StageCopy = (input: TodayInput) => Omit<TodayPlan, "dueCount" | "stage">;

const COPY_NEW: StageCopy = ({ goal }) => ({
  due: {
    big: false,
    line: "Your first review lands tomorrow. Learn something today first.",
    sub: "",
  },
  estReviewMin: 1,
  greeting:
    goal === null
      ? "Welcome back. Lesson 1 is 10 minutes · that's the whole plan today."
      : `You picked ${pathName(goal)}. Lesson 1 is 10 minutes · that's the whole plan today.`,
  hero: { cta: "Start Lesson 1 · 10 min →", to: "/lesson" },
  nudge: null,
});

const COPY_FIRST_REVIEW: StageCopy = ({ dueCount, goal }) => ({
  due: {
    big: true,
    line: `${dueCount === 1 ? "word" : "words"} ready to review`,
    sub: `first review day · ~${estReviewMinutes(dueCount)} min`,
  },
  estReviewMin: estReviewMinutes(dueCount),
  // Rail = the arc (who/where), never the count · the Due tile owns the
  // number, the hero owns the verb. One fact, one home.
  greeting:
    goal === null
      ? "Something you made is ripe to review today."
      : `You picked ${pathName(goal)}. Something you made is ripe to review.`,
  hero: { cta: "Start your first review →", to: "/review" },
  nudge: null,
});

const COPY_MID: StageCopy = ({ dueCount, goal, level, practicedDays }) => ({
  due: {
    big: true,
    line: `${dueCount === 1 ? "word" : "words"} ready to review`,
    sub: `~${estReviewMinutes(dueCount)} min · next at R≤90%`,
  },
  estReviewMin: estReviewMinutes(dueCount),
  greeting: `${plural(practicedDays, "day")} this week. Reviews first, then ${nextLessonLabel(goal, level)}.`,
  hero: { cta: "Clear today's reviews →", to: "/review" },
  nudge: null,
});

const COPY_AHEAD: StageCopy = ({ goal, level }) => ({
  due: {
    big: false,
    line: "Nothing due · you're ahead.",
    sub: "Reviews return as the cards you learn come due.",
  },
  estReviewMin: 0,
  greeting: "Nothing due · you're ahead. Want more?",
  hero: {
    cta: `Next lesson: ${nextLessonLabel(goal, level)} →`,
    to: "/lesson",
  },
  nudge: "5 minutes of kana keeps the rhythm?",
});

const COPY: Record<TodayStage, StageCopy> = {
  ahead: COPY_AHEAD,
  "first-review": COPY_FIRST_REVIEW,
  mid: COPY_MID,
  new: COPY_NEW,
};

/** Pure ladder · the whole "what should I do today" machine. */
export const deriveToday = (input: TodayInput): TodayPlan => {
  const { dueCount, practicedDays } = input;
  let stage: TodayStage;
  if (dueCount > 0 && practicedDays >= 2) {
    stage = "mid";
  } else if (dueCount > 0) {
    stage = "first-review";
  } else if (practicedDays >= 1) {
    stage = "ahead";
  } else {
    stage = "new";
  }
  return { ...COPY[stage](input), dueCount, stage };
};

/** Momentum tile copy · facts, never obligations (anti-streak rule). */
export const momentumCopy = (
  practicedDays: number
): { line: string; sub: string } => {
  if (practicedDays === 0) {
    return { line: "No days yet · today can be the first.", sub: "" };
  }
  return {
    line: `${practicedDays} of last 7 days`,
    sub: practicedDays < 3 ? "Practice builds a rhythm." : "Nice rhythm.",
  };
};

export const __test__ = {
  deriveToday,
  estReviewMinutes,
  momentumCopy,
  pathName,
  plural,
};
