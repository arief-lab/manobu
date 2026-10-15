import { beforeAll, describe, expect, it } from "bun:test";
import { PAPER_BLUEPRINTS } from "@manobu/item-engine/paper";
import { goseikeiStoreFor } from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
// The three word-form specs consume the whole shared harness, so this import
// block is identical by design; a per-family re-export module would only add an
// indirection and a second clone.
// fallow-ignore-next-line code-duplication
import {
  assertBlockFullyPrinted,
  assertBlockNotPrintedNorNamed,
  assertComposedSourceShape,
  assertFourDistinctOptionsAnswerFirst,
  assertLandedScoresInto,
  assertOptionsAreRowsOwn,
  assertOverlayRootStillFillsBlock,
  assertSpendsOneStimulusPerWalk,
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

const DB_URL = prepareContentDb("exam-goseikei");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/*
 * TASK-173.9.26: authentic 語形成 material for the 大問 that asks which single
 * kanji completes the compound a sentence prints half of (2018 sample paper
 * N2V.pdf 問題３; doc-26 §1: 語形成 exists at N2 only).
 *
 * The block (`goseikei`) prints 5 小問 per N2 paper. A 小問 is ONE authored
 * sentence with the compound's fragment glued to a （　） blank — 蒸気機関（　）
 * or （　）水準 — plus FOUR SINGLE KANJI, exactly one of which completes an
 * attested compound the sentence means. The mechanical half is falsifiable
 * against the licensed vocab corpus (attestation, the one-end split, the
 * unattested distractor completions, and the n2-g-013 leak rule: the answer
 * kanji may not appear in its own passage anywhere, 電車-under-a-車 included);
 * the two blind judge passes certify what no corpus can see, that the SENTENCE
 * means the compound. `check:goseikei` re-proves all of it offline; this file
 * proves the shipped rows REACH a paper:
 *
 *   - the store (`goseikeiStoreFor`): 23 composed+validated rows at N2, ≥ the
 *     four-paper depth floor, and nothing at any other level,
 *   - the picker (`goseikeiSourceFor`): the row's own sentence and instruction
 *     line, one sentence per 小問 (spent), `seenAnchors` honored, an empty
 *     level declined rather than invented,
 *   - the real N2 paper: 大問3 lands whole, byte-equal to shipped rows, the key
 *     kanji absent from every landed sentence, scored into 言語知識,
 *   - the hole: with the store emptied the receipt NAMES 語形成 大問3
 *     (TASK-173.1 no-fallback), a one-row store comes up short instead, and an
 *     unvalidated substitute never reaches a learner.
 */

/** The 小問数 of the 語形成 大問 at the one level that ships a store
 * (paper.ts:587). The frozen store carries `SHIPPED_ROWS` rows; the depth floor
 * is four papers' worth, so `ITEMS_PER_PAPER * 4`. */
const ITEMS_PER_PAPER = 5;
const SHIPPED_ROWS = 23;
/** The paper prints exactly one （　） per 語形成 小問: full-width parens around
 * one full-width space, the blank the answer kanji fills. */
const BLANK_RE = /（　）/g;

/** The paper's own instruction line, quoted from N2V.pdf p.5 問題３ and matching
 * the `check:goseikei` gate's `GOSEIKEI_STEMS` and the item engine's
 * `PAPER_BLOCK_INSTRUCTIONS.goseikei.N2`. */
const N2_STEM =
  "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。";

/** 語形成 sits in the merged 言語知識・読解 科目 at N2, its 大問3; no other
 * level prints the 大問 at all. */
const SECTIONS_BY_LEVEL: Readonly<
  Record<"N2", readonly "language-knowledge-reading"[]>
> = {
  N2: ["language-knowledge-reading"],
};

const realPaper = (level: "N2", seed: string) => {
  const sections = SECTIONS_BY_LEVEL[level];
  return requestAssembleRead(client, {
    budget: fullBudget(sections),
    level,
    mode: "real",
    sections: [...sections],
    seed,
  });
};

const goseikeiItemsOf = (
  state: Awaited<ReturnType<typeof realPaper>>["state"]
) =>
  state.items.filter((entry) => entry.item.itemType === "compound-completion");

const { goseikeiSourceFor, servableReadingRow } = __test__;

type GoseikeiSource = NonNullable<ReturnType<typeof goseikeiSourceFor>>;

const sourceOf = (
  catalog: WritableCatalog,
  level: string,
  index = 0,
  offset = 0
): GoseikeiSource | null =>
  goseikeiSourceFor({ catalog, index, level, offset });

/*
 * The store-sized boundary and the unjudged-row boundary are both reached by
 * SUBSTITUTING the N2 語形成 file: a real paper is never ready (its other 大問
 * are holes), so nothing can be drained by spending it. The scratch root
 * symlinks everything else, so the vocab/grammar corpora stay the real ones and
 * the shipped file can never be written by the overlay.
 */

/** The shipped store, rewritten in the scratch root. `null` means the file is
 * absent, which is the same absence as an empty one. */
const withN2GoseikeiStore = async <T>(
  rows: string | null,
  run: () => Promise<T>
): Promise<T> =>
  withSubstitutedReadingStore({
    fileName: "n2-goseikei.json",
    prefix: "manobu-goseikei-",
    rows,
    run,
  });

/** The shipped N2 rows, read as JSON so an overlay can rewrite one field. */
const shippedN2Rows = (): Record<string, unknown>[] =>
  shippedReadingRows("n2-goseikei.json");

describe("the 語形成 store", () => {
  it("ships 23 composed rows at N2", () => {
    const store = goseikeiStoreFor("N2");
    expect(store).toHaveLength(SHIPPED_ROWS);
    for (const entry of store) {
      expect(entry.level).toBe("N2");
      expect(entry.block).toBe("goseikei");
      expect(entry.provenance).toBe("composed");
      // The honesty gate (`isRefused`) trusts exactly this flag, and
      // `check:goseikei` is what makes it mean the two blind passes ran.
      expect(entry.validated ?? false).toBe(true);
      // A real 語形成 小問 is a compound-completion item: one sentence printing
      // one （　） blank, four SINGLE-KANJI candidate completions.
      expect(entry.passage.match(BLANK_RE)).toHaveLength(1);
      assertFourDistinctOptionsAnswerFirst(entry);
      for (const option of entry.options) {
        expect([...option]).toHaveLength(1);
      }
      // The answer kanji must NOT sit in the sentence anywhere, even inside
      // another word: `hasStemLeak` searches prompt+passage for the ANSWER TEXT,
      // so 電車 under a key 車 is a row the assembly drops in silence (the
      // n2-g-013 lesson, now a gate screen and pinned here too).
      const key = entry.options[entry.answerIndex];
      expect(key).toBeDefined();
      expect(entry.passage.includes(key ?? "")).toBe(false);
    }
    // Four papers' worth of 小問 before the store runs dry (the same depth
    // standard 表記 and 用法 are held to).
    expect(store.length).toBeGreaterThanOrEqual(ITEMS_PER_PAPER * 4);
  });

  it("ships nothing at N1, N3, N4 or N5, which print no 語形成 大問", () => {
    // 語形成 is an N2-only 大問 (doc-26 §1: the measured N3/N4/N5 papers print no
    // such block and N1 has none). The empty stores are what keep a real paper
    // at any other level from ever printing one.
    for (const level of ["N1", "N3", "N4", "N5"]) {
      expect(goseikeiStoreFor(level)).toHaveLength(0);
    }
  });

  it("keeps every 語形成 wearing the N2 paper's own instruction line", () => {
    const store = goseikeiStoreFor("N2");
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBe(1);
    expect([...stems][0]).toBe(N2_STEM);
    // The blank the answer fills and the full-width option digits a real paper
    // prints both live in the instruction line, not in the sentence.
    expect(N2_STEM).toContain("（　）");
    expect(N2_STEM).toContain("１・２・３・４");
  });

  it("serves no row outside N2", () => {
    // `servableReadingRow` is the third leg of no-fallback: the loader keys on
    // the filename, so a row that wears another level's stamp must be skipped,
    // not printed under a 大問 that does not ask it.
    for (const entry of goseikeiStoreFor("N2")) {
      expect(servableReadingRow({ entry, level: "N2" })).not.toBeNull();
      expect(servableReadingRow({ entry, level: "N1" })).toBeNull();
      expect(servableReadingRow({ entry, level: "N3" })).toBeNull();
    }
  });
});

describe("goseikeiSourceFor", () => {
  it("turns one store row into a source carrying its own sentence and line", () => {
    const source = sourceOf(newCatalog(), "N2");
    expect(source).not.toBeNull();
    const s = source as GoseikeiSource;
    expect(s.passage).not.toBeNull();
    expect((s.passage ?? "").match(BLANK_RE)).toHaveLength(1);
    // The picker hands over the three WRONG completions; the answer kanji rides
    // `target`, so the 小問 is `[target, ...distractors]`. The answer is ONE
    // kanji, not a phrase.
    expect([...s.target]).toHaveLength(1);
    // The anchor namespace, the instruction line as `cue`, the judgement flags
    // and the no-leak rule are the shape every word-form picker shares; the
    // harness helper is where they are pinned.
    assertComposedSourceShape({
      anchorPrefix: "goseikei",
      cue: N2_STEM,
      source: s,
    });
  });

  it("spends the sentence, so one sentence backs one 小問", () => {
    assertSpendsOneStimulusPerWalk((catalog) => sourceOf(catalog, "N2"));
  });

  it("honors `seenAnchors`, so a retry asks a compound this learner has not seen", () => {
    const catalog = newCatalog();
    const first = sourceOf(catalog, "N2");
    expect(first).not.toBeNull();
    const seen = newCatalog();
    seen.seenAnchors.add((first as GoseikeiSource).anchorId);
    const next = sourceOf(seen, "N2");
    expect(next).not.toBeNull();
    expect((next as GoseikeiSource).anchorId).not.toBe(
      (first as GoseikeiSource).anchorId
    );
  });

  it("declines N1 rather than invent a compound", () => {
    // N1 ships no store, so the picker returns null and the paper never prints a
    // 語形成 大問 there (TASK-173.1: no invented fallback).
    expect(sourceOf(newCatalog(), "N1")).toBeNull();
  });
});

describe("a real paper fills 語形成 from the validated store", () => {
  it("lands the whole N2 大問3 byte-equal to its store", async () => {
    const { assembled, state } = await realPaper("N2", "goseikei-fill-N2");
    const landed = goseikeiItemsOf(state);
    // Not "some 語形成": the entire 大問 the blueprint asks.
    assertBlockFullyPrinted({
      assembled,
      blockName: "語形成",
      count: ITEMS_PER_PAPER,
      landed,
    });
    eachLandedRowMatchesStore({
      bigQuestion: 3,
      blockName: "語形成",
      landed,
      level: "N2",
      onRow: (item, row, passage) => {
        assertOptionsAreRowsOwn({
          blockName: "語形成",
          item,
          level: "N2",
          passage,
          row,
        });
        expect(passage.match(BLANK_RE)).toHaveLength(1);
        // The answer is ONE kanji: a landed 語形成 小問 cannot give its own
        // completion away, not even inside a second word, and no option may be
        // a multi-character phrase.
        for (const option of item.options) {
          expect(option).not.toContain("＿");
          expect([...option]).toHaveLength(1);
        }
      },
      rows: goseikeiStoreFor("N2"),
      stimulus: "sentence",
    });
  });

  it("scores the 小問 into 言語知識, where the official 得点区分 puts them", async () => {
    // A placed item type missing from a band's `itemTypes` filter silently loses
    // its points (the N2 57/60 precedent TASK-173.9.23 hit with 用法). N2's
    // merged 科目 carries `LANGUAGE_KNOWLEDGE_ITEM_TYPES`, so compound-completion
    // must be listed there or 大問3 lands uncounted.
    const band = PAPER_BLUEPRINTS.N2.scoringSections.find(
      (each) => each.id === "language-knowledge"
    );
    if (band !== undefined && "itemTypes" in band) {
      expect(band.itemTypes).toContain("compound-completion");
    }
    const { assembled, state } = await realPaper("N2", "goseikei-band-N2");
    assertLandedScoresInto({
      assembled,
      landed: goseikeiItemsOf(state),
      scoringSectionId: "language-knowledge",
    });
  });
});

describe("語形成 is a hole exactly when its store is gone", () => {
  it("names 大問3 when the store is empty or missing", async () => {
    for (const rows of ["[]", null] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: both iterations swap an overlay of the SAME N2 store file, so they must not run concurrently.
      const { assembled, state } = await withN2GoseikeiStore(rows, () =>
        realPaper("N2", "goseikei-drained")
      );
      const hole = assembled.unfilledBlocks.find(
        (block) => block.name === "語形成"
      );
      expect(hole?.bigQuestion).toBe(3);
      expect(hole?.requestedItems).toBe(ITEMS_PER_PAPER);
      expect(goseikeiItemsOf(state)).toHaveLength(0);
      // Non-vacuity: the overlay is a working data root, not a broken one,
      // because the 漢字読み 大問 above it still fills from the vocab corpus.
      assertOverlayRootStillFillsBlock({
        itemType: "kanji-reading",
        state,
      });
    }
  });

  it("counts a store too small for its 大問 as a shortfall, not a hole", async () => {
    // The shipped store holds 23 rows against a 5-小問 大問. One row DOES
    // trigger the boundary: the block HAS a source, so it stays out of
    // `unfilledBlocks` and comes up short instead (TASK-148's different fact).
    const { assembled, state } = await withN2GoseikeiStore(
      JSON.stringify(shippedN2Rows().slice(0, 1)),
      () => realPaper("N2", "goseikei-one-row")
    );
    expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
      "語形成"
    );
    expect(goseikeiItemsOf(state)).toHaveLength(1);
  });
});

describe("an unjudged 語形成 row never reaches a learner", () => {
  it("refuses every row whose two blind passes did not sign it off", async () => {
    // The `validated` flag is the cert record: `check:goseikei` proves the two
    // independently shuffled passes agreed, and the walk's `composed && !validated`
    // term is what makes a real paper trust it. Drop that term and a hand-edited
    // store whose keys no judge ever read serves 大問3 whole, which is the
    // laundering TASK-173.9.5 exists to stop.
    const unjudged = shippedN2Rows().map((row) => ({
      ...row,
      validated: false,
    }));
    const { assembled, state } = await withN2GoseikeiStore(
      JSON.stringify(unjudged),
      () => realPaper("N2", "goseikei-unjudged")
    );
    // The store EXISTS, so this is a shortfall, not a hole: the receipt says the
    // paper came up short without blaming the learner, and says nothing about a
    // block it could have asked.
    assertBlockNotPrintedNorNamed({
      assembled,
      blockName: "語形成",
      landed: goseikeiItemsOf(state),
    });
    expect(assembled.shortfall).toBeGreaterThan(0);
    // Non-vacuity in the other direction: the same overlay with the flag left
    // TRUE fills the 大問, so the refusal above is the flag and nothing else.
    const filled = await withN2GoseikeiStore(
      JSON.stringify(shippedN2Rows()),
      () => realPaper("N2", "goseikei-judged-overlay")
    );
    expect(goseikeiItemsOf(filled.state)).toHaveLength(ITEMS_PER_PAPER);
  });
});
