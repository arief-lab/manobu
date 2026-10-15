/**
 * Direct coverage for the provider-owned pure helpers (TASK-83):
 * `readInitialChatState` normalization and the label resolvers. These
 * were inline in provider.tsx before the contract split; TASK-82's
 * conversationId persistence will extend the seed reader, so the
 * helpers need provider-free coverage first.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { installMemoryStorage } from "./test-storage";

const storageStub = installMemoryStorage();

const { persistChat } = await import("./persistence");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const {
  isPlausibleConversationId,
  mergeOpenConversation,
  readInitialChatState,
  resolveAgentLabel,
  resolveConversationId,
  resolveConversationKnown,
  resolvePersonaLabel,
  resolveSlashSnapshotReady,
} = await import("./provider-initial");

afterEach(() => {
  storageStub.clear();
});

describe("readInitialChatState (TASK-83)", () => {
  test("empty-string ids become undefined (the server default)", () => {
    persistChat({ agent: "", input: "draft", model: "", persona: "" });
    const initial = readInitialChatState();
    expect(initial.agent).toBeUndefined();
    expect(initial.model).toBeUndefined();
    expect(initial.persona).toBeUndefined();
    expect(initial.input).toBe("draft");
  });

  test("absent blob falls back to a fresh conversation", () => {
    const initial = readInitialChatState();
    expect(initial.agent).toBeUndefined();
    expect(initial.input).toBe("");
    expect(initial.messages).toEqual([]);
  });

  test("real values pass through", () => {
    persistChat({ agent: "opencode", model: "gpt-x", persona: "teacher" });
    const initial = readInitialChatState();
    expect(initial.agent).toBe("opencode");
    expect(initial.model).toBe("gpt-x");
    expect(initial.persona).toBe("teacher");
  });
});

describe("label resolvers (TASK-83)", () => {
  const agents = [
    {
      command: "opencode",
      displayName: "OpenCode",
      id: "opencode",
      installed: true,
    },
  ];
  const personas = [
    { description: null, id: "p1", name: "Sensei" },
    { description: null, id: "p2", name: "Tutor" },
  ];

  test("agent: catalog match wins, then raw id, then Default", () => {
    expect(resolveAgentLabel(agents, "opencode")).toBe("OpenCode");
    expect(resolveAgentLabel([], "custom")).toBe("custom");
    expect(resolveAgentLabel([], undefined)).toBe("Default");
  });

  test("persona: selection, then server default, then Default", () => {
    expect(resolvePersonaLabel(personas, "p2", "p1")).toBe("Tutor");
    expect(resolvePersonaLabel(personas, undefined, "p1")).toBe("Sensei");
    expect(resolvePersonaLabel(personas, "gone", "p1")).toBe("gone");
    expect(resolvePersonaLabel([], undefined, undefined)).toBe("Default");
  });
});

describe("conversationId persistence (TASK-82)", () => {
  test("isPlausibleConversationId accepts only real UUIDs", () => {
    expect(
      isPlausibleConversationId("f81d4fae-7dec-11d0-a765-00a0c91e6bf6")
    ).toBe(true);
    expect(isPlausibleConversationId("")).toBe(false);
    expect(isPlausibleConversationId("not-a-uuid")).toBe(false);
    expect(isPlausibleConversationId(undefined)).toBe(false);
    expect(isPlausibleConversationId(123)).toBe(false);
  });

  test("resolveConversationId reuses a persisted UUID (reload reconnects)", () => {
    const id = "f81d4fae-7dec-11d0-a765-00a0c91e6bf6";
    expect(resolveConversationId(id)).toBe(id);
  });

  test("resolveConversationId mints fresh on absent or invalid persisted id", () => {
    const fresh = resolveConversationId(undefined);
    expect(fresh).toMatch(UUID_RE);
    // a stale/garbage value self-heals instead of poisoning the identity
    expect(resolveConversationId("garbage")).not.toBe("garbage");
    expect(resolveConversationId("")).not.toBe("");
  });

  test("readInitialChatState surfaces a persisted conversationId", () => {
    const id = "f81d4fae-7dec-11d0-a765-00a0c91e6bf6";
    persistChat({ conversationId: id });
    expect(readInitialChatState().conversationId).toBe(id);
  });

  test("readInitialChatState drops an implausible persisted id", () => {
    persistChat({ conversationId: "garbage" });
    expect(readInitialChatState().conversationId).toBeUndefined();
  });

  test("absent blob yields undefined conversationId (mint fresh)", () => {
    expect(readInitialChatState().conversationId).toBeUndefined();
  });
});

describe("mergeOpenConversation (TASK-101)", () => {
  test("the stored agent and assistant win over the blob's current ones", () => {
    persistChat({
      agent: "claude",
      conversationId: "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
      persona: "sensei",
    });
    const merged = mergeOpenConversation(readInitialChatState(), {
      agent: "kilo",
      assistant: "tutor",
      conversationId: "11111111-2222-3333-4444-555555555555",
    });
    // The stored acp_session_id belongs to the agent that made it, so
    // resuming on the blob's agent would load a session that CLI never had.
    expect(merged.agent).toBe("kilo");
    expect(merged.persona).toBe("tutor");
    expect(merged.conversationId).toBe("11111111-2222-3333-4444-555555555555");
  });

  test("a null stored binding falls back to the server default, not the blob", () => {
    persistChat({ agent: "claude", persona: "sensei" });
    const merged = mergeOpenConversation(readInitialChatState(), {
      agent: null,
      assistant: null,
      conversationId: "11111111-2222-3333-4444-555555555555",
    });
    expect(merged.agent).toBeUndefined();
    expect(merged.persona).toBeUndefined();
  });

  test("the blob's transcript, draft and model do not follow the opened chat", () => {
    persistChat({
      input: "half-typed sentence",
      messages: [
        {
          content: "stale",
          id: "stale-1",
          role: "assistant",
          type: "text",
        } as unknown as ReturnType<
          typeof readInitialChatState
        >["messages"][number],
      ],
      model: "gemini-2.5-pro",
    });
    const merged = mergeOpenConversation(readInitialChatState(), {
      agent: "kilo",
      assistant: null,
      conversationId: "11111111-2222-3333-4444-555555555555",
    });
    // The database replay is the transcript; the previous chat's cards and
    // half-finished draft belong to a conversation this one is not.
    expect(merged.messages).toEqual([]);
    expect(merged.input).toBe("");
    expect(merged.model).toBeUndefined();
  });
});

/** One transcript card, typed through the seed reader so the fixture cannot
 * drift from the message type. */
type SeedCard = ReturnType<typeof readInitialChatState>["messages"][number];

const card = {
  content: "hello",
  id: "user-1",
  role: "user",
  type: "text",
} as unknown as SeedCard;

describe("resolveConversationKnown (TASK-157)", () => {
  const opened = {
    agent: "claude",
    assistant: null,
    conversationId: "11111111-2222-3333-4444-555555555555",
  };

  test("a minted id with no transcript is not a conversation the server holds", () => {
    // The bug this pins: the id passes every string test (it is a well-formed
    // UUID and non-empty), and `persistChat` writes it to the blob on mount,
    // so nothing about the id itself says whether a send ever happened.
    expect(
      resolveConversationKnown({
        conversationId: opened.conversationId,
        messages: [],
        open: null,
      })
    ).toBe(false);
  });

  test("an opened conversation is known before a row arrives", () => {
    expect(
      resolveConversationKnown({
        conversationId: opened.conversationId,
        messages: [],
        open: opened,
      })
    ).toBe(true);
  });

  test("a transcript is the server's own evidence, with no open seed", () => {
    expect(
      resolveConversationKnown({
        conversationId: opened.conversationId,
        messages: [card],
        open: null,
      })
    ).toBe(true);
  });

  test("New Chat under an open seed is fresh again", () => {
    // The route keeps `open` while the provider mints a new identity, so a
    // seed that no longer names this conversation proves nothing.
    expect(
      resolveConversationKnown({
        conversationId: "66666666-7777-8888-9999-000000000000",
        messages: [],
        open: opened,
      })
    ).toBe(false);
  });
});

/** A card of one wire frame type, typed through the seed reader so the
 * fixture cannot drift from the message union. */
const frame = (type: string): SeedCard =>
  ({
    content: "x",
    id: `${type}-1`,
    type,
  }) as unknown as SeedCard;

describe("resolveSlashSnapshotReady (TASK-172)", () => {
  test("no cards: nothing has established the session yet", () => {
    expect(resolveSlashSnapshotReady([])).toBe(false);
  });

  test("a stored paper with no turn is not a session: the exam mount would 404", () => {
    // The bug this pins: `open`/a non-empty transcript proves the server has
    // the conversation, but the exam paper is a server-built card and no turn
    // has run, so the session id is absent and slashCommands answers NOT_FOUND.
    expect(resolveSlashSnapshotReady([frame("paper")])).toBe(false);
  });

  test("the learner's own persisted row is not a session", () => {
    // user_created is emitted at chat-rpc.ts:470, before runTurn sets the id.
    expect(resolveSlashSnapshotReady([frame("user_created")])).toBe(false);
  });

  test("a pre-session error and a client retry notice prove nothing", () => {
    expect(resolveSlashSnapshotReady([frame("error")])).toBe(false);
    expect(resolveSlashSnapshotReady([frame("retry_notice")])).toBe(false);
  });

  test("any agent-streamed card proves the session landed", () => {
    for (const type of [
      "acp_context_usage",
      "acp_permission",
      "acp_terminal_output",
      "acp_tool_call",
      "ask",
      "plan",
      "text",
      "thinking",
    ]) {
      expect(resolveSlashSnapshotReady([frame(type)])).toBe(true);
    }
  });

  test("the session card survives a learner-only card before it", () => {
    expect(
      resolveSlashSnapshotReady([
        frame("user_created"),
        frame("paper"),
        frame("text"),
      ])
    ).toBe(true);
  });
});
