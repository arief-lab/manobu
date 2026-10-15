import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createItemStore,
  type StoreItemInput,
  type UserDatabase,
} from "@manobu/db/item-store";
import { applyContentMigrations } from "@manobu/db/migrate";
import {
  cards,
  conversations,
  drillAttempts,
  revlog,
} from "@manobu/db/schema/user";
import { count, eq } from "drizzle-orm";
import { submitItemAnswer } from "../src/services/item-grading";
import { closeAndRemoveSqliteDb } from "./harness";

const DB_PATH = join(tmpdir(), `manobu-item-grading-${Date.now()}.db`);
const DB_URL = `file:${DB_PATH}`;
const NOW = new Date("2026-09-24T12:00:00.000Z");

process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.DATABASE_URL = DB_URL;

const { createUserDb } = await import("@manobu/db");

let db: UserDatabase;
let cardId = 0;

const itemInput = (
  id: string,
  overrides: Partial<StoreItemInput> = {}
): StoreItemInput => ({
  anchors: [`vocab:N5:${id}`],
  answerIndex: 0,
  fsrsVocabId: null,
  id,
  itemType: "grammar-form",
  level: "N5",
  options: ["は", "を", "に", "で"],
  prompt: "本___読みます。",
  surface: "drill",
  ...overrides,
});

beforeAll(async () => {
  applyContentMigrations(DB_URL);
  db = await createUserDb(DB_URL);
  await db
    .insert(conversations)
    .values({ id: "item-grading-conversation", title: "Items" });
  const [card] = await db
    .insert(cards)
    .values({
      due: "2026-09-24",
      jp: "食べる",
      level: "N5",
      reading: "たべる",
      vocabId: 1,
    })
    .returning({ id: cards.id });
  if (!card) {
    throw new Error("test card was not stored");
  }
  cardId = card.id;

  const store = createItemStore(db);
  await store.storeItem(itemInput("grammar-item"));
  await store.storeItem(
    itemInput("word-item", {
      answerIndex: 1,
      fsrsVocabId: 1,
      itemType: "word-in-context",
      options: ["たべる", "飲む", "読む", "見る"],
      prompt: "毎朝___ます。",
    })
  );
  await store.storeItem(
    itemInput("missing-card-item", {
      fsrsVocabId: 999,
      itemType: "word-in-context",
    })
  );
  await store.storeItem(
    itemInput("concurrent-item", {
      fsrsVocabId: 1,
      itemType: "word-in-context",
    })
  );
  await Promise.all(
    [
      "grammar-session",
      "word-session",
      "missing-card-session",
      "concurrent-session",
    ].map(async (id) =>
      store.createDrillSession({
        anchors: ["vocab:N5:test"],
        conversationId: "item-grading-conversation",
        declaredCount: 1,
        id,
        level: "N5",
        tier: "2",
      })
    )
  );
}, 120_000);

afterAll(() => {
  closeAndRemoveSqliteDb(db, DB_PATH);
});

const rowCount = async (
  table: typeof revlog | typeof drillAttempts,
  column: typeof revlog.cardId | typeof drillAttempts.itemId,
  value: number | string
): Promise<number> => {
  const [row] = await db
    .select({ value: count() })
    .from(table)
    .where(eq(column, value));
  return Number(row?.value ?? 0);
};

describe("TASK-123 item grading", () => {
  it("records a grammar attempt without writing FSRS", async () => {
    const result = await submitItemAnswer(
      db,
      {
        chosenIndex: 0,
        itemId: "grammar-item",
        responseQuality: "standard",
        sessionId: "grammar-session",
      },
      NOW
    );
    expect(result.recorded).toBe(true);
    expect(result.attempt.correct).toBe(true);
    expect(result.card).toBeNull();
    expect(await rowCount(revlog, revlog.cardId, cardId)).toBe(0);
  });

  it("writes one revlog for a word item and none for a replay", async () => {
    const first = await submitItemAnswer(
      db,
      {
        chosenIndex: 1,
        itemId: "word-item",
        responseQuality: "standard",
        sessionId: "word-session",
      },
      NOW
    );
    const replay = await submitItemAnswer(
      db,
      {
        chosenIndex: 0,
        itemId: "word-item",
        responseQuality: "fast",
        sessionId: "word-session",
      },
      NOW
    );
    expect(first.recorded).toBe(true);
    expect(first.card?.state).toBe("review");
    expect(first.card?.stability).toBeGreaterThan(0);
    expect(replay.recorded).toBe(false);
    expect(replay.attempt.id).toBe(first.attempt.id);
    expect(replay.attempt.chosenIndex).toBe(1);
    await createItemStore(db).pauseDrillSession("word-session");
    const pausedReplay = await submitItemAnswer(
      db,
      {
        chosenIndex: 0,
        itemId: "word-item",
        responseQuality: "fast",
        sessionId: "word-session",
      },
      NOW
    );
    expect(pausedReplay.recorded).toBe(false);
    expect(pausedReplay.attempt.id).toBe(first.attempt.id);
    expect(await rowCount(revlog, revlog.cardId, cardId)).toBe(1);
  });

  it("serializes concurrent retries into one recorded answer", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, async () =>
        submitItemAnswer(
          db,
          {
            chosenIndex: 0,
            itemId: "concurrent-item",
            responseQuality: "standard",
            sessionId: "concurrent-session",
          },
          NOW
        )
      )
    );
    expect(results.filter((result) => result.recorded)).toHaveLength(1);
    expect(new Set(results.map((result) => result.attempt.id)).size).toBe(1);
    expect(await rowCount(revlog, revlog.cardId, cardId)).toBe(2);
  });

  it("rolls back the attempt when an FSRS-linked card is missing", async () => {
    await expect(
      submitItemAnswer(
        db,
        {
          chosenIndex: 0,
          itemId: "missing-card-item",
          responseQuality: "standard",
          sessionId: "missing-card-session",
        },
        NOW
      )
    ).rejects.toThrow("no FSRS card exists for N5:999");
    expect(
      await rowCount(drillAttempts, drillAttempts.itemId, "missing-card-item")
    ).toBe(0);
  });
});
