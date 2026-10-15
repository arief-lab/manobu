/*
 * SRS grading pipeline (TASK-53, refactored in TASK-71 phase 3): the FSRS
 * transition, revlog append, and card lookup are separate steps so the RPC
 * handler stays a thin orchestrator.
 *
 * The retention is a caller argument, never a constant in here. The desk
 * prints the interval it previews, so the write has to schedule at the same
 * number the learner chose (TASK-166).
 */

import type { createUserDb } from "@manobu/db";
import type { ItemStoreDatabase } from "@manobu/db/item-store";
import { cards, revlog } from "@manobu/db/schema/user";
import type { FsrsGradeName } from "@manobu/item-engine/grading";
import {
  daysElapsedSince,
  nextStates,
  scheduleDays,
  shouldMarkLeech,
} from "@manobu/srs";
import { and, eq } from "drizzle-orm";

const gradeMap = { again: 1, easy: 4, good: 3, hard: 2 } as const;

export type GradeCode = FsrsGradeName;
export type CardRow = typeof cards.$inferSelect;
export type GradeOutcome = Pick<
  CardRow,
  "difficulty" | "due" | "isLeech" | "lapses" | "stability" | "state"
>;

type UserDb = Awaited<ReturnType<typeof createUserDb>>;

async function lookupCard(
  db: ItemStoreDatabase,
  cardId: number
): Promise<CardRow | undefined> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  return card;
}

export async function lookupCardByVocab(
  db: ItemStoreDatabase,
  level: string,
  vocabId: number
): Promise<CardRow | undefined> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.level, level), eq(cards.vocabId, vocabId)));
  return card;
}

function fsrsTransition(
  card: CardRow,
  grade: GradeCode,
  now: Date,
  desiredRetention: number
) {
  const daysElapsed = daysElapsedSince(card.due, now);
  const previous =
    card.state === "new"
      ? null
      : { difficulty: card.difficulty, stability: card.stability };
  const states = nextStates(previous, desiredRetention, daysElapsed);
  const next = states[grade];
  // TASK-166: the preview on the desk's buttons is `previewIntervals`, which
  // is `scheduleDays` over these same states, so the day written here is the
  // day that was promised. `daysElapsedSince` and the retention both come
  // from the caller for the same reason.
  const due = new Date(now.getTime() + scheduleDays(next.interval) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { daysElapsed, due, next };
}

export async function applyGrade(
  db: ItemStoreDatabase,
  card: CardRow,
  grade: GradeCode,
  now: Date,
  desiredRetention: number
): Promise<GradeOutcome> {
  const { daysElapsed, next, due } = fsrsTransition(
    card,
    grade,
    now,
    desiredRetention
  );
  const lapses = grade === "again" ? card.lapses + 1 : card.lapses;
  const outcome: GradeOutcome = {
    difficulty: next.memory.difficulty,
    due,
    isLeech: card.isLeech || shouldMarkLeech(lapses),
    lapses,
    stability: next.memory.stability,
    state: "review",
  };

  await db.update(cards).set(outcome).where(eq(cards.id, card.id));

  await db.insert(revlog).values({
    cardId: card.id,
    deltaT: daysElapsed,
    dSnapshot: card.difficulty,
    grade: gradeMap[grade],
    rSnapshot: card.state === "new" ? null : daysElapsed,
    sSnapshot: card.stability,
    ts: now.toISOString().slice(0, 19).replace("T", " "),
  });

  return outcome;
}

export function gradeCardById(
  db: UserDb,
  cardId: number,
  grade: GradeCode,
  desiredRetention: number,
  now = new Date()
): Promise<CardRow | null> {
  return db.transaction(
    async (transaction) => {
      const card = await lookupCard(transaction, cardId);
      if (!card) {
        return null;
      }
      const outcome = await applyGrade(
        transaction,
        card,
        grade,
        now,
        desiredRetention
      );
      return { ...card, ...outcome };
    },
    { behavior: "immediate" }
  );
}
