import { beforeAll, describe, expect, it } from "bun:test";
import type { ExamSectionId } from "@manobu/api-contract";
import { PAPER_BLUEPRINTS } from "@manobu/item-engine/paper";
import { hyoukiStoreFor } from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertBlockFullyPrinted,
  assertBlockNotPrintedNorNamed,
  assertComposedSourceShape,
  assertLandedScoresInto,
  assertNoStimulusReused,
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

const DB_URL = prepareContentDb("exam-hyouki");

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/*
 * TASK-173.9.25: authentic 表記 material for the 大問 that asks how one word of a
 * sentence is written in kanji (2018 sample papers N5V/N4V もんだい２,
 * N3V/N2V 問題２; doc-26 §3).
 *
 * The block (`hyouki`) prints 表記 at N5 (8 小問), N4 (6), N3 (6) and N2 (5); N1
 * does not ask it. A 小問 is ONE authored sentence printing one word in kana
 * inside 「…」 plus FOUR candidate SPELLINGS, exactly one of which writes that
 * word. The key IS mechanically falsifiable: it is a word+reading pair attested
 * in `data/{level}.json`, and the wrong spellings are the official classes (a
 * real word read differently, or a component-mangled non-word). What no corpus
 * can prove is that the authored SENTENCE makes exactly one spelling defensible
 * in context, so the two blind judge passes (keys withheld, packets shuffled
 * independently per pass) certify that fit, `check:hyouki` re-proves the shape,
 * the attestation and the cert record offline, and this file proves the shipped
 * rows REACH a paper:
 *
 *   - the stores (`hyoukiStoreFor`): N5 42 / N4 29 / N3 30 / N2 27 composed+
 *     validated rows, each ≥ the four-paper depth floor, and nothing at N1,
 *   - the picker (`hyoukiSourceFor`): the row's own sentence and instruction
 *     line, one sentence per 小問 (spent), `seenAnchors` honored, an empty
 *     level declined rather than invented,
 *   - the real papers: N5/N4/N3/N2 each land the whole 大問 whose sentence and
 *     stem are byte-equal to a shipped row, the four spellings are the row's own
 *     set, the key spelling never appears in the sentence (no leak), it scores
 *     into 言語知識, and no two levels hand out the same sentence,
 *   - the hole: with the N5 store emptied the receipt NAMES 表記 (TASK-173.1
 *     no-fallback), a one-row store comes up short instead, and a
 *     validated:false row never reaches a learner.
 */

/** The 小問数 of the 表記 大問 at each level that ships a store (paper.ts:633,
 * :610, :585, :560). The rows each frozen store carries are `SHIPPED_ROWS`; the
 * depth floor is four papers' worth, so `ITEMS_PER_PAPER[level] * 4`. */
const ITEMS_PER_PAPER = { N2: 5, N3: 6, N4: 6, N5: 8 } as const;
const SHIPPED_ROWS = { N2: 27, N3: 30, N4: 29, N5: 42 } as const;
/** The kana word a real 表記 sentence prints inside one pair of corner brackets. */
const KANA_SPAN_RE = /「[^」]*」/g;

/** The paper's own instruction line per level, quoted from the 2018 sample
 * papers and matching the `check:hyouki` gate's `HYOUKI_STEMS`. N5 and N4 share
 * the hiragana line (もんだい２ 「＿＿の ことばは どう かきますか。」); N3 and N2
 * each print their own kanji line (問題２ 「＿＿のことばを漢字で書くとき…」). */
const OFFICIAL_STEMS: Readonly<Record<keyof typeof SHIPPED_ROWS, string>> = {
  N2: "＿＿＿ の言葉を漢字で書くとき、最もよいものを１・２・３・４から一つ 選びなさい。",
  N3: "＿＿＿ のことばを漢字で書くとき、最もよいものを、１・２・３・４から一つ えらびなさい。",
  N4: "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
  N5: "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
};

/** 表記 sits in the 文字語彙 大問 at N5/N4/N3 (the `vocabulary` section) and in
 * the merged 言語知識・読解 科目 at N2 (`language-knowledge-reading`). */
const SECTIONS_BY_LEVEL: Readonly<
  Record<keyof typeof SHIPPED_ROWS, readonly ExamSectionId[]>
> = {
  N2: ["language-knowledge-reading"],
  N3: ["vocabulary"],
  N4: ["vocabulary"],
  N5: ["vocabulary"],
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

const hyoukiItemsOf = (state: Awaited<ReturnType<typeof realPaper>>["state"]) =>
  state.items.filter((entry) => entry.item.itemType === "word-spelling");

const { hyoukiSourceFor, servableReadingRow } = __test__;

type HyoukiSource = NonNullable<ReturnType<typeof hyoukiSourceFor>>;

const sourceOf = (
  catalog: WritableCatalog,
  level: string,
  index = 0,
  offset = 0
): HyoukiSource | null => hyoukiSourceFor({ catalog, index, level, offset });

/*
 * The store-sized boundary and the unjudged-row boundary are both reached by
 * SUBSTITUTING the N5 表記 file: a real paper is never ready (its 聴解 blocks are
 * holes), so nothing can be drained by spending it. The scratch root symlinks
 * everything else, so the vocab/grammar corpora stay the real ones and the shipped
 * file can never be written by the overlay.
 */

/** One shipped store, rewritten in the scratch root. `null` means the file is
 * absent, which is the same absence as an empty one. */
const withN5HyoukiStore = async <T>(
  rows: string | null,
  run: () => Promise<T>
): Promise<T> =>
  withSubstitutedReadingStore({
    fileName: "n5-hyouki.json",
    prefix: "manobu-hyouki-",
    rows,
    run,
  });

/** The shipped N5 rows, read as JSON so an overlay can rewrite one field. */
const shippedN5Rows = (): Record<string, unknown>[] =>
  shippedReadingRows("n5-hyouki.json");

describe("the 表記 stores", () => {
  for (const level of ["N5", "N4", "N3", "N2"] as const) {
    it(`ships ${String(SHIPPED_ROWS[level])} composed rows at ${level}`, () => {
      const store = hyoukiStoreFor(level);
      expect(store).toHaveLength(SHIPPED_ROWS[level]);
      for (const entry of store) {
        expect(entry.level).toBe(level);
        expect(entry.block).toBe("hyouki");
        expect(entry.provenance).toBe("composed");
        // The honesty gate (`isRefused`) trusts exactly this flag, and
        // `check:hyouki` is what makes it mean the two blind passes ran.
        expect(entry.validated ?? false).toBe(true);
        // A real 表記 小問 is a spell-the-word item: one sentence printing one
        // word in kana inside one 「」 span, and four candidate spellings.
        expect(entry.passage.match(KANA_SPAN_RE)).toHaveLength(1);
        expect(entry.options).toHaveLength(4);
        expect(new Set(entry.options).size).toBe(4);
        expect(entry.answerIndex).toBe(0);
        // The key spelling is the answer option, and it must NOT sit in the
        // sentence: a sentence that printed the kanji form would give the
        // answer away. `hasStemLeak` guards this because `word-spelling` is
        // deliberately absent from `STIMULUS_ANSWER_TYPES`.
        expect(entry.options[entry.answerIndex]).toBeDefined();
        expect(
          entry.passage.includes(entry.options[entry.answerIndex] ?? "")
        ).toBe(false);
      }
      // Four papers' worth of 小問 before the store runs dry (the same depth
      // standard 用法 and 読解 are held to).
      expect(store.length).toBeGreaterThanOrEqual(ITEMS_PER_PAPER[level] * 4);
    });
  }

  it("ships nothing at N1, which does not ask 表記", () => {
    // 表記 is a 文字語彙 大問 at N5–N2 only; the N1 言語知識 大問 opens with
    // 漢字の読み, never 表記. The empty store is what keeps a real N1 paper from
    // ever printing one (paper.ts:558-574 has no `hyouki` block).
    expect(hyoukiStoreFor("N1")).toHaveLength(0);
  });

  it("keeps every 表記 for the level whose instruction line it carries", () => {
    // N5/N4 print the hiragana かきますか line; N3/N2 each print their own kanji
    // 漢字で書く line. A row wearing another level's line was pasted, not
    // authored, so each store must carry exactly its level's official line.
    for (const level of ["N5", "N4", "N3", "N2"] as const) {
      const store = hyoukiStoreFor(level);
      const stems = new Set(store.map((entry) => entry.stem));
      expect(stems.size).toBe(1);
      expect([...stems][0]).toBe(OFFICIAL_STEMS[level]);
      // The blank and the full-width option digits a real paper prints sit in the
      // question line (the sentence itself carries no ＿＿; the kana word is quoted).
      expect(OFFICIAL_STEMS[level]).toContain("＿＿＿");
      expect(OFFICIAL_STEMS[level]).toContain("１・２・３・４");
    }
    // The hiragana and kanji families are genuinely different lines, and N3 vs N2
    // differ by the comma after をもの (the gate keeps that honest both ways).
    expect(OFFICIAL_STEMS.N5).toBe(OFFICIAL_STEMS.N4);
    expect(OFFICIAL_STEMS.N3).not.toBe(OFFICIAL_STEMS.N2);
    expect(OFFICIAL_STEMS.N3).toContain("を、");
    expect(OFFICIAL_STEMS.N2).not.toContain("を、");
  });

  it("serves no row stamped with another level", () => {
    // `servableReadingRow` is the third leg of no-fallback: the loader keys on the
    // filename, so a row that wears the wrong level must be skipped, not printed
    // under the wrong 大問 heading.
    for (const level of ["N5", "N4", "N3", "N2"] as const) {
      for (const entry of hyoukiStoreFor(level)) {
        expect(servableReadingRow({ entry, level })).not.toBeNull();
        // N1 ships no 表記 store, so a row from any level is unservable there.
        expect(servableReadingRow({ entry, level: "N1" })).toBeNull();
      }
    }
  });
});

describe("hyoukiSourceFor", () => {
  it("turns one store row into a source carrying its own sentence and line", () => {
    const source = sourceOf(newCatalog(), "N5");
    expect(source).not.toBeNull();
    const s = source as HyoukiSource;
    expect(s.passage).not.toBeNull();
    expect((s.passage ?? "").match(KANA_SPAN_RE)).toHaveLength(1);
    // The picker hands over the three WRONG spellings; the key rides `target`,
    // so the 小問 is `[target, ...distractors]`. The key is a real SPELLING,
    // not a bare surface.
    expect(s.target.length).toBeGreaterThan(0);
    // The anchor namespace, the instruction line as `cue`, the judgement flags
    // and the no-leak rule are the shape every word-form picker shares; the
    // harness helper is where they are pinned.
    assertComposedSourceShape({
      anchorPrefix: "hyouki",
      cue: OFFICIAL_STEMS.N5,
      source: s,
    });
  });

  it("spends the sentence, so one sentence backs one 小問", () => {
    assertSpendsOneStimulusPerWalk((catalog) => sourceOf(catalog, "N5"));
  });

  it("honors `seenAnchors`, so a retry asks a sentence this learner has not seen", () => {
    const catalog = newCatalog();
    const first = sourceOf(catalog, "N5");
    expect(first).not.toBeNull();
    const seen = newCatalog();
    seen.seenAnchors.add((first as HyoukiSource).anchorId);
    const next = sourceOf(seen, "N5");
    expect(next).not.toBeNull();
    expect((next as HyoukiSource).anchorId).not.toBe(
      (first as HyoukiSource).anchorId
    );
  });

  it("declines N1 rather than invent a sentence", () => {
    // N1 ships no store, so the picker returns null and the block names its hole
    // instead of fabricating a 表記 小問 (TASK-173.1).
    expect(sourceOf(newCatalog(), "N1")).toBeNull();
  });
});

describe("a real paper fills 表記 from the validated store", () => {
  for (const level of ["N5", "N4", "N3", "N2"] as const) {
    it(`lands the whole ${level} 大問 byte-equal to its store`, async () => {
      const { assembled, state } = await realPaper(
        level,
        `hyouki-fill-${level}`
      );
      const landed = hyoukiItemsOf(state);
      // Not "some 表記": the entire 大問 the blueprint asks.
      assertBlockFullyPrinted({
        assembled,
        blockName: "表記",
        count: ITEMS_PER_PAPER[level],
        landed,
      });
      eachLandedRowMatchesStore({
        blockName: "表記",
        landed,
        level,
        onRow: (item, row, passage) => {
          assertOptionsAreRowsOwn({
            blockName: "表記",
            item,
            level,
            passage,
            row,
          });
          // Exactly one kana span is underlined in the sentence.
          expect(passage.match(KANA_SPAN_RE)).toHaveLength(1);
          // No option is the blank marker and none is empty.
          for (const option of item.options) {
            expect(option).not.toContain("＿＿");
            expect(option.length).toBeGreaterThanOrEqual(1);
          }
        },
        rows: hyoukiStoreFor(level),
        stimulus: "sentence",
      });
    });
  }

  it("scores the 小問 into 言語知識, where the official 得点区分 puts them", async () => {
    // A placed item type missing from a band's `itemTypes` filter silently loses
    // its points (the N2 57/60 precedent TASK-173.9.23 hit with 用法). Only the
    // bands that FILTER by item type can drop one: N3/N2 carry
    // `LANGUAGE_KNOWLEDGE_ITEM_TYPES` (word-spelling among them), while N5/N4
    // score their whole `vocabulary` + `grammar-reading` sections by source id and
    // have no filter to omit the type. Both ways, the 小問 must actually reach the
    // band, which the assembled section's `scoringSectionIds` proves for every
    // level.
    for (const level of ["N5", "N4", "N3", "N2"] as const) {
      const band = PAPER_BLUEPRINTS[level].scoringSections.find(
        (each) => each.id === "language-knowledge"
      );
      if (band !== undefined && "itemTypes" in band) {
        expect(band.itemTypes).toContain("word-spelling");
      }
      // biome-ignore lint/performance/noAwaitInLoops: each paper writes to and reads back the one shared test database; the levels run in order so the store is never touched by two assemblies at once.
      const { assembled, state } = await realPaper(
        level,
        `hyouki-band-${level}`
      );
      assertLandedScoresInto({
        assembled,
        landed: hyoukiItemsOf(state),
        scoringSectionId: "language-knowledge",
      });
    }
  });

  it("asks no level a sentence another level already asks", async () => {
    // The learner who moves up from N5 to N4 must not re-write the same word in
    // the same sentence.
    const passages = new Set<string>();
    for (const level of ["N5", "N4", "N3", "N2"] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: one shared test database, and the clash check accumulates across levels, so the papers are drawn in order.
      const { state } = await realPaper(level, `hyouki-cross-${level}`);
      assertNoStimulusReused({
        blockName: "表記",
        landed: hyoukiItemsOf(state),
        level,
        seen: passages,
        stimulus: "sentence",
      });
    }
    expect(passages.size).toBe(
      ITEMS_PER_PAPER.N5 +
        ITEMS_PER_PAPER.N4 +
        ITEMS_PER_PAPER.N3 +
        ITEMS_PER_PAPER.N2
    );
  });
});

describe("表記 is a hole exactly when its store is gone", () => {
  it("names the 大問 when the store is empty or missing", async () => {
    for (const rows of ["[]", null] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: both iterations swap an overlay of the SAME N5 store file, so they must not run concurrently.
      const { assembled, state } = await withN5HyoukiStore(rows, () =>
        realPaper("N5", "hyouki-drained")
      );
      const hole = assembled.unfilledBlocks.find(
        (block) => block.name === "表記"
      );
      expect(hole?.bigQuestion).toBe(2);
      expect(hole?.requestedItems).toBe(ITEMS_PER_PAPER.N5);
      expect(hyoukiItemsOf(state)).toHaveLength(0);
      // Non-vacuity: the overlay is a working data root, not a broken one,
      // because the 漢字の読み 大問 above it still fills from the vocab corpus.
      assertOverlayRootStillFillsBlock({
        itemType: "kanji-reading",
        state,
      });
    }
  });

  it("counts a store too small for its 大問 as a shortfall, not a hole", async () => {
    // The shipped N5 store holds 42 rows against an 8-小問 大問. One row does
    // trigger the boundary: the block HAS a source, so it stays out of
    // `unfilledBlocks` and comes up short instead (TASK-148's different fact).
    const { assembled, state } = await withN5HyoukiStore(
      JSON.stringify(shippedN5Rows().slice(0, 1)),
      () => realPaper("N5", "hyouki-one-row")
    );
    expect(assembled.unfilledBlocks.map((block) => block.name)).not.toContain(
      "表記"
    );
    expect(hyoukiItemsOf(state)).toHaveLength(1);
  });
});

describe("an unjudged 表記 row never reaches a learner", () => {
  it("refuses every row whose two blind passes did not sign it off", async () => {
    // The `validated` flag is the cert record: `check:hyouki` proves the two
    // independently shuffled passes agreed, and the walk's `composed && !validated`
    // term is what makes a real paper trust it. Drop that term and a hand-edited
    // store whose keys no judge ever read serves 大問2 whole, which is the
    // laundering TASK-173.9.5 exists to stop.
    const unjudged = shippedN5Rows().map((row) => ({
      ...row,
      validated: false,
    }));
    const { assembled, state } = await withN5HyoukiStore(
      JSON.stringify(unjudged),
      () => realPaper("N5", "hyouki-unjudged")
    );
    // The store EXISTS, so this is a shortfall, not a hole: the receipt says the
    // paper came up short without blaming the learner, and says nothing about a
    // block it could have asked.
    assertBlockNotPrintedNorNamed({
      assembled,
      blockName: "表記",
      landed: hyoukiItemsOf(state),
    });
    expect(assembled.shortfall).toBeGreaterThan(0);
    // Non-vacuity in the other direction: the same overlay with the flag left
    // TRUE fills the 大問, so the refusal above is the flag and nothing else.
    const filled = await withN5HyoukiStore(
      JSON.stringify(shippedN5Rows()),
      () => realPaper("N5", "hyouki-judged-overlay")
    );
    expect(hyoukiItemsOf(filled.state)).toHaveLength(ITEMS_PER_PAPER.N5);
  });
});
