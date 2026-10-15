import { beforeAll, describe, expect, it } from "bun:test";
import type { ExamSectionId } from "@manobu/api-contract";
import { PAPER_BLUEPRINTS } from "@manobu/item-engine/paper";
import { bunshouStoreFor } from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertBlockFullyPrinted,
  assertLandedScoresInto,
  assertNoStimulusReused,
  connectExamClient,
  type ExamClient,
  eachLandedRowMatchesStore,
  fullBudget,
  newCatalog,
  prepareContentDb,
  requestAssembleRead,
  shippedReadingRows,
  type WritableCatalog,
  withSubstitutedReadingStore,
} from "./exam-harness";

const DB_URL = prepareContentDb("exam-bunshou");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/*
 * TASK-173.9.24: authentic 文章の文法 material for the 大問 that asks 文章の流れに
 * 合った文かどうかを判断する (doc-26 §3, the same ねらい wording at all five levels).
 *
 * The block (`bunshou-no-bunpou`) prints 5 小問 at every level: N3 大問3, N4 大問3,
 * N5 大問3, N2 大問9, N1 大問7. A 小問 is ONE short 文章 holding exactly one ＿＿ and
 * FOUR CANDIDATE SENTENCES, so the key cannot be re-derived from any licensed
 * corpus - nothing pairs a passage with its own removed sentence. The two blind
 * judge passes (prompts/bunshou-validator.md, keys withheld, packets shuffled
 * independently per pass) ARE the solvability proof, `check:bunshou` re-proves the
 * shape and the cert record offline, and this file proves the shipped rows REACH a
 * paper:
 *
 *   - the stores (`bunshouStoreFor`): N1 28 / N2 27 / N3 29 composed+validated
 *     rows (TASK-173.9.24) and N5 23 / N4 21 (TASK-179), each ≥ the four-paper
 *     depth floor,
 *   - the picker (`discourseClozeSourceFor`): the row's own passage and instruction
 *     line, one passage per 小問 (spent), `seenAnchors` honored, an absent level
 *     declined rather than invented,
 *   - the real papers: every level lands the whole 大問 (5 小問) whose passage and
 *     stem are byte-equal to a shipped row, inside the section that scores into
 *     言語知識, and no two levels hand out the same 文章,
 *   - the hole: with a level's store emptied the receipt NAMES 文章の文法
 *     (TASK-173.1 no-fallback). That is now the only way to see the name at all,
 *     because TASK-179 wrote the N4 and N5 stores that closed the last live hole.
 */

/** The 小問数 of the 文章の文法 大問 at every level that prints it (all five,
 * since TASK-179), and the rows each frozen store carries. */
const ITEMS_PER_PAPER = 5;
const SHIPPED_ROWS = { N1: 28, N2: 27, N3: 29, N4: 21, N5: 23 } as const;
const BLANK = "＿＿";

/** N2/N1 print the merged 言語知識・読解 科目; N3 splits 読解 into grammar-reading,
 * which is also where the N4/N5 文章の文法 lives. */
const SECTIONS_BY_LEVEL: Readonly<
  Record<"N1" | "N2" | "N3" | "N4" | "N5", readonly ExamSectionId[]>
> = {
  N1: ["language-knowledge-reading"],
  N2: ["language-knowledge-reading"],
  N3: ["vocabulary", "grammar-reading"],
  N4: ["vocabulary", "grammar-reading"],
  N5: ["vocabulary", "grammar-reading"],
};

const realPaper = (level: keyof typeof SECTIONS_BY_LEVEL, seed: string) => {
  const sections = SECTIONS_BY_LEVEL[level];
  return requestAssembleRead(client, {
    budget: fullBudget(sections),
    level,
    mode: "real",
    sections: [...sections],
    seed,
  });
};

const bunshouItemsOf = (
  state: Awaited<ReturnType<typeof realPaper>>["state"]
) => state.items.filter((entry) => entry.item.itemType === "discourse-cloze");

const { discourseClozeSourceFor, servableReadingRow } = __test__;

type BunshouSource = NonNullable<ReturnType<typeof discourseClozeSourceFor>>;

const sourceOf = (
  catalog: WritableCatalog,
  level: string,
  index = 0,
  offset = 0
): BunshouSource | null =>
  discourseClozeSourceFor({ catalog, index, level, offset });

/*
 * The store-sized boundary and the unjudged-row boundary are both reached by
 * SUBSTITUTING the N3 文章の文法 file: draining one would mean starting and
 * finishing enough papers to spend every anchor in it, which the assembled read
 * these tests use never does. The overlay reaches the same boundary in one
 * assembly. See `exam-harness.ts` for why the scratch root symlinks everything
 * else.
 */

/** One shipped store, rewritten in the scratch root. `null` means the file is
 * absent, which is the same absence as an empty one. */
const withN3BunshouStore = async <T>(
  rows: string | null,
  run: () => Promise<T>
): Promise<T> =>
  withSubstitutedReadingStore({
    fileName: "n3-bunshou.json",
    prefix: "manobu-bunshou-",
    rows,
    run,
  });

/** The shipped N3 rows, read as JSON so an overlay can rewrite one field. */
const shippedN3Rows = (): Record<string, unknown>[] =>
  shippedReadingRows("n3-bunshou.json");

describe("the 文章の文法 stores", () => {
  // TASK-179 added the N4 and N5 legs, so the loop covers every level that
  // prints the 大問 rather than only the three TASK-173.9.24 authored.
  for (const level of ["N5", "N4", "N3", "N2", "N1"] as const) {
    it(`ships ${String(SHIPPED_ROWS[level])} composed rows at ${level}`, () => {
      const store = bunshouStoreFor(level);
      expect(store).toHaveLength(SHIPPED_ROWS[level]);
      for (const entry of store) {
        expect(entry.level).toBe(level);
        expect(entry.provenance).toBe("composed");
        // The honesty gate (`isRefused`) trusts exactly this flag, and
        // `check:bunshou` is what makes it mean the two blind passes ran.
        expect(entry.validated ?? false).toBe(true);
        // A real 文章の文法 小問 is a fill-the-flow item: one 文章, one blank,
        // four candidate sentences.
        expect(entry.passage.split(BLANK).length - 1).toBe(1);
        expect(entry.options).toHaveLength(4);
        expect(new Set(entry.options).size).toBe(4);
        expect(entry.answerIndex).toBe(0);
      }
      // Four papers' worth of 小問 before the store runs dry (the same depth
      // standard 用法 and 読解 are held to).
      expect(store.length).toBeGreaterThanOrEqual(ITEMS_PER_PAPER * 4);
    });
  }

  it("ships the two legs TASK-179 added, past the same depth floor", () => {
    // TASK-173.9.24 scoped the authoring to N3/N2/N1 and left the lower levels as
    // a named hole. TASK-179 wrote the two missing stores, so a full 文章の文法
    // 大問 is askable at all five levels and the real paper reaches 91/98.
    expect(bunshouStoreFor("N4")).toHaveLength(SHIPPED_ROWS.N4);
    expect(bunshouStoreFor("N5")).toHaveLength(SHIPPED_ROWS.N5);
  });

  it("keeps every 文章 for the level whose instruction line it carries", () => {
    // Five levels print five differently-worded official lines. N1 asks for the
    // 趣旨 and N2/N3 for the 内容; N4 and N5, written by TASK-179, ask what the
    // passage MEANS at the blank (文章の意味を考えて), which is a different ねらい
    // and not a simplification of N3's wording. A row wearing another level's
    // line was pasted, not authored.
    const stemByLevel = new Map(
      (["N1", "N2", "N3", "N4", "N5"] as const).map((level) => {
        const store = bunshouStoreFor(level);
        const stems = new Set(store.map((entry) => entry.stem));
        expect(stems.size).toBe(1);
        return [level, [...stems][0] ?? ""] as const;
      })
    );
    const n1Stem = stemByLevel.get("N1") ?? "";
    const n2Stem = stemByLevel.get("N2") ?? "";
    const n3Stem = stemByLevel.get("N3") ?? "";
    const n4Stem = stemByLevel.get("N4") ?? "";
    const n5Stem = stemByLevel.get("N5") ?? "";
    expect(n1Stem).toContain("趣旨");
    expect(n2Stem).toContain("内容");
    expect(n3Stem).toContain("内容");
    expect(n4Stem).toContain("意味");
    expect(n5Stem).toContain("意味");
    // N5 prints the whole line in kana the way its paper does, and no higher
    // level's line may leak into it.
    expect(n5Stem).toContain("かんがえて");
    expect(n4Stem).toContain("選びなさい");
    // The blank sits in the question line, and １・２・３・４ are the full-width
    // digits a real paper prints.
    for (const stem of [n1Stem, n2Stem, n3Stem, n4Stem, n5Stem]) {
      expect(stem).toContain(BLANK);
      expect(stem).toContain("１・２・３・４");
    }
    const distinct = new Set([n1Stem, n2Stem, n3Stem, n4Stem, n5Stem]);
    // N2 and N4 share nothing but their kanji script: one asks 内容, the other
    // 意味. Every one of the five lines is its own.
    expect(distinct.size).toBe(5);
  });

  it("serves no row stamped with another level", () => {
    // `servableReadingRow` is the third leg of no-fallback: the loader keys on the
    // filename, so a row that wears the wrong level must be skipped, not printed
    // under the wrong 大問 heading.
    const levels = ["N5", "N4", "N3", "N2", "N1"] as const;
    for (const level of levels) {
      // A level that now ships its own store cannot be the foreign one for itself.
      const foreign = levels.find((each) => each !== level) ?? "N1";
      for (const entry of bunshouStoreFor(level)) {
        expect(servableReadingRow({ entry, level })).not.toBeNull();
        expect(servableReadingRow({ entry, level: foreign })).toBeNull();
      }
    }
  });
});

describe("discourseClozeSourceFor", () => {
  it("turns one store row into a source carrying its own 文章 and line", () => {
    const source = sourceOf(newCatalog(), "N3");
    expect(source).not.toBeNull();
    const s = source as BunshouSource;
    expect(s.passage).not.toBeNull();
    expect((s.passage ?? "").split(BLANK).length - 1).toBe(1);
    // The picker hands over the three WRONG sentences; the key rides `target`,
    // so the 小問 is `[target, ...distractors]`.
    expect(s.distractors).toHaveLength(3);
    expect(s.target.length).toBeGreaterThan(0);
    expect(s.validated).toBe(true);
    expect(s.provenance).toBe("composed");
    // The anchor is the store's own namespace: `resolveAnchor` must attest
    // `bunshou:{id}` or every candidate is silently rejected and the 大問 lands
    // empty (the same trap 情報検索 fell into).
    expect(s.anchorId.startsWith("bunshou:")).toBe(true);
    // The official instruction line travels as `cue` and prints as the item's
    // stem; the English daily prompt never reaches a real 小問.
    expect(s.cue).toContain("えらびなさい");
    // A candidate SENTENCE is not a form, so nothing here reads like a 用法 key.
    expect(s.pattern).toBeNull();
    expect(s.stimulus).toBeNull();
  });

  it("spends the 文章, so one passage backs one 小問", () => {
    const catalog = newCatalog();
    const first = sourceOf(catalog, "N3");
    const second = sourceOf(catalog, "N3");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // Same index and offset: the first passage is spent, so the walk moves on.
    expect((second as BunshouSource).passage).not.toBe(
      (first as BunshouSource).passage
    );
  });

  it("honors `seenAnchors`, so a retry asks a 文章 this learner has not seen", () => {
    const catalog = newCatalog();
    const first = sourceOf(catalog, "N3");
    expect(first).not.toBeNull();
    const seen = newCatalog();
    seen.seenAnchors.add((first as BunshouSource).anchorId);
    const next = sourceOf(seen, "N3");
    expect(next).not.toBeNull();
    expect((next as BunshouSource).anchorId).not.toBe(
      (first as BunshouSource).anchorId
    );
  });

  it("serves the N4 and N5 legs from their own stores", () => {
    // TASK-173.9.24 left these two levels declining the 大問 because no store
    // existed; the picker now reads one for each, and the source carries the
    // level's own instruction line rather than a borrowed one.
    for (const level of ["N4", "N5"] as const) {
      const source = sourceOf(newCatalog(), level);
      expect(source).not.toBeNull();
      const s = source as BunshouSource;
      expect(s.anchorId.startsWith("bunshou:")).toBe(true);
      expect(s.cue).toBe(bunshouStoreFor(level)[0]?.stem ?? "");
      expect((s.passage ?? "").split(BLANK).length - 1).toBe(1);
      expect(s.validated).toBe(true);
    }
  });
});

describe("a real paper fills 文章の文法 from the validated store", () => {
  // All five levels now land the whole 大問: N4 and N5 are the legs TASK-179
  // wrote, and their papers were the learner-visible symptom (43/91 at N5).
  for (const level of ["N5", "N4", "N3", "N2", "N1"] as const) {
    it(`lands the whole ${level} 大問 byte-equal to its store`, async () => {
      const { assembled, state } = await realPaper(
        level,
        `bunshou-fill-${level}`
      );
      const landed = bunshouItemsOf(state);
      // Not "some 文章の文法": the entire 大問 the blueprint asks.
      assertBlockFullyPrinted({
        assembled,
        blockName: "文章の文法",
        count: ITEMS_PER_PAPER,
        landed,
      });
      eachLandedRowMatchesStore({
        blockName: "文章の文法",
        landed,
        level,
        onRow: (item, _row, passage) => {
          expect(passage.split(BLANK).length - 1).toBe(1);
          expect(item.options).toHaveLength(4);
          expect(new Set(item.options).size).toBe(4);
          // The options are candidate SENTENCES, so none of them is the blank
          // or a fragment of the passage it belongs to.
          for (const option of item.options) {
            expect(option).not.toContain(BLANK);
            expect(option.length).toBeGreaterThanOrEqual(6);
          }
        },
        rows: bunshouStoreFor(level),
        stimulus: "文章",
      });
    });
  }

  it("scores the 小問 into 言語知識, where the official 得点区分 puts them", async () => {
    // A placed item type missing from `LANGUAGE_KNOWLEDGE_ITEM_TYPES` silently
    // loses its points (the N2 57/60 precedent TASK-173.9.23 hit with 用法), so
    // both halves are pinned: the blueprint claims the type, and the 小問 lands in
    // a section that feeds that band.
    for (const level of ["N1", "N2", "N3"] as const) {
      const band = PAPER_BLUEPRINTS[level].scoringSections.find(
        (each) => each.id === "language-knowledge"
      );
      expect(band?.itemTypes).toContain("discourse-cloze");
      // biome-ignore lint/performance/noAwaitInLoops: each paper writes to and reads back the one shared test database; the levels run in order so the store is never touched by two assemblies at once.
      const { assembled, state } = await realPaper(
        level,
        `bunshou-band-${level}`
      );
      assertLandedScoresInto({
        assembled,
        landed: bunshouItemsOf(state),
        scoringSectionId: "language-knowledge",
      });
    }
  });

  it("asks no level a 文章 another level already asks", async () => {
    // The learner who moves up from N3 to N2 must not re-read the same passage,
    // and since TASK-179 the ladder starts two rungs lower: N5 through N1 now all
    // land the 大問, so the reuse check spans the five stores it was written
    // against three of.
    const passages = new Set<string>();
    for (const level of ["N5", "N4", "N3", "N2", "N1"] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: one shared test database, and the clash check accumulates across levels, so the papers are drawn in order.
      const { state } = await realPaper(level, `bunshou-cross-${level}`);
      assertNoStimulusReused({
        blockName: "文章の文法",
        landed: bunshouItemsOf(state),
        level,
        seen: passages,
        stimulus: "文章",
      });
    }
    expect(passages.size).toBe(ITEMS_PER_PAPER * 5);
  });
});

describe("文章の文法 is a hole exactly when its store is gone", () => {
  it("names the 大問 when the store is empty or missing", async () => {
    for (const rows of ["[]", null] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: both iterations swap an overlay of the SAME N3 store file, so they must not run concurrently.
      const { assembled, state } = await withN3BunshouStore(rows, () =>
        realPaper("N3", "bunshou-drained")
      );
      const hole = assembled.unfilledBlocks.find(
        (block) => block.name === "文章の文法"
      );
      expect(hole?.bigQuestion).toBe(3);
      expect(hole?.requestedItems).toBe(ITEMS_PER_PAPER);
      expect(bunshouItemsOf(state)).toHaveLength(0);
      // Non-vacuity: the overlay is a working data root, not a broken one,
      // because the 短文 大問 below it still fills from its own store.
      expect(
        state.items.filter((entry) => entry.item.itemType === "short-reading")
          .length
      ).toBeGreaterThan(0);
    }
  });

  it("counts a store too small for its 大問 as a shortfall, not a hole", async () => {
    // The shipped N3 store holds 29 rows against a 5-小問 大問. One row does
    // trigger the boundary: the block HAS a source, so it stays out of
    // `unfilledBlocks` and comes up short instead (TASK-148's different fact).
    const { assembled, state } = await withN3BunshouStore(
      JSON.stringify(shippedN3Rows().slice(0, 1)),
      () => realPaper("N3", "bunshou-one-row")
    );
    expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
      "文章の文法"
    );
    expect(bunshouItemsOf(state)).toHaveLength(1);
  });
});

describe("an unjudged 文章の文法 row never reaches a learner", () => {
  it("refuses every row whose two blind passes did not sign it off", async () => {
    // The `validated` flag is the cert record: `check:bunshou` proves the two
    // independently shuffled passes agreed, and the walk's
    // `composed && !validated` term is what makes a real paper trust it. Drop
    // that term and a hand-edited store whose keys no judge ever read serves
    // 大問3 whole, which is the laundering TASK-173.9.5 exists to stop.
    const unjudged = shippedN3Rows().map((row) => ({
      ...row,
      validated: false,
    }));
    const { assembled, state } = await withN3BunshouStore(
      JSON.stringify(unjudged),
      () => realPaper("N3", "bunshou-unjudged")
    );
    expect(bunshouItemsOf(state)).toHaveLength(0);
    // The store EXISTS, so this is a shortfall, not a hole: the receipt says the
    // paper came up short without blaming the learner, and says nothing about a
    // block it could have asked.
    expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
      "文章の文法"
    );
    expect(assembled.shortfall).toBeGreaterThan(0);
    // Non-vacuity in the other direction: the same overlay with the flag left
    // TRUE fills the 大問, so the refusal above is the flag and nothing else.
    const filled = await withN3BunshouStore(
      JSON.stringify(shippedN3Rows()),
      () => realPaper("N3", "bunshou-judged-overlay")
    );
    expect(bunshouItemsOf(filled.state)).toHaveLength(ITEMS_PER_PAPER);
  });
});

describe("a store that stops existing still names the hole at the new legs", () => {
  // TASK-179 filled these two levels, which is exactly when the refuse-not-
  // fabricate path is at risk of going stale: the hole is reported from the
  // store's ABSENCE, so an emptied N5 store must name 大問3 rather than let the
  // walk invent a 文章. Proved with an overlay because the shipped file exists.
  for (const level of ["N4", "N5"] as const) {
    it(`N${level.slice(1)} names 文章の文法 once its own store is emptied`, async () => {
      const { assembled, state } = await withSubstitutedReadingStore({
        fileName: `n${level.slice(1).toLowerCase()}-bunshou.json`,
        prefix: "manobu-bunshou-hole-",
        rows: "[]",
        run: () => realPaper(level, `bunshou-absent-${level}`),
      });
      const hole = assembled.unfilledBlocks.find(
        (block) => block.name === "文章の文法"
      );
      expect(hole?.bigQuestion).toBe(3);
      expect(bunshouItemsOf(state)).toHaveLength(0);
      // Non-vacuity: the overlay root is a working one, so the 短文 大問 under
      // the same 大問 number still fills from its own store.
      expect(
        state.items.filter((entry) => entry.item.itemType === "short-reading")
          .length
      ).toBeGreaterThan(0);
    });
  }
});
