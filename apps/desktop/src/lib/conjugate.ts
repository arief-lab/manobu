/*
 * Grading wrapper around the shared conjugation engine (TASK-145).
 *
 * The engine used to live here and this file used to BE it. It now lives in
 * `@manobu/japanese/conjugation`, because the exam path needs the same table
 * the Conjugate Lab used and a sidecar cannot import from `apps/desktop`. The
 * split is by dependency: the table is pure, and the ONE thing that was not
 * is `verifyDetailed` below, which needs the `deinflect` rule table to tell a
 * right-verb-wrong-form answer from a wrong one. So the engine moved and the
 * grading stayed, and this file is now only the part that could not move.
 *
 * The re-exports below look like a barrel and are not one: `verifyDetailed`
 * is real code in this file that could not move, and the re-exports exist so
 * the ~30 call sites importing from here keep working across the move.
 *
 * Everything re-exported below is a pure re-export with no local definition,
 * deliberately: a second copy of the form table is how the UI and the exam
 * would drift into disagreeing about what 飲ません is.
 */

import {
  classify,
  conjugate,
  type FormId,
  type VerbEntry,
  verifyForm,
} from "@manobu/japanese/conjugation";
import { deinflect } from "@/lib/deinflect";

// biome-ignore lint/performance/noBarrelFile: grading wrapper, not a barrel - see the header
export {
  choiceOptions,
  classify,
  conjugate,
  FORM_IDS,
  FORM_LABELS,
  type FormId,
  formGloss,
  patternExplanation,
  toTeForm,
  type VerbEntry,
  verifyForm,
} from "@manobu/japanese/conjugation";

export type VerifyResult =
  | { kind: "exact" }
  | { kind: "deinflected"; hint: string }
  | { kind: "wrong" };

/**
 * TASK-23.29: exact form stays the primary path; when it fails, deinflect
 * the input and accept it only when a candidate's target-form equals the
 * target's form · a hint-level response, never a silent pass. Example:
 * target 食べて, learner types 食べた → deinflects to 食べる → te-form
 * matches → hint "dictionary form 食べる (Past)".
 */
export const verifyDetailed = (
  verb: VerbEntry | null,
  input: string,
  form: FormId = "te"
): VerifyResult => {
  if (verb === null) {
    return { kind: "wrong" };
  }
  if (verifyForm(verb, form, input)) {
    return { kind: "exact" };
  }
  const target = conjugate(verb, form);
  for (const candidate of deinflect(input.trim())) {
    // TASK-54: skip identity candidates · the bare-potential rule pushes
    // the input's own dictionary form (食べる → 食べる), and a
    // dictionary-form answer to a te-form prompt is simply wrong, not a
    // "wrong-conjugation of the right verb" hint.
    if (candidate.form === input.trim()) {
      continue;
    }
    // Regenerate the form from the candidate's dictionary form and
    // compare · confirms the learner conjugated the RIGHT verb into the
    // WRONG form, which deserves a hint, not a pass.
    const candidateVerb = classify(candidate.form);
    if (candidateVerb !== null && conjugate(candidateVerb, form) === target) {
      return {
        hint: `${candidate.form} (${candidate.reason}) · right verb, wrong form`,
        kind: "deinflected",
      };
    }
  }
  return { kind: "wrong" };
};
