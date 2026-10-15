/**
 * TASK-87: the collapsed-by-default thinking strip, verified through the
 * real composition path (Provider → MessageTranscript → ChatCardSwitch →
 * AcpThinkingPart) rather than the dispatch component alone, so the
 * answered-turn wiring in `message-transcript.tsx` is pinned too.
 *
 * SSR markup assertions (no DOM): a persisted transcript replays with
 * `status` idle, so a thinking card is collapsed unless its turn is
 * streaming. The collapsed panel unmounts its body (Base UI default),
 * which is what "raw reasoning is off screen by default" means here.
 */

import { describe, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { TMessage } from "./chat-engine/types";
import { MessageTranscript } from "./message-transcript";
import { CHAT_STORAGE_KEY } from "./persistence";
import { ChatSessionProvider } from "./provider";
import { createTestQueryClient, installLocalStorageStub } from "./ssr-test-env";

const store = installLocalStorageStub();
const testQueryClient = createTestQueryClient();

const thinkingCard: TMessage = {
  content: "the model quoting its own instructions",
  conversation_id: "c1",
  id: "thinking:m1",
  msg_id: "m1",
  type: "thinking",
};
const answerCard: TMessage = {
  content: "the real answer",
  conversation_id: "c1",
  id: "text:m1",
  msg_id: "m1",
  type: "text",
};

const renderTranscript = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={testQueryClient}>
      <ChatSessionProvider readOnly>
        <MessageTranscript />
      </ChatSessionProvider>
    </QueryClientProvider>
  );

describe("thinking collapse through the transcript (TASK-87)", () => {
  test("a replayed turn renders thinking as the collapsed strip, body unmounted (AC#1, AC#3)", () => {
    store.set(
      CHAT_STORAGE_KEY,
      JSON.stringify({ messages: [thinkingCard, answerCard] })
    );
    const html = renderTranscript();
    expect(html).toContain("Thought");
    expect(html).toContain('data-slot="collapsible-trigger"');
    expect(html).not.toContain("the model quoting its own instructions");
    expect(html).toContain("the real answer");
  });

  test("a thinking card from an unfinished turn is still collapsed in replay", () => {
    store.set(CHAT_STORAGE_KEY, JSON.stringify({ messages: [thinkingCard] }));
    const html = renderTranscript();
    expect(html).not.toContain("the model quoting its own instructions");
  });
});
