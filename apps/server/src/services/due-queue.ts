import type { DueOutput } from "@manobu/api-contract/schemas/cards";
import type { UserDatabase } from "@manobu/db/item-store";
import { cards } from "@manobu/db/schema/user";
import { asc, count, gt, lte } from "drizzle-orm";

/** Rows one queue read serves. The review desk slices its batch out of these. */
const QUEUE_LIMIT = 20;

/**
 * The `cards.due` column is date-granular: both writers (the insert in
 * `routes/cards.ts` / `rpc.ts`, and the FSRS transition in
 * `services/grading.ts`) store `toISOString()` truncated to `YYYY-MM-DD`. So
 * comparing that text lexicographically IS comparing the days; anything finer
 * silently mis-orders the queue.
 */
export const isoDay = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * `GET /cards/due` is the DUE QUEUE (TASK-164), not a card browser: a card
 * scheduled for a future day is not in it. That predicate is what makes
 * "N cards due" true on the dashboard tile and the desk header, and what makes
 * the desk's empty state reachable through the real API. Both handlers read
 * through here so the route and the RPC cannot disagree about what is due.
 *
 * The response also has to say how big that queue is (TASK-165). `cards` is a
 * page, so its length caps every claim a surface could make from it: a learner
 * with 200 due was told "20 cards due · 20 total", and one with nothing due and
 * a card scheduled for Thursday was told "0 total" over a deck they own. So the
 * three counts are read from the table here, beside the page, and no consumer
 * has to guess what a slice cannot answer.
 */
export const selectDueQueue = async (db: UserDatabase): Promise<DueOutput> => {
  const today = isoDay(new Date());
  const [page, dueRows, deckRows, nextRows] = await Promise.all([
    db
      .select()
      .from(cards)
      .where(lte(cards.due, today))
      .orderBy(asc(cards.due))
      .limit(QUEUE_LIMIT),
    db.select({ n: count() }).from(cards).where(lte(cards.due, today)),
    db.select({ n: count() }).from(cards),
    // The earliest future day, walked rather than aggregated: `ORDER BY due`
    // over the queue's own index puts it first.
    db
      .select({ due: cards.due })
      .from(cards)
      .where(gt(cards.due, today))
      .orderBy(asc(cards.due))
      .limit(1),
  ]);
  return {
    cards: page,
    deckCount: deckRows[0]?.n ?? 0,
    dueCount: dueRows[0]?.n ?? 0,
    nextDue: nextRows[0]?.due ?? null,
  };
};
