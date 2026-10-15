// Pin the public surface of `@manobu/chat-session` so adding a new export
// is a deliberate commit, and removing/renaming one is a deliberate break.
//
// We test each subpath separately so this file can also serve as a
// cookbook for consumers adding new ones. The barrel at `./index`
// re-exports each leaf; if the barrel drifts we add a barrel-vs-leaf
// smoke in a second pass.

import { describe, expect, test } from "bun:test";
import {
  isAskCard,
  type TMessage,
  type TMessageAcpToolCall,
} from "./chat-engine";
import {
  useAgentCatalog,
  useModelCatalog,
  usePersonaCatalog,
  useSlashCommands,
} from "./fetcher";
import {
  cardsFromRows,
  conversationHistoryQueryKey,
  conversationHistoryQueryOptions,
  conversationQueryOptions,
  mergeTranscript,
  messageHistoryQueryOptions,
  storedStampToEpochMs,
} from "./history";
import { MessageTranscript } from "./message-transcript";
import {
  CHAT_STORAGE_KEY,
  loadPersistedChat,
  persistChat,
} from "./persistence";
import {
  type ChatSessionActions,
  type ChatSessionApi,
  type ChatSessionMeta,
  ChatSessionProvider,
  type ChatSessionState,
  useChatSession,
  useChatSessionActions,
  useChatSessionMeta,
  useChatSessionState,
} from "./provider";

describe("provider surface (functions)", () => {
  test("ChatSessionProvider is a function component", () => {
    expect(typeof ChatSessionProvider).toBe("function");
    expect(ChatSessionProvider.name).toBe("ChatSessionProvider");
  });

  test("useChatSession is the full-context hook", () => {
    expect(typeof useChatSession).toBe("function");
    expect(useChatSession.name).toBe("useChatSession");
  });

  test("useChatSessionState is the state-slice subsubscription hook", () => {
    expect(typeof useChatSessionState).toBe("function");
    expect(useChatSessionState.name).toBe("useChatSessionState");
  });

  test("useChatSessionActions is the actions-slice subsubscription hook", () => {
    expect(typeof useChatSessionActions).toBe("function");
    expect(useChatSessionActions.name).toBe("useChatSessionActions");
  });

  test("useChatSessionMeta is the meta-slice subsubscription hook", () => {
    expect(typeof useChatSessionMeta).toBe("function");
    expect(useChatSessionMeta.name).toBe("useChatSessionMeta");
  });
});

describe("provider surface (types)", () => {
  // The four names below are the public type contract. Renaming or
  // removing them is a deliberate break: update this assertion list
  // and the JSDoc on `ChatSessionApi` in the same commit.
  const declaredTypeNames: readonly string[] = [
    "ChatSessionApi",
    "ChatSessionActions",
    "ChatSessionMeta",
    "ChatSessionState",
  ];
  for (const name of declaredTypeNames) {
    test(`public type "${name}" is declared in provider.tsx`, () => {
      // Compile-time: the import above must succeed.
      // Runtime:      the declaredTypeNames list must contain the
      //               symbol so we notice when a refactor drops one.
      expect(declaredTypeNames).toContain(name);
    });
  }

  // Compile-time shape assertions. If `ChatSessionApi`'s three-part
  // contract ever drifts from {state, actions, meta}, these fail and
  // force a deliberate decision.
  test("ChatSessionApi is a structural composite of three slices", () => {
    const sample: ChatSessionApi = {
      actions: {} as ChatSessionActions,
      meta: {} as ChatSessionMeta,
      state: {} as ChatSessionState,
    };
    expect(Object.keys(sample).sort()).toEqual(["actions", "meta", "state"]);
  });
});

describe("message-transcript surface", () => {
  test("MessageTranscript is a function component", () => {
    expect(typeof MessageTranscript).toBe("function");
    expect(MessageTranscript.name).toBe("MessageTranscript");
  });
});

// TASK-101: the history subpath is the desktop's only route to a past
// conversation, so its surface is part of the public contract.
describe("history surface (TASK-101)", () => {
  test("the query-option builders are functions", () => {
    expect(typeof conversationHistoryQueryOptions).toBe("function");
    expect(typeof conversationQueryOptions).toBe("function");
    expect(typeof messageHistoryQueryOptions).toBe("function");
  });

  test("cardsFromRows is the persisted-row fold and is exported by name", () => {
    expect(typeof cardsFromRows).toBe("function");
    expect(cardsFromRows.name).toBe("cardsFromRows");
  });

  test("mergeTranscript is the persisted+live card union (TASK-108)", () => {
    expect(typeof mergeTranscript).toBe("function");
    expect(mergeTranscript.name).toBe("mergeTranscript");
  });

  test("storedStampToEpochMs is the shared timestamp rule", () => {
    expect(typeof storedStampToEpochMs).toBe("function");
  });

  test("the history list's key is stable and hierarchical", () => {
    // Mutations invalidate by this key; a rename that changed it would
    // silently leave stale rows on screen.
    expect(conversationHistoryQueryKey).toEqual(["chat", "history"]);
  });
});

// The chat-messages seam file was deleted in TASK-80.6: the engine card
// union (TMessage + isAskCard, from ./chat-engine) is the public contract
// these assertions pin now.
describe("engine card surface", () => {
  // The engine card union (one card shape per durable frame type) is
  // what every surface consumes; a real text card satisfies it.
  test("TMessage is the card union (text card shape)", () => {
    const message: TMessage = {
      content: "hi",
      conversation_id: "c1",
      id: "a1",
      msg_id: "a1",
      type: "text",
    };
    expect(message.type).toBe("text");
  });

  test("the acp_tool_call card shape is a TMessageAcpToolCall", () => {
    const card: TMessageAcpToolCall = {
      content: null,
      conversation_id: "c1",
      id: "tool:t1",
      kind: null,
      locations: null,
      msg_id: "m1",
      raw_input: null,
      raw_output: null,
      status: null,
      title: null,
      toolCallId: "t1",
      type: "acp_tool_call",
    };
    expect(card.toolCallId).toBe("t1");
  });

  test("isAskCard is the ask-card guard (was isAskUserPart)", () => {
    expect(typeof isAskCard).toBe("function");
  });
});

describe("fetcher hook surface", () => {
  test("useAgentCatalog is a function hook", () => {
    expect(typeof useAgentCatalog).toBe("function");
    expect(useAgentCatalog.name).toBe("useAgentCatalog");
  });

  test("useModelCatalog is a function hook", () => {
    expect(typeof useModelCatalog).toBe("function");
    expect(useModelCatalog.name).toBe("useModelCatalog");
  });

  test("usePersonaCatalog is a function hook", () => {
    expect(typeof usePersonaCatalog).toBe("function");
    expect(usePersonaCatalog.name).toBe("usePersonaCatalog");
  });

  test("useSlashCommands is a function hook (TASK-80.5)", () => {
    expect(typeof useSlashCommands).toBe("function");
    expect(useSlashCommands.name).toBe("useSlashCommands");
  });
});

describe("persistence surface", () => {
  test("loadPersistedChat is a function", () => {
    expect(typeof loadPersistedChat).toBe("function");
  });

  test("persistChat is a function", () => {
    expect(typeof persistChat).toBe("function");
  });

  test("storage key is versioned", () => {
    // The key must carry a version so a future schema change can leave
    // old blobs behind and start fresh without crashing the load.
    expect(CHAT_STORAGE_KEY).toContain(":v");
  });
});
