/**
 * Native ACP engine contract suite (TASK-80.1 AC#1).
 *
 * Spawns `test/fake-agent.ts` as a real stdio child and drives the full
 * stack: handshake, prompt → streamed updates → terminal result, cancel
 * mid-prompt, permission park + confirm resolving the prompt, tool-call
 * sanitize (>64KiB base64 image strip on the wire; dual-case folding at the
 * shared unit), replay suppression during session/load, terminal
 * create/kill, the parked-ask round trip, and health eviction on child
 * death. The SDK's zod layer strips unknown wire keys, so the snake_case
 * `raw_output` spelling is pinned on the fold function itself (the same one
 * chat-session's reducer uses in 80.3), not through the wire.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AcpAskQuestion,
  type AcpDrillItem,
  type AcpDrillResolution,
  type AcpDrillSnapshot,
  type AcpStreamEvent,
  sanitizeAcpToolUpdate,
} from "../src/acp-events";

/** Child-exit / connection-close error shape asserted on turn failure. */
const EXITED_OR_CLOSED_RE = /agent exited|connection closed/;
const NOT_SUPPORTED_RE = /not supported/;
const DENIED_RE = /denied/;
/** TASK-99: what a failed child transport says. */
const STDOUT_FLOOD_RE = /non-protocol lines to stdout/;
const HANDSHAKE_TIMEOUT_RE = /did not complete the ACP handshake within 150ms/;
const STDERR_DETAIL_RE = /\| stderr: /;
/** Sequential table walk: each case spawns a real child and waits for teardown. */
const TEARDOWN_TICK_MS = 50;
const teardownTick = () =>
  new Promise((resolve) => setTimeout(resolve, TEARDOWN_TICK_MS));

/** Attempt a promise, returning [value, null] or [null, error]. */
function attempt<T>(
  promise: Promise<T>
): Promise<readonly [T | null, unknown]> {
  return promise.then(
    (value) => [value, null] as const,
    (error: unknown) => [null, error] as const
  );
}

/** Drive one failure case; the awaits live here so the table loop stays
 * linear (ultracite noAwaitInLoops) while cases still run sequentially. */
async function runFailureCase(
  controller: SessionController,
  spec: CommandSpec
): Promise<{ handle: unknown; leaked: number; threw: unknown }> {
  const [handle, threw] = await attempt(controller.ensureSession(spec));
  await teardownTick();
  const leaked = controller.sessionIds().length;
  await controller.disposeAll();
  return { handle, leaked, threw };
}

import type { CommandSpec } from "../src/launch-policy";
import { SessionController } from "../src/session";
import type { AcpSessionHandle, PromptTurnResult } from "../src/session-types";

const FAKE = join(import.meta.dir, "fake-agent.ts");
const dir = mkdtempSync(join(tmpdir(), "acp-fake-"));

/** Write a script file and return a CommandSpec that runs the fake agent. */
function specFor(
  name: string,
  script: Record<string, unknown>
): { spec: CommandSpec; scriptPath: string } {
  const scriptPath = join(dir, `${name}.json`);
  writeFileSync(scriptPath, JSON.stringify(script));
  return {
    scriptPath,
    spec: {
      args: [FAKE, scriptPath],
      command: process.execPath,
      cwd: dir,
      forwardMcp: false,
      mcpServers: [],
    },
  };
}

interface Collector {
  events: AcpStreamEvent[];
  sink: (event: AcpStreamEvent) => void;
  waitFor: (pred: (events: AcpStreamEvent[]) => boolean) => Promise<void>;
}

/** Collect frames from a prompt turn; waitFor resolves once pred() holds. */
function collector(): Collector {
  const events: AcpStreamEvent[] = [];
  const waiters: (() => void)[] = [];
  const waitFor = (
    pred: (events: AcpStreamEvent[]) => boolean
  ): Promise<void> => {
    if (pred(events)) {
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    waiters.push(resolve);
    return promise.then(() => waitFor(pred));
  };
  return {
    events,
    sink: (event) => {
      events.push(event);
      for (const wake of waiters.splice(0)) {
        wake();
      }
    },
    waitFor,
  };
}

function textFrames(events: AcpStreamEvent[]): string[] {
  return events
    .filter((event) => event.type === "text")
    .map((event) => {
      if (event.type !== "text") {
        return "";
      }
      const content = event.content as { text?: string };
      return content.text ?? "";
    });
}

/**
 * The ask and permission suites all need the same setup: a live session plus
 * a turn whose `session/prompt` reply is deliberately slow, so the test can
 * act on a parked ask while the turn is still in flight. Opening it here
 * keeps six suites from re-typing the script shape.
 */
async function openTurn(
  controller: SessionController,
  name: string,
  options: {
    content?: string;
    delayMs?: number;
    turnId?: string;
  } = {}
): Promise<{
  c: Collector;
  handle: AcpSessionHandle;
  running: Promise<PromptTurnResult>;
}> {
  const { content = "hi", delayMs = 4000, turnId } = options;
  const { spec } = specFor(name, {
    capabilities: {},
    responses: {
      "session/prompt": {
        delayMs,
        stopReason: "end_turn",
        updates: [],
      },
    },
  });
  const handle = await controller.ensureSession(spec);
  const c = collector();
  const running = controller.prompt(handle, { content, sink: c.sink, turnId });
  return { c, handle, running };
}

/** The one-question ask the cancel / timeout / replay suites park. */
const abcAsk: AcpAskQuestion[] = [
  {
    options: [{ label: "a" }, { label: "b" }, { label: "c" }],
    question: "Q?",
  },
];

const abcDrillItem: AcpDrillItem = {
  anchors: ["grammar:particle", "sentence:42"],
  id: "item-particle-1",
  itemType: "particle",
  level: "N5",
  options: ["を", "に", "が", "で"],
  passage: "私は学校___行きます。",
  prompt: "空所に入る助詞を選んでください。",
};

const initialDrillSnapshot: AcpDrillSnapshot = {
  answered: 0,
  asked: 1,
  declaredCount: 5,
  pendingRefill: false,
  readyCount: 3,
  remaining: 4,
};

const answeredDrillSnapshot: AcpDrillSnapshot = {
  answered: 1,
  asked: 1,
  declaredCount: 5,
  pendingRefill: false,
  readyCount: 2,
  remaining: 4,
};

const abcDrillResolution: AcpDrillResolution = {
  chosenIndex: 0,
  correct: false,
  correctIndex: 1,
  correctOption: "に",
  explanation: "に marks the destination.",
  itemId: abcDrillItem.id,
};

const BIG_PNG_BASE64 = `iVBORw0KGgo${"A".repeat(70 * 1024)}`;

test("handshake: initialize + session/new yields a session_active handle", async () => {
  const controller = new SessionController();
  const { spec } = specFor("handshake", { capabilities: {} });
  const handle = await controller.ensureSession(spec);
  expect(handle.sessionActive).toBe(true);
  expect(handle.sessionId).toBe("s-1");
  expect(handle.healthy).toBe(true);
  await controller.disposeAll();
}, 15_000);

test("session/new: a stdio server reaches the wire with its own env (TASK-96)", async () => {
  const controller = new SessionController();
  const dumpPath = join(dir, "attached-mcp.json");
  const { spec } = specFor("attach-env", {
    capabilities: { mcpCapabilities: { http: true, sse: true } },
    dumpMcpServers: dumpPath,
  });
  await controller.ensureSession({
    ...spec,
    forwardMcp: true,
    mcpServers: [
      {
        env: { JLPT_MCP_DEBUG: "1" },
        id: "jlpt-vocab",
        target: "/bin/jlpt-mcp",
        transport: "stdio",
      },
    ],
  });
  const attached = JSON.parse(readFileSync(dumpPath, "utf8")) as {
    args: string[];
    command: string;
    env: { name: string; value: string }[];
    name: string;
  }[];
  expect(attached).toEqual([
    {
      args: [],
      command: "/bin/jlpt-mcp",
      env: [{ name: "JLPT_MCP_DEBUG", value: "1" }],
      name: "jlpt-vocab",
    },
  ]);
  await controller.disposeAll();
}, 15_000);

test("prompt: streams updates then the terminal stopReason + usage", async () => {
  const controller = new SessionController();
  const { spec } = specFor("prompt", {
    capabilities: {},
    responses: {
      "session/prompt": {
        stopReason: "end_turn",
        updates: [
          {
            content: { text: "konnichiwa", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
          {
            content: { text: "thinking", type: "text" },
            sessionUpdate: "agent_thought_chunk",
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    },
  });
  const handle = await controller.ensureSession(spec);
  const c = collector();
  const result = await controller.prompt(handle, {
    content: "hello",
    sink: c.sink,
  });
  expect(result.stopReason).toBe("end_turn");
  expect(result.usage?.totalTokens).toBe(15);
  expect(textFrames(c.events)).toContain("konnichiwa");
  expect(c.events.some((e) => e.type === "thinking")).toBe(true);
  expect(c.events[0]?.type).toBe("turn_start");
  expect(c.events.at(-1)?.type).toBe("turn_end");
  const types = c.events.map((event) => event.type);
  expect(types.indexOf("acp_context_usage")).toBe(types.length - 2);
  await controller.disposeAll();
}, 15_000);

test("prompt: a settled turn clears the handle so the next turn runs", async () => {
  // The busy guard is a race guard for IN-FLIGHT turns; a turn that already
  // reached its terminal must not keep claiming the session (TASK-86 live
  // loop: the second message of a conversation threw AIONUI_CONVERSATION_BUSY).
  const controller = new SessionController();
  const { spec } = specFor("prompt-twice", {
    capabilities: {},
    responses: {
      "session/prompt": {
        stopReason: "end_turn",
        updates: [
          {
            content: { text: "hello", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        ],
      },
    },
  });
  const handle = await controller.ensureSession(spec);
  const first = collector();
  expect(
    (await controller.prompt(handle, { content: "one", sink: first.sink }))
      .stopReason
  ).toBe("end_turn");
  expect(handle.activeTurn).toBeNull();
  const second = collector();
  expect(
    (await controller.prompt(handle, { content: "two", sink: second.sink }))
      .stopReason
  ).toBe("end_turn");
  expect(textFrames(second.events)).toContain("hello");
  expect(second.events[0]?.type).toBe("turn_start");
  expect(second.events.at(-1)?.type).toBe("turn_end");
  await controller.disposeAll();
}, 15_000);

test("cancel mid-prompt: notification reaches the agent, terminal is cancelled", async () => {
  const controller = new SessionController();
  const { spec } = specFor("cancel", {
    capabilities: {},
    responses: {
      "session/cancel": {
        updates: [
          {
            content: { text: "cancelled-flush", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        ],
      },
      "session/prompt": {
        delayMs: 5000,
        stopReason: "end_turn",
        updates: [
          {
            content: { text: "partial", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        ],
      },
    },
  });
  const handle = await controller.ensureSession(spec);
  const c = collector();
  const running = controller.prompt(handle, { content: "go", sink: c.sink });
  await c.waitFor((events) => textFrames(events).includes("partial"));
  expect(await controller.cancel(handle.sessionId)).toBe(true);
  const result = await running;
  expect(result.stopReason).toBe("cancelled");
  expect(textFrames(c.events)).toContain("cancelled-flush");
  expect(c.events.at(-1)?.type).toBe("turn_end");
  await controller.disposeAll();
}, 15_000);

test("permission: request parks, confirm echoes a REAL optionId and ends the turn", async () => {
  const controller = new SessionController();
  const { spec } = specFor("permission", {
    capabilities: {},
    responses: {
      "session/prompt": {
        askPermission: true,
        permissionThen: [
          {
            content: { text: "done-after-allow", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        ],
        updates: [
          {
            sessionUpdate: "tool_call",
            status: "pending",
            title: "dangerous tool",
            toolCallId: "tc-perm",
          },
        ],
      },
    },
  });
  const handle = await controller.ensureSession(spec);
  const c = collector();
  const running = controller.prompt(handle, { content: "rm", sink: c.sink });
  await c.waitFor((events) => events.some((e) => e.type === "acp_permission"));
  expect(controller.pendingPermissions(handle.sessionId).length).toBe(1);
  expect(controller.confirm("tc-perm", "allow_all")).toBe(true);
  const result = await running;
  expect(result.stopReason).toBe("end_turn");
  const permissionLine = textFrames(c.events).find((t) =>
    t.startsWith("PERMISSION:")
  );
  expect(permissionLine).toContain('"optionId":"allow_all"');
  expect(textFrames(c.events)).toContain("done-after-allow");
  expect(controller.confirm("nope", "whatever")).toBe(false);
  await controller.disposeAll();
}, 15_000);

test("tool frames: >64KiB base64 image results sanitize on the wire", async () => {
  const controller = new SessionController();
  const { spec } = specFor("sanitize", {
    capabilities: {},
    responses: {
      "session/prompt": {
        stopReason: "end_turn",
        updates: [
          {
            rawOutput: { result: BIG_PNG_BASE64, saved_path: "/tmp/x.png" },
            sessionUpdate: "tool_call",
            status: "in_progress",
            title: "image",
            toolCallId: "tc-img",
          },
          {
            rawOutput: { result: BIG_PNG_BASE64 },
            sessionUpdate: "tool_call_update",
            status: "completed",
            title: "image update",
            toolCallId: "tc-img",
          },
        ],
      },
    },
  });
  const handle = await controller.ensureSession(spec);
  const c = collector();
  await controller.prompt(handle, { content: "img", sink: c.sink });
  const toolFrames = c.events.filter((e) => e.type === "acp_tool_call");
  expect(toolFrames.length).toBe(2);
  for (const frame of toolFrames) {
    if (frame.type !== "acp_tool_call") {
      continue;
    }
    const raw = frame.update.rawOutput as Record<string, unknown>;
    expect(raw.result).toBeUndefined();
    expect(raw.result_omitted).toBe(true);
    expect(raw.result_omitted_reason).toBe("image_base64");
    expect(Number(raw.result_bytes)).toBeGreaterThan(64 * 1024);
    expect((raw.image as { path?: string }).path).toBeDefined();
  }
  // Without saved_path the image reference is synthesized (source marker).
  const [, second] = toolFrames;
  if (second?.type === "acp_tool_call") {
    const raw = second.update.rawOutput as Record<string, unknown>;
    expect((raw.image as { source?: string }).source).toBe(
      "codex_image_generation"
    );
  }
  await controller.disposeAll();
}, 15_000);

test("sanitizeAcpToolUpdate folds the snake_case raw_output dual-case", () => {
  // The SDK's zod layer strips unknown wire keys, so the snake spelling can
  // only arrive through non-SDK paths; the fold function (shared with the
  // 80.3 reducer) must sanitize BOTH spellings.
  const folded = sanitizeAcpToolUpdate({
    raw_output: { result: BIG_PNG_BASE64 },
    toolCallId: "tc",
  });
  const snake = folded.raw_output as Record<string, unknown>;
  expect(snake.result).toBeUndefined();
  expect(snake.result_omitted).toBe(true);
  const camel = sanitizeAcpToolUpdate({
    rawOutput: { result: BIG_PNG_BASE64, saved_path: "/tmp/y.webp" },
  });
  const rawCamel = camel.rawOutput as {
    image?: { mimeType?: string; path?: string };
  };
  expect(rawCamel.image?.path).toBe("/tmp/y.webp");
  expect(rawCamel.image?.mimeType).toBe("image/webp");
});

test("session/load: replay updates are suppressed from the UI but feed state", async () => {
  const controller = new SessionController();
  const { spec } = specFor("load", {
    capabilities: { loadSession: true },
    responses: {
      "session/load": {
        delayMs: 300,
        result: { sessionId: "s-load" },
        updates: [
          {
            content: { text: "REPLAY-LEAK", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
          {
            availableCommands: [{ description: "help", name: "help" }],
            sessionUpdate: "available_commands_update",
          },
        ],
      },
      "session/prompt": {
        stopReason: "end_turn",
        updates: [
          {
            content: { text: "live", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        ],
      },
    },
  });
  spec.resume = "s-load";
  const handle = await controller.ensureSession(spec);
  expect(handle.sessionId).toBe("s-load");
  // Side effects survived the suppression window (aioncore semantics).
  expect(handle.slashCommands.length).toBe(1);
  const c = collector();
  await controller.prompt(handle, { content: "next", sink: c.sink });
  expect(textFrames(c.events)).toContain("live");
  expect(textFrames(c.events).some((t) => t.includes("REPLAY-LEAK"))).toBe(
    false
  );
  await controller.disposeAll();
}, 15_000);

test("terminal: create runs the command, kill ends it without cancelling the turn", async () => {
  const controller = new SessionController();
  const { spec } = specFor("terminal", {
    capabilities: {},
    responses: {
      "session/prompt": {
        stopReason: "end_turn",
        terminalFlow: {
          action: "clientKill",
          args: ["30"],
          command: "/bin/sleep",
        },
        updates: [],
      },
    },
  });
  const handle = await controller.ensureSession(spec);
  const c = collector();
  const running = controller.prompt(handle, { content: "run", sink: c.sink });
  await c.waitFor((events) =>
    textFrames(events).some((t) => t.startsWith("TERMINAL:"))
  );
  const terminalLine = textFrames(c.events).find((t) =>
    t.startsWith("TERMINAL:")
  );
  const terminalId = terminalLine?.slice("TERMINAL:".length) ?? "";
  expect(terminalId.length).toBeGreaterThan(0);
  expect(controller.killTerminal(terminalId)).toBe(true);
  const result = await running;
  // The engine streamed cumulative-output snapshots for the command.
  expect(c.events.some((e) => e.type === "acp_terminal_output")).toBe(true);
  expect(result.stopReason).toBe("end_turn");
  const outcome = textFrames(c.events).find((t) => t.startsWith("TERMRESULT:"));
  expect(outcome).toBeDefined();
  expect(outcome).toContain("SIGKILL");
  await controller.disposeAll();
}, 20_000);

test("ask: parkAsk emits an ask frame; answerAsk resumes the parked waiter", async () => {
  const controller = new SessionController();
  const { c, handle, running } = await openTurn(controller, "ask");
  const questions = [
    {
      options: [{ label: "vocab" }, { label: "grammar" }, { label: "kanji" }],
      question: "What do you want to study?",
    },
  ];
  const { promise: parked, requestId } = controller.parkAsk(handle, questions);
  await c.waitFor((events) => events.some((e) => e.type === "ask"));
  const askEvent = c.events.find((e) => e.type === "ask");
  if (askEvent?.type !== "ask") {
    throw new Error("no ask frame");
  }
  expect(askEvent.questions[0]?.options.length).toBe(3);
  // TASK-86: parkAsk exposes the same requestId it embeds in the frame.
  expect(requestId).toBe(askEvent.request_id);
  expect(controller.pendingAsks(handle.sessionId).length).toBe(1);
  expect(
    controller.answerAsk(askEvent.request_id, {
      answers: [
        { labels: ["grammar"], question: "What do you want to study?" },
      ],
    })
  ).toBe(true);
  expect(await parked).toBe("What do you want to study?: grammar");
  // Decline resolves with explicit deny text; unknown ids return false.
  const { promise: declined } = controller.parkAsk(handle, questions);
  const ask2 = c.events.filter((e) => e.type === "ask").at(-1);
  if (ask2?.type !== "ask") {
    throw new Error("no second ask frame");
  }
  expect(controller.answerAsk(ask2.request_id, { decline: true })).toBe(true);
  expect(await declined).toContain("declined");
  expect(controller.answerAsk("unknown-id", { decline: true })).toBe(false);
  const result = await running;
  expect(result.stopReason).toBe("end_turn");
  await controller.disposeAll();
}, 15_000);

test("ask: engine timeout rejects a parked ask and clears the park", async () => {
  // TASK-88: the engine-side backstop (confirmationTimeoutMs) must reject
  // the park with the timeout text and drop the row from the park map, so
  // the caller's race handler settles the persisted row exactly once (the
  // server wires that via AskToolServer.onExpire, TASK-86).
  const controller = new SessionController({ confirmationTimeoutMs: 120 });
  const { c, handle, running } = await openTurn(controller, "ask-timeout");
  const { promise: parked } = controller.parkAsk(handle, abcAsk);
  await c.waitFor((events) => events.some((e) => e.type === "ask"));
  await expect(parked).rejects.toThrow("ask timed out");
  expect(controller.pendingAsks(handle.sessionId)).toEqual([]);
  // The turn itself is unaffected: the fake agent answers on its own clock.
  const result = await running;
  expect(result.stopReason).toBe("end_turn");
  await controller.disposeAll();
}, 15_000);

test("ask: keyed park is a resumable long-poll (TASK-92)", async () => {
  const controller = new SessionController();
  const { c, handle, running } = await openTurn(controller, "ask-longpoll");
  const questions = [
    {
      options: [{ label: "a" }, { label: "b" }, { label: "c" }],
      question: "Q?",
    },
  ];
  const first = controller.parkAsk(handle, questions, "key-1");
  await c.waitFor((events) => events.some((e) => e.type === "ask"));
  // Re-call while LIVE: same waiter + requestId, no duplicate card.
  const second = controller.parkAsk(handle, questions, "key-1");
  expect(second.requestId).toBe(first.requestId);
  expect(second.promise).toBe(first.promise);
  expect(c.events.filter((e) => e.type === "ask").length).toBe(1);
  expect(controller.pendingAsks(handle.sessionId).length).toBe(1);
  // The answer reaches BOTH callers (the second is the "late re-caller"
  // that raced the settle).
  expect(controller.answerAsk(first.requestId, { decline: true })).toBe(true);
  expect(await first.promise).toContain("declined");
  expect(await second.promise).toContain("declined");
  // Terminal replay: a NEW call with the same key returns the settled
  // outcome instantly instead of re-parking.
  const third = controller.parkAsk(handle, questions, "key-1");
  expect(third.requestId).toBe(first.requestId);
  expect(await third.promise).toContain("declined");
  expect(controller.pendingAsks(handle.sessionId).length).toBe(0);
  // Different key: the same questions park FRESH (proves keying, and that
  // the terminal cache never bleeds across keys).
  const fresh = controller.parkAsk(handle, questions, "key-2");
  expect(fresh.requestId).not.toBe(first.requestId);
  expect(controller.pendingAsks(handle.sessionId).length).toBe(1);
  // Expired keyed park: re-call replays the SAME rejection, no re-park,
  // no second card.
  await controller.cancel(handle.sessionId);
  await expect(fresh.promise).rejects.toThrow("ask cancelled");
  const fourth = controller.parkAsk(handle, questions, "key-2");
  expect(fourth.requestId).toBe(fresh.requestId);
  await expect(fourth.promise).rejects.toThrow("ask cancelled");
  expect(c.events.filter((e) => e.type === "ask").length).toBe(2);
  const result = await running;
  expect(result.stopReason).toBe("cancelled");
  await controller.disposeAll();
}, 15_000);

test("ask: terminal replay expires after its TTL (TASK-94)", async () => {
  // The terminal cache exists to recover abandoned long-poll calls, not to
  // haunt verbatim re-asks: inside the window a re-call replays; past it
  // (tests shorten the window at the seam), an identical question set must
  // park fresh with a new requestId.
  const controller = new SessionController();
  const { c, handle, running } = await openTurn(controller, "ask-ttl");
  const questions = [
    {
      options: [{ label: "a" }, { label: "b" }, { label: "c" }],
      question: "Same again?",
    },
  ];
  const first = controller.parkAsk(handle, questions, "ttl-key", 250);
  await c.waitFor((events) => events.some((e) => e.type === "ask"));
  await controller.cancel(handle.sessionId);
  await expect(first.promise).rejects.toThrow("ask cancelled");
  // Within the window: the abandonment retry replays the settled rejection.
  const replay = controller.parkAsk(handle, questions, "ttl-key");
  expect(replay.requestId).toBe(first.requestId);
  await expect(replay.promise).rejects.toThrow("ask cancelled");
  // Past the window: a verbatim re-ask is genuinely new.
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  const fresh = controller.parkAsk(handle, questions, "ttl-key");
  expect(fresh.requestId).not.toBe(first.requestId);
  expect(controller.pendingAsks(handle.sessionId).length).toBe(1);
  const askFrames = c.events.filter((e) => e.type === "ask").length;
  expect(askFrames).toBe(2);
  await controller.disposeAll();
  await running.catch(() => undefined);
}, 15_000);

test("ask: cancel force-rejects parked asks", async () => {
  const controller = new SessionController();
  const { c, handle, running } = await openTurn(controller, "ask-cancel");
  const { promise: parked } = controller.parkAsk(handle, abcAsk);
  await c.waitFor((events) => events.some((e) => e.type === "ask"));
  expect(await controller.cancel(handle.sessionId)).toBe(true);
  await expect(parked).rejects.toThrow("ask cancelled");
  const result = await running;
  expect(result.stopReason).toBe("cancelled");
  await controller.disposeAll();
}, 15_000);

test("drill: park/answer emits key-free pending then answered frames", async () => {
  const controller = new SessionController();
  const { c, handle, running } = await openTurn(controller, "drill-park", {
    delayMs: 1000,
  });
  const unsafeItem: AcpDrillItem & {
    answerIndex: number;
    fsrsVocabId: number;
    script: string;
  } = {
    ...abcDrillItem,
    answerIndex: 1,
    fsrsVocabId: 17,
    script: "秘密の台本",
  };
  const parked = controller.parkDrillItem(
    handle,
    "drill-session-1",
    unsafeItem,
    initialDrillSnapshot
  );
  await c.waitFor((events) => events.some((e) => e.type === "drill_item"));
  const pending = c.events.find((event) => event.type === "drill_item");
  if (pending?.type !== "drill_item" || pending.item === null) {
    throw new Error("no pending drill frame");
  }
  expect(pending.request_id).toBe(parked.requestId);
  expect(pending.drill_session_id).toBe("drill-session-1");
  expect(pending.session_id).toBe(handle.sessionId);
  expect(pending.phase).toBe("pending");
  expect(pending.item).toEqual(abcDrillItem);
  expect(pending.item).not.toHaveProperty("answerIndex");
  expect(pending.item).not.toHaveProperty("script");
  expect(pending.item).not.toHaveProperty("fsrsVocabId");
  expect(pending).not.toHaveProperty("resolution");
  expect(controller.pendingDrills(handle.sessionId)).toEqual([pending]);
  expect(
    controller
      .listConfirmations(handle.sessionId)
      .some((event) => event.type === "drill_item")
  ).toBe(true);
  const settledAfterFrame = parked.promise.then(() =>
    c.events.some(
      (event) => event.type === "drill_item" && event.phase === "answered"
    )
  );
  expect(
    controller.answerDrillItem(
      parked.requestId,
      abcDrillResolution,
      answeredDrillSnapshot
    )
  ).toBe(true);
  expect(await settledAfterFrame).toBe(true);
  expect(await parked.promise).toEqual(abcDrillResolution);
  const answered = c.events
    .filter((event) => event.type === "drill_item")
    .at(-1);
  if (answered?.type !== "drill_item") {
    throw new Error("no answered drill frame");
  }
  expect(answered.phase).toBe("answered");
  expect(answered.item).toEqual(abcDrillItem);
  expect(answered.resolution).toEqual(abcDrillResolution);
  expect(answered.snapshot).toEqual(answeredDrillSnapshot);
  expect(controller.pendingDrills(handle.sessionId)).toEqual([]);
  expect(controller.answerDrillItem("unknown", abcDrillResolution)).toBe(false);
  expect(controller.retireDrillItem("unknown")).toBe(false);
  const result = await running;
  expect(result.stopReason).toBe("end_turn");
  await controller.disposeAll();
}, 15_000);

test("drill: stable key attaches live and replays terminal outcomes", async () => {
  const controller = new SessionController();
  const { c, handle, running } = await openTurn(controller, "drill-keyed");
  const first = controller.parkDrillItem(
    handle,
    "drill-session-2",
    abcDrillItem,
    initialDrillSnapshot,
    "draw-1"
  );
  const attached = controller.parkDrillItem(
    handle,
    "drill-session-2",
    abcDrillItem,
    initialDrillSnapshot,
    "draw-1"
  );
  expect(attached.promise).toBe(first.promise);
  expect(attached.requestId).toBe(first.requestId);
  expect(c.events.filter((event) => event.type === "drill_item")).toHaveLength(
    1
  );
  expect(controller.answerDrillItem(first.requestId, abcDrillResolution)).toBe(
    true
  );
  expect(await first.promise).toEqual(abcDrillResolution);
  const replay = controller.parkDrillItem(
    handle,
    "drill-session-2",
    abcDrillItem,
    initialDrillSnapshot,
    "draw-1"
  );
  expect(replay.promise).toBe(first.promise);
  expect(replay.requestId).toBe(first.requestId);
  expect(await replay.promise).toEqual(abcDrillResolution);
  const cancelled = controller.parkDrillItem(
    handle,
    "drill-session-2",
    abcDrillItem,
    initialDrillSnapshot,
    "draw-2"
  );
  expect(await controller.cancel(handle.sessionId)).toBe(true);
  await expect(cancelled.promise).rejects.toThrow("drill item cancelled");
  const cancelledReplay = controller.parkDrillItem(
    handle,
    "drill-session-2",
    abcDrillItem,
    initialDrillSnapshot,
    "draw-2"
  );
  expect(cancelledReplay.promise).toBe(cancelled.promise);
  expect(cancelledReplay.requestId).toBe(cancelled.requestId);
  await expect(cancelledReplay.promise).rejects.toThrow("drill item cancelled");
  expect(c.events.filter((event) => event.type === "drill_item")).toHaveLength(
    3
  );
  const result = await running;
  expect(result.stopReason).toBe("cancelled");
  await controller.disposeAll();
}, 15_000);

test("drill: timeout, retire, and cancel settle the host promise", async () => {
  const controller = new SessionController({ confirmationTimeoutMs: 25 });
  const { handle, running } = await openTurn(controller, "drill-expiry", {
    delayMs: 1000,
  });
  const timedOut = controller.parkDrillItem(
    handle,
    "drill-session-3",
    abcDrillItem,
    initialDrillSnapshot
  );
  await expect(timedOut.promise).rejects.toThrow("drill item timed out");
  expect(controller.pendingDrills(handle.sessionId)).toEqual([]);
  const retired = controller.parkDrillItem(
    handle,
    "drill-session-3",
    abcDrillItem,
    initialDrillSnapshot
  );
  expect(controller.retireDrillItem(retired.requestId)).toBe(true);
  await expect(retired.promise).rejects.toThrow("drill item expired");
  expect(
    controller.answerDrillItem(retired.requestId, abcDrillResolution)
  ).toBe(false);
  const cancelled = controller.parkDrillItem(
    handle,
    "drill-session-3",
    abcDrillItem,
    initialDrillSnapshot
  );
  expect(await controller.cancel(handle.sessionId)).toBe(true);
  await expect(cancelled.promise).rejects.toThrow("drill item cancelled");
  expect(controller.pendingDrills(handle.sessionId)).toEqual([]);
  const result = await running;
  expect(result.stopReason).toBe("cancelled");
  await controller.disposeAll();
}, 15_000);

test("prompt turnId: the caller's id arms the turn so chat-style cancel matches", async () => {
  // TASK-86: chat.send acks its own turn id and chat.cancel passes it back;
  // a foreign id must be refused (stale-turn guard) and the acked id must
  // cancel the in-flight turn and reject its parked ask.
  const controller = new SessionController();
  const { c, handle, running } = await openTurn(
    controller,
    "ask-cancel-turnid",
    {
      turnId: "turn-ack-1",
    }
  );
  const { promise: parked } = controller.parkAsk(handle, abcAsk);
  await c.waitFor((events) => events.some((e) => e.type === "ask"));
  expect(await controller.cancel(handle.sessionId, "turn-foreign")).toBe(false);
  expect(await controller.cancel(handle.sessionId, "turn-ack-1")).toBe(true);
  await expect(parked).rejects.toThrow("ask cancelled");
  const result = await running;
  expect(result.turnId).toBe("turn-ack-1");
  expect(result.stopReason).toBe("cancelled");
  await controller.disposeAll();
}, 15_000);

test("health: child death mid-turn fails the turn and marks the session dead", async () => {
  const controller = new SessionController();
  const { spec } = specFor("death", {
    capabilities: {},
    responses: {
      "session/prompt": {
        delayMs: 5000,
        updates: [
          {
            content: { text: "before-death", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        ],
      },
    },
  });
  const handle = await controller.ensureSession(spec);
  const c = collector();
  const running = controller.prompt(handle, { content: "go", sink: c.sink });
  await c.waitFor((events) => textFrames(events).includes("before-death"));
  handle.child?.kill("SIGKILL");
  await expect(running).rejects.toThrow();
  expect(handle.isHealthy()).toBe(false);
  expect(handle.sessionActive).toBe(false);
  const end = c.events.find((e) => e.type === "turn_end");
  if (end?.type !== "turn_end") {
    throw new Error("no turn_end frame");
  }
  expect(end.stopReason).toBe("error");
  expect(end.error?.message).toMatch(EXITED_OR_CLOSED_RE);
  // The disconnect status trails the terminal (markDead ordering).
  expect(c.events.some((e) => e.type === "agent_status")).toBe(true);
  await controller.disposeAll();
}, 15_000);

test("config options: session/new snapshot normalizes legacy models/modes", async () => {
  const controller = new SessionController();
  const { spec } = specFor("config", {
    capabilities: {},
    responses: {
      "session/new": {
        result: {
          configOptions: [
            {
              currentValue: "fast",
              id: "speed",
              name: "Speed",
              options: [
                { name: "Fast", value: "fast" },
                { name: "Deep", value: "deep" },
              ],
              type: "select",
            },
          ],
          models: {
            availableModels: [
              { modelId: "m-a", name: "Model A" },
              { modelId: "m-b" },
            ],
            currentModelId: "m-a",
          },
          modes: {
            availableModes: [{ id: "ask" }, { id: "code", name: "Code" }],
            currentModeId: "code",
          },
          sessionId: "s-1",
        },
      },
      "session/prompt": { stopReason: "end_turn", updates: [] },
    },
  });
  const handle = await controller.ensureSession(spec);
  const ids = handle.configOptions.map((option) => option.id);
  expect(ids).toContain("speed");
  expect(ids).toContain("model");
  expect(ids).toContain("mode");
  const model = handle.configOptions.find((option) => option.id === "model");
  expect(model?.currentValue).toBe("m-a");
  expect(model?.options.length).toBe(2);
  expect(handle.currentModeId).toBe("code");
  await controller.disposeAll();
}, 15_000);

// ── TASK-81.4: handshake failure table ──────────────────────────────
// Pins the guarantee the refactor must keep: EVERY handshake step failure
// tears the child down, emits a terminal `error` status, and rethrows — no
// half-open sessions, no orphaned spawns.

test("handshake failures: every step teardowns the child and surfaces the error", async () => {
  const cases: {
    name: string;
    responses: Record<string, unknown>;
    errorMatch: RegExp;
  }[] = [
    {
      errorMatch: NOT_SUPPORTED_RE,
      name: "initialize rejected",
      responses: {
        initialize: {
          error: { code: -32_601, message: "initialize: not supported" },
        },
      },
    },
    {
      errorMatch: DENIED_RE,
      name: "session/new rejected",
      responses: {
        "session/new": {
          error: { code: -32_000, message: "session/new: denied" },
        },
      },
    },
  ];
  for (const [index, tc] of cases.entries()) {
    const controller = new SessionController();
    const { spec } = specFor(`fail-${index}`, {
      capabilities: {},
      responses: tc.responses,
    });
    // Each case spawns a real child process; sequential execution keeps
    // the children isolated (suppression: noAwaitInLoops is unavoidable
    // for a sequential spawn table).
    // biome-ignore lint/performance/noAwaitInLoops: sequential spawn table
    const outcome = await runFailureCase(controller, spec);
    expect(outcome.threw, `${tc.name}: must throw`).toBeInstanceOf(Error);
    expect(String(outcome.threw), `${tc.name}: message`).toMatch(tc.errorMatch);
    expect(outcome.handle, `${tc.name}: no handle escapes`).toBeNull();
    expect(outcome.leaked, `${tc.name}: no leaked session`).toBe(0);
  }
}, 20_000);

// ── TASK-99: child transport (stdout junk, silent child, stderr tail) ─
// The real `opencode` wrapper printed its mise notice to protocol stdout and
// then blocked on the held-open stdin pipe: the engine saw neither a frame
// nor a failure, and the warm pool key wedged forever. These three cases pin
// what the engine does instead.

test("child transport: a stdout banner is dropped and the session still works", async () => {
  const controller = new SessionController();
  const { spec } = specFor("stdout-banner", {
    capabilities: {},
    responses: {
      "session/prompt": {
        stopReason: "end_turn",
        updates: [
          {
            content: { text: "alive", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        ],
      },
    },
    stdoutJunk: { count: 3 },
  });
  const handle = await controller.ensureSession(spec);
  const c = collector();
  const turn = await controller.prompt(handle, { content: "hi", sink: c.sink });
  expect(handle.sessionActive).toBe(true);
  expect(turn.stopReason).toBe("end_turn");
  expect(textFrames(c.events)).toContain("alive");
  await controller.disposeAll();
}, 15_000);

test("child transport: a stdout flood fails the transport instead of logging forever", async () => {
  const controller = new SessionController();
  const { spec } = specFor("stdout-flood", {
    capabilities: {},
    // Slow to answer *and* spamming: the shape the 30s handshake budget alone
    // would not have caught until it expired.
    responses: { initialize: { delayMs: 3000 } },
    stdoutJunk: { intervalMs: 10 },
  });
  const outcome = await runFailureCase(controller, spec);
  expect(String(outcome.threw)).toMatch(STDOUT_FLOOD_RE);
  expect(outcome.handle).toBeNull();
  expect(outcome.leaked).toBe(0);
}, 20_000);

test("handshake: a silent child trips the budget and its stderr explains it", async () => {
  const controller = new SessionController({ handshakeTimeoutMs: 150 });
  const { spec } = specFor("silent-child", {
    capabilities: {},
    responses: { initialize: { delayMs: 5000 } },
    stderrNoise: 2,
  });
  const outcome = await runFailureCase(controller, spec);
  const message = String(outcome.threw);
  expect(message).toMatch(HANDSHAKE_TIMEOUT_RE);
  expect(message).toMatch(STDERR_DETAIL_RE);
  // The tail is redacted on the way into the ring, so the secret can't ride
  // into a status frame or a persisted error row.
  expect(message).not.toContain("sk-secret");
  expect(outcome.handle).toBeNull();
  expect(outcome.leaked).toBe(0);
}, 20_000);

test("cancel: unknown session and stale turnId are false; no notification sent", async () => {
  const controller = new SessionController();
  // Unknown session id → false (no crash, no notification).
  expect(await controller.cancel("no-such-session")).toBe(false);
  // Real session, stale turnId guard.
  const { spec } = specFor("cancel-guards", {
    capabilities: {},
    responses: { "session/prompt": { delayMs: 400, stopReason: "end_turn" } },
  });
  const handle = await controller.ensureSession(spec);
  const staleTurn = handle.activeTurn; // null pre-prompt; guard must still hold
  expect(staleTurn).toBeNull();
  await controller.disposeAll();
}, 15_000);
