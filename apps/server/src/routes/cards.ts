import { zValidator } from "@hono/zod-validator";

// TASK-46: one shared drizzle client for the process — per-request
// createUserDb() opened a fresh libsql handle (fd churn, WAL touched on
// every request). libsql clients are safe to share; drizzle wraps them.

import { GradeInputSchema } from "@manobu/api-contract/schemas/cards";
import { cards } from "@manobu/db/schema/user";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { createFactory, type Factory } from "hono/factory";
import { z } from "zod";
import { isoDay, selectDueQueue } from "../services/due-queue";
import { gradeCardById } from "../services/grading";
import { getUserDb } from "../user-db";

const cardsFactory: Factory = createFactory();

const InsertCardsSchema = z.object({
  cards: z.array(
    z.object({
      // TASK-40: jp/level/reading snapshot stored on the card so /cards/due
      // can serve real words (vocabId alone is a position in a level file —
      // ambiguous across levels).
      jp: z.string(),
      level: z.string(),
      reading: z.string(),
      vocabId: z.number().int().positive(),
    })
  ),
});

// One schema for both cards surfaces: this route and the RPC handler validate
// the same `GradeInputSchema`, so they cannot disagree about what retention a
// grade may carry (TASK-166).
const validateGrade = zValidator("json", GradeInputSchema);

export const createCardsRoute = (
  /** TASK-53 DI seam: tests pass an isolated db factory; prod uses the
   * shared singleton. Signature matches createUserDb (url optional). */
  getUserDbOverride: typeof getUserDb = getUserDb
): Hono => {
  const app = cardsFactory.createApp();

  app.post("/cards", zValidator("json", InsertCardsSchema), async (c) => {
    const { cards: nextCards } = c.req.valid("json");
    const db = await getUserDbOverride();
    const now = isoDay(new Date());
    const results = await Promise.all(
      nextCards.map(async (card) => {
        const existing = await db
          .select()
          .from(cards)
          .where(
            and(eq(cards.level, card.level), eq(cards.vocabId, card.vocabId))
          )
          .then((rows) => rows[0]);
        if (existing) {
          return null;
        }
        const inserted = await db
          .insert(cards)
          .values({
            due: now,
            jp: card.jp,
            level: card.level,
            reading: card.reading,
            vocabId: card.vocabId,
          })
          .returning({ id: cards.id });
        return inserted[0]?.id ?? null;
      })
    );
    const inserted = results.filter((id): id is number => id !== null);
    return c.json({ inserted });
  });

  app.get("/cards/due", async (c) => {
    const db = await getUserDbOverride();
    // TASK-164: the due queue, not a card browser - only rows whose day has
    // arrived. TASK-165: the read also carries the queue's real size, the
    // deck's, and the next scheduled day. See services/due-queue.ts.
    return c.json(await selectDueQueue(db));
  });

  app.post("/cards/grade", validateGrade, async (c) => {
    const { cardId, desiredRetention, grade } = c.req.valid("json");
    const db = await getUserDbOverride();
    const card = await gradeCardById(db, cardId, grade, desiredRetention);
    if (!card) {
      return c.json({ error: "card not found" }, 404);
    }
    return c.json({ card });
  });

  return app;
};
