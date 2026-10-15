import { describe, expect, test } from "bun:test";

import { installMemoryStorage } from "./test-storage";

/**
 * TASK-58 persistence-contract tests.
 *
 * Product decision: ONE shared persisted conversation across surfaces.
 * Every writable <ChatSessionProvider> loads and writes the same blob
 * (`manobu:chat:v1`); last writer wins. In-memory state stays
 * per-instance (see multi-mount.test.tsx — no provider drift).
 *
 * These tests pin the storage layer: shared key, write-through shape,
 * and the corrupt/absent-blob fallbacks. `readOnly` (provider prop) is
 * what keeps debug mounts out of the write race — it is covered by the
 * provider effect, asserted here at the persistence boundary.
 */

// Bun test env has no localStorage — install a stub before importing
// the module under test (persistence.ts touches it lazily, not at
// import time).
const storageStub = installMemoryStorage();
const { store } = storageStub;

const { CHAT_STORAGE_KEY, loadPersistedChat, persistChat } = await import(
  "./persistence"
);

describe("chat-session persistence (TASK-58 shared-by-design contract)", () => {
  test("single versioned key — every surface persists to the same blob", () => {
    expect(CHAT_STORAGE_KEY).toBe("manobu:chat:v1");
  });

  test("persistChat writes through; loadPersistedChat reads the same blob", () => {
    persistChat({
      agent: "sensei",
      input: "What does 食べる mean?",
      messages: [
        {
          conversation_id: "c1",
          id: "user:m1",
          msg_id: "m1",
          text: "こんにちは",
          type: "user_created",
        },
      ],
      model: "local",
      persona: "teacher",
    });
    const loaded = loadPersistedChat();
    expect(loaded.agent).toBe("sensei");
    expect(loaded.persona).toBe("teacher");
    expect(loaded.model).toBe("local");
    expect(loaded.input).toBe("What does 食べる mean?");
    expect(loaded.messages?.length).toBe(1);
    expect(loaded.messages?.[0]?.type).toBe("user_created");
  });

  test("draft input round-trips (TASK-66: survives provider remount)", () => {
    persistChat({ input: "こんにちは sensei", messages: [] });
    const loaded = loadPersistedChat();
    expect(loaded.input).toBe("こんにちは sensei");
    // empty-string draft persists too (cleared composer stays cleared)
    persistChat({ input: "", messages: [] });
    expect(loadPersistedChat().input).toBe("");
    // undefined input (older blob) loads as undefined → provider defaults ""
    persistChat({ messages: [] });
    expect(loadPersistedChat().input).toBeUndefined();
  });

  test("last writer wins — a second write fully replaces the blob", () => {
    persistChat({ agent: "a1", messages: [] });
    persistChat({ agent: "a2", messages: [] });
    const loaded = loadPersistedChat();
    expect(loaded.agent).toBe("a2");
  });

  test("corrupt blob falls back to {} (no throw, no partial state)", () => {
    store[CHAT_STORAGE_KEY] = "not-json{{";
    const loaded = loadPersistedChat();
    expect(loaded).toEqual({});
  });

  test("missing blob returns {} (fresh session)", () => {
    storageStub.clear();
    expect(loadPersistedChat()).toEqual({});
  });
});
