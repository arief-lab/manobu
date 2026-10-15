/**
 * Delta-vs-replace truncation regression (2026-09-21 live smoke finding).
 *
 * ACP `agent_message_chunk` / `agent_thought_chunk` arrive as DELTAS. The
 * persistence bridge's contract with the client fold is snapshot-based:
 * `replace: true` means "this frame's text is the FULL accumulated text"
 * (`chat-engine/folds/text.ts` doctrine). The bug published/persisted the
 * raw delta, so a multi-chunk reply lost everything except its last chunk
 * — on the live wire AND in the DB row (reload replay showed it too).
 *
 * The fix: `chat-text-accumulator.ts` rewrites streaming text/thinking
 * events to carry the accumulated snapshot before publish and persist.
 * This file covers the accumulator purely; the harness-level pin (live
 * frames + stored row carry the full text) lives in chat-e2e.test.ts
 * ("delta truncation" cases).
 */

import { describe, expect, it } from "bun:test";

import {
  accumulate,
  isDeltaTextEvent,
  withAccumulatedText,
} from "../src/chat-text-accumulator";

describe("chat-text-accumulator", () => {
  it("accumulates deltas into full snapshots keyed by type+msg_id", () => {
    const acc = new Map<string, string>();
    const e1 = {
      content: { text: "Hello", type: "text" },
      message_id: "m1",
      type: "text",
    } as never;
    const e2 = {
      content: { text: " world", type: "text" },
      message_id: "m1",
      type: "text",
    } as never;
    expect(isDeltaTextEvent(e1)).toBe(true);
    expect(accumulate(acc, e1)).toBe("Hello");
    expect(accumulate(acc, e2)).toBe("Hello world");
    // Snapshot rewrite carries the full text, keeps the block shape.
    const framed = withAccumulatedText(e2, "Hello world") as unknown as {
      content: { text: string; type: string };
    };
    expect(framed.content.text).toBe("Hello world");
    expect(framed.content.type).toBe("text");
  });

  it("keys text and thinking separately", () => {
    const acc = new Map<string, string>();
    const text = {
      content: { text: "a", type: "text" },
      message_id: "m1",
      type: "text",
    } as never;
    const think = {
      content: { text: "b", type: "text" },
      type: "thinking",
    } as never;
    accumulate(acc, text);
    accumulate(acc, think);
    expect(acc.get("text:m1")).toBe("a");
    expect(accumulate(acc, think)).toBe("bb");
  });

  it("tolerates content blocks without a text field (empty delta)", () => {
    const acc = new Map<string, string>();
    const empty = {
      content: { type: "text" },
      message_id: "m1",
      type: "text",
    } as never;
    expect(accumulate(acc, empty)).toBe("");
  });
});
