import { beforeAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __test__ as corpusTest,
  usageStoreFor,
} from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  connectExamClient,
  type ExamClient,
  newCatalog,
  prepareContentDb,
} from "./exam-harness";

const DB_URL = prepareContentDb("exam-youhou");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

const buildRealN3Vocabulary = async (seed: string) => {
  const requested = await client.exam.request({
    budget: { "grammar-reading": 400, vocabulary: 400 },
    level: "N3",
    mode: "real",
    sections: ["vocabulary", "grammar-reading"],
    seed,
  });
  await client.exam.assemble({ examId: requested.examId });
  return client.exam.get({ examId: requested.examId });
};

const { usageSourceFor } = __test__;

/*
 * TASK-173.9.23: authentic 用法 material for the 用法 大問.
 *
 * The official ねらい (doc-26 §3.3) asks the learner to pick the grammatically
 * correct form to complete a sentence. The 用法 block (`youhou`) sits in the
 * vocabulary 科目 at N1 (大問4, 6 小問), N2 (大問6, 5) and N3 (大問5, 5).
 * This file pins the store, the picker, the content gate and the real-paper
 * fill/shortfall at N3.
 *
 *   - the store (`usageStoreFor`): N1 24 / N2 20 / N3 22 validated rows (the
 *     TASK-173.9.23.2 top-up took them past the four-paper depth floor of
 *     大問 count × 4), each `provenance: "composed"` and carrying the
 *     solvability-gate provenance (`sourceIds` naming the licensed pattern it
 *     was built from).
 *   - the picker (`usageSourceFor`): one stem sentence per 小問, `seenAnchors`
 *     honored, an empty level declined rather than invented.
 *   - the real-paper fill/shortfall (AC#4, TASK-173.9.23.1): a real N3 paper
 *     carries 用法 小問 from the validated store; the inverse (usage store
 *     drained) names the 用法 大問 as a hole.
 */

describe("the 用法 store", () => {
  it("ships twenty-four composed rows at N1", () => {
    const store = usageStoreFor("N1");
    expect(store).toHaveLength(24);
    for (const entry of store) {
      expect(entry.block).toBe("youhou");
      expect(entry.level).toBe("N1");
      expect(entry.provenance).toBe("composed");
      // The generator's `sourceIds` field names the licensed pattern each row was
      // built from; a row that cannot be traced back to `grammar/n1.json` is not
      // an authored row, it is a fabrication.
      expect(Array.isArray(entry.sourceIds)).toBe(true);
      expect((entry.sourceIds ?? []).length).toBeGreaterThan(0);
      expect(entry.options).toHaveLength(4);
      expect(new Set(entry.options).size).toBe(4);
      expect(entry.validated ?? false).toBe(true);
    }
  });

  it("ships twenty composed rows at N2", () => {
    const store = usageStoreFor("N2");
    expect(store).toHaveLength(20);
    for (const entry of store) {
      expect(entry.level).toBe("N2");
      expect(entry.options).toHaveLength(4);
      expect(entry.validated ?? false).toBe(true);
    }
  });

  it("ships twenty-two composed rows at N3", () => {
    const store = usageStoreFor("N3");
    expect(store).toHaveLength(22);
    for (const entry of store) {
      expect(entry.level).toBe("N3");
      expect(entry.options).toHaveLength(4);
      expect(entry.validated ?? false).toBe(true);
    }
  });

  it("ships nineteen composed rows at N4, one short of the four-paper floor (TASK-179)", () => {
    // The N4 用法 rows come from the licensed grammar patterns the gate
    // re-derives its key from, so the level ships what the source can prove and
    // no more: 19 certified rows against the 5 小問 × 4 papers standard of 20.
    // The picker spends each stem once per paper, so the fourth N4 real paper
    // comes up short on this 大問 rather than inventing a twenty-first row.
    const store = usageStoreFor("N4");
    expect(store).toHaveLength(19);
    for (const entry of store) {
      expect(entry.level).toBe("N4");
      expect(entry.options).toHaveLength(4);
      expect(entry.validated ?? false).toBe(true);
    }
  });

  it("declines N5, which prints no 用法 大問", () => {
    // Only the shortage differs between the levels: N5's paper has no 用法 小問
    // to fill (doc-26 §3.1), so an empty store there is the shape of the level,
    // not a hole in the plan.
    expect(usageStoreFor("N5")).toHaveLength(0);
  });

  it("clears the four-paper depth floor at every level it prints (TASK-173.9.23.2 AC#4)", () => {
    // The depth standard (same owner rule as 読解) is that the 大問 can print
    // four papers' worth of 小問 without the store running dry: rows >= the
    // block count x 4. N1 prints 6 小問, N2 and N3 print 5. Within a paper the
    // picker spends each sentence once (the "spends the stem" test below).
    expect(usageStoreFor("N1").length).toBeGreaterThanOrEqual(6 * 4);
    expect(usageStoreFor("N2").length).toBeGreaterThanOrEqual(5 * 4);
    expect(usageStoreFor("N3").length).toBeGreaterThanOrEqual(5 * 4);
  });
});

describe("usageSourceFor", () => {
  it("turns one store row into a source that carries its own stem", () => {
    const source = usageSourceFor({
      catalog: newCatalog(),
      index: 0,
      level: "N3",
      offset: 0,
    });
    expect(source).not.toBeNull();
    const s = source as NonNullable<ReturnType<typeof usageSourceFor>>;
    expect(s.passage).not.toBeNull();
    // The picker returns the THREE wrong options; option 0 (the target) rides
    // `s.target`, so the four-option 小問 is `s.target` + `s.distractors`.
    expect(s.distractors).toHaveLength(3);
    expect(s.target).toBeDefined();
    // Both blind passes ran over independently shuffled packets, so agreement
    // is on the KEY FORM, never on an option position; every shipped row passed
    // that way, so `validated` is true and the row serves a real paper.
    expect(s.validated).toBe(true);
    // The stem sentence travels as `passage`, the fixed 用法 instruction line as
    // `cue`; the Japanese question is never leaked into `prompt` (the daily-mode
    // line only, which a real 小問 does not print).
    expect(s.cue).toContain("えらびなさい");
  });

  it("spends the stem, so one sentence backs one 小問", () => {
    const catalog = newCatalog();
    const first = usageSourceFor({ catalog, index: 0, level: "N3", offset: 0 });
    expect(first).not.toBeNull();
    const second = usageSourceFor({
      catalog,
      index: 0,
      level: "N3",
      offset: 0,
    });
    // Same index/offset: the first stem is spent, so the picker walks to the
    // next row, which is a DIFFERENT stem sentence.
    expect(second).not.toBeNull();
    expect(
      (second as NonNullable<ReturnType<typeof usageSourceFor>>).passage
    ).not.toBe(
      (first as NonNullable<ReturnType<typeof usageSourceFor>>).passage
    );
  });

  it("declines a level with no store rather than invent a stem", () => {
    const catalog = newCatalog();
    expect(
      usageSourceFor({ catalog, index: 0, level: "N5", offset: 0 })
    ).toBeNull();
  });
});

describe("the 用法 store is a content gate, not a source of truth", () => {
  it("a level with no store file declines at the picker, not the wire", () => {
    // N5 prints no 用法 大問 and has no store file, so the picker answers null
    // before the walk. That is the same mechanism a MISSING store file uses at
    // the levels that do print the 大問, so the block comes up short rather than
    // inventing a stem. N4 printed this line too until TASK-179 wrote its store.
    expect(
      usageSourceFor({
        catalog: newCatalog(),
        index: 0,
        level: "N5",
        offset: 0,
      })
    ).toBeNull();
  });
});

describe("a real N3 paper fills the 用法 大問 from the validated store (AC#4)", () => {
  it("lands 用法 小問 in the vocabulary section", async () => {
    const state = await buildRealN3Vocabulary("youhou-fill");
    const usageItems = state.items.filter(
      (entry) => entry.item.itemType === "usage"
    );
    // N3 prints 5 用法 小問 (大問5) and the 11-row store fills it.
    expect(usageItems.length).toBeGreaterThan(0);
    for (const entry of usageItems) {
      expect(entry.item.options).toHaveLength(4);
      expect(new Set(entry.item.options).size).toBe(4);
      // The stem sentence is the row's own passage, not the canned long text.
      expect(entry.item.passage ?? "").toContain("＿＿");
      expect(entry.item.prompt).not.toContain("えらびなさい");
    }
  });
});

/*
 * TASK-173.9.23.1 AC#5, pinned for real: the walk's `composed && !validated` term
 * is the ONLY thing that makes `validated: true` in `n3-usage.json` mean the two
 * blind passes read the row. The shipped store carries the flag on every row, so
 * nothing above this line can see the refusal fire, and dropping the term served
 * an unjudged 用法 小問 to a learner while the whole suite stayed green (the
 * mutation gate caught exactly that on 2026-10-10). The claim needs a store whose
 * rows are NOT signed off, which is reached by substituting the file, never by
 * editing the shipped one.
 */

const DATA_DIR = join(import.meta.dir, "../../../packages/japanese/data");

/** One shipped N3 用法 row, read as JSON so an overlay can rewrite one field. */
const shippedN3UsageRows = (): Record<string, unknown>[] =>
  JSON.parse(
    readFileSync(join(DATA_DIR, "reading", "n3-usage.json"), "utf8")
  ) as Record<string, unknown>[];

/** Run with the N3 用法 store replaced. Everything else is symlinked, so the
 * vocab/grammar corpora stay the real ones and the shipped file is untouched. */
const withN3UsageStore = async <T>(
  rows: string,
  run: () => Promise<T>
): Promise<T> => {
  const fileName = "n3-usage.json";
  const scratch = mkdtempSync(join(tmpdir(), "manobu-youhou-"));
  const root = join(scratch, "data");
  const reading = join(root, "reading");
  const previousDataDir = process.env.MANOBU_DATA_DIR;
  mkdirSync(reading, { recursive: true });
  for (const entry of readdirSync(DATA_DIR)) {
    if (entry !== "reading") {
      symlinkSync(join(DATA_DIR, entry), join(root, entry));
    }
  }
  for (const entry of readdirSync(join(DATA_DIR, "reading"))) {
    if (entry !== fileName) {
      symlinkSync(join(DATA_DIR, "reading", entry), join(reading, entry));
    }
  }
  writeFileSync(join(reading, fileName), rows);
  process.env.MANOBU_DATA_DIR = root;
  // `usageStoreFor` caches by level, not by directory, so the overlay must clear
  // it or the run serves the shipped rows instead of the substituted ones.
  corpusTest.resetCorpusCache();
  try {
    return await run();
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.MANOBU_DATA_DIR;
    } else {
      process.env.MANOBU_DATA_DIR = previousDataDir;
    }
    corpusTest.resetCorpusCache();
    rmSync(scratch, { force: true, recursive: true });
  }
};

const usageItemsOf = (
  state: Awaited<ReturnType<typeof buildRealN3Vocabulary>>
) => state.items.filter((entry) => entry.item.itemType === "usage");

describe("an unjudged 用法 row never reaches a learner (AC#5)", () => {
  it("refuses the whole 大問 when no blind pass signed the keys off", async () => {
    const unjudged = shippedN3UsageRows().map((row) => ({
      ...row,
      validated: false,
    }));
    const state = await withN3UsageStore(JSON.stringify(unjudged), () =>
      buildRealN3Vocabulary("youhou-unjudged")
    );
    expect(usageItemsOf(state)).toHaveLength(0);
    // Non-vacuity: the identical overlay with the flag left TRUE fills the 大問,
    // so the refusal above is the flag and not a broken data root.
    const judged = await withN3UsageStore(
      JSON.stringify(shippedN3UsageRows()),
      () => buildRealN3Vocabulary("youhou-judged-overlay")
    );
    expect(usageItemsOf(judged).length).toBeGreaterThan(0);
  });
});
