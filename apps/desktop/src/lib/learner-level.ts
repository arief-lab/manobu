/*
 * Learner level (TASK-35) — the app-wide JLPT level the sidebar
 * selector drives. Deliberately NOT in `Settings` (spec SCR-11 owns
 * review preferences, not curriculum level) and NOT in the database —
 * v1 surfaces default to N5 and the level is a UI hint, not a
 * constraint. Follows the settings.ts hand-rolled store pattern (no
 * zustand): module-level state + subscribe + localStorage persistence.
 */

import type { JlptLevel } from "@manobu/api-contract";

export const JLPT_LEVELS: readonly JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];

const STORAGE_KEY = "manobu.learnerLevel";

const isJlptLevel = (value: string): value is JlptLevel =>
  (JLPT_LEVELS as readonly string[]).includes(value);

const DEFAULT_LEVEL: JlptLevel = "N5";

const load = (): JlptLevel => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isJlptLevel(stored)) {
      return stored;
    }
  } catch {
    // localStorage unavailable (private mode) — fall through to default.
  }
  return DEFAULT_LEVEL;
};

let current: JlptLevel = DEFAULT_LEVEL;

let initialized = false;

const subscribers = new Set<() => void>();

export const ensureLearnerLevelLoaded = (): JlptLevel => {
  if (!initialized) {
    current = load();
    initialized = true;
  }
  return current;
};

export const getLearnerLevel = (): JlptLevel => ensureLearnerLevelLoaded();

export const setLearnerLevel = (level: JlptLevel): void => {
  ensureLearnerLevelLoaded();
  if (level === current) {
    return;
  }
  current = level;
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Persistence is best-effort; in-memory value still applies.
  }
  for (const notify of subscribers) {
    notify();
  }
};

export const subscribeLearnerLevel = (notify: () => void): (() => void) => {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
};

export const __test__ = {
  isJlptLevel,
  STORAGE_KEY,
};
