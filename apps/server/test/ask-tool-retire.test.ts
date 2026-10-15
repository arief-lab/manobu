/**
 * TASK-94 cross-seam integration: tool-side expiry must retire the ENGINE
 * park.
 *
 * Wires the REAL pieces end to end — a real fake-agent child behind a real
 * SessionController, the AskToolServer over its real streamable-HTTP
 * transport, and context.ts's onExpire/retire wiring shape (settle +
 * retireAsk). Pins the contract the unit mocks cannot: when the tool's own
 * deadline fires, the park dies with it. A late learner tap gets
 * `answerAsk() === false`, `pendingAsks` stops projecting the card, and a
 * re-calling agent replays the expiry from the terminal cache instead of
 * re-parking. settlePending's WHERE status='pending' (chat-store) keeps the
 * repeated expire a no-op on the row.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpAskQuestion } from "@manobu/acp/acp-events";
import { SessionController } from "@manobu/acp/session";
import { AskToolServer } from "../src/ask-tool";
import { callHostTool, type ToolReply } from "./host-tool-client";

const FAKE = join(import.meta.dir, "../../../packages/acp/test/fake-agent.ts");
const TMP = mkdtempSync(join(tmpdir(), "ask-retire-"));

const QUESTIONS: AcpAskQuestion[] = [
  {
    options: [{ label: "vocab" }, { label: "grammar" }, { label: "kanji" }],
    question: "What do you want to study?",
  },
];

const callAskUser = (
  server: AskToolServer,
  token: string
): Promise<ToolReply> =>
  callHostTool(server, token, {
    arguments: { questions: QUESTIONS },
    name: "ask_user",
  });

describe("tool expiry retires the engine park (TASK-94)", () => {
  test("timeout settles, retires, refuses late answers, and replays expiry", async () => {
    const controller = new SessionController();
    const scriptPath = join(TMP, "retire.json");
    writeFileSync(
      scriptPath,
      JSON.stringify({
        capabilities: {},
        responses: {
          "session/prompt": {
            delayMs: 600,
            stopReason: "end_turn",
            updates: [],
          },
        },
      })
    );
    const handle = await controller.ensureSession({
      args: [FAKE, scriptPath],
      command: process.execPath,
      cwd: TMP,
      forwardMcp: false,
      mcpServers: [],
    });
    // Park emits through the handle's sink (lastSink fallback is enough,
    // but arming a turn mirrors production exactly).
    const frames: { request_id?: string; type: string }[] = [];
    const running = controller.prompt(handle, {
      content: "hi",
      sink: (event) => {
        frames.push(event as unknown as { request_id?: string; type: string });
      },
    });

    const expirations: string[] = [];
    const retirements: string[] = [];
    const server = new AskToolServer({
      askTimeoutMs: 80,
      onExpire: (_conversationId, expiredId) => {
        expirations.push(expiredId);
      },
      park: (_conversationId, questions, key) =>
        controller.parkAsk(handle, questions, key),
      retire: (expiredId) => {
        retirements.push(expiredId);
        controller.retireAsk(expiredId);
      },
    });
    const token = server.tokenFor("conv-retire");

    const first = await callAskUser(server, token);
    expect(first.isError).toBe(true);
    expect(first.text).toContain("timed out");
    expect(retirements.length).toBe(1);
    expect(expirations).toEqual(retirements);

    // AC#1: the engine park is gone from the live index.
    const requestId = retirements[0] ?? "";
    expect(controller.pendingAsks(handle.sessionId)).toEqual([]);
    // AC#1: a late learner tap is refused.
    expect(
      controller.answerAsk(requestId, {
        answers: [
          { labels: ["kanji"], question: QUESTIONS[0]?.question ?? "" },
        ],
      })
    ).toBe(false);

    // AC#2: a re-call replays the terminal expiry, never re-parks.
    const second = await callAskUser(server, token);
    expect(second.isError).toBe(true);
    expect(controller.pendingAsks(handle.sessionId)).toEqual([]);
    // The replayed rejection expires again; the row's WHERE pending guard
    // makes that a no-op (chat-store), and it is the SAME requestId.
    expect(expirations.every((id) => id === requestId)).toBe(true);
    expect(new Set(expirations).size).toBe(1);

    await running;
    await controller.disposeAll();
  }, 15_000);
});
