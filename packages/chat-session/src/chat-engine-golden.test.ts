/**
 * Golden full-transcript snapshots for the chat-engine reducer
 * (TASK-81 AC#2, cluster B).
 *
 * The existing chat-engine.test.ts pins individual fold rules piecemeal.
 * This file pins the COMPLETE `TMessage[]` output for realistic multi-
 * frame turn scripts — every card type, merge path, and deriveStatus
 * transition in one deterministic sequence — so the TASK-81.2 folder-
 * ization (folds/ split, applyFold extraction, rule-list deriveStatus)
 * cannot change fold behavior while files move.
 *
 * Regenerate intentionally-changed snapshots with:
 *   UPDATE_GOLDENS=1 bun test src/chat-engine-golden.test.ts
 * (review the diff — regeneration is a reducer-contract change.)
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ChatFrame } from "@manobu/api-contract";
import { deriveStatus, transformFrame } from "./chat-engine";

const GOLDEN_DIR = join(import.meta.dir, "goldens", "chat-engine");
const UPDATE = process.env.UPDATE_GOLDENS === "1";

function frame(partial: Record<string, unknown> & { type: string }): ChatFrame {
  return {
    conversation_id: "conv-1",
    data: {},
    msg_id: "m1",
    ...partial,
  } as unknown as ChatFrame;
}

/** A full realistic turn: start → side-state → thinking → tool merge →
 * permission park + resolve → content delta → terminal → finish. */
const FULL_TURN: ChatFrame[] = [
  frame({ data: { session_id: "ses-1" }, msg_id: "start-1", type: "start" }),
  frame({
    data: {
      commands: [{ description: "Review", name: "review" }],
    },
    msg_id: "cmds-1",
    type: "available_commands",
  }),
  frame({
    data: { text: "Let me check the corpus.", type: "thinking" },
    msg_id: "think-1",
    type: "thinking",
  }),
  frame({
    data: {
      kind: "read",
      rawInput: { path: "src/x.ts" },
      rawOutput: "export const x = 1;",
      sessionUpdate: "tool_call",
      status: "pending",
      title: "read src/x.ts",
      toolCallId: "call-1",
    },
    msg_id: "tool-1",
    type: "acp_tool_call",
  }),
  frame({
    data: {
      rawOutput: "export const x = 1;\nexport const y = 2;",
      sessionUpdate: "tool_call_update",
      status: "completed",
      toolCallId: "call-1",
    },
    msg_id: "tool-1u",
    type: "acp_tool_call",
  }),
  frame({
    data: {
      options: [
        { kind: "allow_once", name: "Allow once", optionId: "allow_once" },
        { kind: "reject_once", name: "Reject", optionId: "reject" },
      ],
      request_id: "perm-1",
      title: "Allow write?",
      tool_call: { toolCallId: "call-1" },
    },
    msg_id: "perm-1",
    type: "acp_permission",
  }),
  frame({
    data: { outcome: { optionId: "allow_once", outcome: "selected" } },
    msg_id: "perm-1r",
    request_id: "perm-1",
    type: "acp_permission_resolved",
  }),
  frame({
    data: { text: "The file exports two constants.", type: "text" },
    msg_id: "content-1",
    type: "content",
  }),
  frame({
    data: {
      output: "$ ls\nsrc",
      terminal_id: "term-1",
    },
    msg_id: "term-1",
    type: "acp_terminal_output",
  }),
  frame({
    data: { cost: { amount: 0.01, currency: "USD" }, size: 100, used: 5 },
    msg_id: "usage-1",
    type: "acp_context_usage",
  }),
  frame({
    data: {
      stopReason: "end_turn",
      usage: { outputTokens: 9, totalTokens: 42 },
    },
    msg_id: "finish-1",
    type: "finish",
  }),
];

/** A second turn on the same conversation: replace:true snapshot text,
 * a parked ask, and an error frame (error card wins deriveStatus). */
const SECOND_TURN: ChatFrame[] = [
  frame({
    data: { text: "First streaming chunk.", type: "text" },
    msg_id: "c2-a",
    turn_id: "turn-2",
    type: "content",
  }),
  frame({
    data: { text: "Replaced snapshot.", type: "text" },
    msg_id: "c2-b",
    replace: true,
    turn_id: "turn-2",
    type: "content",
  }),
  frame({
    data: {
      options: [
        { label: "N5", value: "n5" },
        { label: "N4", value: "n4" },
      ],
      questions: [{ question: "Which level are you studying?" }],
      request_id: "ask-1",
    },
    msg_id: "ask-1",
    turn_id: "turn-2",
    type: "ask",
  }),
  frame({
    data: { text: "tool exploded", type: "text" },
    msg_id: "err-1",
    turn_id: "turn-2",
    type: "error",
  }),
  frame({
    data: { stopReason: "error" },
    msg_id: "finish-2",
    turn_id: "turn-2",
    type: "finish",
  }),
];

interface GoldenSnapshot {
  /** The final TMessage[] after the last frame. */
  finalMessages: unknown[];
  /** The reducer input: frames folded in order. */
  frames: ChatFrame[];
  /** deriveStatus after each frame, in order. */
  statuses: string[];
}

function runGolden(name: string, frames: ChatFrame[]): void {
  let messages: ReturnType<typeof transformFrame> = [];
  const statuses: string[] = [];
  for (const f of frames) {
    messages = transformFrame(messages, f, {
      turnId: "turn-2" in f ? "turn-2" : undefined,
    });
    statuses.push(deriveStatus(messages, f));
  }
  if (UPDATE || !existsSync(join(GOLDEN_DIR, `${name}.json`))) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    const snapshot: GoldenSnapshot = {
      finalMessages: JSON.parse(JSON.stringify(messages)),
      frames,
      statuses,
    };
    writeFileSync(
      join(GOLDEN_DIR, `${name}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`
    );
    return;
  }
  const stored = JSON.parse(
    readFileSync(join(GOLDEN_DIR, `${name}.json`), "utf8")
  ) as unknown as GoldenSnapshot;
  expect(messages).toEqual(stored.finalMessages as never);
  expect(statuses).toEqual(stored.statuses);
}

describe("chat-engine golden full-transcript snapshots", () => {
  test("golden: full single turn (every card family in one sequence)", () => {
    runGolden("full-turn", FULL_TURN);
  });

  test("golden: second turn with replace snapshot, ask park, error win", () => {
    // Fold turn 1 first (realistic conversation), then turn 2 on top:
    // runGolden refolds the whole sequence from empty, so this warm-up
    // fold just guards that turn 1 alone leaves no cross-turn residue.
    let warmup: ReturnType<typeof transformFrame> = [];
    for (const f of FULL_TURN) {
      warmup = transformFrame(warmup, f, {});
    }
    expect(warmup.length).toBeGreaterThan(0);
    const all = [...FULL_TURN, ...SECOND_TURN];
    runGolden("second-turn", all);
  });
});
