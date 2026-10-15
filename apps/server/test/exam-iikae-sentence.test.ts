import { beforeAll, describe, expect, it } from "bun:test";
import type { ExamLevel, ExamSectionId } from "@manobu/api-contract";
import {
  PAPER_BLUEPRINTS,
  paperBlockInstruction,
  paperBlocksFor,
} from "@manobu/item-engine/paper";
import { iikaeSentenceStoreFor } from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
// The three word-form specs consume the whole shared harness, so this import
// block is identical by design; a per-family re-export module would only add an
// indirection and a second clone.
// fallow-ignore-next-line code-duplication
import {
  assertBlockFullyPrinted,
  assertBlockNotPrintedNorNamed,
  assertComposedSourceShape,
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

const DB_URL = prepareContentDb("exam-iikae-sentence");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/*
 * TASK-173.9.28: authentic 言い換え類義 material for the 大問 that asks which of
 * four complete sentences means the sentence a whole 小問 is made of (the N4/N5
 * word form of the same ねらい; doc-26 §1).
 *
 * The 大問 prints 5 小問 at BOTH N4 and N5, in 語彙. A 小問 is ONE authored
 * sentence plus FOUR sentences, exactly one of which keeps what the printed
 * sentence says. The mechanical half is falsifiable against the assembly's own
 * leak rule (`sentence-paraphrase` is absent from `STIMULUS_ANSWER_TYPES`, so
 * `hasStemLeak` searches prompt+passage for the ANSWER TEXT and a row whose
 * sentence already prints its answer is dropped in silence) and against the
 * frame algebra the gate proves offline (`check:iikae-sentence`: every option is
 * exactly one swap of the passage, the frame around the swap carries the
 * sentence, and the level's length band puts material within the reader's
 * reach). What no screen can see, that the swapped-in sentence MEANS the printed
 * one, is what the two blind judge passes certified. This file proves the shipped
 * rows REACH a paper:
 *
 *   - the store (`iikaeSentenceStoreFor`): 20/20 composed+validated rows at
 *     N4/N5, each ≥ the four-paper depth floor, and nothing at N1-N3,
 *   - the picker (`iikaeSentenceSourceFor`): the row's own sentence and
 *     instruction line, one sentence per 小問 (spent), `seenAnchors` honored,
 *     the word-form levels declined rather than borrowed from,
 *   - the real papers: 大問4 at N4 and N5 lands whole, byte-equal to shipped
 *     rows under the official sentence-form instruction, scored into 言語知識,
 *   - the hole: with the store emptied the receipt NAMES 言い換え類義
 *     (TASK-173.1 no-fallback), a one-row store comes up short instead, and an
 *     unvalidated substitute never reaches a learner.
 */

/** One level's 言い換え類義 大問: where the paper numbers it, how many 小問 it
 * prints, and how many rows ship behind it. */
const LEVELS = [
  { bigQuestion: 4, items: 5, level: "N4", rows: 20 },
  { bigQuestion: 4, items: 5, level: "N5", rows: 20 },
] as const;

/** The sentence form prints NO brackets: the 小問 IS the sentence, underlined,
 * so a 「」 anywhere in a store row would be the word form wearing this 大問's
 * heading. */
const BRACKET_RE = /「[^」]+」/g;

/** The paper's own instruction line for the sentence form, transcribed from the
 * N4/N5 booklets rather than imported, matching `check:iikae-sentence`'s
 * `SENTENCE_STEM` and the item engine's
 * `PAPER_BLOCK_INSTRUCTIONS['iikae-ruiji']` for these levels. */
const SENTENCE_STEM =
  "＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。";

/** N4/N5 split 語彙 into its own 科目, and that 科目 is where this 大問 lives. */
const SECTIONS_BY_LEVEL: Readonly<Record<string, readonly ExamSectionId[]>> = {
  N4: ["vocabulary"],
  N5: ["vocabulary"],
};

const realPaper = (level: ExamLevel, seed: string) => {
  const sections = SECTIONS_BY_LEVEL[level] ?? [];
  return requestAssembleRead(client, {
    budget: fullBudget(sections),
    level,
    mode: "real",
    sections: [...sections],
    seed,
  });
};

const iikaeItemsOf = (state: Awaited<ReturnType<typeof realPaper>>["state"]) =>
  state.items.filter((entry) => entry.item.itemType === "sentence-paraphrase");

const { iikaeSentenceSourceFor, servableReadingRow } = __test__;

type IikaeSentenceSource = NonNullable<
  ReturnType<typeof iikaeSentenceSourceFor>
>;

const sourceOf = (
  catalog: WritableCatalog,
  level: string,
  index = 0,
  offset = 0
): IikaeSentenceSource | null =>
  iikaeSentenceSourceFor({ catalog, index, level, offset });

/*
 * The store-sized boundary, the drained boundary and the unjudged-row boundary
 * are all reached by SUBSTITUTING one level's sentence-form file: a real paper is
 * never drained by spending it. The scratch root symlinks everything else, so the
 * vocab/grammar corpora and the WORD-form files stay the real ones and a shipped
 * file can never be written by the overlay.
 */

/** One level's shipped store, rewritten in the scratch root. `null` means the
 * file is absent, which is the same absence as an empty one. */
const withIikaeSentenceStore = async <T>(
  level: string,
  rows: string | null,
  run: () => Promise<T>
): Promise<T> =>
  withSubstitutedReadingStore({
    fileName: `${level.toLowerCase()}-iikae-sentence.json`,
    prefix: "manobu-iikae-sentence-",
    rows,
    run,
  });

/** One shipped store, read as JSON so an overlay can rewrite one field. */
const shippedRows = (level: string): Record<string, unknown>[] =>
  shippedReadingRows(`${level.toLowerCase()}-iikae-sentence.json`);

describe("the 言い換え類義 sentence store", () => {
  for (const { level, rows, items } of LEVELS) {
    it(`ships ${rows} composed rows at ${level}, four papers' worth of its ${items} 小問`, () => {
      const store = iikaeSentenceStoreFor(level);
      expect(store).toHaveLength(rows);
      for (const entry of store) {
        expect(entry.level).toBe(level);
        expect(entry.block).toBe("iikae-ruiji");
        expect(entry.provenance).toBe("composed");
        // The honesty gate (`isRefused`) trusts exactly this flag, and
        // `check:iikae-sentence` is what makes it mean the two blind passes ran.
        expect(entry.validated ?? false).toBe(true);
        // A sentence-form 小問 is the sentence itself: it prints a plain
        // underlined line, not a word standing inside brackets.
        expect(entry.passage.match(BRACKET_RE)).toBeNull();
        expect(entry.options).toHaveLength(4);
        expect(new Set(entry.options).size).toBe(4);
        expect(entry.answerIndex).toBe(0);
        // Every candidate is a whole sentence of its own, which is what
        // separates this 大問 from the word form's four short paraphrases.
        for (const option of entry.options) {
          expect(option.endsWith("。")).toBe(true);
        }
        // No option may sit inside the sentence it belongs to: `hasStemLeak`
        // searches prompt+passage for the ANSWER TEXT, so a row whose sentence
        // already prints its own paraphrase is dropped in silence by the
        // assembly rather than graded as a weak 小問.
        for (const option of entry.options) {
          expect(entry.passage.includes(option)).toBe(false);
        }
      }
      // Four papers' worth of 小問 before the store runs dry (the same depth
      // standard 表記, 語形成 and the word form are held to).
      expect(store.length).toBeGreaterThanOrEqual(items * 4);
    });
  }

  it("ships nothing at N1, N2 or N3, whose 大問 asks the word form", () => {
    // TASK-173.9.28 delivers the sentence form only. The top three levels print a
    // bracketed word plus four short paraphrases (doc-26 §1), so a sentence store
    // there would be the wrong construction under the right heading, and the
    // picker must decline instead of borrowing rows across forms.
    for (const level of ["N1", "N2", "N3"] as const) {
      expect(iikaeSentenceStoreFor(level)).toHaveLength(0);
      expect(sourceOf(newCatalog(), level)).toBeNull();
    }
  });

  it("keeps every row wearing the same official instruction line", () => {
    for (const { level } of LEVELS) {
      const stems = new Set(
        iikaeSentenceStoreFor(level).map((entry) => entry.stem)
      );
      expect(stems.size).toBe(1);
      expect([...stems][0]).toBe(SENTENCE_STEM);
      // The blank the learner fills and the full-width option digits a real
      // paper prints both live in the instruction line, not in the sentence.
      expect(SENTENCE_STEM).toContain("＿＿＿");
      expect(SENTENCE_STEM).toContain("１・２・３・４");
    }
  });

  it("serves no row outside its own level", () => {
    // `servableReadingRow` is the third leg of no-fallback: the loader keys on
    // the filename, so a row that wears another level's stamp must be skipped,
    // not printed under a 大問 whose reader has not met that sentence length.
    for (const { level } of LEVELS) {
      for (const entry of iikaeSentenceStoreFor(level)) {
        expect(servableReadingRow({ entry, level })).not.toBeNull();
        for (const other of ["N1", "N2", "N3", "N4", "N5"]) {
          if (other !== level) {
            expect(servableReadingRow({ entry, level: other })).toBeNull();
          }
        }
      }
    }
  });
});

describe("iikaeSentenceSourceFor", () => {
  it("turns one store row into a source carrying its own sentence and line", () => {
    const source = sourceOf(newCatalog(), "N4");
    expect(source).not.toBeNull();
    const s = source as IikaeSentenceSource;
    expect(s.passage).not.toBeNull();
    expect((s.passage ?? "").match(BRACKET_RE)).toBeNull();
    // The picker hands over the three WRONG sentences; the answer rides
    // `target`, so the 小問 is `[target, ...distractors]`. The anchor namespace
    // is the store's own. The trailing hyphen matters: the word form's anchors
    // are `iikae:{id}`, so a sentence row whose id echoed a word row's would
    // otherwise be attested under the wrong level. The rest of the word-form
    // shape is the harness helper's to pin.
    assertComposedSourceShape({
      anchorPrefix: "iikae-sentence",
      cue: SENTENCE_STEM,
      source: s,
    });
  });

  it("spends the sentence, so one sentence backs one 小問", () => {
    assertSpendsOneStimulusPerWalk((catalog) => sourceOf(catalog, "N4"));
  });

  it("honors `seenAnchors`, so a retry asks a sentence this learner has not seen", () => {
    const catalog = newCatalog();
    const first = sourceOf(catalog, "N4");
    expect(first).not.toBeNull();
    const seen = newCatalog();
    seen.seenAnchors.add((first as IikaeSentenceSource).anchorId);
    const next = sourceOf(seen, "N4");
    expect(next).not.toBeNull();
    expect((next as IikaeSentenceSource).anchorId).not.toBe(
      (first as IikaeSentenceSource).anchorId
    );
  });

  it("declines a level with no sentence store rather than invent a paraphrase", () => {
    // N2 ships no sentence file, so the picker returns null and the paper names
    // the hole instead of printing a 大問 off a word list (TASK-173.1: no
    // invented fallback). The word form at that level is served by
    // `iikaeSourceFor`, never by this one.
    expect(sourceOf(newCatalog(), "N2")).toBeNull();
  });
});

describe("a real paper fills 言い換え類義 from the validated sentence store", () => {
  for (const { level, bigQuestion, items } of LEVELS) {
    it(`lands the whole ${level} 大問${bigQuestion} byte-equal to its store`, async () => {
      const { assembled, state } = await realPaper(
        level,
        `iikae-sentence-fill-${level}`
      );
      const landed = iikaeItemsOf(state);
      // Not "some 言い換え類義": the entire 大問 the blueprint asks.
      assertBlockFullyPrinted({
        assembled,
        blockName: "言い換え類義",
        count: items,
        landed,
      });
      eachLandedRowMatchesStore({
        bigQuestion,
        blockName: "言い換え類義",
        landed,
        level,
        onRow: (item, row, passage) => {
          assertOptionsAreRowsOwn({
            blockName: "言い換え類義",
            item,
            level,
            passage,
            row,
          });
          // The 小問 prints an underlined sentence, so no bracket sneaks into
          // the material and no blank leaks out of the instruction line.
          expect(passage.match(BRACKET_RE)).toBeNull();
          expect(passage).not.toContain("＿");
          for (const option of item.options) {
            expect(option).not.toContain("＿");
          }
        },
        rows: iikaeSentenceStoreFor(level),
        stimulus: "sentence",
      });
    });

    it(`heads the ${level} 大問${bigQuestion} with the sentence-form instruction`, () => {
      // The heading is a per-(level, 大問) fact the paper prints whether or not
      // the store filled, and this is the line the N4/N5 booklets print, not the
      // N1-N3 word form's.
      expect(paperBlockInstruction({ block: "iikae-ruiji", level })).toBe(
        SENTENCE_STEM
      );
      // The 大問 row asks ONE form: a row that named both would split its 小問
      // across two constructions, which is a paper nobody printed.
      const block = paperBlocksFor({ level, section: "vocabulary" }).find(
        (candidate) => candidate.bigQuestion === bigQuestion
      );
      expect(block?.id).toBe("iikae-ruiji");
      expect(block?.itemTypes).toEqual(["sentence-paraphrase"]);
    });
  }

  it("scores the 小問 into 言語知識, where the official 得点区分 puts them", async () => {
    // The N4/N5 言語知識 band takes a whole 科目 unfiltered, but the three upper
    // levels FILTER that band by item type, and a type missing from the shared
    // list silently loses its points (the N2 57/60 precedent TASK-173.9.23 hit
    // with 用法). Read the registration off the N3 band, the lowest paper that
    // prints the filter.
    const filteredBand = PAPER_BLUEPRINTS.N3.scoringSections.find(
      (each) => each.id === "language-knowledge"
    );
    if (filteredBand === undefined || !("itemTypes" in filteredBand)) {
      throw new Error(
        "N3 prints no 言語知識 scoring band with an item filter to read"
      );
    }
    expect(filteredBand.itemTypes).toContain("sentence-paraphrase");
    for (const { level } of LEVELS) {
      // If a future edit gives these levels the filter too, the same type has to
      // be inside it, so the assertion below fails rather than the learner's 得点.
      const band = PAPER_BLUEPRINTS[level].scoringSections.find(
        (each) => each.id === "language-knowledge"
      );
      if (band === undefined) {
        throw new Error(`${level} prints no 言語知識 scoring band`);
      }
      if ("itemTypes" in band) {
        expect(band.itemTypes).toContain("sentence-paraphrase");
      }
    }
    for (const { level } of LEVELS) {
      // biome-ignore lint/performance/noAwaitInLoops: every iteration assembles a real paper against the SAME isolated database and the process-wide corpus cache, so Promise.all would interleave the two assemblies and their writes; the assertions are per level, not a throughput path.
      const { assembled, state } = await realPaper(
        level,
        `iikae-sentence-band-${level}`
      );
      assertLandedScoresInto({
        assembled,
        landed: iikaeItemsOf(state),
        scoringSectionId: "language-knowledge",
      });
    }
  });
});

describe("言い換え類義 is a hole exactly when its sentence store is gone", () => {
  it("names 大問4 at N4 when the store is empty or missing", async () => {
    for (const rows of ["[]", null] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: both iterations swap an overlay of the SAME N4 store file, so they must not run concurrently.
      const { assembled, state } = await withIikaeSentenceStore(
        "N4",
        rows,
        () => realPaper("N4", "iikae-sentence-drained")
      );
      const hole = assembled.unfilledBlocks.find(
        (block) => block.name === "言い換え類義"
      );
      expect(hole?.bigQuestion).toBe(4);
      expect(hole?.requestedItems).toBe(5);
      expect(iikaeItemsOf(state)).toHaveLength(0);
      // Non-vacuity: the overlay is a working data root, not a broken one,
      // because the 漢字読み 大問 above it still fills from the vocab corpus.
      assertOverlayRootStillFillsBlock({
        itemType: "kanji-reading",
        state,
      });
    }
  });

  it("counts a store too small for its 大問 as a shortfall, not a hole", async () => {
    // The shipped N5 store holds 20 rows against a 5-小問 大問. One row DOES
    // trigger the boundary: the block HAS a source, so it stays out of
    // `unfilledBlocks` and comes up short instead (TASK-148's different fact).
    const { assembled, state } = await withIikaeSentenceStore(
      "N5",
      JSON.stringify(shippedRows("N5").slice(0, 1)),
      () => realPaper("N5", "iikae-sentence-one-row")
    );
    expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
      "言い換え類義"
    );
    expect(iikaeItemsOf(state)).toHaveLength(1);
  });
});

describe("an unjudged 言い換え類義 sentence row never reaches a learner", () => {
  it("refuses every row whose two blind passes did not sign it off", async () => {
    // The `validated` flag is the cert record: `check:iikae-sentence` proves the
    // two independently shuffled passes agreed, and the walk's
    // `composed && !validated` term is what makes a real paper trust it. Drop
    // that term and a hand-edited store whose keys no judge ever read serves
    // 大問4 whole, which is the laundering TASK-173.9.5 exists to stop. Whether
    // one sentence means another is a judgement no corpus can make, so this flag
    // is the ONLY proof an option keeps the printed sentence's meaning.
    const unjudged = shippedRows("N5").map((row) => ({
      ...row,
      validated: false,
    }));
    const { assembled, state } = await withIikaeSentenceStore(
      "N5",
      JSON.stringify(unjudged),
      () => realPaper("N5", "iikae-sentence-unjudged")
    );
    // The store EXISTS, so this is a shortfall, not a hole: the receipt says the
    // paper came up short without blaming the learner, and says nothing about a
    // block it could have asked.
    assertBlockNotPrintedNorNamed({
      assembled,
      blockName: "言い換え類義",
      landed: iikaeItemsOf(state),
    });
    expect(assembled.shortfall).toBeGreaterThan(0);
    // Non-vacuity in the other direction: the same overlay with the flag left
    // TRUE fills the 大問, so the refusal above is the flag and nothing else.
    const filled = await withIikaeSentenceStore(
      "N5",
      JSON.stringify(shippedRows("N5")),
      () => realPaper("N5", "iikae-sentence-judged-overlay")
    );
    expect(iikaeItemsOf(filled.state)).toHaveLength(5);
  });
});
