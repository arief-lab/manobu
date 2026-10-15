/**
 * TASK-86 ask-tool race contracts.
 *
 * Drives the registered `ask_user` tool through the real stateless
 * streamable-HTTP transport (`handleRequest`), the same seam the agent
 * child (or the stdio bridge) hits in production. Pins that every
 * no-answer outcome settles the parked row exactly once via `onExpire`
 * with the requestId the park exposed — the hook context.ts wires to
 * `settlePending(..., "error")` so dead asks stop replaying interactive.
 *
 * TASK-92 extends the coverage: the park receives a stable content key so
 * a re-call after a client abandonment attaches to the same ask, and an
 * answer that lands after the tool-side timeout still reaches the next
 * call's tool result.
 */

import { describe, expect, test } from "bun:test";
import type { AcpAskQuestion } from "@manobu/acp/acp-events";
import { AskToolServer, type ParkAsk } from "../src/ask-tool";
import { callHostTool, type ToolReply } from "./host-tool-client";

const QUESTIONS: AcpAskQuestion[] = [
  {
    options: [{ label: "vocab" }, { label: "grammar" }, { label: "kanji" }],
    question: "What do you want to study?",
  },
];

interface ExpireCall {
  conversationId: string;
  requestId: string;
}

/** Shape of the TASK-92 content key: a lowercase sha256 hex digest. */
const HEX64_RE = /^[0-9a-f]{64}$/;

function makeServer(options: { askTimeoutMs?: number; park: ParkAsk }): {
  expirations: ExpireCall[];
  server: AskToolServer;
  token: string;
} {
  const expirations: ExpireCall[] = [];
  const server = new AskToolServer({
    askTimeoutMs: options.askTimeoutMs,
    onExpire: (conversationId, requestId) => {
      expirations.push({ conversationId, requestId });
    },
    park: options.park,
  });
  const token = server.tokenFor("conv-1");
  return { expirations, server, token };
}

const callAskUser = (
  server: AskToolServer,
  token: string,
  questions: unknown[] = QUESTIONS
): Promise<ToolReply> =>
  callHostTool(server, token, {
    arguments: { questions },
    name: "ask_user",
  });

describe("ask_user tool race (TASK-86)", () => {
  test("tool-side timeout wins: isError reply + onExpire with the parked requestId", async () => {
    const park: ParkAsk = () => ({
      promise: new Promise<string>(() => undefined),
      requestId: "req-timeout",
    });
    const { expirations, server, token } = makeServer({
      askTimeoutMs: 60,
      park,
    });
    const reply = await callAskUser(server, token);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("timed out");
    expect(expirations).toEqual([
      { conversationId: "conv-1", requestId: "req-timeout" },
    ]);
  });

  test("park rejection (engine timeout / cancel) settles once as a failure", async () => {
    const park: ParkAsk = () => ({
      promise: Promise.reject(new Error("ask cancelled")),
      requestId: "req-cancelled",
    });
    const { expirations, server, token } = makeServer({ park });
    const reply = await callAskUser(server, token);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("ask_user failed");
    expect(reply.text).toContain("ask cancelled");
    expect(expirations).toEqual([
      { conversationId: "conv-1", requestId: "req-cancelled" },
    ]);
  });

  test("an answered park resolves the tool and never expires", async () => {
    const park: ParkAsk = () => ({
      promise: Promise.resolve("What do you want to study?: grammar"),
      requestId: "req-answered",
    });
    const { expirations, server, token } = makeServer({
      askTimeoutMs: 60,
      park,
    });
    const reply = await callAskUser(server, token);
    expect(reply.isError).toBe(false);
    expect(reply.text).toBe("What do you want to study?: grammar");
    // Past the (cleared) 60ms deadline: no late expire fires.
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    expect(expirations).toEqual([]);
  });

  test("a synchronous park throw fails the call without expiring (nothing parked)", async () => {
    const park: ParkAsk = () => {
      throw new Error("ask_user: no live session for conversation conv-1");
    };
    const { expirations, server, token } = makeServer({ park });
    const reply = await callAskUser(server, token);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("no live session");
    expect(expirations).toEqual([]);
  });

  test("the park receives a stable content key for identical questions (TASK-92)", async () => {
    const keys: (string | undefined)[] = [];
    const park: ParkAsk = (_conversationId, _questions, key) => {
      keys.push(key);
      return {
        promise: Promise.resolve("Q: a"),
        requestId: `req-${keys.length}`,
      };
    };
    const { server, token } = makeServer({ park });
    await callAskUser(server, token);
    await callAskUser(server, token);
    await callAskUser(server, token, [
      {
        options: [{ label: "x" }, { label: "y" }, { label: "z" }],
        question: "Different?",
      },
    ]);
    expect(keys[0]).toMatch(HEX64_RE);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test("an answer landing after the tool-side timeout reaches the re-call (TASK-92)", async () => {
    let parks = 0;
    // Models the engine's keyed park: every call for the same content
    // attaches to ONE waiter; the first caller can time out while the
    // learner still answers.
    let deliver = (_text: string): void => {
      throw new Error("ask was never parked");
    };
    const shared = new Promise<string>((resolve) => {
      deliver = resolve;
    });
    const park: ParkAsk = () => {
      parks += 1;
      return { promise: shared, requestId: "req-longpoll" };
    };
    const { expirations, server, token } = makeServer({
      askTimeoutMs: 80,
      park,
    });
    const first = await callAskUser(server, token);
    expect(first.isError).toBe(true);
    expect(first.text).toContain("timed out");
    expect(expirations).toEqual([
      { conversationId: "conv-1", requestId: "req-longpoll" },
    ]);
    deliver("What do you want to study?: kanji");
    const second = await callAskUser(server, token);
    expect(second.isError).toBe(false);
    expect(second.text).toBe("What do you want to study?: kanji");
    // The answer reached the re-call as a tool result, and the answered
    // re-call never re-expired the row.
    expect(parks).toBe(2);
    expect(expirations.length).toBe(1);
  });
});
