/*
 * Kanji progress log (TASK-75) — the data behind the /kanji grid's
 * seen/learned tile badges. Deliberately minimal, the practice-days.ts
 * pattern: one localStorage key, a JSON blob, corrupt/private-mode reads
 * fall back to empty. No invented state:
 *   seen    = the learner opened this character's detail page
 *   learned = the learner saved at least one word containing it
 *             (undo un-marks; the last word removed falls back to seen)
 * When real FSRS card persistence lands (usePersistCards today has zero
 * callers), the grid derives from cards instead and `seen` stays here.
 */

const STORAGE_KEY = "manobu.kanjiProgress";

export interface KanjiProgress {
  /** character → saved word keys (word\0reading) containing it. */
  learned: Readonly<Record<string, readonly string[]>>;
  seen: readonly string[];
}

const EMPTY_PROGRESS: KanjiProgress = { learned: {}, seen: [] };

/* ── pure transitions (tested via __test__) ────────────────────── */

const strArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string" && s !== "")
    : [];

/** Tile badge state: learned beats seen beats nothing (TASK-75). */
export const cellState = (
  p: KanjiProgress,
  character: string
): "learned" | "none" | "seen" => {
  if (character in p.learned) {
    return "learned";
  }
  if (p.seen.includes(character)) {
    return "seen";
  }
  return "none";
};

/**
 * Honest grid subtitle fragment (facts, never obligations): ` · N learned,
 * M seen`, empty when nothing is learned or seen among the shown rows.
 */
export const progressNote = (
  p: KanjiProgress,
  characters: Iterable<string>
): string => {
  let learned = 0;
  let seen = 0;
  for (const char of characters) {
    const state = cellState(p, char);
    if (state === "learned") {
      learned += 1;
    } else if (state === "seen") {
      seen += 1;
    }
  }
  if (learned + seen === 0) {
    return "";
  }
  const parts = [`${learned} learned`];
  if (seen > 0) {
    parts.push(`${seen} seen`);
  }
  return ` · ${parts.join(", ")}`;
};

/** Validate a stored blob; anything malformed degrades to empty. */
const parseProgress = (raw: string | null): KanjiProgress => {
  if (raw === null) {
    return EMPTY_PROGRESS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_PROGRESS;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return EMPTY_PROGRESS;
  }
  const seen = strArray("seen" in parsed ? parsed.seen : undefined);
  const learnedRaw = "learned" in parsed ? parsed.learned : undefined;
  const learned: Record<string, string[]> = {};
  if (typeof learnedRaw === "object" && learnedRaw !== null) {
    for (const [char, words] of Object.entries(learnedRaw)) {
      const list = strArray(words);
      // an empty word list is not "learned" — drop the key entirely
      if (list.length > 0) {
        learned[char] = list;
      }
    }
  }
  return { learned, seen };
};

const withSeen = (p: KanjiProgress, char: string): KanjiProgress =>
  p.seen.includes(char) ? p : { ...p, seen: [...p.seen, char] };

/** Saving a word containing `char` marks it learned — and seen. */
const withLearned = (
  p: KanjiProgress,
  char: string,
  wordKey: string
): KanjiProgress => {
  const words = p.learned[char] ?? [];
  const next = words.includes(wordKey) ? words : [...words, wordKey];
  return withSeen({ ...p, learned: { ...p.learned, [char]: next } }, char);
};

/** Undo drops the word; the last word removed falls back to seen-only. */
const withoutLearned = (
  p: KanjiProgress,
  char: string,
  wordKey: string
): KanjiProgress => {
  const words = p.learned[char];
  if (words === undefined) {
    return p;
  }
  const rest = words.filter((w) => w !== wordKey);
  const learned = { ...p.learned };
  if (rest.length === 0) {
    delete learned[char];
  } else {
    learned[char] = rest;
  }
  return { ...p, learned };
};

/* ── storage wrappers (private-mode safe, never throw) ────────── */

export const readProgress = (): KanjiProgress => {
  try {
    return parseProgress(localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY_PROGRESS;
  }
};

const persist = (p: KanjiProgress): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // private mode: progress lives for this session only (practice-days.ts)
  }
};

/** The learner opened this character's detail page. */
export const markSeen = (char: string): void => {
  persist(withSeen(readProgress(), char));
};

/** The learner saved a word containing this character. */
export const markLearned = (char: string, wordKey: string): void => {
  persist(withLearned(readProgress(), char, wordKey));
};

/** Undo of that save. */
export const unmarkLearned = (char: string, wordKey: string): void => {
  persist(withoutLearned(readProgress(), char, wordKey));
};

export const __test__ = {
  parseProgress,
  strArray,
  withLearned,
  withoutLearned,
  withSeen,
};
