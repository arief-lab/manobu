/**
 * Golden-frame coverage for the session-update translator (TASK-81 AC#2).
 *
 * Pins the CURRENT output of `translateSessionUpdate` for every ACP
 * `sessionUpdate` family (plus the defensive dual-case and unknown-variant
 * paths) so the TASK-81.1 table-driven refactor cannot change the wire.
 * One JSON file per case under `test/goldens/translator/`; the file holds
 * the inbound notification AND the expected emitted frame plus the handle
 * state the translator mutates (slashCommands/currentModeId/configOptions).
 *
 * Regenerate intentionally-changed goldens with:
 *   UPDATE_GOLDENS=1 bun test test/translator-golden.test.ts
 * (review the diff — regeneration is a contract change, not a test fix.)
 */

import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { translateSessionUpdate } from "../src/session-translator";
import { AcpSessionHandle } from "../src/session-types";

const GOLDEN_DIR = join(import.meta.dir, "goldens", "translator");
const UPDATE = process.env.UPDATE_GOLDENS === "1";

interface GoldenCase {
  /** The single frame the translator must emit. */
  expectedFrame: Record<string, unknown>;
  /** Handle fields the translator mutates as a side effect. */
  expectedHandle?: {
    configOptions?: unknown[];
    currentModeId?: string | null;
    slashCommands?: unknown[];
  };
  /** The inbound session/notification update payload (wire shape). */
  notification: { update: Record<string, unknown> };
}

function runCase(name: string, raw: GoldenCase): void {
  const handle = new AcpSessionHandle("golden-agent");
  handle.sessionId = "ses-golden";
  const emitted: unknown[] = [];
  handle.lastSink = (event) => {
    emitted.push(event);
  };

  translateSessionUpdate(handle, raw.notification as never);

  if (UPDATE || !existsSync(join(GOLDEN_DIR, `${name}.json`))) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(
      join(GOLDEN_DIR, `${name}.json`),
      `${JSON.stringify(raw, null, 2)}\n`
    );
    return;
  }
  const stored = JSON.parse(
    readFileSync(join(GOLDEN_DIR, `${name}.json`), "utf8")
  ) as GoldenCase;
  expect(emitted).toHaveLength(1);
  expect(emitted[0]).toEqual(stored.expectedFrame);
  if (stored.expectedHandle?.slashCommands !== undefined) {
    expect([...handle.slashCommands]).toEqual(
      stored.expectedHandle.slashCommands
    );
  }
  if (stored.expectedHandle?.currentModeId !== undefined) {
    expect(handle.currentModeId).toBe(stored.expectedHandle.currentModeId);
  }
  if (stored.expectedHandle?.configOptions !== undefined) {
    expect(handle.configOptions).toEqual(stored.expectedHandle.configOptions);
  }
}

const NOTIFICATION = (update: Record<string, unknown>) => ({ update });

const CASES: Record<string, GoldenCase> = {
  agent_message_chunk: {
    expectedFrame: {
      content: { text: "hello", type: "text" },
      message_id: "msg-1",
      type: "text",
    },
    notification: NOTIFICATION({
      content: { text: "hello", type: "text" },
      messageId: "msg-1",
      sessionUpdate: "agent_message_chunk",
    }),
  },
  agent_message_chunk_no_id: {
    expectedFrame: {
      content: { text: "anon", type: "text" },
      message_id: null,
      type: "text",
    },
    notification: NOTIFICATION({
      content: { text: "anon", type: "text" },
      sessionUpdate: "agent_message_chunk",
    }),
  },
  agent_thought_chunk: {
    expectedFrame: {
      content: { text: "pondering", type: "text" },
      type: "thinking",
    },
    notification: NOTIFICATION({
      content: { text: "pondering", type: "text" },
      sessionUpdate: "agent_thought_chunk",
    }),
  },
  available_commands_update: {
    expectedFrame: "GOLDEN",
    expectedHandle: {
      slashCommands: [
        { description: "Review the diff", name: "review" },
        { input: { hint: "topic" }, name: "explain" },
      ],
    },
    notification: NOTIFICATION({
      availableCommands: [
        { description: "Review the diff", name: "review" },
        { input: { hint: "topic" }, name: "explain" },
      ],
      sessionUpdate: "available_commands_update",
    }),
  },
  config_option_update: {
    expectedFrame: "GOLDEN",
    expectedHandle: {
      configOptions: [
        {
          category: "model",
          currentValue: "opus",
          id: "model",
          name: "Model",
          options: [{ name: "Opus", value: "opus" }],
          type: "select",
        },
      ],
    },
    notification: NOTIFICATION({
      configOptions: [
        {
          category: "model",
          currentValue: "opus",
          id: "model",
          name: "Model",
          options: [{ name: "Opus", value: "opus" }],
          type: "select",
        },
      ],
      sessionUpdate: "config_option_update",
    }),
  },
  current_mode_update: {
    expectedFrame: {
      currentModeId: "code",
      type: "acp_mode_info",
    },
    expectedHandle: { currentModeId: "code" },
    notification: NOTIFICATION({
      currentModeId: "code",
      sessionUpdate: "current_mode_update",
    }),
  },
  plan: {
    expectedFrame: {
      entries: [
        { content: "step one", priority: "high", status: "completed" },
        { content: "step two", priority: "medium", status: "pending" },
      ],
      type: "plan",
    },
    notification: NOTIFICATION({
      entries: [
        { content: "step one", priority: "high", status: "completed" },
        { content: "step two", priority: "medium", status: "pending" },
      ],
      sessionUpdate: "plan",
    }),
  },
  session_info_update: {
    expectedFrame: {
      title: "My chat",
      type: "acp_session_info",
      updatedAt: "2026-09-20T00:00:00Z",
    },
    notification: NOTIFICATION({
      sessionUpdate: "session_info_update",
      title: "My chat",
      updatedAt: "2026-09-20T00:00:00Z",
    }),
  },
  tool_call_full: {
    expectedFrame: "GOLDEN",
    notification: NOTIFICATION({
      content: [
        { content: { text: "listing", type: "text" }, type: "content" },
      ],
      kind: "read",
      rawInput: { path: "/tmp/x" },
      rawOutput: "file-a\nfile-b",
      sessionUpdate: "tool_call",
      status: "completed",
      title: "ls /tmp/x",
      toolCallId: "call-1",
    }),
  },
  tool_call_minimal: {
    expectedFrame: "GOLDEN",
    notification: NOTIFICATION({
      sessionUpdate: "tool_call",
      toolCallId: "call-2",
    }),
  },
  tool_call_update_camel: {
    expectedFrame: "GOLDEN",
    notification: NOTIFICATION({
      rawOutput: "done",
      sessionUpdate: "tool_call_update",
      status: "completed",
      title: "ls",
      toolCallId: "call-1",
    }),
  },
  tool_call_update_snake_raw_output: {
    expectedFrame: "GOLDEN",
    notification: NOTIFICATION({
      raw_output: "snake-case-out",
      sessionUpdate: "tool_call_update",
      status: "completed",
      toolCallId: "call-3",
    }),
  },
  unknown_variant_opaque: {
    expectedFrame: {
      payload: {
        custom: "data",
        sessionUpdate: "brand_new_future_variant",
      },
      tag: "acp_update:brand_new_future_variant",
      type: "adapter_specific",
    },
    notification: NOTIFICATION({
      custom: "data",
      sessionUpdate: "brand_new_future_variant",
    }),
  },
  usage_update: {
    expectedFrame: {
      data: {
        cost: { amount: 0.42, currency: "USD" },
        size: 200_000,
        used: 630,
      },
      type: "acp_context_usage",
    },
    notification: NOTIFICATION({
      cost: { amount: 0.42, currency: "USD" },
      sessionUpdate: "usage_update",
      size: 200_000,
      used: 630,
    }),
  },
  user_message_chunk_suppressed: {
    expectedFrame: {
      payload: null,
      tag: "acp_update:user_message_chunk",
      type: "adapter_specific",
    },
    notification: NOTIFICATION({
      content: { text: "echo", type: "text" },
      sessionUpdate: "user_message_chunk",
    }),
  },
};

for (const [name, testCase] of Object.entries(CASES)) {
  test(`translator golden: ${name}`, () => {
    runCase(name, testCase);
  });
}

test("golden corpus is complete (every case has a stored file)", () => {
  const files = existsSync(GOLDEN_DIR)
    ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json"))
    : [];
  expect(files.length).toBe(Object.keys(CASES).length);
});
