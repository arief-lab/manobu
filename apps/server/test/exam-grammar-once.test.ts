import { beforeAll, describe, expect, it } from "bun:test";
import { createUserDb } from "@manobu/db";
import type { UserDatabase } from "@manobu/db/item-store";
import {
  type ExamClient,
  makeExamClient,
  prepareContentDb,
} from "./exam-harness";

/*
 * TASK-138 AC#9: a grammar anchor is spent once per paper ACROSS ITEM TYPES.
 *
 * AC#4 spends a vocabulary WORD once, and nothing stopped two item types from
 * spending the same grammar POINT. The TASK-144 baseline caught it by judging
 * ten assembled items by hand: the `particle` and `reading-info` items shared
 * `grammar:masu-polite-verb`, the same sentence and the same answer, so the
 * paper asked one question twice.
 *
 * The distribution is measured over five assembled papers rather than one,
 * because the defect is a subset - it only fires when the pool walk happens to
 * land two item types on the same point - and a single paper would prove
 * nothing either way. Before the fix this test measured 21 duplicate anchors
 * across those five papers; it now measures 0.
 */

const DB_URL = prepareContentDb("exam-grammar-once");

let client: ExamClient;

beforeAll(async () => {
  const db: UserDatabase = await createUserDb(DB_URL);
  client = makeExamClient(db);
});

const SEEDS = ["ac9-a", "ac9-b", "ac9-c", "ac9-d", "ac9-e"] as const;

/** Assemble one paper and return the grammar anchors per item. */
const grammarAnchorsOf = async (seed: string) => {
  const requested = await client.exam.request({
    level: "N5",
    mode: "shortened",
    sections: ["grammar-reading", "listening"],
    seed,
  });
  const assembled = await client.exam.assemble({ examId: requested.examId });
  const state = await client.exam.get({ examId: requested.examId });
  const rows: { anchor: string; itemType: string }[] = [];
  for (const entry of state.items) {
    // `answerIndex` is server-only, and this test only needs the anchors, so
    // the client projection is enough and no store round-trip is required.
    for (const anchor of entry.item.anchors) {
      if (anchor.startsWith("grammar:")) {
        rows.push({ anchor, itemType: entry.item.itemType });
      }
    }
  }
  return { assembled, rows };
};

describe("a paper never asks the same grammar question twice (TASK-138 AC#9)", () => {
  it("has no duplicated grammar anchor across five assembled papers", async () => {
    const duplicates: string[] = [];
    for (const seed of SEEDS) {
      // biome-ignore lint/performance/noAwaitInLoops: one libsql handle is shared, so five concurrent assemblies buy little and read worse
      const { rows } = await grammarAnchorsOf(seed);
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.anchor)) {
          duplicates.push(`${seed}: ${row.anchor} (${row.itemType})`);
        } else {
          seen.add(row.anchor);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("still fills its budget, because the walk has to fall through not give up", async () => {
    // The fix skips a spent point, so the failure mode to guard is a paper that
    // runs out of grammar and returns a shortfall instead of a shorter set of
    // repeats. Zero shortfall is part of the same property.
    for (const seed of SEEDS) {
      // biome-ignore lint/performance/noAwaitInLoops: as above
      const { assembled } = await grammarAnchorsOf(seed);
      expect(assembled.ready).toBe(true);
      expect(assembled.shortfall).toBe(0);
    }
  });
});
