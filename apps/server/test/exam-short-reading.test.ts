import { beforeAll, describe, expect, it } from "bun:test";
import type { ExamSectionId } from "@manobu/api-contract";
import type { CorpusShortReadingEntry } from "../src/services/exam-corpus";
import { shortReadingStoreFor } from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertJudgedFourOptionRow,
  assertNoStimulusReused,
  assertQuestionIsJapanese,
  assertSourceCarriesItsRow,
  connectExamClient,
  type ExamClient,
  eachLandedRowMatchesStore,
  fullBudget,
  newCatalog,
  prepareContentDb,
  requestAssembleRead,
  type WritableCatalog,
} from "./exam-harness";

/*
 * TASK-173.7: authentic 読解 passages for the 内容理解（短文） block.
 *
 * A real N5 paper's 大問4 prints a short Japanese passage, a Japanese
 * comprehension question, and four Japanese options. The engine had no such
 * material: `long-reading` answers off one hardcoded `LONG_READING_PASSAGE`, and
 * handing a 短文 the same canned text would be the fabricated content TASK-173.1
 * exists to stop. So this file pins the new `short-reading` type against the real
 * seams (never a reimplementation that could drift):
 *
 *   - the store (`shortReadingStoreFor`): N5 carries well-formed licensed
 *     passages; N4, N3, N2 and N1 carry composed AUTHORED rows (TASK-173.9.19,
 *     TASK-173.9.18, TASK-173.9.20 and TASK-173.9.21), whole passages written for
 *     the block with one official ねらい per 小問 and no blank, because a cloze
 *     cannot ask what a phrase refers to or how the writer feels. N4, N2 and N1
 *     replaced the masked-slot routes of TASK-173.9.6 and TASK-173.9.11. Every
 *     level the app serves now has a 短文 store and an empty level is reached by
 *     spending one rather than by a level shipping nothing,
 *   - the picker (`shortReadingSourceFor`), which draws one entry, spends the
 *     passage so a 大問 never prints the same reading text twice, respects
 *     `seenAnchors`, and refuses a dry store rather than inventing a passage,
 *   - the presentation branch (`candidatePresentationFor`), gated on ITEM TYPE so
 *     a 短文 keeps its OWN passage and never falls through to `LONG_READING_PASSAGE`
 *     (AC#3),
 *   - the real N5 paper end to end: every landed 短文 小問 is a sourced Japanese
 *     passage + Japanese stem, no Latin, never the canned long text,
 *   - the real N3/N2/N1 papers (TASK-173.9.11): 大問4/大問10/大問8 fill to their
 *     official 小問数 with rows the store carries verbatim, inside the server's
 *     240-rune 短文 cap, and no two levels hand out the same passage.
 */

const DB_URL = prepareContentDb("exam-short-reading");

const { candidatePresentationFor, shortReadingSourceFor } = __test__;

/** The comprehension question is the line a real 短文 小問 prints, so an ASCII
 * letter means it stopped being the sourced Japanese and became a paraphrase -
 * the from-recall failure the source rule exists to stop. The papers print
 * full-width digits and never a Latin glyph. */
const LATIN_RE = /[A-Za-z]/;

/** An authored 短文 asks its question in the stem, and a Japanese question
 * closes on か. A stem that does not is a statement, which is what a cloze row
 * prints and what this route must never fall back to. */
const QUESTION_RE = /か。$/u;

/** The awaited source `shortReadingSourceFor` yields, read off its own signature
 * rather than reimplemented (the return type is a private service shape). */
type ShortSource = NonNullable<ReturnType<typeof shortReadingSourceFor>>;

const sourceFor = (
  catalog: WritableCatalog,
  level = "N5",
  index = 0,
  offset = 0
): ShortSource | null =>
  shortReadingSourceFor({ catalog, index, level, offset });

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

const buildRealGrammarReading = (level: "N3" | "N4" | "N5", seed: string) =>
  requestAssembleRead(client, {
    level,
    mode: "real",
    sections: ["grammar-reading"],
    seed,
  });

/** The official 小問数 of the 短文 大問 at each 白書 level: N3 大問4, N2 大問10,
 * N1 大問8 (`PAPER_BLOCKS`, packages/item-engine/src/paper.ts). */
const TANBUN_ITEMS_BY_LEVEL = { N1: 4, N2: 5, N3: 4 } as const;

/** N2/N1 print the merged 言語知識・読解 科目; N3 splits 読解 off into
 * grammar-reading, which is also where the N4/N5 短文 lives. */
const READING_SECTION_BY_LEVEL = {
  N1: "language-knowledge-reading",
  N2: "language-knowledge-reading",
  N3: "grammar-reading",
} as const satisfies Record<keyof typeof TANBUN_ITEMS_BY_LEVEL, ExamSectionId>;

/** The exam state a paper read returns, read off the client rather than
 * reimplemented. */
type ExamState = Awaited<ReturnType<typeof client.exam.get>>;

/**
 * A real paper asked big enough to reach every 大問 of the level's reading
 * section. The over-large ask is clamped to the official shape at parse time, so
 * the 短文 大問 lands exactly its blueprint 小問数 rather than a shortened
 * sample of it.
 */
const buildRealReadingPaper = (level: "N1" | "N2" | "N3", seed: string) => {
  const section = READING_SECTION_BY_LEVEL[level];
  return requestAssembleRead(client, {
    budget: fullBudget([section]),
    level,
    mode: "real",
    sections: [section],
    seed,
  });
};

const shortReadingsOf = (state: ExamState) =>
  state.items.filter((entry) => entry.item.itemType === "short-reading");

describe("the 短文 stores", () => {
  it("ships well-formed N5 passages", () => {
    const store = shortReadingStoreFor("N5");
    expect(store.length).toBeGreaterThan(0);
    for (const entry of store) {
      // Every row the picker can turn into an item: a real passage and question,
      // four options, and an answer index that points at one of them.
      expect(entry.passage.length).toBeGreaterThan(0);
      expect(entry.stem.length).toBeGreaterThan(0);
      expect(entry.options).toHaveLength(4);
      expect(Number.isInteger(entry.answerIndex)).toBe(true);
      expect(entry.answerIndex).toBeGreaterThanOrEqual(0);
      expect(entry.answerIndex).toBeLessThan(4);
      // The reading material is Japanese: no row arrived as a Latin placeholder.
      expect(entry.passage).not.toMatch(LATIN_RE);
      expect(entry.stem).not.toMatch(LATIN_RE);
    }
  });

  it("carries authored comprehension rows at N4", () => {
    // TASK-173.9.19 changed this level's answer. N4 大問4 was the masked-slot
    // route of TASK-173.9.6 (one word of an in-level sentence blanked) and is now
    // the authored route: whole short passages, each 小問 asking one official
    // 内容理解（短文） ねらい in its stem, which is the thing a blanked noun cannot
    // ask. A blank appearing here would mean the old construction came back. The
    // band is `TANBUN_AUTHORED_BAND.N4` (110-240 runes,
    // packages/japanese/scripts/reading-tanbun-corpus.ts) and the store gate is
    // `bun run check:reading-n4`; what the SERVER boundary keeps proving is that
    // it only hands out rows this level's own file carries, inside the 240-rune
    // 短文 cap, tagged composed and validated.
    const store = shortReadingStoreFor("N4");
    // N4 大問4 prints 4 小問; four papers' worth of rows is the depth this store
    // ships rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(16);
    for (const entry of store) {
      assertJudgedFourOptionRow(entry);
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(110);
      expect(runes).toBeLessThanOrEqual(240);
      expect(entry.passage).not.toContain("＿＿");
      expect(entry.passage).not.toMatch(LATIN_RE);
      assertQuestionIsJapanese(entry);
    }
    // Depth, not just supply: one repeated question over 16 rows would be the
    // cloze 大問 under another name.
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBeGreaterThanOrEqual(4);
  });

  it("carries authored comprehension rows at N3", () => {
    // TASK-173.9.18 changed this level's answer. N3 大問4 no longer asks a cloze:
    // its rows are written whole, one ねらい per 小問, because the official N3
    // question is what a phrase refers to or how the writer feels (doc-26 §3.3),
    // which a blanked noun cannot ask. The store gate
    // (packages/japanese check:reading-tanbun --level N3) proves the band and the
    // evidence sentence; what the SERVER boundary must keep proving is that it only
    // hands out rows this level's own file carries, inside the 240-rune 短文 cap,
    // and that a composed row is still tagged composed and still validated.
    const store = shortReadingStoreFor("N3");
    expect(store.length).toBeGreaterThanOrEqual(TANBUN_ITEMS_BY_LEVEL.N3);
    for (const entry of store) {
      assertJudgedFourOptionRow(entry);
      expect(entry.passage.length).toBeLessThanOrEqual(240);
      // An authored passage prints no blank: the text is whole and the question
      // rides in the stem, so a blank here means a cloze row wore this route's
      // label.
      expect(entry.passage).not.toContain("＿＿");
      expect(entry.passage).not.toMatch(LATIN_RE);
      // The comprehension line, in Japanese, closing on か.
      assertQuestionIsJapanese(entry);
    }
    // Depth, not just supply: one repeated question over 16 rows would be the
    // cloze 大問 under another name. The ねらい spread lives here, at the store.
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBeGreaterThanOrEqual(TANBUN_ITEMS_BY_LEVEL.N3);
  });

  it("carries authored comprehension rows at N2", () => {
    // TASK-173.9.20 changed this level's answer. N2 大問10 was the masked-slot
    // route of TASK-173.9.11 (one noun of a short 白書 paragraph blanked) and is
    // now the authored route: whole passages, each 小問 asking one official
    // 内容理解（短文） ねらい in its stem. That is the difference between a 短文 and
    // a cloze, so a blank appearing here would mean the old construction came
    // back. The band is `TANBUN_AUTHORED_BAND.N2` (140-240 runes,
    // packages/japanese/scripts/reading-tanbun-corpus.ts) and the store gate is
    // `bun run check:reading-tanbun --level N2`; what the SERVER boundary keeps
    // proving is that it only hands out rows this level's own file carries,
    // inside the 240-rune 短文 cap, tagged composed and validated.
    const store = shortReadingStoreFor("N2");
    // N2 大問10 prints 5 小問; four papers' worth of rows is the depth this store
    // ships rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(20);
    for (const entry of store) {
      assertJudgedFourOptionRow(entry);
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(140);
      // The server's 短文 cap is what makes these rows print at all; a row that
      // grew past it would silently never be askable (MAX_PASSAGE_LENGTH).
      expect(runes).toBeLessThanOrEqual(240);
      expect(entry.passage).not.toContain("＿＿");
      // The stem and the four options are what the 小問 asks, so both stay in
      // Japanese. The passage may print an abbreviation the prose itself uses:
      // n2s-2 prints ATM.
      assertQuestionIsJapanese(entry);
    }
    // Depth, not just supply: one repeated question over 20 rows would be the
    // cloze 大問 under another name.
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBeGreaterThanOrEqual(4);
  });

  it("carries authored comprehension rows at N1", () => {
    // TASK-173.9.21 changed this level's answer. N1 大問8 was the masked-slot
    // route of TASK-173.9.11 (one noun of a short 白書 paragraph blanked) and is
    // now the authored route: whole passages, each 小問 asking one official
    // 内容理解（短文） ねらい in its stem. That is the difference between a 短文 and
    // a cloze, so a blank appearing here would mean the old construction came
    // back. The band is `TANBUN_AUTHORED_BAND.N1` (160-240 runes,
    // packages/japanese/scripts/reading-tanbun-corpus.ts) and the store gate is
    // `bun run check:reading-tanbun --level N1`; what the SERVER boundary keeps
    // proving is that it only hands out rows this level's own file carries,
    // inside the 240-rune 短文 cap, tagged composed and validated.
    const store = shortReadingStoreFor("N1");
    // N1 大問8 prints 4 小問; four papers' worth of rows is the depth this store
    // ships rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(16);
    for (const entry of store) {
      assertJudgedFourOptionRow(entry);
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(160);
      // The server's 短文 cap is what makes these rows print at all; a row that
      // grew past it would silently never be askable (MAX_PASSAGE_LENGTH).
      expect(runes).toBeLessThanOrEqual(240);
      expect(entry.passage).not.toContain("＿＿");
      // A written row cites no 白書 paragraph: the masked-slot route's provenance
      // was a source id, and one here would mean a borrowed document came back.
      expect(entry.sourceIds).toBeUndefined();
      assertQuestionIsJapanese(entry);
    }
    // Depth, not just supply: one repeated question over 16 rows would be the
    // cloze 大問 under another name.
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBeGreaterThanOrEqual(4);
  });

  it("hands no two levels the same passage", () => {
    // The picker's anchor is `reading:{id}`, and the id names its level, so a
    // repeat learner who tries N2 after N3 would be served the same reading text
    // again and the item's own identity could not tell them. The generator
    // excludes the other levels' sources; this proves the shipped files honour
    // it, across every level that has a 短文 store.
    const seen = new Map<string, string>();
    for (const level of ["N1", "N2", "N3", "N4", "N5"] as const) {
      // One level's repeats are its own business: the licensed N5 store prints
      // two 小問 over one passage, which the picker's spend set withholds inside
      // a 大問. What must never happen is the same text owned by two levels.
      for (const passage of new Set(
        shortReadingStoreFor(level).map((entry) => entry.passage)
      )) {
        const owner = seen.get(passage);
        if (owner !== undefined) {
          throw new Error(`短文 passage shared between ${owner} and ${level}`);
        }
        seen.set(passage, level);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe("shortReadingSourceFor", () => {
  it("turns one store row into a source that carries its own passage", () => {
    const store = shortReadingStoreFor("N5");
    const source = sourceFor(newCatalog(), "N5", 0);
    expect(source).not.toBeNull();
    const found = source as ShortSource;
    const row = assertSourceCarriesItsRow({ found, level: "N5", rows: store });
    // The comprehension question is the Japanese line, the passage is verbatim
    // from the store, and the anchor is namespaced as a reading id.
    expect(found.passage).toBe(row.passage);
  });

  it("spends the passage, so a 大問 never prints one reading text twice", () => {
    const catalog = newCatalog();
    const first = sourceFor(catalog, "N5", 0);
    expect(first).not.toBeNull();
    const usedPassage = (first as ShortSource).passage as string;
    expect(catalog.usedShortReadingPassages.has(usedPassage)).toBe(true);
    // The store repeats each passage across its two questions, so walking far
    // enough would offer the same reading again; the spend must withhold it.
    for (let index = 0; index < shortReadingStoreFor("N5").length; index += 1) {
      const next = sourceFor(catalog, "N5", index);
      if (next === null) {
        break;
      }
      expect(next.passage).not.toBe(usedPassage);
    }
  });

  it("skips an anchor this learner has already been served", () => {
    const store = shortReadingStoreFor("N5");
    const entry = store[0] as CorpusShortReadingEntry;
    const catalog = newCatalog();
    catalog.seenAnchors.add(`reading:${entry.id}`);
    // The served row is skipped; the walk still finds an unseen one.
    const found = sourceFor(catalog, "N5", 0) as ShortSource;
    expect(found.anchorId).not.toBe(`reading:${entry.id}`);
  });

  it("declines a spent store rather than invent a passage", () => {
    // AC#4, the picker's half. No shipped level is empty now that 短文 reaches
    // N1 (TASK-173.9.11), so the absence the picker must respect is a store whose
    // passages are all spent: pre-fill the spend set with everything N3 carries
    // and the walk finds no candidate, so the 短文 slot becomes an honest
    // shortfall. Nothing here returns a canned text.
    // (A level with no FILE at all is the same refusal by a different route, and
    // `exam-reading-holes.test.ts` pins that one against a substituted data root,
    // where the paper names the 大問 instead of filling it with invented reading.)
    const catalog = newCatalog();
    for (const entry of shortReadingStoreFor("N3")) {
      catalog.usedShortReadingPassages.add(entry.passage);
    }
    expect(sourceFor(catalog, "N3", 0)).toBeNull();
  });

  it("runs out once every passage is spent", () => {
    const catalog = newCatalog();
    const distinct = new Set<string>();
    // More attempts than there are passages, all through one catalog.
    for (
      let index = 0;
      index < shortReadingStoreFor("N5").length + 5;
      index += 1
    ) {
      const source = sourceFor(catalog, "N5", index);
      if (source === null) {
        break;
      }
      distinct.add(source.passage as string);
    }
    // At most one item per passage, and then the walk is dry.
    expect(distinct.size).toBe(
      new Set(shortReadingStoreFor("N5").map((e) => e.passage)).size
    );
    expect(sourceFor(catalog, "N5", 0)).toBeNull();
  });
});

describe("the 短文 presentation branch keeps its own passage", () => {
  it("prints the sourced reading text, unmasked, and never the canned long passage", async () => {
    const source = sourceFor(newCatalog(), "N5", 0) as ShortSource;
    const result = await candidatePresentationFor({
      itemType: "short-reading",
      // The branch is gated on the ITEM TYPE, not the section: 短文 lives in
      // grammar-reading, where the reading-mask branch below it would otherwise
      // fire off `source.pattern`. Passing that section proves it does not.
      section: "grammar-reading",
      source,
      split: () => Promise.resolve(null),
    });
    // `result.passage` is `string | null` and the source's optional `passage` is
    // `string | undefined`; the presentation copies the sourced text through, so the
    // null-coalesce is the type, not a behavior change (a real store row has one).
    expect(result.passage).toBe(source.passage ?? null);
    // Nothing is masked: the passage is printed whole and the question rides in
    // the stem, so there is no blank and no leaked answer.
    expect(result.mask).toBeNull();
    // AC#3: a real 短文 is not the hardcoded 長文 text wearing a different label.
    // Membership in the licensed store is the honest proof: the canned
    // `LONG_READING_PASSAGE` is no row there, so a passage drawn from the store
    // cannot be it.
    const passages = new Set(shortReadingStoreFor("N5").map((e) => e.passage));
    expect(passages.has(result.passage as string)).toBe(true);
  });

  // The authored route now serves every 短文 level whose store this repo writes
  // itself: N3 since TASK-173.9.18, N2 since TASK-173.9.20, and N1 since
  // TASK-173.9.21 replaced that level's masked-slot 白書 rows. The property is the
  // same at each, so it is proved once per level rather than cloned: the branch
  // copies the written passage through byte for byte, prints the row's own ねらい
  // line as the question, and invents no mask over text that hides nothing. The
  // blank this branch used to forward at N1 came from the ROW, so a store with no
  // blank must produce a blank-free paper.
  const SECTION_BY_AUTHORED_LEVEL = {
    // The branch is gated on the ITEM TYPE, not the section: an N3 paper prints
    // 短文 inside grammar-reading, where the reading-mask branch below would
    // otherwise fire off `source.pattern`, and an N2/N1 paper prints it inside the
    // merged 言語知識・読解 科目. Passing each level's real section proves neither
    // path masks.
    N1: "language-knowledge-reading",
    N2: "language-knowledge-reading",
    N3: "grammar-reading",
  } as const;

  for (const [level, section] of Object.entries(SECTION_BY_AUTHORED_LEVEL)) {
    it(`prints an authored ${level} passage whole, with its own question and no mask`, async () => {
      const source = sourceFor(newCatalog(), level, 0) as ShortSource;
      const result = await candidatePresentationFor({
        itemType: "short-reading",
        section,
        source,
        split: () => Promise.resolve(null),
      });
      expect(result.passage).toBe(source.passage ?? null);
      expect(result.passage ?? "").not.toContain("＿＿");
      expect(result.mask).toBeNull();
      // The question this row asks is its own comprehension line, not the fixed
      // cloze text, and the picker carries it through unchanged.
      expect(source.cue).toMatch(QUESTION_RE);
    });
  }
});

describe("a real N5 paper asks an authentic 短文", () => {
  it("lands 大問4 小問 that are sourced Japanese reading, not the canned long text", async () => {
    const { state } = await buildRealGrammarReading("N5", "short-reading-n5");
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "short-reading"
    );
    // Non-vacuity: the block the task enabled actually fills at N5.
    expect(landed.length).toBeGreaterThan(0);
    const passages = new Set(shortReadingStoreFor("N5").map((e) => e.passage));
    const seenStems = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      // The reading text is one the licensed store carries verbatim, which is the
      // strongest form of "not fabricated": it is byte-equal to a vendored row.
      expect(passages.has(item.passage ?? "")).toBe(true);
      // The comprehension question is the item's own Japanese line.
      const { stem } = item;
      if (stem === null) {
        throw new Error("a real 短文 prints a comprehension question");
      }
      expect(stem.length).toBeGreaterThan(0);
      expect(stem).not.toMatch(LATIN_RE);
      // Four Japanese options.
      expect(item.options).toHaveLength(4);
      for (const option of item.options) {
        expect(option).not.toMatch(LATIN_RE);
      }
      seenStems.add(stem);
    }
    // A real 短文 大問 prints a distinct question per 小問 (distinct passages).
    expect(seenStems.size).toBe(landed.length);
  });

  it("asks the reading in Japanese, not with the English prompt the store carries", async () => {
    // The stored prompt is the fixed English task line; the learner reads the
    // Japanese question in `stem`. Pin that the prompt names no cue text (it is a
    // constant) so a regression that echoed the passage into the prompt is caught.
    const { state } = await buildRealGrammarReading(
      "N5",
      "short-reading-prompt"
    );
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "short-reading"
    );
    expect(landed.length).toBeGreaterThan(0);
    for (const entry of landed) {
      expect(entry.item.prompt).toBe(
        "Read the passage and choose the answer that matches its content."
      );
    }
  });
});

/** Every 白書-derived 短文 level composes whole passages and asks one official
 * 内容理解（短文） ねらい per 小問: N3 since TASK-173.9.18, N2 since TASK-173.9.20,
 * and N1 since TASK-173.9.21, which retired the last masked-slot 短文 store. So
 * there is no per-level shape left to branch on: what lands in a paper is the
 * authored row, whole, with its own question. */
describe("the real N3/N2/N1 papers fill their 短文 大問", () => {
  for (const level of ["N3", "N2", "N1"] as const) {
    it(`lands the official ${String(TANBUN_ITEMS_BY_LEVEL[level])} 小問 at ${level}`, async () => {
      const { state } = await buildRealReadingPaper(level, `tanbun-${level}`);
      const landed = shortReadingsOf(state);
      // Not "some 短文": the whole 大問 the blueprint asks, from a store of at
      // least that many rows. A block that came up short here would be a supply
      // problem, not a plumbed one.
      expect(landed).toHaveLength(TANBUN_ITEMS_BY_LEVEL[level]);
      eachLandedRowMatchesStore({
        blockName: "短文",
        landed,
        level,
        onRow: (item, _row, passage) => {
          // The server's own cap, applied to what actually landed rather than to
          // the store file.
          expect(passage.length).toBeLessThanOrEqual(240);
          // Four options, in Japanese.
          expect(item.options).toHaveLength(4);
          for (const option of item.options) {
            expect(option).not.toMatch(LATIN_RE);
          }
          // An authored 小問 prints its passage whole, so no blank marker
          // survives in it, and it asks the question that passage was written to
          // answer (the stem equality proves the row match; this proves the row
          // asks a 内容理解 question).
          expect(passage).not.toContain("＿＿");
          expect(item.stem).toMatch(QUESTION_RE);
        },
        rows: shortReadingStoreFor(level),
        stimulus: "passage",
      });
    });
  }

  it("asks no level a passage another level already asks", async () => {
    // The store-level disjointness above says the files do not overlap; this says
    // the papers that SHIP from them do not either, which is what a learner
    // moving up from N3 to N2 actually experiences.
    const papers = await Promise.all(
      (["N3", "N2", "N1"] as const).map(async (level) => ({
        level,
        state: (await buildRealReadingPaper(level, `tanbun-cross-${level}`))
          .state,
      }))
    );
    const passages = new Set<string>();
    for (const { level, state } of papers) {
      assertNoStimulusReused({
        blockName: "短文",
        landed: shortReadingsOf(state),
        level,
        seen: passages,
        stimulus: "passage",
      });
    }
    expect(passages.size).toBe(
      TANBUN_ITEMS_BY_LEVEL.N3 +
        TANBUN_ITEMS_BY_LEVEL.N2 +
        TANBUN_ITEMS_BY_LEVEL.N1
    );
  });

  it("fills the 短文 大問 and bands N3's 文法・読解 section to ready", async () => {
    // N3's five 読解 大問 all fill since TASK-173.9.16 closed 大問6, and
    // TASK-173.9.24 closed 大問3 文章の文法 with the authored discourse-cloze
    // store. So the section this paper asks for now has NOTHING left it cannot
    // name: a paper that prints its whole 大問 mix comes up short by zero.
    // And since TASK-173.9.29 widened the 読解 band to the types the real 大問
    // place, filling the blocks DOES make the paper ready: the 読解 floor counts
    // the 短/中/長文 and 情報検索 小問 it asked. Under the old two-type band this
    // exact paper pinned ready=false with the 読解 floor "unmet", which was the
    // drop, not a design rule.
    const { assembled, state } = await buildRealReadingPaper(
      "N3",
      "tanbun-n3-ready"
    );
    expect(shortReadingsOf(state).length).toBe(TANBUN_ITEMS_BY_LEVEL.N3);
    expect(assembled.unfilledBlocks).toEqual([]);
    expect(assembled.shortfall).toBe(0);
    expect(assembled.ready).toBe(true);
    expect(
      assembled.floor.floors.find((entry) => entry.id === "reading")?.status
    ).toBe("met");
    // Every landed 小問 belongs to exactly one band: the 組み立て 小問 and the
    // 読解 小問 that the pre-TASK-173.9.29 lists dropped are counted now, so the
    // two asked 科目's floors sum to the whole paper (shortfall is 0, so the
    // plan-based itemCounts equal the landed items).
    const languageFloor = assembled.floor.floors.find(
      (entry) => entry.id === "language-knowledge"
    );
    const readingFloor = assembled.floor.floors.find(
      (entry) => entry.id === "reading"
    );
    expect(
      (languageFloor?.itemCount ?? 0) + (readingFloor?.itemCount ?? 0)
    ).toBe(state.items.length);
  });
});
