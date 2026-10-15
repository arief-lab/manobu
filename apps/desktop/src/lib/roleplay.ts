/*
 * Roleplay scoring (spec §SCR-07).
 *
 * politenessScore(input)   0-3 — keigo + です/ます forms boost
 * particleScore(input)     0-3 — counter for required particles
 * I1_REQUIRED_PARTICLES          — the composer's fallback chip set when
 *                          a scene line declares no required particles
 *
 * TASK-73 note: the scene-end rule ("not endless thread") now lives in
 * the compound's own index/total walk; the old endAfter3Saves helper and
 * the never-consumed i1Constraint/I1Pick/progress exports were deleted
 * with the redesign (clean cutover — no zero-consumer exports left).
 */

const POLITE_RE_1 = /です|ます|でした|ました|ません|ましょう/;
const POLITE_RE_2 =
  /ください|いただく|いただける|いただきましょう|なさる|ございます|お願い(します|できますか)/;
const POLITE_RE_3 =
  /いただけますか|お願いできますでしょうか|いただけますでしょうか|恐れ入りますが|差し支えなければ/;

export const politenessScore = (input: string): number => {
  let score = 0;
  if (POLITE_RE_1.test(input)) {
    score += 1;
  }
  if (POLITE_RE_2.test(input)) {
    score += 1;
  }
  if (POLITE_RE_3.test(input)) {
    score += 1;
  }
  return score;
};

export const particleScore = (
  input: string,
  required: readonly string[]
): number => {
  let score = 0;
  for (const p of required) {
    if (input.includes(p)) {
      score += 1;
    }
  }
  return Math.min(score, 3);
};

export const I1_REQUIRED_PARTICLES = ["を", "は", "に", "で", "が"] as const;
