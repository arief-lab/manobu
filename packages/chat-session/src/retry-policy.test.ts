/**
 * TASK-104 — the terminal-error retry policy, headless.
 *
 * Three layers pinned here, all pure (the orchestrator's transport side
 * effects live in `use-chat-engine.test.tsx`):
 * 1. `classifyTerminalError` — the AC#1/#3 decision matrix: which wire
 *    errors re-drive, which end the turn with their real reason.
 * 2. The notice folds (`beginRetryNotice` / `settleRetryNotice` /
 *    `dropRetryingNotice`) — the singleton insert/replace, the AC#2
 *    "recovered" settle, and the error-card supersede.
 * 3. `transformFrame` integration — the notice mutations fire on the REAL
 *    dispatch path (clean finish settles, error folds supersede), and a
 *    message-less error finish must NOT read as a recovery.
 */

import { describe, expect, test } from "bun:test";
import type { ChatFrame } from "@manobu/api-contract";
import {
  beginRetryNotice,
  dropRetryingNotice,
  isRetryNoticeCard,
  settleRetryNotice,
  type TMessage,
  terminalError,
  transformFrame,
} from "./chat-engine";
import { classifyTerminalError } from "./chat-engine/retry-policy";

// ── Frame fixtures ───────────────────────────────────────────────────────────

function errorFrame(text: string, turnId = "t1"): ChatFrame {
  return {
    conversation_id: "c1",
    data: { text },
    msg_id: `m-${turnId}`,
    turn_id: turnId,
    type: "error",
  } as unknown as ChatFrame;
}

function errorFinishFrame(message?: string, extra?: object): ChatFrame {
  return {
    conversation_id: "c1",
    data: {
      error: message === undefined ? undefined : { message, ...extra },
      stopReason: "error",
    },
    msg_id: "m1",
    turn_id: "t1",
    type: "finish",
  } as unknown as ChatFrame;
}

function cleanFinishFrame(): ChatFrame {
  return {
    conversation_id: "c1",
    data: { stopReason: "end_turn" },
    msg_id: "m1",
    turn_id: "t2",
    type: "finish",
  } as unknown as ChatFrame;
}

// ── 1. classifyTerminalError ─────────────────────────────────────────────────

describe("classifyTerminalError (retryable vs final, AC#1/#3)", () => {
  test("a rate-limit message is retryable with the short label", () => {
    for (const text of [
      "You have been rate limited, try again",
      "HTTP 429 Too Many Requests",
      "provider returned: rate_limit_exceeded",
    ]) {
      expect(classifyTerminalError(errorFrame(text))).toEqual({
        reason: "rate limit",
        retryable: true,
      });
    }
  });

  test("timeout, connection reset and empty-response messages are retryable", () => {
    const cases: [string, string][] = [
      ["The agent request timed out after 60s", "timeout"],
      ["deadline exceeded while waiting for the model", "timeout"],
      ["connection reset by peer", "connection reset"],
      ["read ECONNRESET", "connection reset"],
      ["the model produced an empty response", "empty response"],
    ];
    for (const [text, reason] of cases) {
      expect(classifyTerminalError(errorFrame(text))?.reason).toBe(reason);
      expect(classifyTerminalError(errorFrame(text))?.retryable).toBe(true);
    }
  });

  test("a message-less error finish is the empty-response class", () => {
    expect(classifyTerminalError(errorFinishFrame(undefined))).toEqual({
      reason: "empty response",
      retryable: true,
    });
    expect(
      classifyTerminalError(errorFinishFrame("   "))?.retryable ?? false
    ).toBe(true);
  });

  test("learner-action codes are final even when the text looks transient (AC#3)", () => {
    for (const code of ["AUTH_REQUIRED", "CONFIG_SWITCH_FAILED"]) {
      const frame = errorFinishFrame("rate limited on the way out", { code });
      expect(classifyTerminalError(frame)).toEqual({
        reason: null,
        retryable: false,
      });
    }
  });

  test("an unclassified message is final: no retry loop on real errors (AC#3)", () => {
    expect(
      classifyTerminalError(errorFrame("the agent process exploded"))
    ).toEqual({ reason: null, retryable: false });
    expect(
      classifyTerminalError(errorFinishFrame("invalid_request_body"))
    ).toEqual({ reason: null, retryable: false });
  });

  test("non-terminal frames carry no decision", () => {
    expect(terminalError(cleanFinishFrame())).toBeNull();
    expect(classifyTerminalError(cleanFinishFrame())).toBeNull();
    const content = {
      conversation_id: "c1",
      data: { text: "hi", type: "text" },
      msg_id: "m1",
      type: "content",
    } as unknown as ChatFrame;
    expect(classifyTerminalError(content)).toBeNull();
  });
});

// ── 2. The notice folds ──────────────────────────────────────────────────────

/** The conversation's live notice state (undefined when no notice card). */
function noticeState(cards: TMessage[]): string | undefined {
  return cards.find(isRetryNoticeCard)?.state;
}

describe("retry-notice folds (singleton, settle, supersede)", () => {
  test("begin inserts the conversation's singleton notice in retrying state", () => {
    const cards = beginRetryNotice(
      [],
      errorFrame("rate limited"),
      "rate limit"
    );
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card?.id).toBe("retry:c1");
    expect(noticeState(cards)).toBe("retrying");
  });

  test("a second begin REPLACES the singleton (one running story, AC#2)", () => {
    let cards = beginRetryNotice([], errorFrame("timed out", "t1"), "timeout");
    cards = beginRetryNotice(cards, errorFrame("timed out", "t2"), "timeout");
    expect(cards).toHaveLength(1);
  });

  test("settle flips retrying to recovered and leaves others untouched", () => {
    const cards = beginRetryNotice(
      [],
      errorFrame("rate limited"),
      "rate limit"
    );
    const settled = settleRetryNotice(cards);
    expect(noticeState(settled)).toBe("recovered");
    // Identity no-op when there is no retrying notice:
    expect(settleRetryNotice(settled)).toBe(settled);
  });

  test("dropRetryingNotice removes only the live notice", () => {
    const retrying = beginRetryNotice(
      [],
      errorFrame("rate limited"),
      "rate limit"
    );
    expect(dropRetryingNotice(retrying)).toHaveLength(0);
    const recovered = settleRetryNotice(retrying);
    expect(dropRetryingNotice(recovered)).toHaveLength(1);
  });
});

// ── 3. transformFrame integration ────────────────────────────────────────────

describe("retry notices through the real transformFrame dispatch", () => {
  test("a clean finish settles a retrying notice (AC#2: recovery is legible)", () => {
    const cards = beginRetryNotice(
      [],
      errorFrame("rate limited"),
      "rate limit"
    );
    const next = transformFrame(cards, cleanFinishFrame(), {});
    expect(noticeState(next)).toBe("recovered");
  });

  test("a terminal error card supersedes the retrying notice (AC#3)", () => {
    const cards = beginRetryNotice(
      [],
      errorFrame("rate limited"),
      "rate limit"
    );
    const next = transformFrame(cards, errorFrame("the agent died", "t1"), {});
    expect(noticeState(next)).toBeUndefined();
    expect(next.some((card) => card.type === "error")).toBe(true);
  });

  test("an error finish WITH a message folds the card and drops the notice", () => {
    const cards = beginRetryNotice(
      [],
      errorFrame("rate limited"),
      "rate limit"
    );
    const next = transformFrame(cards, errorFinishFrame("boom"), {});
    expect(noticeState(next)).toBeUndefined();
    expect(next.some((card) => card.type === "error")).toBe(true);
  });

  test("a message-LESS error finish neither folds nor settles (no false recovery)", () => {
    const cards = beginRetryNotice(
      [],
      errorFrame("rate limited"),
      "rate limit"
    );
    const next = transformFrame(cards, errorFinishFrame(undefined), {});
    expect(noticeState(next)).toBe("retrying");
  });

  test("content frames never touch the notice (no wire frame builds one)", () => {
    // No frame type folds a retry_notice; only the hook's beginRetryNotice
    // and the finish/error dispatch above ever change it.
    const cards = beginRetryNotice(
      [],
      errorFrame("rate limited"),
      "rate limit"
    );
    const content = {
      conversation_id: "c1",
      data: { text: "partial answer", type: "text" },
      msg_id: "m9",
      turn_id: "t2",
      type: "content",
    } as unknown as ChatFrame;
    const next = transformFrame(cards, content, {});
    expect(noticeState(next)).toBe("retrying");
  });
});
