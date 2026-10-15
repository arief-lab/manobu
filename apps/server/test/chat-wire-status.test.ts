/**
 * TASK-86 replay-status carry contracts for `toWireFrame`.
 *
 * The subscribe replay renders history through the same frames the live
 * lane sent, so a parked `ask` row must replay with its settled status
 * ("finish"/"error") — otherwise a reloaded transcript re-arms an
 * interactive card that can never be answered. TASK-109 extends the same
 * carry to `acp_permission` rows (a park orphaned by a crash must replay
 * expired, not tappable). Other frame types keep replaying statusless
 * (their client reducers derive state from data).
 */

import { describe, expect, test } from "bun:test";
import { toWireFrame } from "../src/chat-persistence";
import type { StoredMessage } from "../src/chat-store";

const row = (patch: Partial<StoredMessage>): StoredMessage => ({
  content: JSON.stringify({ questions: [], request_id: "req-1" }),
  conversationId: "conv-1",
  createdAt: "2026-09-21 00:00:00",
  frameType: "ask",
  hidden: false,
  id: 1,
  msgId: "m-1",
  refId: "req-1",
  seq: 1,
  status: "pending",
  turnId: "turn-1",
  uiId: null,
  ...patch,
});

describe("toWireFrame status carry (TASK-86)", () => {
  test("ask rows replay their lifecycle status", () => {
    expect(toWireFrame(row({ status: "pending" }), true)).toHaveProperty(
      "status",
      "pending"
    );
    expect(toWireFrame(row({ status: "finish" }), true)).toHaveProperty(
      "status",
      "finish"
    );
    expect(toWireFrame(row({ status: "error" }), true)).toHaveProperty(
      "status",
      "error"
    );
  });

  test("acp_permission rows replay their lifecycle status (TASK-109)", () => {
    const perm = {
      content: JSON.stringify({
        options: [],
        request_id: "p-1",
        tool_call: {},
      }),
      frameType: "acp_permission",
      refId: "p-1",
    } satisfies Partial<StoredMessage>;
    expect(toWireFrame(row(perm), true)).toHaveProperty("status", "pending");
    expect(toWireFrame(row({ ...perm, status: "error" }), true)).toHaveProperty(
      "status",
      "error"
    );
  });

  test("non-ask frames replay statusless as before", () => {
    const frame = toWireFrame(
      row({
        content: JSON.stringify({ text: "hello", type: "text" }),
        frameType: "content",
        refId: null,
        status: "work",
      }),
      true
    );
    expect(frame).not.toHaveProperty("status");
  });

  test("an ask row with an out-of-enum status is dropped, not cast", () => {
    const frame = toWireFrame(row({ status: "weird" }), true);
    expect(frame).not.toHaveProperty("status");
  });
});
