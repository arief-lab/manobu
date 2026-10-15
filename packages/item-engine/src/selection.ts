import { hashString } from "./hash";
import type { ItemType } from "./types";

export type ItemBucket = "due" | "new" | "weak";

export interface SelectionCandidate<Item> {
  dueAt?: string | null;
  id: string;
  item: Item;
  itemType: ItemType;
  level: string;
  totalCount?: number;
  wrongCount?: number;
}

export interface SelectionPools<Item> {
  due: readonly SelectionCandidate<Item>[];
  new: readonly SelectionCandidate<Item>[];
  weak: readonly SelectionCandidate<Item>[];
}

export interface SelectItemsInput<Item> {
  count: number;
  level: string;
  maxPerType: number;
  pools: SelectionPools<Item>;
  seed: string;
  today: string;
}

export interface SelectedItem<Item> extends SelectionCandidate<Item> {
  bucket: ItemBucket;
}

export interface SelectItemsResult<Item> {
  selected: SelectedItem<Item>[];
  shortfall: number;
}

const MIX: readonly ItemBucket[] = ["due", "weak", "new", "due", "weak"];

const BUCKET_PRIORITY: Record<ItemBucket, number> = {
  due: 2,
  new: 0,
  weak: 1,
};

const isDue = (
  candidate: SelectionCandidate<unknown>,
  today: string
): boolean => !candidate.dueAt || candidate.dueAt.slice(0, 10) <= today;

const validateInput = (input: { count: number; maxPerType: number }): void => {
  if (!Number.isInteger(input.count) || input.count < 0) {
    throw new Error("item selection count must be a non-negative integer");
  }
  if (!Number.isInteger(input.maxPerType) || input.maxPerType < 1) {
    throw new Error("the per-item-type cap must be a positive integer");
  }
};

const addCandidates = <Item>(
  target: Map<string, SelectedItem<Item>>,
  candidates: readonly SelectionCandidate<Item>[],
  bucket: ItemBucket,
  today: string
): void => {
  for (const candidate of candidates) {
    if (bucket === "due" && !isDue(candidate, today)) {
      continue;
    }
    const existing = target.get(candidate.id);
    if (
      existing &&
      BUCKET_PRIORITY[existing.bucket] >= BUCKET_PRIORITY[bucket]
    ) {
      continue;
    }
    target.set(candidate.id, { ...candidate, bucket });
  }
};

const collectCandidates = <Item>(
  input: SelectItemsInput<Item>
): Map<string, SelectedItem<Item>> => {
  const candidates = new Map<string, SelectedItem<Item>>();
  addCandidates(candidates, input.pools.new, "new", input.today);
  addCandidates(candidates, input.pools.weak, "weak", input.today);
  addCandidates(candidates, input.pools.due, "due", input.today);
  return candidates;
};

const orderBucket = <Item>(
  candidates: SelectedItem<Item>[],
  bucket: ItemBucket,
  seed: string
): SelectedItem<Item>[] => {
  const ordered = [...candidates];
  if (bucket === "due") {
    ordered.sort(
      (left, right) =>
        (left.dueAt ?? "").localeCompare(right.dueAt ?? "") ||
        left.id.localeCompare(right.id)
    );
    return ordered;
  }
  if (bucket === "weak") {
    ordered.sort(
      (left, right) =>
        (right.wrongCount ?? 0) - (left.wrongCount ?? 0) ||
        (right.totalCount ?? 0) - (left.totalCount ?? 0) ||
        left.id.localeCompare(right.id)
    );
    return ordered;
  }
  ordered.sort((left, right) => {
    const leftHash = hashString(`${seed}\0new\0${left.id}`);
    const rightHash = hashString(`${seed}\0new\0${right.id}`);
    return leftHash - rightHash || left.id.localeCompare(right.id);
  });
  return ordered;
};

const buildBuckets = <Item>(
  input: SelectItemsInput<Item>
): Record<ItemBucket, SelectedItem<Item>[]> => {
  const buckets: Record<ItemBucket, SelectedItem<Item>[]> = {
    due: [],
    new: [],
    weak: [],
  };
  for (const candidate of collectCandidates(input).values()) {
    if (candidate.level === input.level) {
      buckets[candidate.bucket].push(candidate);
    }
  }
  for (const bucket of ["due", "new", "weak"] as const) {
    buckets[bucket] = orderBucket(buckets[bucket], bucket, input.seed);
  }
  return buckets;
};

const takeEligible = <Item>(
  pool: SelectedItem<Item>[],
  start: number,
  maxPerType: number,
  typeCounts: Map<ItemType, number>
): [SelectedItem<Item> | null, number] => {
  let cursor = start;
  while (cursor < pool.length) {
    const candidate = pool[cursor];
    if (!candidate) {
      break;
    }
    cursor += 1;
    const used = typeCounts.get(candidate.itemType) ?? 0;
    if (used < maxPerType) {
      typeCounts.set(candidate.itemType, used + 1);
      return [candidate, cursor];
    }
  }
  return [null, cursor];
};

export const selectItems = <Item>(
  input: SelectItemsInput<Item>
): SelectItemsResult<Item> => {
  validateInput(input);
  const buckets = buildBuckets(input);
  const cursors: Record<ItemBucket, number> = { due: 0, new: 0, weak: 0 };
  const typeCounts = new Map<ItemType, number>();
  const selected: SelectedItem<Item>[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const bucket = MIX[index % MIX.length] ?? "new";
    const [candidate, cursor] = takeEligible(
      buckets[bucket],
      cursors[bucket],
      input.maxPerType,
      typeCounts
    );
    cursors[bucket] = cursor;
    if (candidate) {
      selected.push(candidate);
    }
  }
  return { selected, shortfall: input.count - selected.length };
};
