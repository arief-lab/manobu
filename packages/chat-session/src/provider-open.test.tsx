/*
 * The Provider's `open` prop (TASK-101 AC#1/#4).
 *
 * Opening a stored conversation is a different seed than the blob's current
 * one: the mount must bind to the STORED id (the engine subscribes to that
 * conversation and the server replays its rows) with the agent/persona the
 * conversation was created with, and it must not carry the previous chat's
 * transcript or draft. Asserted through the real context (`meta.conversationId`,
 * `state.*`) so a provider that kept the blob's identity fails here instead of
 * in the browser.
 *
 * `readOnly` keeps the mount off the write race; it says nothing about which
 * conversation is loaded, which is exactly the property under test.
 */

import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatSessionApi } from "./chat-session-contract";
import { ChatSessionProvider, useChatSession } from "./provider";
import type { OpenConversationSeed } from "./provider-initial";
import { installMemoryStorage } from "./test-storage";

installMemoryStorage();

const { persistChat } = await import("./persistence");

const testQueryClient = new QueryClient({
  defaultOptions: { mutations: { retry: 0 }, queries: { retry: 0 } },
});

const BLOB_ID = "f81d4fae-7dec-11d0-a765-00a0c91e6bf6";
const STORED: OpenConversationSeed = {
  agent: "kilo",
  assistant: "tutor",
  conversationId: "11111111-2222-3333-4444-555555555555",
};

/** Render one provider and hand back the context its subtree reads. */
function renderProvider(open: OpenConversationSeed | null): ChatSessionApi {
  // A slot object, not a `let`: the assignment happens inside a closure, and
  // control-flow analysis would otherwise narrow a local back to `null`.
  const slot: { api: ChatSessionApi | null } = { api: null };
  function Probe() {
    slot.api = useChatSession();
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={testQueryClient}>
      <ChatSessionProvider open={open} readOnly>
        <Probe />
      </ChatSessionProvider>
    </QueryClientProvider>
  );
  return slot.api as ChatSessionApi;
}

describe("ChatSessionProvider open prop (TASK-101)", () => {
  test("without open, the mount binds to the blob's conversation", () => {
    persistChat({ conversationId: BLOB_ID });
    const api = renderProvider(null);
    expect(api.meta.conversationId).toBe(BLOB_ID);
  });

  test("with open, the mount binds to the STORED id, not the blob's", () => {
    persistChat({ conversationId: BLOB_ID });
    const api = renderProvider(STORED);
    // The engine subscribes with this id, so the server replay that follows
    // is the opened conversation's, not the blob's.
    expect(api.meta.conversationId).toBe(STORED.conversationId);
  });

  test("the stored agent and persona replace the blob's selection", () => {
    persistChat({ agent: "claude", input: "half-typed", persona: "sensei" });
    const api = renderProvider(STORED);
    expect(api.state.selectedAgent).toBe("kilo");
    expect(api.state.selectedPersona).toBe("tutor");
    // The previous chat's unfinished draft is not this chat's draft.
    expect(api.state.input).toBe("");
  });

  test("a null stored binding means the server default, not the blob's agent", () => {
    persistChat({ agent: "claude", persona: "sensei" });
    const api = renderProvider({
      agent: null,
      assistant: null,
      conversationId: STORED.conversationId,
    });
    expect(api.state.selectedAgent).toBeUndefined();
    expect(api.state.selectedPersona).toBeUndefined();
  });
});
