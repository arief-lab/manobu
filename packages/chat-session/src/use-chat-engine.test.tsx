/**
 * TASK-80.3 — `useChatEngine` hook wiring tests.
 *
 * No DOM testing environment exists in this workspace (no @testing-library,
 * no jsdom, no happy-dom). The `useChatEngine` hook uses `useState` /
 * `useEffect` / `useRef` with an async `for-await` loop, which cannot be
 * exercised via SSR rendering (`renderToStaticMarkup` skips effects).
 *
 * This file tests the **fake client contract** that the hook injects —
 * the structural surface `ChatWsClient` requires — so that the e2e suite
 * (or a future DOM-backed test) can use the same fixture with confidence.
 * The hook's reducer integration (frames → `TMessage[]`) is covered by
 * the pure `chatEngine.test.ts`; the full lifecycle (mount → subscribe →
 * frame fold → status derivation) is pinned by the e2e chat tests in
 * apps/server once the WS link is up.
 *
 * If a DOM test env lands, replace this file with `renderHook` + `act`
 * using the same `makeFakeClient` helper.
 */

import { describe, expect, it, test } from "bun:test";
import type { ChatFrame } from "@manobu/api-contract";
import {
  beginRetryNotice,
  dropRetryingNotice,
  type FrameStatus,
  isRetryNoticeCard,
  type TMessage,
} from "./chat-engine";
import {
  type ChatWsClient,
  createFrameHandler,
  createRetryOrchestrator,
  dispatchSideState,
  runSubscribeLoop,
  type UseChatEngineOptions,
} from "./use-chat-engine";

// ── Frame fixture helpers ────────────────────────────────────────────────────

function contentFrame(
  text: string,
  extra?: Record<string, unknown>
): ChatFrame {
  return {
    conversation_id: "c1",
    data: { text, type: "text" },
    msg_id: "m1",
    type: "content",
    ...extra,
  } as unknown as ChatFrame;
}

function finishFrame(stopReason = "end_turn"): ChatFrame {
  return {
    conversation_id: "c1",
    data: { stopReason },
    msg_id: "m1",
    type: "finish",
  } as unknown as ChatFrame;
}

// ── Fake WS client ───────────────────────────────────────────────────────────

interface FakeClientOpts {
  /** If true, the first iterator throws after exhausting its frames
   * (simulates a socket drop → the hook resubscribes). */
  dropAfterFrames?: boolean;
  /** Frames to yield on the first `subscribe` call. */
  frames: ChatFrame[];
  /** Frames to yield on the second (resubscribe) call. */
  resubscribeFrames?: ChatFrame[];
}

interface FakeClient {
  cancelCalls: Array<{ conversationId: string; turnId: string }>;
  client: ChatWsClient;
  sendCalls: Array<{
    conversationId: string;
    messages: Array<{ content: string; role: string }>;
  }>;
  subscribeCalls: Array<{
    conversationId: string;
    lastEventId?: string;
  }>;
}

function makeFakeClient(opts: FakeClientOpts): FakeClient {
  const sendCalls: FakeClient["sendCalls"] = [];
  const cancelCalls: FakeClient["cancelCalls"] = [];
  const subscribeCalls: FakeClient["subscribeCalls"] = [];
  let subscribeCount = 0;

  const client = {
    chat: {
      cancel(input: { conversationId: string; turnId: string }) {
        cancelCalls.push({
          conversationId: input.conversationId,
          turnId: input.turnId,
        });
        return Promise.resolve({ cancelled: true });
      },
      send(input: {
        agent?: string;
        assistant?: string;
        conversationId: string;
        messages: Array<{ content: string; role: string }>;
        model?: string;
      }) {
        sendCalls.push({
          conversationId: input.conversationId,
          messages: input.messages,
        });
        return Promise.resolve({
          msg_id: "m-ack",
          runtime: {
            can_send_message: true,
            is_processing: true,
            pending_confirmations: 0,
            state: "processing",
            turn_id: "turn-1",
          },
          turn_id: "turn-1",
        });
      },
      subscribe(
        input: { conversationId: string },
        options?: { lastEventId?: string }
      ) {
        subscribeCalls.push({
          conversationId: input.conversationId,
          lastEventId: options?.lastEventId,
        });
        subscribeCount += 1;
        const frames =
          subscribeCount === 1 ? opts.frames : (opts.resubscribeFrames ?? []);
        const dropAfter = opts.dropAfterFrames && subscribeCount === 1;

        // An async iterator that yields the scripted frames.
        const iterator: AsyncIterable<ChatFrame> = {
          async *[Symbol.asyncIterator]() {
            for (const frame of frames) {
              // biome-ignore lint/performance/noAwaitInLoops: simulating real-time frame delivery via microtask yield.
              await Promise.resolve();
              yield frame;
            }
            if (dropAfter) {
              // Simulate a socket drop mid-stream: throwing here makes the
              // hook's `for await` catch block resubscribe with
              // `lastEventId` carried.
              throw new Error("socket dropped");
            }
          },
        };
        return iterator;
      },
    },
  } as ChatWsClient;

  return { cancelCalls, client, sendCalls, subscribeCalls };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("fake ChatWsClient contract (useChatEngine injection surface)", () => {
  test("subscribe yields a scripted frame sequence", async () => {
    const frames = [
      contentFrame("hello"),
      contentFrame(", world"),
      finishFrame(),
    ];
    const { client } = makeFakeClient({ frames });

    const iterator = await client.chat.subscribe({ conversationId: "c1" });
    const collected: ChatFrame[] = [];
    for await (const frame of iterator) {
      collected.push(frame);
    }
    expect(collected).toHaveLength(3);
    expect(collected[0]?.type).toBe("content");
    expect(collected[2]?.type).toBe("finish");
  });

  test("subscribe with dropAfterFrames throws after the scripted frames", async () => {
    const frames = [contentFrame("hi")];
    const { client } = makeFakeClient({
      dropAfterFrames: true,
      frames,
      resubscribeFrames: [],
    });

    const iterator = await client.chat.subscribe({ conversationId: "c1" });
    let threw = false;
    try {
      for await (const _ of iterator) {
        /* drain */
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("resubscribe carries lastEventId in the second call", async () => {
    const { client, subscribeCalls } = makeFakeClient({
      dropAfterFrames: true,
      frames: [contentFrame("first")],
      resubscribeFrames: [contentFrame("replayed")],
    });

    // First subscribe (no lastEventId):
    await client.chat.subscribe({ conversationId: "c1" });
    // Second subscribe with lastEventId (as the hook does on socket drop):
    await client.chat.subscribe(
      { conversationId: "c1" },
      { lastEventId: "ev-42" }
    );

    expect(subscribeCalls).toHaveLength(2);
    expect(subscribeCalls[0]?.lastEventId).toBeUndefined();
    expect(subscribeCalls[1]?.lastEventId).toBe("ev-42");
  });

  test("an idle clean close parks before resubscribing", async () => {
    const { client, subscribeCalls } = makeFakeClient({ frames: [] });
    let resolveWake: (() => void) | undefined;
    let stopped = false;
    const waitForWake = () =>
      new Promise<void>((resolve) => {
        resolveWake = resolve;
      });
    const loop = runSubscribeLoop(
      client,
      "c1",
      { current: null },
      () => stopped,
      waitForWake,
      () => undefined
    );
    const flush = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

    await flush();
    expect(subscribeCalls).toHaveLength(1);
    resolveWake?.();
    await flush();
    expect(subscribeCalls).toHaveLength(2);

    stopped = true;
    resolveWake?.();
    await loop;
  });

  test("send records the call and returns a turn ack", async () => {
    const { client, sendCalls } = makeFakeClient({ frames: [] });

    const ack = await client.chat.send({
      conversationId: "c1",
      messages: [{ content: "hello", role: "user" }],
    });
    expect(ack.turn_id).toBe("turn-1");
    expect(ack.msg_id).toBe("m-ack");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.conversationId).toBe("c1");
    expect(sendCalls[0]?.messages[0]?.content).toBe("hello");
    expect(sendCalls[0]?.messages[0]?.role).toBe("user");
  });

  test("cancel records the call and returns { cancelled: true }", async () => {
    const { client, cancelCalls } = makeFakeClient({ frames: [] });

    const result = await client.chat.cancel({
      conversationId: "c1",
      turnId: "turn-1",
    });
    expect(result.cancelled).toBe(true);
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]?.turnId).toBe("turn-1");
  });
});

// ── TASK-80.5: dispatchSideState (headless, no hook render) ─────────────
//
// The engine's frame loop fires the side-state callbacks on the two
// non-card frame types; `dispatchSideState` is the pure seam, so the
// callback contract is pinned here without a DOM env.

describe("dispatchSideState (TASK-80.5 side-state frames)", () => {
  const availableCommandsFrame = {
    conversation_id: "c1",
    created_at: 123,
    data: {
      commands: [{ description: "d", name: "review" }],
    },
    msg_id: "m1",
    type: "available_commands",
  } as unknown as ChatFrame;

  const configOptionFrame = {
    conversation_id: "c1",
    data: {
      configOptions: [
        {
          currentValue: "opus",
          id: "model",
          options: [{ value: "opus" }],
          type: "select",
        },
      ],
    },
    msg_id: "m1",
    type: "acp_config_option",
  } as unknown as ChatFrame;

  it("fires onAvailableCommands with the frame's commands + created_at version", () => {
    const calls: Array<{ commands: unknown[]; version: number }> = [];
    const opts: UseChatEngineOptions = {
      client: makeFakeClient({ frames: [] }).client,
      onAvailableCommands: (commands, version) => {
        calls.push({ commands, version });
      },
    };
    dispatchSideState(availableCommandsFrame, opts);
    expect(calls).toEqual([
      {
        commands: [{ description: "d", name: "review" }],
        version: 123,
      },
    ]);
  });

  it("falls back to version 0 when the frame has no created_at", () => {
    const frame = {
      ...availableCommandsFrame,
      created_at: undefined,
    } as unknown as ChatFrame;
    let version = -1; // sentinel: the callback overwrites it
    const opts: UseChatEngineOptions = {
      client: makeFakeClient({ frames: [] }).client,
      onAvailableCommands: (_commands, v) => {
        version = v;
      },
    };
    dispatchSideState(frame, opts);
    expect(version).toBe(0);
  });

  it("fires onConfigOptions with the frame's option list", () => {
    const received: unknown[] = [];
    const opts: UseChatEngineOptions = {
      client: makeFakeClient({ frames: [] }).client,
      onConfigOptions: (options) => {
        received.push(...options);
      },
    };
    dispatchSideState(configOptionFrame, opts);
    const { data } = configOptionFrame;
    if (!("configOptions" in data && Array.isArray(data.configOptions))) {
      throw new Error("config option frame lost its data");
    }
    expect(received).toEqual(data.configOptions);
  });

  it("a card frame fires neither callback", () => {
    let fired = 0;
    const opts: UseChatEngineOptions = {
      client: makeFakeClient({ frames: [] }).client,
      onAvailableCommands: () => {
        fired += 1;
      },
      onConfigOptions: () => {
        fired += 1;
      },
    };
    dispatchSideState(contentFrame("hi"), opts);
    expect(fired).toBe(0);
  });
});

// ── createFrameHandler: the handleFrame guard regression pin ──────────
//
// 2026-09-20: commit 585db4b inverted the stale-frame guard —
// `if (guard()) return;` instead of `if (!guard()) return;` — and every
// live frame was silently discarded (streaming status, empty transcript,
// zero errors). These tests drive frames through the REAL factory the
// hook uses, so the inversion fails here instead of only in the UI.

describe("createFrameHandler (handleFrame guard semantics)", () => {
  /** Harness mirroring the hook's wiring: React-style setters over plain
   * arrays so the factory's exact production shape is exercised. */
  function makeHarness(guard: () => boolean) {
    let messages: TMessage[] = [];
    let status: FrameStatus = "idle";
    const sideState: UseChatEngineOptions = {
      client: makeFakeClient({ frames: [] }).client,
      // Side-state callbacks aren't under test here; no-op bodies.
      onAvailableCommands: () => undefined,
      onConfigOptions: () => undefined,
    };
    const handler = createFrameHandler({
      guard,
      setMessages: (updater) => {
        messages = updater(messages);
      },
      setStatus: (next) => {
        status = next;
      },
      sideStateRef: { current: sideState },
      turnIdRef: { current: null },
    });
    return {
      handler,
      get messages() {
        return messages;
      },
      get status() {
        return status;
      },
    };
  }

  it("an ALIVE engine folds frames into messages (the inverted-guard killer)", () => {
    const h = makeHarness(() => true);
    h.handler(contentFrame("hello"));
    expect(h.messages.length).toBe(1);
    expect(h.messages[0]?.type).toBe("text");
    expect(h.status).toBe("streaming");
    h.handler(finishFrame());
    expect(h.status).toBe("idle");
  });

  it("a DISPOSED engine drops frames (stale loop must not fold)", () => {
    const h = makeHarness(() => false);
    h.handler(contentFrame("late frame"));
    h.handler(finishFrame());
    expect(h.messages.length).toBe(0);
    expect(h.status).toBe("idle");
  });

  it("folds incrementally: two content frames become one growing text card", () => {
    const h = makeHarness(() => true);
    h.handler(contentFrame("foo"));
    h.handler(contentFrame("bar"));
    expect(h.messages.length).toBe(1);
    expect(h.messages[0]?.type).toBe("text");
  });
});

// ── TASK-104: createRetryOrchestrator (the retry-once boundary) ─────────
//
// The AC#5 matrix, driven through the REAL handler + orchestrator the hook
// wires: one automatic recovery per learner send, no second attempt after
// that, non-retryable codes ending immediately, and the failed turn's
// paired terminal frame (the wire sends error AND finish per failure)
// never resurrecting the error. The fake client acks `turn_id: "turn-1"`
// for every send, so the retried turn's frames carry that id.

describe("createRetryOrchestrator (TASK-104 retry-once, AC#1/#3/#5)", () => {
  function makeRetryHarness() {
    let messages: TMessage[] = [];
    let status: FrameStatus = "idle";
    const turnIdRef = { current: null as string | null };
    const fake = makeFakeClient({ frames: [] });
    const orchestrator = createRetryOrchestrator({
      client: () => fake.client,
      guard: () => true,
      identity: () => ({ agent: "a", assistant: "p", model: "m" }),
      onDriveFailed: () => {
        messages = dropRetryingNotice(messages);
        status = "error";
      },
      onRetryStarted: (frame, reason) => {
        messages = beginRetryNotice(messages, frame, reason);
        status = "submitted";
      },
      onRetryStreaming: () => {
        status = "streaming";
      },
      setTurnId: (turnId) => {
        turnIdRef.current = turnId;
      },
    });
    const handler = createFrameHandler({
      consumeRetry: (frame) => orchestrator.consume(frame),
      guard: () => true,
      setMessages: (updater) => {
        messages = updater(messages);
      },
      setStatus: (next) => {
        status = next;
      },
      sideStateRef: { current: {} },
      turnIdRef,
    });
    return {
      fake,
      handler,
      messages: () => messages,
      orchestrator,
      status: () => status,
    };
  }

  function rateLimitFinish(turnId: string): ChatFrame {
    return {
      conversation_id: "c1",
      data: {
        error: { message: "Upstream returned 429: rate limit exceeded" },
        stopReason: "error",
      },
      msg_id: `fin-${turnId}`,
      turn_id: turnId,
      type: "finish",
    } as unknown as ChatFrame;
  }

  function errorFrameOf(turnId: string, text: string): ChatFrame {
    return {
      conversation_id: "c1",
      data: { text },
      msg_id: `err-${turnId}`,
      turn_id: turnId,
      type: "error",
    } as unknown as ChatFrame;
  }

  function turnContent(turnId: string, text: string, msgId: string): ChatFrame {
    return contentFrame(text, { msg_id: msgId, turn_id: turnId });
  }

  /** Let the fake send's ack microtasks run (adopt the retry turn id). */
  async function flushAcks() {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  it("retries a retryable error EXACTLY once: re-drive fires, error card does not", async () => {
    const h = makeRetryHarness();
    h.orchestrator.noteSend("explain keigo");
    // Turn t1 streams a partial answer, then fails twice-over (the wire's
    // error + finish pair) with a rate limit.
    h.handler(turnContent("t1", "partial answer", "m1"));
    h.handler(rateLimitFinish("t1"));
    expect(h.fake.sendCalls).toHaveLength(1);
    expect(h.fake.sendCalls[0]?.messages[0]?.content).toBe("explain keigo");
    expect(h.messages().some((card) => card.type === "error")).toBe(false);
    expect(h.messages().some(isRetryNoticeCard)).toBe(true);
    expect(h.status()).toBe("submitted");
    // The failed turn's PAIRED terminal frame is swallowed too:
    h.handler(errorFrameOf("t1", "Upstream returned 429: rate limit exceeded"));
    expect(h.fake.sendCalls).toHaveLength(1);
    expect(h.messages().some((card) => card.type === "error")).toBe(false);

    await flushAcks(); // the retry ack adopts turn "turn-1"
    // AC#4: the retried turn's output appends after the kept partial.
    h.handler(turnContent("turn-1", " keigo politely", "m2"));
    expect(h.messages().some((card) => card.type === "text")).toBe(true);
    // AC#5, second direction: a NEW failure on the retried turn gets NO
    // second re-drive; its real error card folds and supersedes the notice.
    h.handler(errorFrameOf("turn-1", "Upstream returned 429 again"));
    expect(h.fake.sendCalls).toHaveLength(1);
    expect(h.messages().some((card) => card.type === "error")).toBe(true);
    expect(h.messages().some(isRetryNoticeCard)).toBe(false);
    expect(h.status()).toBe("error");
  });

  it("a learner-action code ends the turn immediately with its reason (AC#3)", () => {
    const h = makeRetryHarness();
    h.orchestrator.noteSend("hello");
    h.handler({
      conversation_id: "c1",
      data: {
        error: { code: "AUTH_REQUIRED", message: "sign in again to continue" },
        stopReason: "error",
      },
      msg_id: "fin-t1",
      turn_id: "t1",
      type: "finish",
    } as unknown as ChatFrame);
    expect(h.fake.sendCalls).toHaveLength(0);
    const error = h.messages().find((card) => card.type === "error");
    expect(error && error.type === "error" && error.code).toBe("AUTH_REQUIRED");
    expect(h.status()).toBe("error");
  });

  it("a clean finish on the retried turn settles the notice to recovered (AC#2)", async () => {
    const h = makeRetryHarness();
    h.orchestrator.noteSend("why?");
    h.handler(rateLimitFinish("t1"));
    await flushAcks();
    h.handler(finishFrame()); // clean finish; fake ack id is "turn-1"
    // finishFrame carries no turn_id → the stale guard passes it through.
    const notice = h.messages().find(isRetryNoticeCard);
    expect(notice && notice.type === "retry_notice" && notice.state).toBe(
      "recovered"
    );
    expect(h.status()).toBe("idle");
    // The next learner send refills the budget (once PER TURN, not per
    // mount): a fresh retryable error re-drives again.
    h.orchestrator.noteSend("and again");
    h.handler(rateLimitFinish("t3"));
    expect(h.fake.sendCalls).toHaveLength(2);
  });

  it("frames before any send (history replay) never re-drive", () => {
    // The budget starts empty: a replayed stored error on (re)subscribe
    // must fold its history card, not fire an unsolicited turn.
    const h = makeRetryHarness();
    const consumed = h.orchestrator.consume(rateLimitFinish("t1"));
    expect(consumed).toBe(false);
    expect(h.fake.sendCalls).toHaveLength(0);
  });
});
