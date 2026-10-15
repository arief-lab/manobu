import { DEFAULT_RETENTION } from "@manobu/api-contract/schemas/cards";
import type { createUserDb } from "@manobu/db";
import {
  createItemStore,
  type StoredDrillAttempt,
} from "@manobu/db/item-store";
import {
  type FsrsGradeName,
  mapAttemptToFsrsGrade,
  type ResponseQuality,
} from "@manobu/item-engine/grading";

import { applyGrade, type CardRow, lookupCardByVocab } from "./grading";

export interface SubmitItemAnswerInput {
  chosenIndex: number;
  itemId: string;
  responseQuality: ResponseQuality;
  sessionId: string;
}

export interface ItemAnswerResult {
  attempt: StoredDrillAttempt;
  card: CardRow | null;
  recorded: boolean;
}

type UserDb = Awaited<ReturnType<typeof createUserDb>>;

const transactionLocks = new WeakMap<UserDb, Promise<void>>();

export async function submitItemAnswer(
  db: UserDb,
  input: SubmitItemAnswerInput,
  now = new Date()
): Promise<ItemAnswerResult> {
  const previous = transactionLocks.get(db) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  transactionLocks.set(db, queued);
  await previous;

  try {
    return await db.transaction(
      async (transaction) => {
        const store = createItemStore(transaction);
        const answer = await store.answerDrillItem(
          input.sessionId,
          input.itemId,
          input.chosenIndex
        );
        if (!answer.recorded) {
          return { attempt: answer.attempt, card: null, recorded: false };
        }

        const item = await store.resolveItem(input.itemId);
        if (!item) {
          throw new Error(`item ${input.itemId} does not exist`);
        }

        let grade: FsrsGradeName | null = null;
        if (item.fsrsVocabId !== null) {
          if (answer.attempt.correct) {
            grade = mapAttemptToFsrsGrade({
              correct: true,
              fsrsLinked: true,
              responseQuality: input.responseQuality,
            });
          } else {
            grade = mapAttemptToFsrsGrade({
              correct: false,
              fsrsLinked: true,
            });
          }
        }
        if (!grade || item.fsrsVocabId === null) {
          return { attempt: answer.attempt, card: null, recorded: true };
        }

        const card = await lookupCardByVocab(
          transaction,
          item.level,
          item.fsrsVocabId
        );
        if (!card) {
          throw new Error(
            `no FSRS card exists for ${item.level}:${item.fsrsVocabId}`
          );
        }
        // The drill has no interval preview, so it schedules at the contract's
        // default retention. It is a caller argument here rather than a
        // constant inside `applyGrade` so that the review desk cannot reach it
        // by accident (TASK-166).
        const outcome = await applyGrade(
          transaction,
          card,
          grade,
          now,
          DEFAULT_RETENTION
        );
        return {
          attempt: answer.attempt,
          card: { ...card, ...outcome },
          recorded: true,
        };
      },
      { behavior: "immediate" }
    );
  } finally {
    release();
    if (transactionLocks.get(db) === queued) {
      transactionLocks.delete(db);
    }
  }
}
