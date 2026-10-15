/*
 * Composer submit routing (TASK-147).
 *
 * `routes/ai.tsx` used to make this call with a chain of inline `if`s, which
 * left it untestable: the desktop has no DOM env, so a render-only assertion
 * cannot tell a wired branch from a dead one (the `reviewRowActions` lesson in
 * `features/exam/exam-paper-pane.tsx`). This module decides from
 * `resolveIntent` which effect a submission runs and returns it as data; the
 * route is a thin adapter over the verdict.
 *
 * The ordering IS the contract, so it lives in one place: a parked offer
 * outranks the draft's own intent (answering an offer is not a new request),
 * then an unanswered offer parks, then the explicit drills and papers start,
 * and everything else goes to the agent.
 */

import { type JlptLevel, JlptLevelSchema } from "@manobu/api-contract";
import { handleConfirm, type IntentResult } from "@/lib/intent";

/** The model-free paper request. `mode` and `budget` are deliberately absent:
 * the server defaults the mode and owns the per-section counts, so a caller
 * here cannot ask for a paper of a size it invented. */
export interface ExamPaperRequest {
  conversationId: string;
  focus: string[];
  level: JlptLevel;
}

export type ComposerRoute =
  | (ExamPaperRequest & { kind: "paper" })
  | {
      kind: "pending";
      receipt: string | null;
      startDrill: boolean;
      text: string;
    }
  | { kind: "chat" }
  | { kind: "drill"; text: string }
  | { kind: "offer"; intent: IntentResult; text: string };

/** The intent's level is a regex capture or the app's stored level, so the
 * paper request parses it through the wire's own schema instead of trusting
 * the shape: anything else would reach it as a 400. */
const paperLevel = (level: string | null | undefined): JlptLevel =>
  JlptLevelSchema.safeParse(level).data ?? "N5";

export const routeComposerSubmit = ({
  conversationId,
  intent,
  pending,
  text,
}: {
  conversationId: string;
  intent: IntentResult;
  pending: { intent: IntentResult; text: string } | null;
  text: string;
}): ComposerRoute => {
  if (pending !== null) {
    const decision = handleConfirm(text, pending.intent);
    return {
      kind: "pending",
      receipt: decision.receipt,
      startDrill: decision.tier === "drill" && decision.layer !== "L3",
      text: pending.text,
    };
  }
  if (intent.tier === "drill" && intent.confirmNeeded) {
    return { intent, kind: "offer", text };
  }
  if (intent.tier === "drill") {
    return { kind: "drill", text };
  }
  // Only an EXPLICIT exam command starts a paper. An inferred one stays
  // conversation: the agent decides, and asks through the `start_exam` host
  // tool rather than the composer guessing at a paper.
  if (intent.tier === "exam" && !intent.confirmNeeded) {
    return {
      conversationId,
      focus: intent.anchors,
      kind: "paper",
      level: paperLevel(intent.level),
    };
  }
  return { kind: "chat" };
};
