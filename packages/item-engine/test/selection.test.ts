import { describe, expect, it } from "bun:test";

import {
  type SelectionCandidate,
  selectItems,
} from "@manobu/item-engine/selection";
import type { ItemType } from "@manobu/item-engine/types";

const itemTypes: readonly ItemType[] = [
  "conjugation",
  "grammar-form",
  "kana-cell",
  "word-in-context",
];

const candidate = (
  id: string,
  itemType: ItemType,
  dueAt: string | null = "2026-09-24"
): SelectionCandidate<string> => ({
  dueAt,
  id,
  item: id,
  itemType,
  level: "N5",
});

const pool = (
  prefix: string,
  itemTypeOffset = 0
): SelectionCandidate<string>[] =>
  Array.from({ length: 12 }, (_, index) =>
    candidate(
      `${prefix}-${index}`,
      itemTypes[(index + itemTypeOffset) % itemTypes.length] ??
        "word-in-context"
    )
  );

const emptyPools = { due: [], new: [], weak: [] };

describe("selectItems", () => {
  it("holds the 40/40/20 mix over a 20-item run", () => {
    const result = selectItems({
      count: 20,
      level: "N5",
      maxPerType: 12,
      pools: {
        due: pool("due"),
        new: pool("new", 1),
        weak: pool("weak", 2),
      },
      seed: "session-1",
      today: "2026-09-24",
    });
    const counts = { due: 0, new: 0, weak: 0 };
    for (const item of result.selected) {
      counts[item.bucket] += 1;
    }
    expect(counts).toEqual({ due: 8, new: 4, weak: 8 });
    expect(result.shortfall).toBe(0);
  });

  it("gives due precedence when one candidate exists in every pool", () => {
    const shared = candidate("shared", "word-in-context");
    const result = selectItems({
      count: 1,
      level: "N5",
      maxPerType: 4,
      pools: {
        due: [shared],
        new: [shared],
        weak: [shared],
      },
      seed: "seed",
      today: "2026-09-24",
    });
    expect(result.selected[0]?.id).toBe("shared");
    expect(result.selected[0]?.bucket).toBe("due");
  });

  it("places a distinct due candidate ahead of a distinct new candidate", () => {
    const result = selectItems({
      count: 2,
      level: "N5",
      maxPerType: 4,
      pools: {
        due: [candidate("due", "word-in-context")],
        new: [candidate("new", "word-in-context")],
        weak: [],
      },
      seed: "seed",
      today: "2026-09-24",
    });
    expect(result.selected.map((item) => item.id)).toEqual(["due"]);
    expect(result.shortfall).toBe(1);
  });

  it("keeps future-due overlaps in their weaker bucket", () => {
    const shared = candidate("future", "word-in-context", "2026-09-25");
    const fresh = candidate("fresh", "word-in-context");
    const result = selectItems({
      count: 3,
      level: "N5",
      maxPerType: 4,
      pools: {
        due: [shared],
        new: [shared, fresh],
        weak: [shared],
      },
      seed: "seed",
      today: "2026-09-24",
    });
    expect(result.selected.map((item) => item.bucket)).toEqual(["weak", "new"]);
    expect(result.shortfall).toBe(1);
  });

  it("is deterministic across input permutation", () => {
    const due = pool("due");
    const weak = pool("weak", 1);
    const fresh = pool("new", 2);
    const options = {
      count: 20,
      level: "N5",
      maxPerType: 12,
      seed: "fixed-seed",
      today: "2026-09-24",
    };
    const first = selectItems({
      ...options,
      pools: { due, new: fresh, weak },
    });
    const second = selectItems({
      ...options,
      pools: {
        due: [...due].reverse(),
        new: [...fresh].reverse(),
        weak: [...weak].reverse(),
      },
    });
    expect(second.selected.map((item) => item.id)).toEqual(
      first.selected.map((item) => item.id)
    );
  });

  it("shuffles a new pool whose ids differ only in their last character (TASK-135)", () => {
    // The property that matters, and the one a determinism assertion cannot
    // see: a sort key that differs only in its FINAL character orders by that
    // character, so these ids used to come back in pool order. That is the
    // `paper-<hex>` and `card-101` shape, so the new bucket was not shuffling
    // them at all. The selector has no production caller yet, which is the only
    // reason nobody had noticed.
    const endVarying = Array.from({ length: 8 }, (_, index) =>
      candidate(`card-10${index}`, "word-in-context", null)
    );
    const due = pool("due");
    const weak = pool("weak", 1);
    const options = {
      count: 20,
      level: "N5",
      maxPerType: 12,
      seed: "new-bucket-seed",
      today: "2026-09-24",
    };
    const select = (newPool: typeof endVarying) =>
      selectItems({ ...options, pools: { due, new: newPool, weak } })
        .selected.map((item) => item.id)
        .filter((id) => id.startsWith("card-"));

    const poolOrder = endVarying.map((item) => item.id);
    const drawn = select(endVarying);
    // The mix is a fixed 5-slot rotation, so a 20-item run draws new items; all
    // we claim is that their relative order is not the pool's.
    expect(drawn.length).toBeGreaterThan(1);
    expect(drawn).not.toEqual(poolOrder.slice(0, drawn.length));
    // Reversing the INPUT must not change the drawn order: the selection is a
    // function of the pool's contents, not of the order they arrived in.
    expect(select([...endVarying].reverse())).toEqual(drawn);
  });

  it("returns a shortfall instead of exceeding the per-type cap", () => {
    const result = selectItems({
      count: 20,
      level: "N5",
      maxPerType: 5,
      pools: {
        due: pool("due").map((item) => ({ ...item, itemType: "kana-cell" })),
        new: emptyPools.new,
        weak: emptyPools.weak,
      },
      seed: "seed",
      today: "2026-09-24",
    });
    expect(result.selected).toHaveLength(5);
    expect(result.shortfall).toBe(15);
    expect(result.selected.every((item) => item.itemType === "kana-cell")).toBe(
      true
    );
  });
});
