import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createItemStore,
  type ItemStore,
  type UserDatabase,
} from "@manobu/db/item-store";
import { applyContentMigrations } from "@manobu/db/migrate";
import { conversations } from "@manobu/db/schema/user";
import { ITEM_TYPES, type QuestionItem } from "@manobu/item-engine/types";
import {
  createDrillLifecycle,
  type DrillBatchProvider,
  type DrillBatchResponse,
  type DrillLifecycle,
} from "../src/services/drill-lifecycle";
import { createCorpusDrillBatchProvider } from "../src/services/drill-provider";
import { closeAndRemoveSqliteDb } from "./harness";

const DB_PATH = join(tmpdir(), `manobu-drill-lifecycle-${Date.now()}.db`);
const DB_URL = `file:${DB_PATH}`;
const CONVERSATION_ID = "drill-lifecycle-conversation";

process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.DATABASE_URL = DB_URL;

const { createUserDb } = await import("@manobu/db");

let db: UserDatabase;
let itemStore: ItemStore;
let lifecycle: DrillLifecycle;
const invalidItemIds = new Set<string>();
let itemSequence = 0;

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (!resolve) {
    throw new Error("deferred promise was not initialized");
  }
  return { promise, resolve };
};

class FakeBatchProvider implements DrillBatchProvider {
  readonly calls: Parameters<DrillBatchProvider["produce"]>[0][] = [];
  private readonly responses: (
    | DrillBatchResponse
    | Promise<DrillBatchResponse>
  )[] = [];

  enqueue(response: DrillBatchResponse | Promise<DrillBatchResponse>): void {
    this.responses.push(response);
  }

  produce(
    request: Parameters<DrillBatchProvider["produce"]>[0]
  ): Promise<DrillBatchResponse> {
    this.calls.push(request);
    return Promise.resolve(
      this.responses.shift() ?? { exhausted: true, items: [] }
    );
  }
}

const flushAsync = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  attempt = 0
): Promise<void> => {
  if ((await condition()) || attempt >= 20) {
    return;
  }
  await flushAsync();
  return waitFor(condition, attempt + 1);
};

const item = (overrides: Partial<QuestionItem> = {}): QuestionItem => {
  itemSequence += 1;
  const id = overrides.id ?? `lifecycle-item-${itemSequence}`;
  return {
    anchors: [`anchor:${id}`],
    answerIndex: 0,
    id,
    itemType: "grammar-form",
    level: "N5",
    options: ["correct", "wrong-a", "wrong-b", "wrong-c"],
    prompt: `Prompt ${id}`,
    surface: "drill",
    ...overrides,
  };
};

const items = (
  count: number,
  overrides: Partial<QuestionItem> = {},
  prefix = ""
) =>
  Array.from({ length: count }, (_, index) =>
    item({
      id: `${prefix}batch-${Date.now()}-${itemSequence}-${index}`,
      ...overrides,
    })
  );

const validateItem = async (value: QuestionItem): Promise<boolean> =>
  !invalidItemIds.has(value.id);

const newHarness = (
  batches: FakeBatchProvider
): { batches: FakeBatchProvider; lifecycle: DrillLifecycle } => ({
  batches,
  lifecycle: createDrillLifecycle(db, { batches, validateItem }),
});

beforeAll(async () => {
  applyContentMigrations(DB_URL);
  db = await createUserDb(DB_URL);
  await db
    .insert(conversations)
    .values({ id: CONVERSATION_ID, title: "Drill lifecycle" });
  itemStore = createItemStore(db);
  lifecycle = createDrillLifecycle(db, {
    batches: new FakeBatchProvider(),
    validateItem,
  });
}, 120_000);

afterAll(() => {
  closeAndRemoveSqliteDb(db, DB_PATH);
});

const settle = async (
  target: DrillLifecycle,
  result: Extract<Awaited<ReturnType<DrillLifecycle["draw"]>>, { kind: "item" }>
) => {
  const settlement = await target.settle({
    chosenIndex: 0,
    itemId: result.item.id,
    responseQuality: "standard",
    sessionId: result.snapshot.sessionId,
  });
  expect(settlement.verdict.correct).toBe(true);
  return settlement;
};

describe("TASK-124 drill lifecycle", () => {
  it("replays the stored item id without calling the batch provider", async () => {
    const batches = new FakeBatchProvider();
    const harness = newHarness(batches);
    const stored = item({ id: "exact-replay-item", surface: "exam" });
    await itemStore.storeItem(stored);
    const opened = await harness.lifecycle.open({
      anchors: stored.anchors,
      conversationId: CONVERSATION_ID,
      count: 1,
      id: "exact-replay-session",
      itemId: stored.id,
      level: "N5",
      seed: "exact-replay",
      tier: "2",
    });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened" || opened.draw.kind !== "item") {
      return;
    }
    expect(opened.draw.item.id).toBe(stored.id);
    expect(batches.calls).toHaveLength(0);
    expect((await itemStore.resolveItem(stored.id))?.id).toBe(stored.id);

    await itemStore.markItemDisputed(stored.id, "2026-09-25T00:00:00.000Z");
    batches.enqueue({ items: [stored] });
    const future = await harness.lifecycle.open({
      anchors: stored.anchors,
      conversationId: CONVERSATION_ID,
      count: 1,
      id: "disputed-future-session",
      level: "N5",
      seed: "disputed-future",
      tier: "2",
    });
    expect(future.kind).toBe("unavailable");
  });

  it("does not open below the first batch", async () => {
    const batches = new FakeBatchProvider();
    batches.enqueue({ exhausted: true, items: items(2) });
    const harness = newHarness(batches);
    const result = await harness.lifecycle.open({
      anchors: ["anchor:first-batch"],
      conversationId: CONVERSATION_ID,
      count: 5,
      id: "first-batch-gate",
      level: "N5",
      seed: "first-batch",
      tier: "2",
    });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("no-valid-items");
    }
    expect(await itemStore.getDrillSessionState("first-batch-gate")).toBeNull();
  });

  it("rejects malformed provider items at the Zod boundary", async () => {
    const batches = new FakeBatchProvider();
    batches.enqueue({ exhausted: true, items: [{ prompt: "missing shape" }] });
    const harness = newHarness(batches);
    const result = await harness.lifecycle.open({
      anchors: ["anchor:zod"],
      conversationId: CONVERSATION_ID,
      count: 1,
      id: "zod-session",
      level: "N5",
      seed: "zod",
      tier: "2",
    });
    expect(result.kind).toBe("unavailable");
    expect(await itemStore.getDrillSessionState("zod-session")).toBeNull();
  });

  it("refills at runway three without blocking a pick and returns pending", async () => {
    const refill = deferred<DrillBatchResponse>();
    const batches = new FakeBatchProvider();
    batches.enqueue({ items: items(5) });
    batches.enqueue(refill.promise);
    const harness = newHarness(batches);
    const opened = await harness.lifecycle.open({
      anchors: ["anchor:runway"],
      conversationId: CONVERSATION_ID,
      count: 6,
      id: "runway-session",
      level: "N5",
      maxPerType: 6,
      seed: "runway",
      tier: "2",
    });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened") {
      return;
    }
    let current = opened.draw;
    expect(current.kind).toBe("item");
    if (current.kind !== "item") {
      return;
    }
    await settle(harness.lifecycle, current);
    current = await harness.lifecycle.draw(current.snapshot.sessionId);
    expect(current.kind).toBe("item");
    if (current.kind !== "item") {
      return;
    }
    await flushAsync();
    expect(batches.calls).toHaveLength(2);
    await settle(harness.lifecycle, current);
    current = await harness.lifecycle.draw(current.snapshot.sessionId);
    if (current.kind !== "item") {
      return;
    }
    await settle(harness.lifecycle, current);
    current = await harness.lifecycle.draw(current.snapshot.sessionId);
    if (current.kind !== "item") {
      return;
    }
    await settle(harness.lifecycle, current);
    current = await harness.lifecycle.draw(current.snapshot.sessionId);
    if (current.kind !== "item") {
      return;
    }
    await settle(harness.lifecycle, current);
    const pending = await harness.lifecycle.draw(current.snapshot.sessionId);
    expect(pending.kind).toBe("pending");
    if (pending.kind === "pending") {
      expect(pending.copyKey).toBe("drill.pending");
    }
    refill.resolve({ items: items(1) });
    await flushAsync();
    const next = await harness.lifecycle.draw(current.snapshot.sessionId);
    expect(next.kind).toBe("item");
  });

  it("does not commit a refill after supersession", async () => {
    const refill = deferred<DrillBatchResponse>();
    const batches = new FakeBatchProvider();
    batches.enqueue({ items: items(5) });
    batches.enqueue(refill.promise);
    const harness = newHarness(batches);
    const opened = await harness.lifecycle.open({
      anchors: ["anchor:stale-refill"],
      conversationId: CONVERSATION_ID,
      count: 6,
      id: "stale-refill-session",
      level: "N5",
      maxPerType: 5,
      seed: "stale-refill",
      tier: "2",
    });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened" || opened.draw.kind !== "item") {
      return;
    }
    await settle(harness.lifecycle, opened.draw);
    const second = await harness.lifecycle.draw(opened.draw.snapshot.sessionId);
    expect(second.kind).toBe("item");
    if (second.kind !== "item") {
      return;
    }
    await flushAsync();
    await harness.lifecycle.supersede(second.snapshot.sessionId);
    refill.resolve({ items: items(1) });
    await flushAsync();
    const state = await harness.lifecycle.snapshot(second.snapshot.sessionId);
    expect(state.generation).toBe(1);
    expect(state.readyCount).toBe(0);
    expect(
      (await itemStore.getDrillPool(second.snapshot.sessionId)).some(
        (entry) => entry.state === "ready"
      )
    ).toBe(false);
  });

  it("restores paused counts and the current item after reopening", async () => {
    const batches = new FakeBatchProvider();
    batches.enqueue({ items: items(3) });
    const harness = newHarness(batches);
    const opened = await harness.lifecycle.open({
      anchors: ["anchor:pause"],
      conversationId: CONVERSATION_ID,
      count: 3,
      id: "pause-session",
      level: "N5",
      seed: "pause",
      tier: "2",
    });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened" || opened.draw.kind !== "item") {
      return;
    }
    const paused = await harness.lifecycle.pause(
      opened.draw.snapshot.sessionId
    );
    expect(paused.phase).toBe("paused");
    expect(paused.answered).toBe(0);
    expect(paused.asked).toBe(1);
    expect(paused.remaining).toBe(2);

    db.$client.close();
    db = await createUserDb(DB_URL);
    itemStore = createItemStore(db);
    const restoredBatches = new FakeBatchProvider();
    lifecycle = createDrillLifecycle(db, {
      batches: restoredBatches,
      validateItem,
    });
    const restored = await lifecycle.snapshot(opened.draw.snapshot.sessionId);
    expect(restored.phase).toBe("paused");
    expect(restored.asked).toBe(1);
    expect(restored.answered).toBe(0);
    expect(restored.remaining).toBe(2);
    const pausedDraw = await lifecycle.draw(opened.draw.snapshot.sessionId);
    expect(pausedDraw.kind).toBe("paused");
    await lifecycle.resume(opened.draw.snapshot.sessionId);
    const resumedDraw = await lifecycle.draw(opened.draw.snapshot.sessionId);
    expect(resumedDraw.kind).toBe("item");
    if (resumedDraw.kind === "item") {
      expect(resumedDraw.item.id).toBe(opened.draw.item.id);
    }
  });

  it("supersedes unasked items at most twice without replacement", async () => {
    const batches = new FakeBatchProvider();
    batches.enqueue({ items: items(5) });
    const harness = newHarness(batches);
    const opened = await harness.lifecycle.open({
      anchors: ["anchor:supersede"],
      conversationId: CONVERSATION_ID,
      count: 5,
      id: "supersede-session",
      level: "N5",
      seed: "supersede",
      tier: "2",
    });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened") {
      return;
    }
    const first = await harness.lifecycle.supersede(
      opened.draw.snapshot.sessionId
    );
    expect(first.supersessionCount).toBe(1);
    await harness.lifecycle.supersede(opened.draw.snapshot.sessionId);
    const third = await harness.lifecycle.supersede(
      opened.draw.snapshot.sessionId
    );
    expect(third.supersessionCount).toBe(2);
    expect(batches.calls).toHaveLength(1);
    const pool = await itemStore.getDrillPool(opened.draw.snapshot.sessionId);
    expect(pool.filter((entry) => entry.state === "superseded")).toHaveLength(
      4
    );
  });

  it("drops an item that fails draw-time validation", async () => {
    const refill = deferred<DrillBatchResponse>();
    const batches = new FakeBatchProvider();
    const firstBatch = items(3);
    batches.enqueue({ items: firstBatch });
    batches.enqueue(refill.promise);
    const harness = newHarness(batches);
    const opened = await harness.lifecycle.open({
      anchors: ["anchor:invalid"],
      conversationId: CONVERSATION_ID,
      count: 3,
      id: "invalid-session",
      level: "N5",
      maxPerType: 3,
      seed: "invalid",
      tier: "2",
    });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened" || opened.draw.kind !== "item") {
      return;
    }
    invalidItemIds.add(firstBatch[1]?.id ?? "");
    await settle(harness.lifecycle, opened.draw);
    const next = await harness.lifecycle.draw(opened.draw.snapshot.sessionId);
    expect(next.kind).toBe("item");
    if (next.kind === "item") {
      expect(next.item.id).toBe(firstBatch[2]?.id ?? "");
    }
    const pool = await itemStore.getDrillPool(opened.draw.snapshot.sessionId);
    expect(
      pool.find((entry) => entry.itemId === firstBatch[1]?.id)?.state
    ).toBe("dropped");
    invalidItemIds.clear();
  });

  it("fills a default first batch across the per-type allowance", async () => {
    const provider = createCorpusDrillBatchProvider();
    const response = await provider.produce({
      anchors: [],
      count: 5,
      excludedItemIds: [],
      expectedGeneration: 0,
      level: "N5",
      remainingTypeAllowance: Object.fromEntries(
        ITEM_TYPES.map((itemType) => [itemType, 1])
      ) as Record<(typeof ITEM_TYPES)[number], number>,
      seed: "provider-default",
    });
    expect(response.items).toHaveLength(5);
    expect(
      new Set(
        response.items.map((candidate) => {
          const parsed = candidate as { itemType?: string };
          return parsed.itemType;
        })
      ).size
    ).toBe(5);
  });

  it("adds worked and near-neighbour items after two misses", async () => {
    const calls: Parameters<DrillBatchProvider["produce"]>[0][] = [];
    const adaptiveBatches: DrillBatchProvider = {
      produce: (request) => {
        calls.push(request);
        const adaptationItems = items(
          2,
          {
            anchors: ["anchor:adaptation"],
            prompt:
              request.adaptation === "worked-example"
                ? "Worked example: choose the matching word."
                : "Choose the near neighbour that completes the meaning.",
          },
          `${request.adaptation ?? "adaptation"}-`
        );
        return Promise.resolve({
          items:
            request.adaptation === undefined
              ? items(
                  request.count,
                  { anchors: ["anchor:adaptation"] },
                  "normal-"
                )
              : adaptationItems,
        });
      },
    };
    const target = createDrillLifecycle(db, {
      batches: adaptiveBatches,
      validateItem,
    });
    const opened = await target.open({
      anchors: ["anchor:adaptation"],
      conversationId: CONVERSATION_ID,
      count: 6,
      id: "adaptation-session",
      level: "N5",
      maxPerType: 6,
      seed: "adaptation",
      tier: "2",
    });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened" || opened.draw.kind !== "item") {
      return;
    }
    const first = await target.draw(opened.draw.snapshot.sessionId);
    expect(first.kind).toBe("item");
    if (first.kind !== "item") {
      return;
    }
    await target.settle({
      chosenIndex: 1,
      itemId: first.item.id,
      responseQuality: "standard",
      sessionId: first.snapshot.sessionId,
    });
    const second = await target.draw(first.snapshot.sessionId);
    expect(second.kind).toBe("item");
    if (second.kind !== "item") {
      return;
    }
    await target.settle({
      chosenIndex: 1,
      itemId: second.item.id,
      responseQuality: "standard",
      sessionId: second.snapshot.sessionId,
    });

    await waitFor(() => calls.filter((call) => call.adaptation).length === 2);
    const third = await target.draw(second.snapshot.sessionId);
    expect(third.kind).toBe("item");
    if (third.kind !== "item") {
      return;
    }
    await target.settle({
      chosenIndex: 0,
      itemId: third.item.id,
      responseQuality: "standard",
      sessionId: third.snapshot.sessionId,
    });
    await waitFor(async () =>
      (await itemStore.getDrillPool(second.snapshot.sessionId)).some(
        (entry) => entry.itemId === second.item.id && entry.state === "ready"
      )
    );
    const requeued = (
      await itemStore.getDrillPool(second.snapshot.sessionId)
    ).filter(
      (entry) => entry.itemId === second.item.id && entry.state === "ready"
    );
    expect(requeued).toHaveLength(1);
    expect(
      calls.filter((call) => call.adaptation).map((call) => call.adaptation)
    ).toEqual(["worked-example", "near-neighbour"]);
    const pool = await itemStore.getDrillPool(opened.draw.snapshot.sessionId);
    const prompts = await Promise.all(
      pool
        .filter((entry) => entry.state === "ready")
        .map((entry) => itemStore.renderItem(entry.itemId))
    );
    expect(
      prompts.some((rendered) => rendered?.prompt.startsWith("Worked example:"))
    ).toBe(true);
    expect(
      prompts.some((rendered) =>
        rendered?.prompt.startsWith("Choose the near neighbour")
      )
    ).toBe(true);
  });

  it("caps cheap item types while allowing a reading replacement", async () => {
    const refill = deferred<DrillBatchResponse>();
    const batches = new FakeBatchProvider();
    batches.enqueue({
      items: items(5, { itemType: "kana-cell" }),
    });
    batches.enqueue(refill.promise);
    const harness = newHarness(batches);
    const opened = await harness.lifecycle.open({
      anchors: ["anchor:cost"],
      conversationId: CONVERSATION_ID,
      count: 10,
      id: "cost-session",
      level: "N5",
      seed: "cost",
      tier: "2",
    });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened" || opened.draw.kind !== "item") {
      return;
    }
    await settle(harness.lifecycle, opened.draw);
    const second = await harness.lifecycle.draw(opened.draw.snapshot.sessionId);
    expect(second.kind).toBe("item");
    if (second.kind !== "item") {
      return;
    }
    await settle(harness.lifecycle, second);
    const pending = await harness.lifecycle.draw(second.snapshot.sessionId);
    expect(pending.kind).toBe("pending");
    refill.resolve({
      items: items(1, {
        itemType: "reading-info",
        passage: "Short reading passage.",
        script: "Short reading passage.",
      }),
    });
    await flushAsync();
    const reading = await harness.lifecycle.draw(second.snapshot.sessionId);
    expect(reading.kind).toBe("item");
    if (reading.kind === "item") {
      expect(reading.item.itemType).toBe("reading-info");
    }
    expect(batches.calls[1]?.remainingTypeAllowance["kana-cell"]).toBe(0);
  });
});
