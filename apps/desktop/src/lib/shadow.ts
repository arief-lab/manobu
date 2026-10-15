/*
 * Shadowing overlap score (TASK-21.5 AC2).
 *
 * Character-multiset overlap between the target kana and the learner's
 * transcription, 0..1. Char-set overlap (not Levenshtein) because the
 * score feeds encouragement + FSRS Good(3), not phoneme-accurate grading.
 */

/** Final shadow ≥80% overlap maps to FSRS Good(3). */
export const SHADOW_GRADE_THRESHOLD = 0.8;

export const shadowScore = (target: string, spoken: string): number => {
  const t = target.replace(/\s+/g, "");
  const s = spoken.replace(/\s+/g, "");
  if (t.length === 0) {
    return 0;
  }
  const targetChars = new Map<string, number>();
  for (const c of t) {
    targetChars.set(c, (targetChars.get(c) ?? 0) + 1);
  }
  let hits = 0;
  for (const c of s) {
    const remaining = targetChars.get(c) ?? 0;
    if (remaining > 0) {
      targetChars.set(c, remaining - 1);
      hits += 1;
    }
  }
  const denom = Math.max(t.length, s.length);
  return denom === 0 ? 0 : hits / denom;
};
