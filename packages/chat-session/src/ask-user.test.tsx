/**
 * TASK-80.4 ask-frame card contracts (replaces the TASK-79.4
 * handoff-era assertions).
 *
 * The ask_user card is now the AionUi `AcpAskCard` (inline in the
 * transcript via `AcpAskPart`), submitted through `chat.answerAsk`
 * over the WS oRPC link. The old pinned `QuestionCard` +
 * `askUserAnswerText` next-user-message transport is gone.
 *
 * Rendering goes through `react-dom/server.renderToStaticMarkup` —
 * no DOM, no jsdom. We pin the static state table: `data-slot`,
 * `data-state`, `data-testid` attributes + HTML substrings.
 */

import { describe, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isAskCard,
  type TMessage,
  type TMessageAcpToolCall,
  type TMessageAsk,
} from "./chat-engine";
import { MessageTranscript } from "./message-transcript";
import { CHAT_STORAGE_KEY } from "./persistence";
import { ChatSessionProvider } from "./provider";
import { createTestQueryClient, installLocalStorageStub } from "./ssr-test-env";

// Bun test env has no localStorage — stub it before seeding.
const store = installLocalStorageStub();
const testQueryClient = createTestQueryClient();

const DRILL = {
  options: [{ label: "Vocab" }, { label: "Grammar" }, { label: "Reading" }],
  question: "What should we drill?",
};
const LEVEL = {
  options: [
    { label: "Beginner" },
    { label: "Intermediate" },
    { label: "Advanced" },
  ],
  question: "Your level?",
};

const ask = (questions: TMessageAsk["questions"]): TMessageAsk => ({
  conversation_id: "c1",
  id: "ask:req-1",
  msg_id: "m-ask",
  questions,
  requestId: "req-1",
  type: "ask",
});

const text = (content: string): TMessage => ({
  content,
  conversation_id: "c1",
  id: "msg-1",
  msg_id: "msg-1",
  type: "text",
});

const user = (textValue: string): TMessage => ({
  conversation_id: "c1",
  id: "user:u1",
  msg_id: "u1",
  text: textValue,
  type: "user_created",
});

describe("isAskCard", () => {
  test("narrowing an ask card", () => {
    const card = ask([DRILL, LEVEL]);
    expect(isAskCard(card)).toBe(true);
  });
  test("rejects other cards", () => {
    expect(isAskCard(text("x"))).toBe(false);
    expect(isAskCard(user("hi"))).toBe(false);
  });
});

describe("AcpAskCard through the transcript (SSR, TASK-80.4)", () => {
  const renderTranscript = (readOnly = false) =>
    renderToStaticMarkup(
      <QueryClientProvider client={testQueryClient}>
        <ChatSessionProvider readOnly={readOnly}>
          <MessageTranscript />
        </ChatSessionProvider>
      </QueryClientProvider>
    );
  const seed = (messages: TMessage[]) => {
    store.set(CHAT_STORAGE_KEY, JSON.stringify({ messages }));
  };

  test("an ask card renders the AionUi ask card inline", () => {
    seed([text("Let us start."), ask([DRILL, LEVEL])]);
    const html = renderTranscript();
    expect(html).toContain('data-slot="acp-ask-card"');
    expect(html).toContain('data-state="default"');
    expect(html).toContain("What should we drill?");
    expect(html).toContain("Your level?");
    expect(html).toContain("Vocab");
    expect(html).toContain("Beginner");
    expect(html).toContain("acp-ask-submit");
    expect(html).toContain("acp-ask-decline");
  });

  test("the old pinned questionnaire is gone", () => {
    seed([text("Let us start."), ask([DRILL, LEVEL])]);
    const html = renderTranscript();
    expect(html).not.toContain('data-slot="questionnaire"');
    expect(html).not.toContain('aria-label="Another answer"');
  });

  test("read-only mount still renders the card (the part owns its state)", () => {
    seed([ask([DRILL, LEVEL])]);
    const html = renderTranscript(true);
    expect(html).toContain('data-slot="acp-ask-card"');
  });

  // TASK-86: a replayed settled row arrives with its lifecycle status, so
  // the part hands the card a terminal resolution and reload collapses it
  // instead of re-arming a dead form.
  test("a finished ask card replays compact with its answer summary", () => {
    const settledAsk: TMessageAsk = {
      ...ask([DRILL]),
      settled: { answers: [{ labels: ["Grammar"], question: DRILL.question }] },
      status: "finish",
    };
    seed([settledAsk]);
    const html = renderTranscript();
    expect(html).toContain('data-state="answered"');
    expect(html).toContain("Response sent");
    expect(html).toContain("Grammar");
    expect(html).not.toContain("acp-ask-submit");
  });

  test("a declined ask card replays compact declined", () => {
    const declinedAsk: TMessageAsk = {
      ...ask([DRILL]),
      settled: { decline: true },
      status: "finish",
    };
    seed([declinedAsk]);
    const html = renderTranscript();
    expect(html).toContain('data-state="declined"');
    expect(html).toContain("Response declined");
    expect(html).not.toContain("acp-ask-submit");
  });

  test("an expired ask card replays compact failed, not interactive", () => {
    const expiredAsk: TMessageAsk = { ...ask([DRILL]), status: "error" };
    seed([expiredAsk]);
    const html = renderTranscript();
    expect(html).toContain('data-state="expired"');
    expect(html).toContain("expired without an answer");
    expect(html).not.toContain("acp-ask-submit");
    expect(html).not.toContain("acp-ask-decline");
  });

  test("acp_tool_call cards render the AionUi tool-call card", () => {
    const bashDone: TMessageAcpToolCall = {
      content: null,
      conversation_id: "c1",
      id: "tool:b1",
      kind: "execute",
      locations: null,
      msg_id: "m-tool",
      raw_input: { command: "echo 42" },
      raw_output: "42",
      status: "completed",
      title: "echo 42",
      toolCallId: "b1",
      type: "acp_tool_call",
    };
    seed([bashDone]);
    const html = renderTranscript();
    expect(html).toContain('data-slot="acp-tool-call-card"');
    expect(html).toContain("acp-tool-call-card");
  });
});
