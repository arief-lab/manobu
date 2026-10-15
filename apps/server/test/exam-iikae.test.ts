import { beforeAll, describe, expect, it } from "bun:test";
import type { ExamLevel, ExamSectionId } from "@manobu/api-contract";
import { PAPER_BLUEPRINTS } from "@manobu/item-engine/paper";
import { iikaeStoreFor } from "../src/services/exam-corpus";
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

const DB_URL = prepareContentDb("exam-iikae");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/*
 * TASK-173.9.27: authentic 言い換え類義 material for the 大問 that asks which of
 * four candidates means the word a sentence brackets (2018 samples N1V.pdf p.5
 * 問題3, N2V.pdf p.7 問題5, N3V.pdf p.6 問題4; doc-26 §1).
 *
 * The 大問 prints 6 小問 at N1 and 5 at N2/N3. A 小問 is ONE authored sentence
 * with one 「　」-bracketed word plus FOUR paraphrases, exactly one of which keeps
 * what the sentence says. The mechanical half is falsifiable against the licensed
 * vocab corpus (the bracketed target is a headword of the level's own band, and
 * no option appears inside its own sentence, which is `hasStemLeak`'s rule:
 * `synonym-paraphrase` is absent from `STIMULUS_ANSWER_TYPES`, so the engine
 * searches prompt+passage for the ANSWER TEXT and a leaky row is dropped in
 * silence). What no corpus can see, that the OPTION means the TARGET in THIS
 * sentence, is what the two blind judge passes certified. `check:iikae` re-proves
 * all of it offline; this file proves the shipped rows REACH a paper:
 *
 *   - the store (`iikaeStoreFor`): 30/26/26 composed+validated rows at
 *     N1/N2/N3, each ≥ the four-paper depth floor, and nothing at N4/N5,
 *   - the picker (`iikaeSourceFor`): the row's own sentence and instruction line,
 *     one sentence per 小問 (spent), `seenAnchors` honored, N4 declined rather
 *     than invented,
 *   - the real papers: 大問3 at N1, 大問5 at N2 and 大問4 at N3 land whole,
 *     byte-equal to shipped rows, no option inside its own sentence, scored into
 *     言語知識,
 *   - the hole: with the store emptied the receipt NAMES 言い換え類義 (TASK-173.1
 *     no-fallback), N4/N5 name it today because the sentence form is
 *     TASK-173.9.28's, a one-row store comes up short instead, and an unvalidated
 *     substitute never reaches a learner.
 */

/** One level's 言い換え類義 大問: where the paper numbers it, how many 小問 it
 * prints, and how many rows ship behind it. */
const LEVELS = [
  { bigQuestion: 3, items: 6, level: "N1", rows: 30 },
  { bigQuestion: 5, items: 5, level: "N2", rows: 26 },
  { bigQuestion: 4, items: 5, level: "N3", rows: 26 },
] as const;

/** The paper brackets ONE word per 小問 with 「」, the corner quotation the
 * samples set it in. */
const BRACKET_RE = /「[^」]+」/g;

/** The papers' own instruction lines, quoted from N1V.pdf p.5 問題3 and N2V.pdf
 * p.7 問題5 (one line, the word form) and N3V.pdf p.6 問題4 (kana-only wording),
 * matching the `check:iikae` gate's `IIKAE_STEMS` and the item engine's
 * `PAPER_BLOCK_INSTRUCTIONS['iikae-ruiji']`. */
const WORD_FORM_STEM =
  "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。";
const N3_STEM =
  "＿＿＿に意味が最も近いものを、１・２・３・４から一つえらびなさい。";

const STEM_BY_LEVEL: Readonly<Record<string, string>> = {
  N1: WORD_FORM_STEM,
  N2: WORD_FORM_STEM,
  N3: N3_STEM,
};

/** N2/N1 print the merged 言語知識・読解 科目; N3 splits 語彙 off, and that 科目 is
 * where its 言い換え類義 大問 lives. */
const SECTIONS_BY_LEVEL: Readonly<Record<string, readonly ExamSectionId[]>> = {
  N1: ["language-knowledge-reading"],
  N2: ["language-knowledge-reading"],
  N3: ["vocabulary"],
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
  state.items.filter((entry) => entry.item.itemType === "synonym-paraphrase");

const { iikaeSourceFor, servableReadingRow } = __test__;

type IikaeSource = NonNullable<ReturnType<typeof iikaeSourceFor>>;

const sourceOf = (
  catalog: WritableCatalog,
  level: string,
  index = 0,
  offset = 0
): IikaeSource | null => iikaeSourceFor({ catalog, index, level, offset });

/*
 * The store-sized boundary, the drained boundary and the unjudged-row boundary
 * are all reached by SUBSTITUTING one level's 言い換え file: a real paper is
 * never drained by spending it, and N4/N5 ship no file at all. The scratch root
 * symlinks everything else, so the vocab/grammar corpora stay the real ones and
 * the shipped file can never be written by the overlay.
 */

/** One level's shipped store, rewritten in the scratch root. `null` means the
 * file is absent, which is the same absence as an empty one. */
const withIikaeStore = async <T>(
  level: string,
  rows: string | null,
  run: () => Promise<T>
): Promise<T> =>
  withSubstitutedReadingStore({
    fileName: `${level.toLowerCase()}-iikae.json`,
    prefix: "manobu-iikae-",
    rows,
    run,
  });

/** One shipped store, read as JSON so an overlay can rewrite one field. */
const shippedRows = (level: string): Record<string, unknown>[] =>
  shippedReadingRows(`${level.toLowerCase()}-iikae.json`);

describe("the 言い換え類義 store", () => {
  for (const { level, rows, items } of LEVELS) {
    it(`ships ${rows} composed rows at ${level}, four papers' worth of its ${items} 小問`, () => {
      const store = iikaeStoreFor(level);
      expect(store).toHaveLength(rows);
      for (const entry of store) {
        expect(entry.level).toBe(level);
        expect(entry.block).toBe("iikae-ruiji");
        expect(entry.provenance).toBe("composed");
        // The honesty gate (`isRefused`) trusts exactly this flag, and
        // `check:iikae` is what makes it mean the two blind passes ran.
        expect(entry.validated ?? false).toBe(true);
        // A real 言い換え類義 小問 is one sentence printing ONE bracketed word,
        // plus four candidate meanings for it.
        expect(entry.passage.match(BRACKET_RE)).toHaveLength(1);
        assertFourDistinctOptionsAnswerFirst(entry);
        // No option may sit inside the sentence it belongs to: `hasStemLeak`
        // searches prompt+passage for the ANSWER TEXT, so a passage that prints
        // its own しばしば is a row the assembly drops in silence rather than a
        // weak row.
        for (const option of entry.options) {
          expect(entry.passage.includes(option)).toBe(false);
        }
      }
      // Four papers' worth of 小問 before the store runs dry (the same depth
      // standard 表記 and 語形成 are held to).
      expect(store.length).toBeGreaterThanOrEqual(items * 4);
    });
  }

  it("ships nothing at N4 or N5, whose 大問 asks the sentence form", () => {
    // TASK-173.9.27 delivers the word form only. N4/N5 print a whole-sentence
    // paraphrase 大問 (doc-26 §1), so their store is empty by design until
    // TASK-173.9.28 writes that construction, and the real paper says so.
    for (const level of ["N4", "N5"] as const) {
      expect(iikaeStoreFor(level)).toHaveLength(0);
    }
  });

  it("keeps every row wearing its level's own instruction line", () => {
    for (const { level } of LEVELS) {
      const stems = new Set(iikaeStoreFor(level).map((entry) => entry.stem));
      expect(stems.size).toBe(1);
      expect([...stems][0]).toBe(STEM_BY_LEVEL[level]);
      // The blank the learner fills and the full-width option digits a real
      // paper prints both live in the instruction line, not in the sentence.
      expect(STEM_BY_LEVEL[level]).toContain("＿＿＿");
      expect(STEM_BY_LEVEL[level]).toContain("１・２・３・４");
    }
  });

  it("serves no row outside its own level", () => {
    // `servableReadingRow` is the third leg of no-fallback: the loader keys on
    // the filename, so a row that wears another level's stamp must be skipped,
    // not printed under a 大問 that does not ask it.
    for (const { level } of LEVELS) {
      for (const entry of iikaeStoreFor(level)) {
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

describe("iikaeSourceFor", () => {
  it("turns one store row into a source carrying its own sentence and line", () => {
    const source = sourceOf(newCatalog(), "N2");
    expect(source).not.toBeNull();
    const s = source as IikaeSource;
    expect(s.passage).not.toBeNull();
    expect((s.passage ?? "").match(BRACKET_RE)).toHaveLength(1);
    // The picker hands over the three WRONG paraphrases; the answer rides
    // `target`, so the 小問 is `[target, ...distractors]`. The anchor
    // namespace, the instruction line as `cue`, the judgement flags and the
    // no-leak rule are the shape every word-form picker shares; the harness
    // helper is where they are pinned.
    assertComposedSourceShape({
      anchorPrefix: "iikae",
      cue: WORD_FORM_STEM,
      source: s,
    });
  });

  it("spends the sentence, so one sentence backs one 小問", () => {
    assertSpendsOneStimulusPerWalk((catalog) => sourceOf(catalog, "N2"));
  });

  it("honors `seenAnchors`, so a retry asks a word this learner has not seen", () => {
    const catalog = newCatalog();
    const first = sourceOf(catalog, "N2");
    expect(first).not.toBeNull();
    const seen = newCatalog();
    seen.seenAnchors.add((first as IikaeSource).anchorId);
    const next = sourceOf(seen, "N2");
    expect(next).not.toBeNull();
    expect((next as IikaeSource).anchorId).not.toBe(
      (first as IikaeSource).anchorId
    );
  });

  it("declines N4 rather than invent a paraphrase", () => {
    // N4 ships no store, so the picker returns null and the paper names the hole
    // instead of printing a 大問 off a word list (TASK-173.1: no invented
    // fallback).
    expect(sourceOf(newCatalog(), "N4")).toBeNull();
  });
});

describe("a real paper fills 言い換え類義 from the validated store", () => {
  for (const { level, bigQuestion, items } of LEVELS) {
    it(`lands the whole ${level} 大問${bigQuestion} byte-equal to its store`, async () => {
      const { assembled, state } = await realPaper(
        level,
        `iikae-fill-${level}`
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
          // Exactly one bracket marks the word the 小問 asks about.
          expect(passage.match(BRACKET_RE)).toHaveLength(1);
          for (const option of item.options) {
            expect(option).not.toContain("＿");
          }
        },
        rows: iikaeStoreFor(level),
        stimulus: "sentence",
      });
    });
  }

  it("scores the 小問 into 言語知識, where the official 得点区分 puts them", async () => {
    // A placed item type missing from a band's `itemTypes` filter silently loses
    // its points (the N2 57/60 precedent TASK-173.9.23 hit with 用法). All three
    // levels route 言い換え類義 into 言語知識, N3 across its split 科目s.
    for (const { level } of LEVELS) {
      const band = PAPER_BLUEPRINTS[level].scoringSections.find(
        (each) => each.id === "language-knowledge"
      );
      if (band === undefined || !("itemTypes" in band)) {
        throw new Error(
          `${level} prints no 言語知識 scoring band with an item filter`
        );
      }
      expect(band.itemTypes).toContain("synonym-paraphrase");
    }
    for (const { level } of LEVELS) {
      // biome-ignore lint/performance/noAwaitInLoops: every iteration assembles a real paper against the SAME isolated database and the process-wide corpus cache, so Promise.all would interleave three assemblies and their writes; the assertions are per level, not a throughput path.
      const { assembled, state } = await realPaper(
        level,
        `iikae-band-${level}`
      );
      assertLandedScoresInto({
        assembled,
        landed: iikaeItemsOf(state),
        scoringSectionId: "language-knowledge",
      });
    }
  });
});

describe("言い換え類義 is a hole exactly when its store is gone", () => {
  it("names 大問5 at N2 when the store is empty or missing", async () => {
    for (const rows of ["[]", null] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: both iterations swap an overlay of the SAME N2 store file, so they must not run concurrently.
      const { assembled, state } = await withIikaeStore("N2", rows, () =>
        realPaper("N2", "iikae-drained")
      );
      const hole = assembled.unfilledBlocks.find(
        (block) => block.name === "言い換え類義"
      );
      expect(hole?.bigQuestion).toBe(5);
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

  it("ships no word-form row at N4/N5, whose 大問4 now fills from the sentence store", async () => {
    // No overlay: these levels simply have no word-form store. The 大問 stopped
    // being a hole when TASK-173.9.28 gave it its own form, and the two stores are
    // disjoint by construction, so what this pins is the crossing that must never
    // happen: 大問4 lands whole WITHOUT one 言い換え類義 word item among them.
    for (const level of ["N4", "N5"] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: both iterations assemble against the SAME isolated database and the process-wide corpus cache, so Promise.all would interleave the two papers' writes; the assertions are per level, not a throughput path.
      const { assembled, state } = await realPaper(
        level,
        `iikae-hole-${level}`
      );
      assertBlockNotPrintedNorNamed({
        assembled,
        blockName: "言い換え類義",
        landed: iikaeItemsOf(state),
      });
      const sentenceForm = state.items.filter(
        (entry) =>
          entry.bigQuestion === 4 &&
          entry.item.itemType === "sentence-paraphrase"
      );
      expect(sentenceForm).toHaveLength(5);
    }
  });

  it("counts a store too small for its 大問 as a shortfall, not a hole", async () => {
    // The shipped N2 store holds 26 rows against a 5-小問 大問. One row DOES
    // trigger the boundary: the block HAS a source, so it stays out of
    // `unfilledBlocks` and comes up short instead (TASK-148's different fact).
    const { assembled, state } = await withIikaeStore(
      "N2",
      JSON.stringify(shippedRows("N2").slice(0, 1)),
      () => realPaper("N2", "iikae-one-row")
    );
    expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
      "言い換え類義"
    );
    expect(iikaeItemsOf(state)).toHaveLength(1);
  });
});

describe("an unjudged 言い換え類義 row never reaches a learner", () => {
  it("refuses every row whose two blind passes did not sign it off", async () => {
    // The `validated` flag is the cert record: `check:iikae` proves the two
    // independently shuffled passes agreed, and the walk's `composed && !validated`
    // term is what makes a real paper trust it. Drop that term and a hand-edited
    // store whose keys no judge ever read serves 大問5 whole, which is the
    // laundering TASK-173.9.5 exists to stop. Synonymy is a judgement no corpus
    // can make, so this flag is the ONLY proof an option means its target.
    const unjudged = shippedRows("N2").map((row) => ({
      ...row,
      validated: false,
    }));
    const { assembled, state } = await withIikaeStore(
      "N2",
      JSON.stringify(unjudged),
      () => realPaper("N2", "iikae-unjudged")
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
    const filled = await withIikaeStore(
      "N2",
      JSON.stringify(shippedRows("N2")),
      () => realPaper("N2", "iikae-judged-overlay")
    );
    expect(iikaeItemsOf(filled.state)).toHaveLength(5);
  });
});
