/*
 * Conversation-history tests (TASK-101).
 *
 * Two layers, one file. The store tests drive `chat-store` directly (the
 * history list's real hazards live there: two timestamp shapes in one
 * column, keyset pagination, the message cascade, and the learner-turn
 * filter of TASK-150). The surface tests boot the production sidecar over
 * /rpc and assert the four new procedures, including the refusal to delete
 * a conversation mid-turn, and that a paper nobody spoke to is not offered
 * as a chat while the paper itself stays usable.
 *
 * Every id is prefixed `hist-`: the chat-store singleton's in-memory db is
 * shared with the other server test files in this process, so listings are
 * filtered rather than assumed empty.
 */

import { describe, expect, it } from "bun:test";

// Required env must be set before src imports run (see chat-e2e.test.ts):
// Bun hoists static imports, so src modules load AFTER this setup.
process.env.CORS_ORIGIN = "http://localhost:3000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("chat-history");
const { applyContentMigrations } = await import("@manobu/db/migrate");
applyContentMigrations(DB_URL);
process.env.DATABASE_URL = DB_URL;
// Every code path, including the module-scope singletons in chat-store and
// routes/cards, resolves through this. Setting the env alone is not enough:
// `bun test` loads all spec files first, so the env is whatever the last one
// assigned. See src/user-db.ts for the whole story.
setUserDbProvider(async () =>
  (await import("@manobu/db")).createUserDb(DB_URL)
);

const { conversations } = await import("@manobu/db/schema/user");
const { sql } = await import("drizzle-orm");
const { createRpcHandlers } = await import("../src/rpc");
const {
  appendMessage,
  backfillConversationTitles,
  deleteConversation,
  ensureConversation,
  getChatDb,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
  setUserAcpSessionId,
} = await import("../src/chat-store");
const { bootChatServer } = await import("./harness");
type ChatController = import("../src/chat-rpc").ChatController;
type ChatServer = import("./harness").ChatServer;
type ConversationSummary = import("../src/chat-store").ConversationSummary;

const HIST_PREFIX = "hist-";
const EPOCH = "1970-01-01T00:00:00.000Z";
/** The one wire timestamp shape the history list promises. */
const ISO_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Only this file's conversations, in list order. */
function histIds(page: ConversationSummary[]): string[] {
  return page
    .filter((row) => row.id.startsWith(HIST_PREFIX))
    .map((row) => row.id);
}

/**
 * Insert a row with an EXACT timestamp, bypassing `ensureConversation`
 * (which always stamps "now"). This is how a legacy row looks: the schema
 * default writes the space-separated `datetime('now')` shape, older code
 * paths wrote it by hand.
 *
 * Every fixture conversation also gets a learner prompt (TASK-150): the list
 * only serves conversations the learner spoke in, and these tests are about
 * ordering, paging and clamping, not about the filter.
 */
async function insertAt(id: string, stamp: string): Promise<void> {
  const db = await getChatDb();
  await db
    .insert(conversations)
    .values({ createdAt: stamp, id, title: null, updatedAt: stamp });
  await addLearnerPrompt(id, `prompt for ${id}`);
}

/** The row a learner's own prompt leaves behind: what makes a chat listable. */
async function addLearnerPrompt(
  conversationId: string,
  text: string
): Promise<void> {
  await appendMessage({
    content: { text },
    conversationId,
    frameType: "user_created",
    msgId: `${conversationId}-u`,
    turnId: `${conversationId}-t`,
  });
}

/** One frame row so a conversation has measurable content. */
async function addFrame(conversationId: string, text: string): Promise<void> {
  await appendMessage({
    content: { text },
    conversationId,
    frameType: "content",
    msgId: `${conversationId}-msg`,
  });
}

/**
 * The sidecar with a stub controller: the history surface never prompts an
 * agent, it only disposes a conversation's session on delete, so the stub
 * records that call instead of spawning a child.
 *
 * The router gets chat-store's OWN handle rather than resolving the provider
 * per call: this file's AC#3 case is a cross-plane read (the exam path writes
 * the paper and its anchor, the chat surface lists history), and both planes
 * must land on one database. `getChatDb` follows the provider, so pinning here
 * is what keeps a provider switch in another spec file from splitting the two
 * writes across two databases mid-test.
 */
async function bootHistoryServer(): Promise<{
  disposed: string[];
  server: ChatServer;
}> {
  const disposed: string[] = [];
  const chatDb = await getChatDb();
  const controller = {
    dispose: (sessionId: string): Promise<void> => {
      disposed.push(sessionId);
      return Promise.resolve();
    },
    handleFor: () => null,
  } as unknown as ChatController;
  const router = createRpcHandlers(
    {
      controller,
      // Never reached: the history surface takes no agent turn, so a call
      // here means a handler started a session it had no business starting.
      resolveHandle: () =>
        Promise.reject(
          new Error("history tests never resolve an agent handle")
        ),
    },
    async () => chatDb
  );
  const server = await bootChatServer({
    agent: {
      handle: (() => null) as never,
      script: new Map(),
    },
    db: chatDb,
    router,
  });
  return { disposed, server };
}

/** The oRPC error code a rejected call carried. */
async function errorCode(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("conversation history store (TASK-101)", () => {
  it("orders by activity across both timestamp shapes", async () => {
    // The space form sorts before the T form as TEXT on the same date, so
    // an 08:30 ISO row would outrank a later 09:00 legacy row without the
    // normalised recency key.
    await insertAt("hist-shape-iso", "2026-09-22T08:30:00.000Z");
    await insertAt("hist-shape-legacy", "2026-09-22 09:00:00");

    const page = await listConversations({ limit: 100 });
    expect(histIds(page.conversations)).toEqual([
      "hist-shape-legacy",
      "hist-shape-iso",
    ]);
    // The wire carries one shape, so the client can sort and display it.
    const legacy = page.conversations.find(
      (row) => row.id === "hist-shape-legacy"
    );
    expect(legacy?.updatedAt).toBe("2026-09-22T09:00:00.000Z");
  });

  it("unparseable timestamps sink instead of breaking the page", async () => {
    await insertAt("hist-junk-01", "(datetime('now'))");
    await insertAt("hist-junk-02", "2026-09-22T08:30:00.000Z");
    const page = await listConversations({ limit: 100 });
    const known = page.conversations.filter((row) =>
      row.id.startsWith("hist-junk-")
    );
    expect(known.map((row) => row.id)).toEqual([
      "hist-junk-02",
      "hist-junk-01",
    ]);
    expect(known.at(-1)?.updatedAt).toBe(EPOCH);
  });

  it("walks every conversation exactly once across keyset pages", async () => {
    const stamps = [
      "2026-09-20T00:00:00.000Z",
      "2026-09-21T00:00:00.000Z",
      "2026-09-22T00:00:00.000Z",
      "2026-09-23T00:00:00.000Z",
      "2026-09-24T00:00:00.000Z",
    ];
    await Promise.all(
      stamps.map((stamp, index) => insertAt(`hist-page-0${index + 1}`, stamp))
    );

    const walked: string[] = [];
    let cursor: import("../src/chat-store").HistoryCursor | null = null;
    let pages = 0;
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: a keyset walk is inherently sequential, each page needs the previous cursor.
      const page = await listConversations({
        before: cursor ?? undefined,
        limit: 2,
      });
      pages += 1;
      walked.push(...page.conversations.map((row) => row.id));
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
      expect(pages).toBeLessThan(50);
    }
    // The walk is total and non-repeating: every conversation, in list
    // order, exactly once, whatever else the shared test db holds.
    const whole = await listConversations({ limit: 100 });
    expect(whole.nextCursor).toBeNull();
    expect(walked).toEqual(whole.conversations.map((row) => row.id));
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked.filter((id) => id.startsWith("hist-page-"))).toEqual([
      "hist-page-05",
      "hist-page-04",
      "hist-page-03",
      "hist-page-02",
      "hist-page-01",
    ]);
  });

  it("clamps the page size to the contract's range", async () => {
    const db = await getChatDb();
    // The listable set, read straight from the rows (TASK-150): a
    // conversation the learner never spoke in is not on this page either.
    const counted = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(conversations)
      .where(
        sql`EXISTS (SELECT 1 FROM messages AS learner_frame
          WHERE learner_frame.conversation_id = conversations.id
            AND learner_frame.frame_type = 'user_created')`
      )
      .get();
    const total = Number(counted?.count ?? 0);
    // A zero page would be an off-by-one; a page above 100 would be an
    // unbounded read of the whole table.
    expect((await listConversations({ limit: 0 })).conversations).toHaveLength(
      1
    );
    const wide = await listConversations({ limit: 500 });
    expect(wide.conversations).toHaveLength(Math.min(total, 100));
  });

  it("renames without moving the conversation", async () => {
    await insertAt("hist-rename-old", "2026-09-20T00:00:00.000Z");
    await insertAt("hist-rename-new", "2026-09-21T00:00:00.000Z");
    const renamed = await renameConversation(
      "hist-rename-old",
      "Kanshi drill, week 3"
    );
    expect(renamed?.title).toBe("Kanshi drill, week 3");
    const page = await listConversations({ limit: 100 });
    expect(
      histIds(page.conversations).filter((id) => id.startsWith("hist-rename-"))
    ).toEqual(["hist-rename-new", "hist-rename-old"]);
    expect(
      await renameConversation("hist-rename-missing", "anything")
    ).toBeNull();
  });

  it("deletes a conversation and cascades its messages", async () => {
    await ensureConversation("hist-cascade-01", { agent: "fake" });
    await addFrame("hist-cascade-01", "one");
    await addFrame("hist-cascade-01", "two");
    await addFrame("hist-cascade-01", "three");
    await ensureConversation("hist-cascade-02", {});
    await addFrame("hist-cascade-02", "only");

    // Per-conversation, not a global count.
    expect((await getConversation("hist-cascade-01"))?.messageCount).toBe(3);
    expect((await getConversation("hist-cascade-02"))?.messageCount).toBe(1);

    expect(await deleteConversation("hist-cascade-01")).toEqual({
      deleted: true,
      messagesDeleted: 3,
    });
    expect(await getConversation("hist-cascade-01")).toBeNull();
    // The cascade is proven by the rows being gone, not by the count.
    expect(await listMessages("hist-cascade-01", { limit: 10 })).toEqual([]);
    expect(await deleteConversation("hist-cascade-01")).toBeNull();
    expect((await getConversation("hist-cascade-02"))?.messageCount).toBe(1);
  });

  it("seeds a title once and re-stamps recency on every turn", async () => {
    const first = await ensureConversation("hist-title-01", {
      agent: "fake",
      title: "derive from the first prompt",
    });
    expect(first.title).toBe("derive from the first prompt");
    const seeded = await getConversation("hist-title-01");

    await Bun.sleep(3);
    const second = await ensureConversation("hist-title-01", {
      title: "a later prompt must not win",
    });
    expect(second.title).toBe("derive from the first prompt");
    const afterTurn = await getConversation("hist-title-01");
    // A turn is the activity the list orders by, so it moves to the front.
    expect(Date.parse(afterTurn?.updatedAt ?? "")).toBeGreaterThan(
      Date.parse(seeded?.updatedAt ?? "")
    );

    // A stored rename survives a new turn the same way.
    await renameConversation("hist-title-01", "learner's own words");
    const third = await ensureConversation("hist-title-01", {
      title: "ignored",
    });
    expect(third.title).toBe("learner's own words");
  });

  it("lists only conversations the learner spoke in (TASK-150)", async () => {
    // The shape a paper built without a conversation leaves behind: a titled
    // row with frames and no learner turn. It is storage for something the
    // learner opens elsewhere, so offering it as a chat is a dead end.
    await ensureConversation("hist-no-learner-01", { title: "N1 paper" });
    await addFrame("hist-no-learner-01", "paper frame");
    await addFrame("hist-no-learner-01", "agent frame");
    await ensureConversation("hist-with-learner-01", {});
    await addLearnerPrompt("hist-with-learner-01", "make me a paper");
    await addFrame("hist-with-learner-01", "here it is");

    const ids = histIds(
      (await listConversations({ limit: 100 })).conversations
    );
    expect(ids).toContain("hist-with-learner-01");
    expect(ids).not.toContain("hist-no-learner-01");

    // The filter is on the LIST only: reading and renaming an id still work,
    // which is what the exam path and every older caller rely on.
    expect(await getConversation("hist-no-learner-01")).not.toBeNull();
    expect(
      await renameConversation("hist-no-learner-01", "still reachable")
    )?.toMatchObject({ id: "hist-no-learner-01", title: "still reachable" });
  });
});

describe("title backfill (TASK-107 AC#3/AC#4)", () => {
  it("names untitled chats from their first prompt; leaves the rest alone", async () => {
    // (a) Untitled + has a prompt -> named from the first user row.
    await ensureConversation("hist-bf-named", {});
    await addLearnerPrompt("hist-bf-named", "  Kanshi   drill  ");
    await addFrame("hist-bf-named", "agent reply");
    // (b) Untitled + NO prompt (pre-persistence data) -> stays untitled
    // (AC#4: no title is fabricated).
    await ensureConversation("hist-bf-empty", {});
    await addFrame("hist-bf-empty", "agent only");
    // (c) Already titled -> backfill must not overwrite the learner's name.
    await ensureConversation("hist-bf-keep", { title: "keep me" });
    await addLearnerPrompt("hist-bf-keep", "a different prompt");

    const named = await backfillConversationTitles();
    expect(named).toBeGreaterThanOrEqual(1);

    expect((await getConversation("hist-bf-named"))?.title).toBe(
      "Kanshi drill"
    );
    expect((await getConversation("hist-bf-empty"))?.title).toBeNull();
    expect((await getConversation("hist-bf-keep"))?.title).toBe("keep me");

    // Idempotent: a second pass does not rename the chat it already named,
    // and never touches the untitled-without-a-prompt one (an already-titled
    // row leaves the candidate set; a chat with no user row is never one).
    await backfillConversationTitles();
    expect((await getConversation("hist-bf-named"))?.title).toBe(
      "Kanshi drill"
    );
    expect((await getConversation("hist-bf-empty"))?.title).toBeNull();
  });
});

describe("conversation history surface (TASK-101)", () => {
  it("serves get, list, rename and delete over /rpc", async () => {
    const { disposed, server } = await bootHistoryServer();
    try {
      const { fetch: client } = server.clients;
      await ensureConversation("hist-rpc-01", {
        agent: "agy",
        assistant: "teacher",
        title: "Grammar questions",
      });
      await setUserAcpSessionId("hist-rpc-01", "sess-rpc-01");
      await addLearnerPrompt("hist-rpc-01", "explain the difference");
      await addFrame("hist-rpc-01", "the particle を takes after a verb");

      const conversation = await client.chat.getConversation({
        conversationId: "hist-rpc-01",
      });
      // Opening a conversation needs the agent it was created with: the
      // stored ACP session belongs to that CLI.
      expect(conversation.agent).toBe("agy");
      expect(conversation.assistant).toBe("teacher");
      expect(conversation.id).toBe("hist-rpc-01");
      expect(conversation.messageCount).toBe(2);
      expect(conversation.title).toBe("Grammar questions");
      expect(conversation.updatedAt).toMatch(ISO_STAMP_RE);

      const listed = await client.chat.listConversations({ limit: 100 });
      const mine = listed.conversations.filter((row) =>
        row.id.startsWith("hist-rpc-")
      );
      expect(mine.map((row) => row.id)).toContain("hist-rpc-01");
      expect(mine[0]?.messageCount).toBeTypeOf("number");

      const renamed = await client.chat.renameConversation({
        conversationId: "hist-rpc-01",
        title: "Particle drill",
      });
      expect(renamed.conversation.title).toBe("Particle drill");

      expect(
        await errorCode(
          client.chat.renameConversation({
            conversationId: "hist-rpc-missing",
            title: "anything",
          })
        )
      ).toBe("NOT_FOUND");
      expect(
        await errorCode(
          client.chat.getConversation({ conversationId: "hist-rpc-missing" })
        )
      ).toBe("NOT_FOUND");
      expect(
        await errorCode(
          client.chat.deleteConversation({ conversationId: "hist-rpc-missing" })
        )
      ).toBe("NOT_FOUND");

      expect(
        await client.chat.deleteConversation({
          conversationId: "hist-rpc-01",
        })
      ).toEqual({ deleted: true, messagesDeleted: 2 });
      expect(disposed).toEqual(["sess-rpc-01"]);
      expect(
        await errorCode(
          client.chat.getConversation({ conversationId: "hist-rpc-01" })
        )
      ).toBe("NOT_FOUND");
    } finally {
      await server.close();
    }
  }, 20_000);

  it("refuses to delete while a turn is in flight, then accepts it", async () => {
    const { server } = await bootHistoryServer();
    try {
      const { fetch: client } = server.clients;
      await ensureConversation("hist-busy-01", { title: "mid turn" });
      await addFrame("hist-busy-01", "hold on");
      // The turn gate is what `send` arms; a parked turn is exactly the
      // state the delete guard has to see.
      server.context.turns.set("hist-busy-01", {
        msgId: "msg-busy",
        turnId: "turn-busy",
      });

      expect(
        await errorCode(
          client.chat.deleteConversation({ conversationId: "hist-busy-01" })
        )
      ).toBe("CONVERSATION_BUSY");
      expect(await getConversation("hist-busy-01")).not.toBeNull();

      server.context.turns.delete("hist-busy-01");
      expect(
        await client.chat.deleteConversation({ conversationId: "hist-busy-01" })
      ).toEqual({ deleted: true, messagesDeleted: 1 });
    } finally {
      await server.close();
    }
  }, 20_000);

  it("drops the conversation's frame hub when it is deleted", async () => {
    const { server } = await bootHistoryServer();
    try {
      const { fetch: client } = server.clients;
      await ensureConversation("hist-hub-01", {});
      server.context.hubs.set("hist-hub-01", {
        // A hub shape only as a presence marker: the handler must forget
        // the conversation entirely, not just delete its rows.
      } as never);
      await client.chat.deleteConversation({ conversationId: "hist-hub-01" });
      expect(server.context.hubs.has("hist-hub-01")).toBe(false);
    } finally {
      await server.close();
    }
  }, 20_000);

  it("keeps a conversation-less paper out of the list but keeps the paper (TASK-150)", async () => {
    // doc-24 F-4: `exam.request` with no `conversationId` synthesises
    // `exam:<examId>` because the exam row and its paper frame are NOT NULL
    // foreign keys into `conversations`. The anchor stays (that is the chosen
    // shape, AC#2); what it must never buy is a history entry.
    const { server } = await bootHistoryServer();
    try {
      const { fetch: client } = server.clients;
      const requested = await client.exam.request({
        budget: { vocabulary: 1 },
        level: "N5",
        mode: "shortened",
        sections: ["vocabulary"],
      });
      if (!requested.conversationId) {
        throw new Error("paper request did not create a conversation");
      }
      await client.exam.assemble({ examId: requested.examId });

      const listed = await client.chat.listConversations({ limit: 100 });
      expect(listed.conversations.map((row) => row.id)).not.toContain(
        requested.conversationId
      );
      // The paper is stored against its anchor and reads back from it, so the
      // exclusion is the list only, not the data.
      expect(await getConversation(requested.conversationId)).not.toBeNull();
      expect(
        (await listMessages(requested.conversationId, { limit: 20 })).map(
          (row) => row.frameType
        )
      ).toContain("paper");

      // AC#4: nothing in the paper's own life depended on being a chat. It
      // opens, answers and submits from its exam id.
      const started = await client.exam.start({ examId: requested.examId });
      const [firstItem] = started.items;
      if (!firstItem) {
        throw new Error("assembled paper had no item to answer");
      }
      await client.exam.answer({
        examId: requested.examId,
        itemId: firstItem.item.id,
        selectedIndex: 0,
      });
      expect(
        await client.exam.submit({ examId: requested.examId })
      ).toMatchObject({ status: "submitted" });
    } finally {
      await server.close();
    }
  }, 120_000);
});
