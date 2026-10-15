/**
 * TASK-164: GET /cards/due is the DUE QUEUE, not a card browser.
 *
 * The desktop reads its "N cards due" through `orpc.cards.due()`
 * (apps/desktop/src/lib/cards.ts), so the predicate is proven on that surface:
 * real rows, moved by a real UPDATE, no mock of the query. The legacy Hono
 * route is pinned to the same answer because the two surfaces diverging is
 * exactly how "cards due" came to mean "up to 20 oldest cards".
 */
import { describe, expect, it } from "bun:test";

process.env.CORS_ORIGIN = "http://localhost:3000";

const { isolatedDbUrl } = await import("./harness");
const DB_URL = isolatedDbUrl("due-queue");
const { applyContentMigrations } = await import("@manobu/db/migrate");
applyContentMigrations(DB_URL);

const { createUserDb } = await import("@manobu/db");
const { cards: cardsTable } = await import("@manobu/db/schema/user");
const { eq } = await import("drizzle-orm");
const { createRouterClient } = await import("@orpc/server");
const { createRpcHandlers } = await import("../src/rpc");
const { createChatContext } = await import("../src/chat-hub");
const { createCardsRoute } = await import("../src/routes/cards");
const { isoDay } = await import("../src/services/due-queue");

const db = await createUserDb(DB_URL);
const getUserDb = async () => db;
const client = createRouterClient(createRpcHandlers({}, getUserDb), {
  context: createChatContext(),
});
const route = createCardsRoute(getUserDb);

const today = isoDay(new Date());

/** N UTC days from today. Shifted on the UTC day, not on local wall-clock,
 * so the offsets cannot collapse onto `today` near local midnight. */
const dayOffset = (offset: number): string =>
  isoDay(new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000));

const seedCard = async (vocabId: number): Promise<number> => {
  const { inserted } = await client.cards.create({
    cards: [
      {
        jp: `明日${vocabId}`,
        level: "N5",
        reading: `あした${vocabId}`,
        vocabId,
      },
    ],
  });
  const [id] = inserted;
  if (id === undefined) {
    throw new Error(`card ${vocabId} was not inserted`);
  }
  return id;
};

const setDue = async (id: number, due: string): Promise<void> => {
  await db.update(cardsTable).set({ due }).where(eq(cardsTable.id, id));
};

const queueDays = async (): Promise<string[]> => {
  const { cards: rows } = await client.cards.due();
  return rows.map((row) => row.due);
};

const routeQueue = async (): Promise<unknown[]> => {
  const res = await route.request("/cards/due");
  expect(res.status).toBe(200);
  const { cards: rows } = (await res.json()) as { cards: unknown[] };
  return rows;
};

describe("TASK-164 due queue", () => {
  it("excludes a card whose due day has not arrived", async () => {
    await db.delete(cardsTable);
    const future = await seedCard(1);
    const dueNow = await seedCard(2);
    await setDue(future, dayOffset(3));

    const rows = await client.cards.due();
    const ids = rows.cards.map((row) => row.id);

    expect(ids).toContain(dueNow);
    expect(ids).not.toContain(future);
  });

  it("keeps a card whose due day has passed", async () => {
    await db.delete(cardsTable);
    const overdue = await seedCard(3);
    await setDue(overdue, dayOffset(-5));

    expect(await queueDays()).toEqual([dayOffset(-5)]);
  });

  it("returns an empty queue when nothing is due (TASK-155 empty state, real API)", async () => {
    await db.delete(cardsTable);
    const first = await seedCard(4);
    const second = await seedCard(5);
    await setDue(first, dayOffset(1));
    await setDue(second, dayOffset(14));

    expect(await queueDays()).toEqual([]);
    expect(await routeQueue()).toEqual([]);
  });

  it("serves the overdue cards oldest first, and stops at today", async () => {
    await db.delete(cardsTable);
    const stale = await seedCard(6);
    const recent = await seedCard(7);
    const dueToday = await seedCard(8);
    const scheduled = await seedCard(9);
    await setDue(stale, dayOffset(-10));
    await setDue(recent, dayOffset(-1));
    await setDue(dueToday, today);
    await setDue(scheduled, dayOffset(2));

    expect(await queueDays()).toEqual([dayOffset(-10), dayOffset(-1), today]);
  });

  it("answers the same queue over the RPC and the legacy route", async () => {
    await db.delete(cardsTable);
    const dueNow = await seedCard(10);
    const future = await seedCard(11);
    await setDue(future, dayOffset(7));

    const { cards: rpcRows } = await client.cards.due();
    expect(await routeQueue()).toEqual(rpcRows);
    expect(rpcRows.map((row) => row.id)).toEqual([dueNow]);
  });
});

/* TASK-165: the response has to state what the whole queue and the whole deck
 * hold, because the page it carries cannot. These run over real rows through
 * both surfaces: the count is exactly the fact a second handler would stale. */
describe("TASK-165 queue size and next due", () => {
  it("counts every due row, past the 20 the page serves", async () => {
    await db.delete(cardsTable);
    const { inserted } = await client.cards.create({
      cards: Array.from({ length: 25 }, (_, i) => ({
        jp: `明日${i}`,
        level: "N5",
        reading: `あした${i}`,
        vocabId: 300 + i,
      })),
    });
    // A fresh insert is due today, so this table holds 25 due rows and no
    // future day. The queue read answers with all 25 counted and 20 of them.
    expect(inserted).toHaveLength(25);

    const summary = await client.cards.due();
    expect(summary.cards).toHaveLength(20);
    expect(summary.dueCount).toBe(25);
    expect(summary.deckCount).toBe(25);
    expect(summary.nextDue).toBeNull();

    const res = await route.request("/cards/due");
    expect(res.status).toBe(200);
    // Parsed through the contract, which is the single source both surfaces
    // answer to; the twin is only a twin if the whole body agrees, counts in.
    const { DueOutputSchema } = await import(
      "@manobu/api-contract/schemas/cards"
    );
    expect(DueOutputSchema.parse(await res.json())).toEqual(summary);
  });

  it("names the earliest day still waiting over a deck the learner owns", async () => {
    await db.delete(cardsTable);
    const soon = await seedCard(12);
    const far = await seedCard(13);
    await setDue(soon, dayOffset(2));
    await setDue(far, dayOffset(9));

    const summary = await client.cards.due();
    expect(summary.cards).toHaveLength(0);
    expect(summary.dueCount).toBe(0);
    // The live case this task was filed on: a card scheduled ahead read as
    // "0 cards due · 0 total" over a deck the learner owns. `dueCount` stays 0
    // (nothing is due), while `deckCount` and `nextDue` say what they have.
    expect(summary.deckCount).toBe(2);
    // The earliest future day, not the first row the table returned.
    expect(summary.nextDue).toBe(dayOffset(2));
  });
});
