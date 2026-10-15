/*
 * Learner setup (first-run page, doc "bento redesign") — the chosen
 * learning goal + the `setup_done` gate. Deliberately NOT in `Settings`
 * (SCR-11 owns review prefs) and not db-backed yet (infra pending); v1
 * follows the lib/learner-level.ts hand-rolled-store pattern:
 * module-level state + subscribe + localStorage.
 */

export type GoalId = "travel" | "jlpt" | "anime" | "work" | "fun";

export const GOALS: readonly GoalId[] = [
  "travel",
  "jlpt",
  "anime",
  "work",
  "fun",
];

/** Display names for the goal, shared by the first-run page and Settings. */
export const GOAL_LABEL: Record<GoalId, string> = {
  anime: "Immersion",
  fun: "Free Roam",
  jlpt: "JLPT",
  travel: "Travel",
  work: "Business",
};

export const isGoalId = (value: string): value is GoalId =>
  (GOALS as readonly string[]).includes(value);

const GOAL_KEY = "manobu.goal";
const SETUP_KEY = "manobu.setupDone";

const readFlag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // localStorage unavailable (private mode) — treat as unset.
    return false;
  }
};

const writeFlag = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort; in-memory value still applies.
  }
};

let goal: GoalId | null = null;
let setupDone = false;
let initialized = false;

const subscribers = new Set<() => void>();

const notify = (): void => {
  for (const listener of subscribers) {
    listener();
  }
};

const ensureLoaded = (): void => {
  if (initialized) {
    return;
  }
  initialized = true;
  try {
    const stored = localStorage.getItem(GOAL_KEY);
    if (stored && isGoalId(stored)) {
      goal = stored;
    }
  } catch {
    // Private mode — goal stays null until Begin.
  }
  setupDone = readFlag(SETUP_KEY);
};

export const getGoal = (): GoalId | null => {
  ensureLoaded();
  return goal;
};

export const getSetupDone = (): boolean => {
  ensureLoaded();
  return setupDone;
};

/** Persist the chosen path and flip the first-run gate in one step. */
export const completeSetup = (next: GoalId): void => {
  ensureLoaded();
  goal = next;
  setupDone = true;
  writeFlag(GOAL_KEY, next);
  writeFlag(SETUP_KEY, "1");
  notify();
};

/** Test/dev seam: clear the gate so the first-run page returns. */
export const resetSetup = (): void => {
  ensureLoaded();
  goal = null;
  setupDone = false;
  writeFlag(GOAL_KEY, "");
  writeFlag(SETUP_KEY, "");
  notify();
};

export const subscribeLearnerSetup = (listener: () => void): (() => void) => {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};

export const __test__ = { GOALS, isGoalId };
