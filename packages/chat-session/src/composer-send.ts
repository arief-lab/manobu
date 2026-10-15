/**
 * The accepted-send contract (TASK-100): a composer submission is either
 * consumed by the engine or it stays put and says why. Never both.
 *
 * Before this module the two halves lived apart: `useChatEngine().send`
 * refused a send while a turn was in flight, and `ChatSessionProvider.send`
 * cleared the draft unconditionally right after calling it, so the text the
 * engine declined to accept was wiped from the composer AND from the
 * persisted blob. The refusal is now classified once, here, and the two
 * consumers (engine + provider) read the same rule instead of each
 * re-deriving "busy".
 */

/** What the engine made of a submission attempt. */
export type SendOutcome = "accepted" | "refused-busy" | "refused-empty";

/**
 * Classify one submission attempt. `isSending` is the engine's own
 * derived busy flag, and the rule is ordered exactly like the guard in
 * `useChatEngine().send`: empty-or-whitespace first (a no-op, not a busy
 * refusal), then busy. Reordering the two would let a blank draft during a
 * streaming turn claim "this stayed in the composer" about nothing.
 */
export function classifySend(input: {
  isSending: boolean;
  text: string;
}): SendOutcome {
  if (input.text.trim().length === 0) {
    return "refused-empty";
  }
  if (input.isSending) {
    return "refused-busy";
  }
  return "accepted";
}

/** What the composer does about an outcome: keep or clear the draft, and
 * what the learner reads when the draft stays. */
export interface ComposerSendPlan {
  clearInput: boolean;
  notice: string | null;
}

const BUSY_NOTICE =
  "Still answering, so this stayed in the composer. Press Stop to cut the turn short, or send it again once the answer lands.";

export function planComposerSend(outcome: SendOutcome): ComposerSendPlan {
  if (outcome === "accepted") {
    return { clearInput: true, notice: null };
  }
  // A whitespace-only draft has nothing to say; a refused send does.
  return {
    clearInput: false,
    notice: outcome === "refused-busy" ? BUSY_NOTICE : null,
  };
}
