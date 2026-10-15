import { beforeAll, describe, expect, it } from "bun:test";
import { PAPER_BLUEPRINTS } from "@manobu/item-engine/paper";
import { kiteiStoreFor } from "../src/services/exam-corpus";
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

const DB_URL = prepareContentDb("exam-kitei");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/*
 * TASK-173.9.29: authentic 文脈規定 material for the 大問 that prints one
 * sentence around a （　） blank and asks which of FOUR WORDS the surrounding
 * context pins (2018 sample papers: N3V.pdf 問題３, N2V.pdf 問題４, N1V.pdf
 * 問題２).
 *
 * The block (`bunmi-kitei`) prints 11 小問 at N3 and 7 at N2/N1. A 小問 is ONE
 * authored adult-register sentence with exactly one （　） plus FOUR attested
 * words of one part-of-speech family, exactly one of which the context makes
 * the only defensible completion. Unlike 語形成, the corpus cannot falsify the
 * key: any of the four may slot grammatically, and only what the SENTENCE means
 * pins the answer. So the mechanical half (blank, sentence form, the options
 * being words the learner has met, one POS family, no option printed verbatim
 * anywhere in the passage, the evidence reconstruction) is proven offline by
 * `check:kitei`, and two blind judge passes per level certify the rest. This
 * file proves the shipped rows REACH a paper:
 *
 *   - the store (`kiteiStoreFor`): 33/21/21 composed+validated rows at
 *     N3/N2/N1, ≥ each level's three-paper depth floor, nothing at N4/N5,
 *   - the picker (`kiteiSourceFor`): the row's own sentence and instruction
 *     line, one sentence per 小問 (spent), `seenAnchors` honored, an empty
 *     level declined rather than invented,
 *   - the real papers: 文脈規定 lands whole at all three levels, byte-equal to
 *     shipped rows, no option leaking into any landed sentence, scored into
 *     言語知識 (the band filter that silently dropped 用法 points at N2),
 *   - the hole: with the store emptied the receipt NAMES 文脈規定 at the
 *     level's own 大問 (TASK-173.1 no-fallback), a one-row store comes up short
 *     instead, and an unvalidated substitute never reaches a learner.
 */

/** Per-level facts, quoted from `paper.ts` rather than restated from recall:
 * the 大問 number and 小問数 of the 文脈規定 block, the store file it serves,
 * the shipped row count, and the section a request must name for the block's
 * 科目. The depth floor is three papers' worth: count × 3. */
const KITEI_LEVELS = {
  N1: {
    bigQuestion: 2,
    count: 7,
    fileName: "n1-kitei.json",
    rows: 21,
    section: "language-knowledge-reading",
    stem: "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  },
  N2: {
    bigQuestion: 4,
    count: 7,
    fileName: "n2-kitei.json",
    rows: 21,
    section: "language-knowledge-reading",
    stem: "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
  },
  N3: {
    bigQuestion: 3,
    count: 11,
    fileName: "n3-kitei.json",
    rows: 33,
    section: "vocabulary",
    stem: "（　）に入れるのに最もよいものを、１・２・３・４から一つえらびなさい。",
  },
} as const;

/** The 文脈規定 小問数 at each store level. */
const ITEMS_PER_PAPER: Record<keyof typeof KITEI_LEVELS, number> = {
  N1: KITEI_LEVELS.N1.count,
  N2: KITEI_LEVELS.N2.count,
  N3: KITEI_LEVELS.N3.count,
};

/** The paper prints exactly one （　） per 文脈規定 小問: full-width parens
 * around one full-width space, the blank the answer word fills. */
const BLANK_RE = /（　）/g;

type KiteiLevel = keyof typeof KITEI_LEVELS;

const realPaper = (level: KiteiLevel, seed: string) => {
  const sections = [KITEI_LEVELS[level].section] as const;
  return requestAssembleRead(client, {
    budget: fullBudget(sections),
    level,
    mode: "real",
    sections: [...sections],
    seed,
  });
};

const kiteiItemsOf = (state: Awaited<ReturnType<typeof realPaper>>["state"]) =>
  state.items.filter((entry) => entry.item.itemType === "context-cloze");

const { kiteiSourceFor, servableReadingRow } = __test__;

type KiteiSource = NonNullable<ReturnType<typeof kiteiSourceFor>>;

const sourceOf = (
  catalog: WritableCatalog,
  level: string,
  index = 0,
  offset = 0
): KiteiSource | null => kiteiSourceFor({ catalog, index, level, offset });

/*
 * The store-sized boundary and the unjudged-row boundary are both reached by
 * SUBSTITUTING the level's 文脈規定 file: a real paper is never ready (its
 * other 大問 are holes), so nothing can be drained by spending it. The scratch
 * root symlinks everything else, so the vocab/grammar corpora stay the real
 * ones and the shipped file can never be written by the overlay.
 */

/** The shipped store of `level`, rewritten in the scratch root. `null` means
 * the file is absent, which is the same absence as an empty one. */
const withLevelKiteiStore = async <T>(
  level: KiteiLevel,
  rows: string | null,
  run: () => Promise<T>
): Promise<T> =>
  withSubstitutedReadingStore({
    fileName: KITEI_LEVELS[level].fileName,
    prefix: "manobu-kitei-",
    rows,
    run,
  });

/** The shipped rows of `level`, read as JSON so an overlay can rewrite one
 * field. */
const shippedKiteiRows = (level: KiteiLevel): Record<string, unknown>[] =>
  shippedReadingRows(KITEI_LEVELS[level].fileName);

describe("the 文脈規定 store", () => {
  for (const level of ["N1", "N2", "N3"] as const) {
    it(`ships ${KITEI_LEVELS[level].rows} composed rows at ${level}`, () => {
      const store = kiteiStoreFor(level);
      expect(store).toHaveLength(KITEI_LEVELS[level].rows);
      for (const entry of store) {
        expect(entry.level).toBe(level);
        expect(entry.block).toBe("bunmi-kitei");
        expect(entry.provenance).toBe("composed");
        // The honesty gate (`isRefused`) trusts exactly this flag, and
        // `check:kitei` plus the two blind passes are what make it mean
        // something.
        expect(entry.validated ?? false).toBe(true);
        // A real 文脈規定 小問 is a context-cloze item: one sentence with one
        // （　） blank, four distinct word options, the answer frozen first.
        expect(entry.passage.match(BLANK_RE)).toHaveLength(1);
        assertFourDistinctOptionsAnswerFirst(entry);
        for (const option of entry.options) {
          expect([...option].length).toBeGreaterThanOrEqual(2);
        }
        // The leak rule is WIDER here than in 語形成: `hasStemLeak` searches
        // prompt+passage for the ANSWER text, and 文脈規定 is not
        // stimulus-answered, so a passage printing ANY option (the answer or a
        // distractor) narrows the elimination the 小問 exists to test.
        for (const option of entry.options) {
          expect(entry.passage.includes(option)).toBe(false);
        }
      }
      // Three papers' worth of 小問 before the store runs dry (the same depth
      // standard 表記 and 用法 are held to).
      expect(store.length).toBeGreaterThanOrEqual(ITEMS_PER_PAPER[level] * 3);
    });
  }

  it("ships nothing at N4 or N5, whose 文脈規定 still comes from the join", () => {
    // N4/N5 語彙の文脈規定 keeps its derived 埋め合わせ source (the join's
    // cloze rows, 10 小問 per paper); the authored stores exist only where the
    // 大問 was found unfillable.
    for (const level of ["N4", "N5"]) {
      expect(kiteiStoreFor(level)).toHaveLength(0);
    }
  });

  it("keeps every 文脈規定 wearing its own paper's instruction line", () => {
    // The N3 paper writes えらびなさい, the N2 and N1 papers 選びなさい
    // (N3V.pdf 問題３, N2V.pdf 問題４, N1V.pdf 問題２). One line per level,
    // from that level's file, not the family's.
    for (const level of ["N1", "N2", "N3"] as const) {
      const stems = new Set(kiteiStoreFor(level).map((entry) => entry.stem));
      expect(stems.size).toBe(1);
      expect([...stems][0]).toBe(KITEI_LEVELS[level].stem);
      // The blank the answer fills and the full-width option digits a real
      // paper prints both live in the instruction line, not in the sentence.
      expect(KITEI_LEVELS[level].stem).toContain("（　）");
      expect(KITEI_LEVELS[level].stem).toContain("１・２・３・４");
    }
  });

  it("serves no row outside its own level", () => {
    // `servableReadingRow` is the third leg of no-fallback: the loader keys on
    // the filename, so a row that wears another level's stamp must be skipped,
    // not printed under a 大問 that does not ask it.
    for (const level of ["N1", "N2", "N3"] as const) {
      for (const entry of kiteiStoreFor(level)) {
        expect(servableReadingRow({ entry, level })).not.toBeNull();
        for (const other of ["N1", "N2", "N3", "N4"]) {
          if (other !== level) {
            expect(servableReadingRow({ entry, level: other })).toBeNull();
          }
        }
      }
    }
  });
});

describe("kiteiSourceFor", () => {
  it("turns one store row into a source carrying its own sentence and line", () => {
    const source = sourceOf(newCatalog(), "N3");
    expect(source).not.toBeNull();
    const s = source as KiteiSource;
    expect(s.passage).not.toBeNull();
    expect((s.passage ?? "").match(BLANK_RE)).toHaveLength(1);
    // The picker hands over the three WRONG words; the answer rides `target`,
    // so the 小問 is `[target, ...distractors]`. The answer is a WORD, not a
    // single kanji.
    expect([...s.target].length).toBeGreaterThanOrEqual(2);
    // The anchor namespace, the instruction line as `cue`, the judgement flags
    // and the no-leak rule are the shape every word-form picker shares; the
    // harness helper is where they are pinned.
    assertComposedSourceShape({
      anchorPrefix: "kitei",
      cue: KITEI_LEVELS.N3.stem,
      source: s,
    });
  });

  it("spends the sentence, so one sentence backs one 小問", () => {
    assertSpendsOneStimulusPerWalk((catalog) => sourceOf(catalog, "N3"));
  });

  it("honors `seenAnchors`, so a retry asks a sentence this learner has not seen", () => {
    const catalog = newCatalog();
    const first = sourceOf(catalog, "N3");
    expect(first).not.toBeNull();
    const seen = newCatalog();
    seen.seenAnchors.add((first as KiteiSource).anchorId);
    const next = sourceOf(seen, "N3");
    expect(next).not.toBeNull();
    expect((next as KiteiSource).anchorId).not.toBe(
      (first as KiteiSource).anchorId
    );
  });

  it("declines N4 rather than invent a context", () => {
    // N4 ships no store, so the picker returns null and the N4 paper keeps its
    // derived join-cloze 大問 (TASK-173.1: no invented fallback).
    expect(sourceOf(newCatalog(), "N4")).toBeNull();
  });
});

describe("a real paper fills 文脈規定 from the validated store", () => {
  for (const level of ["N1", "N2", "N3"] as const) {
    it(`lands the whole ${level} 文脈規定 大問 byte-equal to its store`, async () => {
      const { assembled, state } = await realPaper(
        level,
        `kitei-fill-${level}`
      );
      const landed = kiteiItemsOf(state);
      // Not "some 文脈規定": the entire 大問 the blueprint asks.
      assertBlockFullyPrinted({
        assembled,
        blockName: "文脈規定",
        count: ITEMS_PER_PAPER[level],
        landed,
      });
      eachLandedRowMatchesStore({
        bigQuestion: KITEI_LEVELS[level].bigQuestion,
        blockName: "文脈規定",
        landed,
        level,
        onRow: (item, row, passage) => {
          assertOptionsAreRowsOwn({
            blockName: "文脈規定",
            item,
            level,
            passage,
            row,
          });
          expect(passage.match(BLANK_RE)).toHaveLength(1);
          // The landed sentence prints none of its four options, not even the
          // answer it is about to accept: the wider leak rule, pinned at the
          // paper rather than only in the store.
          for (const option of item.options) {
            expect(option).not.toContain("＿");
            expect(passage.includes(option)).toBe(false);
          }
        },
        rows: kiteiStoreFor(level),
        stimulus: "sentence",
      });
    });
  }

  for (const level of ["N1", "N2", "N3"] as const) {
    it(`fills the ${level} 文脈規定 大問 again on a SECOND real paper, from sentences the first did not print`, async () => {
      // AC#4 headroom. The catalog seeds `seenAnchors` from
      // `listServedAnchorsForLevel`, so the second paper cannot re-ask the
      // first paper's sentences; filling it whole a second time proves the
      // store carries more than one paper's supply, not just that assembly is
      // per-exam. And the cloze family must not report exhausted.
      const first = await realPaper(level, `kitei-headroom-${level}-1`);
      expect(kiteiItemsOf(first.state)).toHaveLength(ITEMS_PER_PAPER[level]);
      const second = await realPaper(level, `kitei-headroom-${level}-2`);
      const landed = kiteiItemsOf(second.state);
      assertBlockFullyPrinted({
        assembled: second.assembled,
        blockName: "文脈規定",
        count: ITEMS_PER_PAPER[level],
        landed,
      });
      expect(second.assembled.contentExhausted).toBe(false);
      const firstIds = new Set(
        kiteiItemsOf(first.state).map((entry) => entry.item.id)
      );
      for (const entry of landed) {
        expect(firstIds.has(entry.item.id)).toBe(false);
      }
    });
  }

  it("scores the 小問 into 言語知識, where the official 得点区分 puts them", () => {
    // A placed item type missing from a band's `itemTypes` filter silently
    // loses its points (the N2 57/60 precedent TASK-173.9.23 hit with 用法).
    // All three merged bands filter on `LANGUAGE_KNOWLEDGE_ITEM_TYPES`, so
    // context-cloze must be listed there or 文脈規定 lands uncounted. N3 needs
    // it too: its 言語知識 band sources across the `vocabulary` section.
    for (const level of ["N1", "N2", "N3"] as const) {
      const band = PAPER_BLUEPRINTS[level].scoringSections.find(
        (each) => each.id === "language-knowledge"
      );
      if (band !== undefined && "itemTypes" in band) {
        expect(band.itemTypes).toContain("context-cloze");
      }
    }
  });

  it("counts the landed N3 大問 into 言語知識 through the vocabulary 科目", async () => {
    // The N3 wiring is the leg the N2-only precedent cannot prove: the block
    // lands in the standalone `vocabulary` 科目 and must still score into the
    // `language-knowledge` band that sources across it.
    const { assembled, state } = await realPaper("N3", "kitei-band-N3");
    assertLandedScoresInto({
      assembled,
      landed: kiteiItemsOf(state),
      scoringSectionId: "language-knowledge",
    });
  });

  it("counts the landed N2 大問 into 言語知識", async () => {
    const { assembled, state } = await realPaper("N2", "kitei-band-N2");
    assertLandedScoresInto({
      assembled,
      landed: kiteiItemsOf(state),
      scoringSectionId: "language-knowledge",
    });
  });
});

describe("文脈規定 is a hole exactly when its store is gone", () => {
  it("names the 大問 at N3 when the store is empty or missing", async () => {
    // N3 carries the hole suite: the deepest block (11 小問) in the section
    // wiring the other levels do not exercise (the standalone `vocabulary`).
    for (const rows of ["[]", null] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: both iterations swap an overlay of the SAME N3 store file, so they must not run concurrently.
      const { assembled, state } = await withLevelKiteiStore("N3", rows, () =>
        realPaper("N3", "kitei-drained")
      );
      const hole = assembled.unfilledBlocks.find(
        (block) => block.name === "文脈規定"
      );
      expect(hole?.bigQuestion).toBe(KITEI_LEVELS.N3.bigQuestion);
      expect(hole?.requestedItems).toBe(ITEMS_PER_PAPER.N3);
      expect(kiteiItemsOf(state)).toHaveLength(0);
      // Non-vacuity: the overlay is a working data root, not a broken one,
      // because the 漢字読み 大問 above it still fills from the vocab corpus.
      assertOverlayRootStillFillsBlock({
        itemType: "kanji-reading",
        state,
      });
    }
  });

  it("counts a store too small for its 大問 as a shortfall, not a hole", async () => {
    // The shipped N3 store holds 33 rows against an 11-小問 大問. One row DOES
    // trigger the boundary: the block HAS a source, so it stays out of
    // `unfilledBlocks` and comes up short instead (TASK-148's different fact).
    const { assembled, state } = await withLevelKiteiStore(
      "N3",
      JSON.stringify(shippedKiteiRows("N3").slice(0, 1)),
      () => realPaper("N3", "kitei-one-row")
    );
    expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
      "文脈規定"
    );
    expect(kiteiItemsOf(state)).toHaveLength(1);
  });
});

describe("an unjudged 文脈規定 row never reaches a learner", () => {
  it("refuses every row whose two blind passes did not sign it off", async () => {
    // The `validated` flag is the cert record: `check:kitei` proves the store
    // shape and the judge artifacts prove two independently shuffled passes
    // agreed, and the walk's `composed && !validated` term is what makes a
    // real paper trust it. Drop that term and a hand-edited store whose keys
    // no judge ever read serves the 大問 whole, which is the laundering
    // TASK-173.9.5 exists to stop.
    const unjudged = shippedKiteiRows("N3").map((row) => ({
      ...row,
      validated: false,
    }));
    const { assembled, state } = await withLevelKiteiStore(
      "N3",
      JSON.stringify(unjudged),
      () => realPaper("N3", "kitei-unjudged")
    );
    // The store EXISTS, so this is a shortfall, not a hole: the receipt says the
    // paper came up short without blaming the learner, and says nothing about a
    // block it could have asked.
    assertBlockNotPrintedNorNamed({
      assembled,
      blockName: "文脈規定",
      landed: kiteiItemsOf(state),
    });
    expect(assembled.shortfall).toBeGreaterThan(0);
    // Non-vacuity in the other direction: the same overlay with the flag left
    // TRUE fills the 大問, so the refusal above is the flag and nothing else.
    const filled = await withLevelKiteiStore(
      "N3",
      JSON.stringify(shippedKiteiRows("N3")),
      () => realPaper("N3", "kitei-judged-overlay")
    );
    expect(kiteiItemsOf(filled.state)).toHaveLength(ITEMS_PER_PAPER.N3);
  });
});
