/**
 * TASK-100: the accepted-send contract, pinned as data.
 *
 * The bug was a division of labour: the engine refused a send while a turn
 * streamed and the provider cleared the draft anyway, so the text was gone
 * from the composer AND from the persisted blob. These cases pin the one
 * rule both halves now read, and the survival claim AC#5 asks for.
 */

import { describe, expect, test } from "bun:test";
import { classifySend, planComposerSend } from "./composer-send";

const DRAFT = "食べるって何？";

// UI copy voice (antislop audit-001, R-02): no em dash in user-visible
// strings.
const EM_DASH = /—/;

describe("classifySend", () => {
  test("a draft on an idle engine is accepted", () => {
    expect(classifySend({ isSending: false, text: DRAFT })).toBe("accepted");
  });

  test("a draft while a turn is in flight is refused as busy", () => {
    expect(classifySend({ isSending: true, text: DRAFT })).toBe("refused-busy");
  });

  test("whitespace is a no-op, never a busy refusal", () => {
    // The order matters: a blank draft during a streaming turn must not be
    // announced as "this stayed in the composer" when there is nothing.
    for (const blank of ["", "   ", "\n\t "]) {
      expect(classifySend({ isSending: true, text: blank })).toBe(
        "refused-empty"
      );
    }
  });
});

describe("planComposerSend", () => {
  test("an accepted send consumes the draft and says nothing", () => {
    expect(planComposerSend("accepted")).toEqual({
      clearInput: true,
      notice: null,
    });
  });

  test("a busy refusal keeps the draft and explains it", () => {
    const plan = planComposerSend("refused-busy");
    expect(plan.clearInput).toBe(false);
    expect(plan.notice).toContain("Still answering");
    expect(plan.notice).not.toMatch(EM_DASH);
  });

  test("an empty refusal keeps the draft and stays quiet", () => {
    expect(planComposerSend("refused-empty")).toEqual({
      clearInput: false,
      notice: null,
    });
  });
});

test("in-flight submit: the refused send leaves the text exactly where it was", () => {
  // Mirrors what ChatSessionProvider.send does with the two calls, in the
  // same order: classify (inside the engine) → plan → clear only when the
  // plan earns it. The React state/JSX glue on top of that is one
  // conditional, covered by type-check + the running app (no DOM test env
  // exists in this workspace: use-chat-engine.test.tsx:5-7).
  let input = DRAFT;
  const plan = planComposerSend(classifySend({ isSending: true, text: input }));
  if (plan.clearInput) {
    input = "";
  }
  expect(input).toBe(DRAFT);
  expect(plan.notice).not.toBeNull();
});
