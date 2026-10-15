import type { createUserDb } from "@manobu/db";
import {
  type CreateDrillSessionInput,
  createItemStore,
  type DrillPoolEntry,
  type DrillSessionState,
  type ItemForClient,
  type ItemResolution,
  type ItemStore,
  type StoredDrillAttempt,
} from "@manobu/db/item-store";
import {
  ITEM_SURFACES,
  ITEM_TYPES,
  type ItemType,
  type QuestionItem,
} from "@manobu/item-engine/types";
import { z } from "zod";

import { type ItemAnswerResult, submitItemAnswer } from "./item-grading";

interface DrawCandidate {
  clientItem: ItemForClient;
  item: QuestionItem;
}

export type DrillLifecyclePhase =
  | "active"
  | "completed"
  | "paused"
  | "unavailable";

export interface DrillLifecycleSnapshot {
  answered: number;
  asked: number;
  correct?: number;
  declaredCount: number;
  generation: number;
  maxPerType: number;
  nextReview?: string | null;
  pendingRefill: boolean;
  phase: DrillLifecyclePhase;
  readyCount: number;
  remaining: number;
  sessionId: string;
  skipped?: number;
  supersessionCount: number;
  unanswered?: number;
}

export interface DrillBatchRequest {
  adaptation?: "near-neighbour" | "worked-example";
  anchors: readonly string[];
  count: number;
  excludedItemIds: readonly string[];
  expectedGeneration: number;
  level: string;
  remainingTypeAllowance: Readonly<Record<ItemType, number>>;
  seed: string;
}

export interface DrillBatchResponse {
  exhausted?: boolean;
  items: readonly unknown[];
}

export interface DrillBatchProvider {
  produce: (request: DrillBatchRequest) => Promise<DrillBatchResponse>;
}

export interface DrillItemValidator {
  validate: (item: QuestionItem) => Promise<boolean>;
}

export interface DrillLifecycleDependencies {
  batches: DrillBatchProvider;
  validateItem: DrillItemValidator["validate"];
}

export interface OpenDrillInput {
  anchors: readonly string[];
  conversationId: string;
  count: number;
  id: string;
  itemId?: string;
  level: string;
  maxPerType?: number;
  seed: string;
  tier: string;
}

export interface DrillDrawItem {
  attemptId?: number;
  item: ItemForClient;
  kind: "item";
  snapshot: DrillLifecycleSnapshot;
}

export interface DrillDrawPending {
  copyKey: "drill.pending";
  kind: "pending";
  snapshot: DrillLifecycleSnapshot;
}

export interface DrillDrawPaused {
  kind: "paused";
  snapshot: DrillLifecycleSnapshot;
}

export interface DrillDrawCompleted {
  kind: "completed";
  snapshot: DrillLifecycleSnapshot;
}

export interface DrillDrawUnavailable {
  kind: "unavailable";
  snapshot: DrillLifecycleSnapshot;
}

export type DrillDrawResult =
  | DrillDrawCompleted
  | DrillDrawItem
  | DrillDrawPaused
  | DrillDrawPending
  | DrillDrawUnavailable;

export type DrillOpenResult =
  | { kind: "opened"; draw: DrillDrawResult; snapshot: DrillLifecycleSnapshot }
  | {
      kind: "unavailable";
      reason: "batch-failed" | "no-valid-items";
      snapshot: null;
    };

export interface DrillVerdict {
  chosenIndex: number;
  correct: boolean;
  correctIndex: number;
  correctOption: string;
  explanation: string | null;
}

export interface DrillSettlement {
  attempt: StoredDrillAttempt;
  card: ItemAnswerResult["card"];
  recorded: boolean;
  snapshot: DrillLifecycleSnapshot;
  verdict: DrillVerdict;
}

export interface DrillLifecycle {
  draw: (
    sessionId: string,
    options?: { allowDisputed?: boolean }
  ) => Promise<DrillDrawResult>;
  end: (sessionId: string) => Promise<DrillLifecycleSnapshot>;
  open: (input: OpenDrillInput) => Promise<DrillOpenResult>;
  pause: (sessionId: string) => Promise<DrillLifecycleSnapshot>;
  resume: (sessionId: string) => Promise<DrillLifecycleSnapshot>;
  settle: (input: {
    chosenIndex: number;
    itemId: string;
    responseQuality: "fast" | "slow" | "standard";
    sessionId: string;
  }) => Promise<DrillSettlement>;
  skip: (input: {
    itemId: string;
    sessionId: string;
  }) => Promise<DrillLifecycleSnapshot>;
  snapshot: (sessionId: string) => Promise<DrillLifecycleSnapshot>;
  supersede: (sessionId: string) => Promise<DrillLifecycleSnapshot>;
}

type UserDb = Awaited<ReturnType<typeof createUserDb>>;

const BATCH_SIZE = 5;
const RUNWAY_TARGET = 3;

const questionItemSchema = z.object({
  anchors: z.array(z.string().min(1)).min(1),
  answerIndex: z.number().int().nonnegative(),
  explanation: z.string().nullable().optional(),
  fsrsVocabId: z.number().int().positive().nullable().optional(),
  id: z.string().min(1),
  itemType: z.enum(ITEM_TYPES),
  level: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  passage: z.string().nullable().optional(),
  prompt: z.string().min(1),
  script: z.string().nullable().optional(),
  seedPart: z.string().nullable().optional(),
  surface: z.enum(ITEM_SURFACES),
});

const parseQuestionItem = (value: unknown): QuestionItem | null => {
  const result = questionItemSchema.safeParse(value);
  return result.success ? result.data : null;
};

const emptyTypeAllowance = (maxPerType: number): Record<ItemType, number> =>
  Object.fromEntries(
    ITEM_TYPES.map((itemType) => [itemType, maxPerType])
  ) as Record<ItemType, number>;

const isTerminalState = (state: DrillSessionState): boolean =>
  state.status === "completed";

const toSnapshot = (
  state: DrillSessionState,
  pendingRefill: boolean,
  nextReview: string | null = null
): DrillLifecycleSnapshot => ({
  answered: state.answered,
  asked: state.asked,
  correct: state.answeredCorrect,
  declaredCount: state.declaredCount,
  generation: state.generation,
  maxPerType: state.maxPerType,
  nextReview,
  pendingRefill,
  phase: isTerminalState(state) ? "completed" : state.status,
  readyCount: state.readyCount,
  remaining: state.remaining,
  sessionId: state.id,
  skipped: state.skipped,
  supersessionCount: state.supersessionCount,
  unanswered: Math.max(state.declaredCount - state.answered, 0),
});

const uniqueItems = (items: readonly QuestionItem[]): QuestionItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
};

const sessionInputFromOpen = (
  input: OpenDrillInput
): CreateDrillSessionInput => ({
  anchors: input.anchors,
  conversationId: input.conversationId,
  declaredCount: input.count,
  id: input.id,
  level: input.level,
  maxPerType: input.maxPerType,
  tier: input.tier,
});

const isActiveState = (state: DrillSessionState): boolean =>
  state.status === "active";

type SettleDrillInput = Parameters<DrillLifecycle["settle"]>[0];

export const createDrillLifecycle = (
  db: UserDb,
  dependencies: DrillLifecycleDependencies
): DrillLifecycle => {
  const store: ItemStore = createItemStore(db);
  const refills = new Map<string, Promise<void>>();
  const refillFailures = new Set<string>();
  const nextReviews = new Map<string, string | null>();
  const adaptedAnchors = new Set<string>();
  const adaptationTasks = new Map<string, Promise<void>>();
  const requeuedItems = new Set<string>();

  const getState = async (sessionId: string): Promise<DrillSessionState> => {
    const state = await store.getDrillSessionState(sessionId);
    if (!state) {
      throw new Error(`drill session ${sessionId} does not exist`);
    }
    return state;
  };

  const snapshot = async (
    sessionId: string
  ): Promise<DrillLifecycleSnapshot> => {
    const state = await getState(sessionId);
    return toSnapshot(
      state,
      refills.has(sessionId),
      nextReviews.get(sessionId) ?? null
    );
  };

  const typeCountsFor = async (
    state: DrillSessionState,
    pool: readonly DrillPoolEntry[],
    includeReady = true
  ): Promise<Map<ItemType, number>> => {
    const counts = new Map<ItemType, number>();
    const add = async (itemId: string): Promise<void> => {
      const item = await store.resolveItem(itemId);
      if (item) {
        counts.set(item.itemType, (counts.get(item.itemType) ?? 0) + 1);
      }
    };
    const itemIds = [
      ...state.askedItemIds,
      ...(includeReady
        ? pool
            .filter((entry) => entry.state === "ready")
            .map((entry) => entry.itemId)
        : []),
    ];
    await Promise.all(itemIds.map((itemId) => add(itemId)));
    return counts;
  };

  const allowanceFor = (
    counts: ReadonlyMap<ItemType, number>,
    maxPerType: number
  ): Record<ItemType, number> => {
    const allowance = emptyTypeAllowance(maxPerType);
    for (const itemType of ITEM_TYPES) {
      allowance[itemType] = Math.max(
        0,
        maxPerType - (counts.get(itemType) ?? 0)
      );
    }
    return allowance;
  };

  const requestBatch = async (
    state: DrillSessionState,
    count: number,
    adaptation?: "near-neighbour" | "worked-example"
  ): Promise<DrillBatchResponse> => {
    const pool = await store.getDrillPool(state.id);
    const counts = await typeCountsFor(state, pool);
    return dependencies.batches.produce({
      ...(adaptation === undefined ? {} : { adaptation }),
      anchors: state.anchors,
      count,
      excludedItemIds: [
        ...new Set([
          ...state.askedItemIds,
          ...pool.map((entry) => entry.itemId),
        ]),
      ],
      expectedGeneration: state.generation,
      level: state.level ?? "",
      remainingTypeAllowance: allowanceFor(counts, state.maxPerType),
      seed: state.id,
    });
  };

  const storeBatchItems = async (
    items: readonly unknown[]
  ): Promise<string[]> => {
    const candidates = uniqueItems(
      items
        .map((candidate) => parseQuestionItem(candidate))
        .filter((candidate): candidate is QuestionItem => candidate !== null)
    ).filter((candidate) => candidate.surface === "drill");
    const stored = await Promise.all(
      candidates.map(async (candidate) => {
        await store.storeItem(candidate);
        const storedItem = await store.resolveItem(candidate.id);
        if (!storedItem || storedItem.disputed) {
          return null;
        }
        return (await dependencies.validateItem(candidate))
          ? candidate.id
          : null;
      })
    );
    return stored.filter((id): id is string => id !== null);
  };

  const appendRefillItems = async (
    state: DrillSessionState,
    sessionId: string,
    itemIds: readonly string[]
  ): Promise<void> => {
    await db.transaction(
      async (transaction) =>
        createItemStore(transaction).appendDrillPoolItems({
          expectedGeneration: state.generation,
          itemIds,
          sessionId,
        }),
      { behavior: "immediate" }
    );
  };

  const markRefillExhausted = (
    sessionId: string,
    response: DrillBatchResponse,
    itemCount: number
  ): void => {
    if (itemCount === 0 && response.exhausted !== false) {
      refillFailures.add(sessionId);
    }
  };

  const runRefill = async (sessionId: string): Promise<void> => {
    try {
      const state = await getState(sessionId);
      if (!isActiveState(state) || state.remaining === 0) {
        return;
      }
      const response = await requestBatch(state, BATCH_SIZE);
      markRefillExhausted(sessionId, response, response.items.length);
      if (response.items.length === 0) {
        return;
      }
      const itemIds = await storeBatchItems(response.items);
      markRefillExhausted(sessionId, response, itemIds.length);
      if (itemIds.length === 0) {
        return;
      }
      await appendRefillItems(state, sessionId, itemIds);
      refillFailures.delete(sessionId);
    } catch {
      refillFailures.add(sessionId);
    }
  };

  const scheduleRefill = (sessionId: string): void => {
    if (refills.has(sessionId)) {
      return;
    }
    const refill = runRefill(sessionId).finally(() => {
      refills.delete(sessionId);
    });
    refills.set(sessionId, refill);
  };

  const preparePoolCandidate = async (
    sessionId: string,
    entry: DrillPoolEntry,
    state: DrillSessionState,
    counts: ReadonlyMap<ItemType, number>,
    allowDisputed = false
  ): Promise<DrawCandidate | null> => {
    const item = await store.resolveItem(entry.itemId);
    if (!item) {
      await store.dropDrillPoolItem(sessionId, entry.itemId, "invalid-at-draw");
      return null;
    }
    if (item.disputed && !allowDisputed) {
      await store.dropDrillPoolItem(sessionId, entry.itemId, "disputed");
      return null;
    }
    if ((counts.get(item.itemType) ?? 0) >= state.maxPerType) {
      await store.dropDrillPoolItem(sessionId, entry.itemId, "type-cap");
      return null;
    }
    if (!(await dependencies.validateItem(item))) {
      await store.dropDrillPoolItem(sessionId, entry.itemId, "invalid-at-draw");
      return null;
    }
    const clientItem = await store.renderItem(entry.itemId);
    return clientItem ? { clientItem, item } : null;
  };

  const claimPoolCandidate = async (
    sessionId: string,
    candidate: DrawCandidate
  ): Promise<DrillDrawResult> => {
    const claim = await db.transaction(
      async (transaction) =>
        createItemStore(transaction).claimDrillItem(
          sessionId,
          candidate.item.id
        ),
      { behavior: "immediate" }
    );
    const nextState = await getState(sessionId);
    if (nextState.readyCount <= RUNWAY_TARGET) {
      scheduleRefill(sessionId);
    }
    return {
      attemptId: claim.attempt.id,
      item: candidate.clientItem,
      kind: "item",
      snapshot: toSnapshot(
        nextState,
        refills.has(sessionId),
        nextReviews.get(sessionId) ?? null
      ),
    };
  };

  const pendingDraw = async (sessionId: string): Promise<DrillDrawResult> => {
    scheduleRefill(sessionId);
    const pendingState = await snapshot(sessionId);
    if (refillFailures.has(sessionId) && !pendingState.pendingRefill) {
      return { kind: "unavailable", snapshot: pendingState };
    }
    return {
      copyKey: "drill.pending",
      kind: "pending",
      snapshot: pendingState,
    };
  };

  const draw = async (
    sessionId: string,
    options: { allowDisputed?: boolean } = {}
  ): Promise<DrillDrawResult> => {
    const state = await getState(sessionId);
    if (state.status === "paused") {
      return { kind: "paused", snapshot: toSnapshot(state, false) };
    }
    const currentAttempt = await store.getCurrentDrillAttempt(sessionId);
    if (currentAttempt) {
      const currentItem = await store.renderItem(currentAttempt.itemId);
      if (!currentItem) {
        throw new Error(`drill item ${currentAttempt.itemId} does not exist`);
      }
      return {
        attemptId: currentAttempt.id,
        item: currentItem,
        kind: "item",
        snapshot: toSnapshot(
          state,
          refills.has(sessionId),
          nextReviews.get(sessionId) ?? null
        ),
      };
    }
    if (state.status === "completed" || state.remaining === 0) {
      return { kind: "completed", snapshot: toSnapshot(state, false) };
    }

    const pool = await store.getDrillPool(sessionId);
    const counts = await typeCountsFor(state, pool, false);
    const candidates = await Promise.all(
      pool
        .filter((entry) => entry.state === "ready")
        .map((entry) =>
          preparePoolCandidate(
            sessionId,
            entry,
            state,
            counts,
            options.allowDisputed === true
          )
        )
    );
    const candidate = candidates.find(
      (value): value is DrawCandidate => value !== null
    );
    return candidate
      ? claimPoolCandidate(sessionId, candidate)
      : pendingDraw(sessionId);
  };

  const collectInitialItems = async (
    input: OpenDrillInput,
    required: number,
    maxPerType: number,
    items: QuestionItem[] = [],
    ids = new Set<string>(),
    counts = new Map<ItemType, number>()
  ): Promise<{ exhausted: boolean; items: QuestionItem[] }> => {
    if (items.length >= required) {
      return { exhausted: false, items };
    }
    const response = await dependencies.batches.produce({
      anchors: input.anchors,
      count: required - items.length,
      excludedItemIds: [...ids],
      expectedGeneration: 0,
      level: input.level,
      remainingTypeAllowance: allowanceFor(counts, maxPerType),
      seed: input.seed,
    });
    const candidates = uniqueItems(
      response.items
        .map((value) => parseQuestionItem(value))
        .filter((value): value is QuestionItem => value !== null)
    ).filter(
      (candidate) => candidate.surface === "drill" && !ids.has(candidate.id)
    );
    const evaluated = await Promise.all(
      candidates.map(async (candidate) => {
        await store.storeItem(candidate);
        const stored = await store.resolveItem(candidate.id);
        if (!stored || stored.disputed) {
          return null;
        }
        return (await dependencies.validateItem(candidate)) ? candidate : null;
      })
    );
    const accepted = evaluated
      .filter((candidate): candidate is QuestionItem => candidate !== null)
      .slice(0, required - items.length);
    const nextIds = new Set(ids);
    for (const candidate of candidates) {
      nextIds.add(candidate.id);
    }
    for (const candidate of accepted) {
      counts.set(candidate.itemType, (counts.get(candidate.itemType) ?? 0) + 1);
    }
    const nextItems = [...items, ...accepted];
    const exhausted =
      response.exhausted === true ||
      response.items.length === 0 ||
      accepted.length === 0;
    if (exhausted) {
      return { exhausted: true, items: nextItems };
    }
    return collectInitialItems(
      input,
      required,
      maxPerType,
      nextItems,
      nextIds,
      counts
    );
  };

  const openExactItem = async (
    input: OpenDrillInput
  ): Promise<DrillOpenResult> => {
    const { itemId } = input;
    if (itemId === undefined) {
      throw new Error("an exact drill replay requires an item id");
    }
    const item = await store.resolveItem(itemId);
    if (item === null) {
      return { kind: "unavailable", reason: "no-valid-items", snapshot: null };
    }
    const valid = await dependencies.validateItem(item);
    if (!valid) {
      return { kind: "unavailable", reason: "no-valid-items", snapshot: null };
    }
    const session = await store.createDrillSession(
      sessionInputFromOpen({
        ...input,
        anchors: item.anchors,
        count: 1,
        level: item.level,
        maxPerType: 1,
      })
    );
    const stateAfterCreate = await getState(session.id);
    const inserted = await db.transaction(
      async (transaction) =>
        createItemStore(transaction).appendDrillPoolItems({
          expectedGeneration: stateAfterCreate.generation,
          itemIds: [item.id],
          sessionId: session.id,
        }),
      { behavior: "immediate" }
    );
    if (inserted !== 1) {
      await store.deleteDrillSession(session.id);
      return { kind: "unavailable", reason: "batch-failed", snapshot: null };
    }
    return {
      draw: await draw(session.id, { allowDisputed: true }),
      kind: "opened",
      snapshot: await snapshot(session.id),
    };
  };

  const open = async (input: OpenDrillInput): Promise<DrillOpenResult> => {
    if (input.itemId !== undefined) {
      return openExactItem(input);
    }
    if (!Number.isInteger(input.count) || input.count < 1) {
      throw new Error("a drill session count must be a positive integer");
    }
    const firstBatchSize = Math.min(BATCH_SIZE, input.count);
    const maxPerType =
      input.maxPerType ?? Math.max(1, Math.floor(input.count * 0.2));
    const initial = await collectInitialItems(
      input,
      firstBatchSize,
      maxPerType
    );
    if (initial.items.length < firstBatchSize) {
      return {
        kind: "unavailable",
        reason: initial.exhausted ? "no-valid-items" : "batch-failed",
        snapshot: null,
      };
    }
    const session = await store.createDrillSession(
      sessionInputFromOpen({
        ...input,
        maxPerType: input.maxPerType,
      })
    );
    const stateAfterCreate = await getState(session.id);
    const itemIds = initial.items
      .slice(0, firstBatchSize)
      .map((item) => item.id);
    const inserted = await db.transaction(
      async (transaction) =>
        createItemStore(transaction).appendDrillPoolItems({
          expectedGeneration: stateAfterCreate.generation,
          itemIds,
          sessionId: session.id,
        }),
      { behavior: "immediate" }
    );
    if (inserted < itemIds.length) {
      await store.deleteDrillSession(session.id);
      return {
        kind: "unavailable",
        reason: "batch-failed",
        snapshot: null,
      };
    }
    return {
      draw: await draw(session.id),
      kind: "opened",
      snapshot: await snapshot(session.id),
    };
  };

  const appendAdaptedItems = async (
    state: DrillSessionState,
    adaptation: "near-neighbour" | "worked-example"
  ): Promise<void> => {
    const response = await requestBatch(state, 2, adaptation);
    const itemIds = await storeBatchItems(response.items.slice(0, 2));
    if (itemIds.length > 0) {
      await appendRefillItems(state, state.id, itemIds);
    }
  };

  const appendAdaptationPair = async (
    state: DrillSessionState
  ): Promise<void> => {
    await appendAdaptedItems(state, "worked-example");
    await appendAdaptedItems(state, "near-neighbour");
  };

  const requeueAdaptedItem = async (
    state: DrillSessionState,
    itemId: string
  ): Promise<void> => {
    await store.requeueDrillItem(state.id, itemId, state.generation);
  };

  const scheduleAdaptation = (
    state: DrillSessionState,
    itemId: string,
    correct: boolean
  ): void => {
    const previous = adaptationTasks.get(state.id) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        const currentRefill = refills.get(state.id);
        if (currentRefill) {
          await currentRefill;
        }
        const current = await store.resolveItem(itemId);
        if (!current) {
          return;
        }
        const attempts = await store.getDrillAttempts(state.id);
        const resolved = await Promise.all(
          attempts.map(async (attempt) => ({
            attempt,
            item: await store.resolveItem(attempt.itemId),
          }))
        );
        const actions = current.anchors.flatMap((anchor) => {
          const anchored = resolved.filter(
            (
              entry
            ): entry is {
              attempt: (typeof attempts)[number];
              item: ItemResolution;
            } => entry.item?.anchors.includes(anchor) === true
          );
          const recent = anchored
            .filter((entry) => !entry.attempt.skipped)
            .slice(-2);
          const key = `${state.id}:${anchor}`;
          const pending: Promise<void>[] = [];
          if (
            !correct &&
            recent.length === 2 &&
            recent.every((entry) => entry.attempt.correct === false) &&
            !adaptedAnchors.has(key)
          ) {
            adaptedAnchors.add(key);
            pending.push(appendAdaptationPair(state));
          }
          if (correct) {
            const missed = anchored
              .filter(
                (entry) =>
                  !entry.attempt.skipped && entry.attempt.correct === false
              )
              .at(-1);
            const requeueKey = `${state.id}:${missed?.item.id ?? ""}`;
            if (missed && !requeuedItems.has(requeueKey)) {
              requeuedItems.add(requeueKey);
              pending.push(requeueAdaptedItem(state, missed.item.id));
            }
          }
          return pending;
        });
        await Promise.all(actions);
      })
      .catch(() => undefined);
    adaptationTasks.set(state.id, task);
  };

  const requireAskedAttempt = async (
    input: SettleDrillInput
  ): Promise<StoredDrillAttempt> => {
    const attempt = await store.getDrillAttempt(input.sessionId, input.itemId);
    if (!attempt) {
      throw new Error(`drill item ${input.itemId} was not asked`);
    }
    return attempt;
  };

  const requireSettlementItem = async (
    itemId: string
  ): Promise<ItemResolution> => {
    const item = await store.resolveItem(itemId);
    if (!item) {
      throw new Error(`drill item ${itemId} does not exist`);
    }
    return item;
  };

  const stateAfterSettlement = async (
    input: SettleDrillInput,
    result: ItemAnswerResult
  ): Promise<DrillSessionState> => {
    const state = await getState(input.sessionId);
    if (result.recorded && state.answered >= state.declaredCount) {
      return store.completeDrillSession(input.sessionId);
    }
    return state;
  };

  const scheduleSettlementWork = (
    state: DrillSessionState,
    input: SettleDrillInput,
    result: ItemAnswerResult
  ): void => {
    if (state.status === "active" && state.readyCount <= RUNWAY_TARGET) {
      scheduleRefill(input.sessionId);
    }
    if (result.recorded) {
      scheduleAdaptation(state, input.itemId, result.attempt.correct === true);
    }
  };

  const settle = async (input: SettleDrillInput): Promise<DrillSettlement> => {
    await requireAskedAttempt(input);
    const result = await submitItemAnswer(db, input);
    nextReviews.set(input.sessionId, result.card?.due ?? null);
    const item = await requireSettlementItem(input.itemId);
    const state = await stateAfterSettlement(input, result);
    scheduleSettlementWork(state, input, result);
    const snapshotValue = await snapshot(input.sessionId);
    return {
      attempt: result.attempt,
      card: result.card,
      recorded: result.recorded,
      snapshot: snapshotValue,
      verdict: {
        chosenIndex: input.chosenIndex,
        correct: result.attempt.correct === true,
        correctIndex: item.answerIndex,
        correctOption: item.options[item.answerIndex] ?? "",
        explanation: item.explanation,
      },
    };
  };
  const skip = async (input: {
    itemId: string;
    sessionId: string;
  }): Promise<DrillLifecycleSnapshot> => {
    const skipped = await store.skipDrillItem(input.sessionId, input.itemId);
    if (!skipped) {
      throw new Error(`drill item ${input.itemId} is not pending`);
    }
    let state = await getState(input.sessionId);
    if (state.asked >= state.declaredCount) {
      state = await store.completeDrillSession(input.sessionId);
    }
    if (state.status === "active" && state.readyCount <= RUNWAY_TARGET) {
      scheduleRefill(input.sessionId);
    }
    return snapshot(input.sessionId);
  };

  return {
    draw,
    end: async (sessionId) => {
      const state = await store.completeDrillSession(sessionId);
      refillFailures.delete(sessionId);
      return toSnapshot(state, false, nextReviews.get(sessionId) ?? null);
    },
    open,
    pause: async (sessionId) => {
      const state = await store.pauseDrillSession(sessionId);
      return toSnapshot(
        state,
        refills.has(sessionId),
        nextReviews.get(sessionId) ?? null
      );
    },
    resume: async (sessionId) => {
      const state = await store.resumeDrillSession(sessionId);
      return toSnapshot(
        state,
        refills.has(sessionId),
        nextReviews.get(sessionId) ?? null
      );
    },
    settle,
    skip,
    snapshot,
    supersede: async (sessionId) => {
      const result = await db.transaction(
        async (transaction) =>
          createItemStore(transaction).supersedeDrillPool(sessionId),
        { behavior: "immediate" }
      );
      if (!result.superseded) {
        return snapshot(sessionId);
      }
      refillFailures.delete(sessionId);
      return snapshot(sessionId);
    },
  };
};
