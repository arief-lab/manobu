/*
 * Older-history paging tests (TASK-106 AC#1/#2/#3/#4).
 *
 * The connect-time replay and the client's opening read carry the newest
 * 200 rows (listMessages's hard cap). These tests pin the path BACK from
 * that window's edge: walk `chat-store.listMessages`' keyset (`before` =
 * oldest held row id, strict `lt`) over a conversation longer than the
 * window, first through the store and then through the real /rpc surface,
 * asserting every row arrives exactly once in ascending order (AC#3) and
 * that rows persisted AFTER the opening page — the live-stream analogue —
 * never enter an older page (AC#4).
 *
 * Ids are prefixed `older-`: the chat-store singleton's in-memory db is
 * shared across server test files in this process.
 */

import { describe, expect, it } from "bun:test";

process.env.CORS_ORIGIN = "http://localhost:13000";
const { isolatedDbUrl } = await import("./harness");
const { setUserDbProvider, getUserDb } = await import("../src/user-db");
const DB_URL = isolatedDbUrl("chat-older-paging");
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

const { sql } = await import("drizzle-orm");
const { messages } = await import("@manobu/db/schema/user");
const { createRpcHandlers } = await import("../src/rpc");
const { appendMessage, ensureConversation, getChatDb, listMessages } =
  await import("../src/chat-store");
const { bootChatServer } = await import("./harness");
type ChatController = import("../src/chat-rpc").ChatController;
type StoredMessage = import("../src/chat-store").StoredMessage;
type PagingServer = Awaited<ReturnType<typeof bootChatServer>>;
type PagingClient = PagingServer["clients"]["fetch"];

/** Page size under test: the store's own cap, which is the replay window. */
const PAGE = 200;
/** Rows seeded in the long conversation: one full page plus a tail. */
const TOTAL_ROWS = PAGE + 60;
/** Pulls the seeded index back out of a row's frame text. */
const ROW_INDEX_RE = /\d+/u;

/** One distinct frame row; msgId unique so nothing folds onto another. */
async function addRow(
  conversationId: string,
  index: number
): Promise<StoredMessage> {
  return await appendMessage({
    content: { text: `row ${index}` },
    conversationId,
    frameType: "content",
    msgId: `${conversationId}-m${index}`,
  });
}

/** The row's seeded index, read back from its frame content. */
function rowIndex(content: string): number {
  const parsed = JSON.parse(content) as { text?: string };
  return Number(parsed.text?.match(ROW_INDEX_RE)?.[0] ?? -1);
}

/**
 * The paging invariant (AC#2/#3): ids strictly ascending with no
 * duplicate, the seeded texts pinning the exact 0..count-1 sequence, so a
 * skipped row would shift every later index and fail here.
 */
function assertFullWalk(
  count: number,
  ids: readonly number[],
  texts: readonly string[]
): void {
  expect(ids).toHaveLength(count);
  expect(new Set(ids).size).toBe(count);
  for (let i = 1; i < ids.length; i += 1) {
    expect(ids[i] ?? -1).toBeGreaterThan(ids[i - 1] ?? -2);
  }
  expect(texts.map(rowIndex)).toEqual(
    Array.from({ length: count }, (_, i) => i)
  );
}

/** Store-side walk: opening page, then backwards until a page comes short. */
async function walkStore(conversationId: string): Promise<StoredMessage[]> {
  const walked: StoredMessage[] = [];
  let cursor: number | undefined;
  let pages = 0;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: a keyset walk is inherently sequential, each page needs the previous cursor.
    const page = await listMessages(conversationId, {
      before: cursor,
      limit: PAGE,
    });
    pages += 1;
    expect(pages).toBeLessThan(20);
    walked.unshift(...page);
    if (page.length < PAGE) {
      break;
    }
    cursor = page[0]?.id;
  }
  return walked;
}

const createPagingServer = async (): Promise<PagingServer> => {
  const database = await getUserDb();
  const server = await bootChatServer({
    agent: { handle: (() => null) as never, script: new Map() },
    db: database,
    router: createRpcHandlers({
      controller: {
        dispose: () => Promise.resolve(),
        handleFor: () => null,
      } as unknown as ChatController,
      resolveHandle: () =>
        Promise.reject(new Error("paging tests never start a turn")),
    }),
  });
  return server;
};

const walkRpcMessages = async (
  fetchClient: PagingClient,
  conversationId: string
): Promise<{ content: string; id: number }[]> => {
  const walked: { content: string; id: number }[] = [];
  let cursor: number | undefined;
  let pages = 0;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: keyset walk, each page needs the previous cursor.
    const page = await fetchClient.chat.listMessages({
      before: cursor,
      conversationId,
      limit: PAGE,
    });
    pages += 1;
    expect(pages).toBeLessThan(20);
    walked.unshift(
      ...page.messages.map((row) => ({ content: row.content, id: row.id }))
    );
    if (page.messages.length < PAGE) {
      break;
    }
    cursor = page.messages[0]?.id;
  }
  return walked;
};

const assertStoredRowCount = async (
  conversationId: string,
  expected: number
): Promise<void> => {
  const db = await getChatDb();
  const counted = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(messages)
    .where(sql`${messages.conversationId} = ${conversationId}`)
    .get();
  expect(Number(counted?.count ?? 0)).toBe(expected);
};

describe("older-history paging store walk (TASK-106)", () => {
  it("reaches the first turn of a longer-than-window conversation with no gaps or dups", async () => {
    const conversationId = "older-store-01";
    await ensureConversation(conversationId, { agent: "fake" });
    const seeded: StoredMessage[] = [];
    for (let i = 0; i < TOTAL_ROWS; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: rows must land in id order; the keyset cursor is defined by insertion order.
      seeded.push(await addRow(conversationId, i));
    }

    // The opening window alone is NOT the whole transcript (AC#1 premise):
    // it drops the oldest TOTAL_ROWS-PAGE rows.
    const opening = await listMessages(conversationId, { limit: PAGE });
    expect(opening).toHaveLength(PAGE);
    expect(opening[0]?.id).toBe(seeded[TOTAL_ROWS - PAGE]?.id);

    const walked = await walkStore(conversationId);
    assertFullWalk(
      TOTAL_ROWS,
      walked.map((row) => row.id),
      walked.map((row) => row.content)
    );
    expect(walked[0]?.id).toBe(seeded[0]?.id);
    expect(walked.at(-1)?.id).toBe(seeded.at(-1)?.id);
  });

  it("keeps rows persisted after the opening page out of older pages (AC#4)", async () => {
    const conversationId = "older-mid-01";
    await ensureConversation(conversationId, { agent: "fake" });
    for (let i = 0; i < TOTAL_ROWS; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: insertion order defines the keyset.
      await addRow(conversationId, i);
    }
    const opening = await listMessages(conversationId, { limit: PAGE });
    const [edge] = opening;
    if (edge === undefined) {
      throw new Error("opening page unexpectedly empty");
    }

    // The live-stream analogue: rows persisted while the learner pages
    // back get HIGHER ids, so an older page (strict `lt` cursor) cannot
    // pick them up and cannot shift the window already held.
    const late = await addRow(conversationId, TOTAL_ROWS);
    const older = await listMessages(conversationId, {
      before: edge.id,
      limit: PAGE,
    });
    expect(older.every((row) => row.id < edge.id)).toBe(true);
    expect(older.map((row) => row.id)).not.toContain(late.id);
    // Walking to the start still yields every row exactly once, the late
    // row included (it simply sits at the end of the sequence).
    const walked = await walkStore(conversationId);
    assertFullWalk(
      TOTAL_ROWS + 1,
      walked.map((row) => row.id),
      walked.map((row) => row.content)
    );
  });
});

describe("older-history paging over the /rpc surface (TASK-106)", () => {
  it("chat.listMessages serves the same gap-free backwards walk", async () => {
    const conversationId = "older-rpc-01";
    await ensureConversation(conversationId, { agent: "fake" });
    const seeded: StoredMessage[] = [];
    for (let i = 0; i < TOTAL_ROWS; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: insertion order defines the keyset.
      seeded.push(await addRow(conversationId, i));
    }

    const server = await createPagingServer();
    try {
      const walked = await walkRpcMessages(
        server.clients.fetch,
        conversationId
      );
      assertFullWalk(
        TOTAL_ROWS,
        walked.map((row) => row.id),
        walked.map((row) => row.content)
      );
      expect(walked[0]?.id).toBe(seeded[0]?.id);
      expect(walked.at(-1)?.id).toBe(seeded.at(-1)?.id);

      await assertStoredRowCount(conversationId, TOTAL_ROWS);
    } finally {
      await server.close();
    }
  }, 30_000);
});
