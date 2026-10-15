import { beforeAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { CorpusShortReadingEntry } from "../src/services/exam-corpus";
import {
  __test__ as corpusTest,
  jouhouStoreFor,
} from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertJudgedFourOptionRow,
  assertQuestionIsJapanese,
  assertSourceCarriesItsRow,
  connectExamClient,
  type ExamClient,
  newCatalog,
  prepareContentDb,
  readingScratch,
  requestAssembleRead,
  type WritableCatalog,
} from "./exam-harness";

/*
 * TASK-173.9.7: authentic 情報検索 material for the 情報検索 大問.
 *
 * The official ねらい (pinned in `backlog/doc-26` §1) asks the reader to find one
 * fact inside a single 案内 or お知らせ document of about 250 characters at N5 and
 * 400 at N4. So the shape is one notice, one lookup question against it, and four
 * Japanese options - NOT the multi-document 統合読み替え, which is a different
 * 大問 that still has no item type.
 *
 * The N5-band material is licensed: that store is the verbatim JLPTSuccess N5
 * 読解 paper 7 (`packages/japanese/data/reading/n5-jouhou.json`, CC BY-SA 4.0, see
 * `packages/japanese/data/LICENSE.md`). N2 and N1 are composed rows over
 * government 情報素材 (TASK-173.9.13), and N3 and N4 are composed authored 素材
 * (TASK-173.9.18 and TASK-173.9.19), whose cell-exactness and lookup contract the
 * package gate re-measures (`bun run check:reading-jouhou`). Either way this file
 * pins the new `info-search` type against the real seams rather than a
 * reimplementation that could drift:
 *
 *   - the store (`jouhouStoreFor`): 12 well-formed notices at N5, the eight
 *     authored 情報素材 at N3 and at N4, and the composed PDL1.0 素材 rows at
 *     N2 (8 rows, TASK-173.9.13 deepened by TASK-173.9.20) and N1 (6 rows),
 *   - the picker (`infoSearchSourceFor`): one notice per 小問, `seenAnchors`
 *     honored, an empty level declined rather than invented,
 *   - the presentation branch (`candidatePresentationFor`): gated on ITEM TYPE, so
 *     a 情報検索 keeps its own notice and never falls through to
 *     `LONG_READING_PASSAGE` (AC#3),
 *   - the real papers: N5 大問6 lands its 1 小問, N4 大問6, N3 大問7, N2 大問14
 *     and N1 大問13 land their 2, each a sourced 素材 plus a Japanese lookup
 *     question.
 */

const DB_URL = prepareContentDb("exam-info-search");

const { candidatePresentationFor, infoSearchSourceFor } = __test__;

/** A lookup question and its options are Japanese. The NOTICE legitimately
 * prints Latin (`7:00pm`, `ABC日本ご学校`), so this guards the question side only:
 * an ASCII letter there means it stopped being the sourced text and became a
 * paraphrase. */
const LATIN_RE = /[A-Za-z]/;

type KensakuSource = NonNullable<ReturnType<typeof infoSearchSourceFor>>;

/**
 * A scratch data root with ONE jouhou file removed. Everything else is symlinked,
 * so the corpus still loads the real vocab, grammar and 中文 corpora and the
 * overlay is a working data root rather than a broken one nothing can read.
 */
const dataRootWithoutJouhouStore = (filename: string): string =>
  readingScratch({
    fileName: filename,
    prefix: "manobu-jouhou-absent-",
    rows: null,
  }).scratch;

const sourceFor = (
  catalog: WritableCatalog,
  level = "N5",
  index = 0,
  offset = 0
): KensakuSource | null =>
  infoSearchSourceFor({ catalog, index, level, offset });

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
  }).then((paper) => paper.state);

const noticePassages = (level: "N5"): Set<string> =>
  new Set(jouhouStoreFor(level).map((entry) => entry.passage));

/** The composed levels (TASK-173.9.13, authored 素材 added by TASK-173.9.18 at
 * N3 and TASK-173.9.19 at N4) print 情報素材 rather than notices. */
const materialPassages = (level: "N1" | "N2" | "N3" | "N4"): Set<string> =>
  new Set(jouhouStoreFor(level).map((entry) => entry.passage));

/** N2 and N1 fold 読解 into the merged 言語知識 科目, so the 情報検索 大問 rides
 * there rather than in `grammar-reading`. */
const buildRealMergedReading = async (level: "N1" | "N2", seed: string) => {
  const requested = await client.exam.request({
    budget: { "language-knowledge-reading": 400 },
    level,
    mode: "real",
    sections: ["language-knowledge-reading"],
    seed,
  });
  await client.exam.assemble({ examId: requested.examId });
  return client.exam.get({ examId: requested.examId });
};

describe("the licensed 情報検索 store", () => {
  it("ships twelve well-formed notices at N5", () => {
    const store = jouhouStoreFor("N5");
    expect(store).toHaveLength(12);
    for (const entry of store) {
      expect(entry.block).toBe("jouhou-kensaku");
      expect(entry.level).toBe("N5");
      expect(entry.passage.length).toBeGreaterThan(0);
      expect(entry.stem.length).toBeGreaterThan(0);
      expect(entry.options).toHaveLength(4);
      expect(Number.isInteger(entry.answerIndex)).toBe(true);
      expect(entry.answerIndex).toBeGreaterThanOrEqual(0);
      expect(entry.answerIndex).toBeLessThan(4);
      // Vendored, so every row declares itself licensed, and the question side is
      // Japanese.
      expect(entry.provenance).toBe("licensed");
      expect(entry.stem).not.toMatch(LATIN_RE);
      for (const option of entry.options) {
        expect(option).not.toMatch(LATIN_RE);
      }
    }
  });
});

describe("the composed 情報検索 store", () => {
  it("ships eight authored-table rows at N3", () => {
    // TASK-173.9.18: N3 大問7 composes its own 書き下ろし 素材 instead of climbing
    // the licensed N5 table upward. The property the server must keep is the same
    // one the sourced levels carry (a 素材 per 小問, four Japanese options, the
    // row's own level), plus the one thing that makes this route honest: the
    // material is NOT the N5 notices, and it is a 500-700 rune 情報素材, the band
    // the official N3 ねらい prints (`JOUHOU_AUTHORED_BAND`, packages/japanese
    // scripts/reading-jouhou-corpus.ts). The lookup contract (the answer is a cell
    // of the 素材, no distractor sits in the line the stem names, nothing leaks
    // across 素材) is machine-checked by `bun run check:reading-jouhou --level N3`.
    const store = jouhouStoreFor("N3");
    expect(store).toHaveLength(8);
    // Four 素材 pairs: a 大問 prints 2 小問 and a passage is spent by the first
    // 小問 that takes it, so four distinct documents is the depth this store
    // ships, not the floor that fills one 大問.
    const passages = new Set(store.map((entry) => entry.passage));
    expect(passages.size).toBeGreaterThanOrEqual(4);
    for (const entry of store) {
      expect(entry.block).toBe("jouhou-kensaku");
      expect(entry.level).toBe("N3");
      assertJudgedFourOptionRow(entry);
      // A written-down 素材 carries no 出典, licence or 取得日, so it cannot be
      // the stamped N5 notice wearing an N3 label.
      expect(noticePassages("N5").has(entry.passage)).toBe(false);
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(500);
      expect(runes).toBeLessThanOrEqual(700);
      assertQuestionIsJapanese(entry);
    }
  });

  it("ships eight authored-table rows at N4", () => {
    // TASK-173.9.19: N4 大問6 was the twelfth-row licensed set wearing an N4
    // label. It now composes its own 書き下ろし 素材, for the same reason N3 left
    // that set: the official N4 ねらい budgets a 400字程度 情報素材 (doc-26 §4),
    // and a 160-245-rune N5 案内 re-labelled N4 is N5-band material under an N4
    // heading. The band below is the property that makes that substitution
    // impossible rather than merely unlikely: JOUHOU_AUTHORED_BAND.N4 runs
    // 340-470 runes, entirely above the licensed set.
    const store = jouhouStoreFor("N4");
    expect(store).toHaveLength(8);
    // Four 素材 pairs, the depth the owner's 読解-finished rule asks a store for
    // rather than the two 小問 one 大問 prints.
    const passages = new Set(store.map((entry) => entry.passage));
    expect(passages.size).toBeGreaterThanOrEqual(4);
    for (const entry of store) {
      expect(entry.block).toBe("jouhou-kensaku");
      expect(entry.level).toBe("N4");
      assertJudgedFourOptionRow(entry);
      // No shipped N4 素材 is one of the licensed notices.
      expect(noticePassages("N5").has(entry.passage)).toBe(false);
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(340);
      expect(runes).toBeLessThanOrEqual(470);
      assertQuestionIsJapanese(entry);
    }
    // Eight rows, eight different lookup questions: one stem repeated over the
    // store would train one lookup, not the 大問.
    expect(new Set(store.map((entry) => entry.stem)).size).toBe(8);
  });

  it("ships eight sourced-table rows at N2", () => {
    // TASK-173.9.20 grew this level from six rows to eight on the pinned-snapshot
    // PDL1.0 route of TASK-173.9.13, so the two 小問 大問14 prints have four
    // papers' worth of lookups behind them instead of three.
    const store = jouhouStoreFor("N2");
    expect(store).toHaveLength(8);
    // A 大問 prints 2 小問 and a passage is spent by the first 小問 that takes it,
    // so the store's depth is the number of DISTINCT 小問 it can print: eight
    // rows over three pinned 素材, each 素材 carrying its own questions.
    expect(
      new Set(store.map((entry) => entry.passage)).size
    ).toBeGreaterThanOrEqual(2);
    for (const entry of store) {
      expect(entry.block).toBe("jouhou-kensaku");
      expect(entry.level).toBe("N2");
      assertJudgedFourOptionRow(entry);
      // The printed 素材 is a government 情報素材 reflowed into a table, sized to
      // the 700字程度 the ねらい budgets (doc-26 §3.5), so it reads as a document to
      // search rather than a notice to skim.
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(600);
      expect(runes).toBeLessThanOrEqual(800);
      assertQuestionIsJapanese(entry);
    }
    // Eight rows, eight different lookups: one stem repeated over the store would
    // train one reading of the table, not the 大問.
    expect(new Set(store.map((entry) => entry.stem)).size).toBe(8);
  });

  it("ships eight sourced-table rows at N1", () => {
    // TASK-173.9.13 opened this level with its OWN 素材 rather than borrowing the
    // N5 notices upward, on six rows. TASK-173.9.21 grew it to eight with the rest
    // of the level, so 大問13's two 小問 have four papers' worth of lookups behind
    // them instead of three, which is the depth rule every other N1 読解 store pays.
    const store = jouhouStoreFor("N1");
    expect(store).toHaveLength(8);
    // A 大問 prints 2 小問 and a passage is spent by the first 小問 that takes
    // it, so two distinct 素材 is the floor that fills one N1 大問.
    expect(
      new Set(store.map((entry) => entry.passage)).size
    ).toBeGreaterThanOrEqual(2);
    for (const entry of store) {
      expect(entry.block).toBe("jouhou-kensaku");
      expect(entry.level).toBe("N1");
      assertJudgedFourOptionRow(entry);
      // The freeze is machine-checked: the gate re-derives each answer from the
      // pinned PDL1.0 snapshot the table was reflowed out of.
      expect(entry.validatedBy).toBe("deterministic:gen-reading-jouhou");
      // Sized to the 700字程度 the ねらい budgets (doc-26 §3.5), so it reads as a
      // document to search rather than a notice to skim.
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(600);
      expect(runes).toBeLessThanOrEqual(800);
      assertQuestionIsJapanese(entry);
    }
    // Eight rows, eight different lookups: one stem repeated over the store would
    // train one reading of the table, not the 大問.
    expect(new Set(store.map((entry) => entry.stem)).size).toBe(8);
  });
});

describe("infoSearchSourceFor", () => {
  it("turns one store row into a source that carries its own notice", () => {
    const store = jouhouStoreFor("N5");
    const source = sourceFor(newCatalog(), "N5", 0);
    expect(source).not.toBeNull();
    const found = source as KensakuSource;
    const row = assertSourceCarriesItsRow({ found, level: "N5", rows: store });
    expect(found.passage).toBe(row.passage);
    // The lookup question is the line a real 小問 prints; the notice is verbatim.
    // Vendored, so this level's source still declares itself licensed.
    expect(found.provenance).toBe("licensed");
  });

  it("spends the notice, so one document backs one 小問", () => {
    const catalog = newCatalog();
    const first = sourceFor(catalog, "N5", 0);
    expect(first).not.toBeNull();
    const usedPassage = (first as KensakuSource).passage as string;
    expect(catalog.usedJouhouPassages.has(usedPassage)).toBe(true);
    // Upstream asks two questions per notice, so a long enough walk would offer
    // the same document again; the spend must withhold it.
    for (let index = 0; index < jouhouStoreFor("N5").length; index += 1) {
      const next = sourceFor(catalog, "N5", index);
      if (next === null) {
        break;
      }
      expect(next.passage).not.toBe(usedPassage);
    }
  });

  it("skips an anchor this learner has already been served", () => {
    const entry = jouhouStoreFor("N5")[0] as CorpusShortReadingEntry;
    const catalog = newCatalog();
    catalog.seenAnchors.add(`reading:${entry.id}`);
    const found = sourceFor(catalog, "N5", 0) as KensakuSource;
    expect(found.anchorId).not.toBe(`reading:${entry.id}`);
  });

  it("declines a level with no store rather than invent a notice", () => {
    // TASK-173.9.13 gave N2 and N1 their own store, so this state is reached by
    // removing a file from an overlay data root rather than by a level the corpus
    // never shipped. The contract is unchanged: no source means no source, and
    // the 大問 comes up a named hole instead of a fabricated 素材.
    const scratch = dataRootWithoutJouhouStore("n2-jouhou.json");
    process.env.MANOBU_DATA_DIR = join(scratch, "data");
    corpusTest.resetCorpusCache();
    try {
      expect(jouhouStoreFor("N2")).toEqual([]);
      expect(sourceFor(newCatalog(), "N2", 0)).toBeNull();
      // Non-vacuity: the overlay is a readable data root, and the level next to
      // it still serves its own rows.
      expect(sourceFor(newCatalog(), "N1", 0)).not.toBeNull();
    } finally {
      delete process.env.MANOBU_DATA_DIR;
      corpusTest.resetCorpusCache();
      rmSync(scratch, { force: true, recursive: true });
    }
  });

  it("runs out once every notice is spent", () => {
    const catalog = newCatalog();
    const distinct = new Set<string>();
    for (let index = 0; index < jouhouStoreFor("N5").length + 5; index += 1) {
      const source = sourceFor(catalog, "N5", index);
      if (source === null) {
        break;
      }
      distinct.add(source.passage as string);
    }
    // One item per notice: six documents, so six 小問 at most, then the walk is
    // dry and a seventh ask gets nothing.
    expect(distinct.size).toBe(noticePassages("N5").size);
    expect(sourceFor(catalog, "N5", 0)).toBeNull();
  });
});

describe("the 情報検索 presentation branch keeps its own notice", () => {
  it("prints the sourced document whole and never the canned long passage", async () => {
    const source = sourceFor(newCatalog(), "N5", 0) as KensakuSource;
    const result = await candidatePresentationFor({
      itemType: "info-search",
      // The branch is gated on the ITEM TYPE, not the section: 情報検索 lives in
      // grammar-reading, where the reading-mask branch below it would otherwise
      // fire off `source.pattern`.
      section: "grammar-reading",
      source,
      split: () => Promise.resolve(null),
    });
    expect(result.passage).toBe(source.passage ?? null);
    // Nothing is masked: the notice is printed whole and the question rides in the
    // stem, so there is no blank and no leaked answer.
    expect(result.mask).toBeNull();
    // AC#3: membership in the licensed store is the strongest available proof that
    // this is not the hardcoded 長文 text wearing a different label.
    expect(noticePassages("N5").has(result.passage as string)).toBe(true);
  });
});

describe("a real paper asks an authentic 情報検索", () => {
  it("lands N5 大問6 with its one sourced 小問", async () => {
    const state = await buildRealGrammarReading("N5", "info-search-n5");
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "info-search"
    );
    // AC#3: the block real mode could not ask before now fills its official count.
    expect(landed).toHaveLength(1);
    for (const entry of landed) {
      const { item } = entry;
      expect(noticePassages("N5").has(item.passage ?? "")).toBe(true);
      const { stem } = item;
      if (stem === null) {
        throw new Error("a real 情報検索 prints its lookup question");
      }
      expect(stem).not.toMatch(LATIN_RE);
      expect(item.options).toHaveLength(4);
      for (const option of item.options) {
        expect(option).not.toMatch(LATIN_RE);
      }
      // The stored prompt is the fixed English line, never the Japanese question
      // echoed back at the learner.
      expect(item.prompt).toBe(
        "Read the passage and choose the answer that matches its content."
      );
    }
  });

  it("lands N4 大問6 with its two sourced 小問", async () => {
    const state = await buildRealGrammarReading("N4", "info-search-n4");
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "info-search"
    );
    // N4 prints two 小問, and both are rows of the level's OWN authored store
    // (TASK-173.9.19), not the N5 notices borrowed across the boundary, which is
    // exactly what the level stamp on each row and this membership test prevent.
    expect(landed).toHaveLength(2);
    const passages = new Set<string>();
    const stems = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      expect(item.level).toBe("N4");
      expect(materialPassages("N4").has(item.passage ?? "")).toBe(true);
      passages.add(item.passage ?? "");
      if (item.stem === null) {
        throw new Error("a real 情報検索 prints its lookup question");
      }
      stems.add(item.stem);
    }
    // One 素材 per 小問, so the block's two 小問 read two different documents.
    expect(passages.size).toBe(2);
    expect(stems.size).toBe(2);
  });

  it("lands N3 大問7 with its two sourced 小問", async () => {
    // TASK-173.9.18: N3 大問7 (doc-26 §3.3) now reads its OWN authored 素材, so
    // the honest description of what filled the block is "an N3 情報素材 was
    // found", not "N5-band material served at N3". The membership test is the
    // same one the licensed levels get: the passage is byte-equal to a row this
    // level's file carries.
    const state = await buildRealGrammarReading("N3", "info-search-n3");
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "info-search"
    );
    expect(landed).toHaveLength(2);
    const passages = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      expect(item.level).toBe("N3");
      expect(materialPassages("N3").has(item.passage ?? "")).toBe(true);
      passages.add(item.passage ?? "");
      if (item.stem === null) {
        throw new Error("a real 情報検索 prints its lookup question");
      }
      expect(item.stem).not.toMatch(LATIN_RE);
    }
    expect(passages.size).toBe(2);
  });

  it("lands N2 大問14 with its two composed 情報素材", async () => {
    // TASK-173.9.13: the level the licensed stamp refuses to climb to prints rows
    // from its OWN store, and the proof is the same membership test the licensed
    // levels get rather than a paraphrase of it.
    const state = await buildRealMergedReading("N2", "info-search-n2");
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "info-search"
    );
    expect(landed).toHaveLength(2);
    const passages = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      expect(entry.bigQuestion).toBe(14);
      expect(item.level).toBe("N2");
      const { passage } = item;
      if (passage === null || !materialPassages("N2").has(passage)) {
        throw new Error("a real N2 情報検索 prints its own 素材");
      }
      // The engine's own ceiling for this shape, so a frozen row is printable.
      expect([...passage].length).toBeLessThanOrEqual(800);
      passages.add(passage);
      if (item.stem === null) {
        throw new Error("a real 情報検索 prints its lookup question");
      }
      expect(item.stem).not.toMatch(LATIN_RE);
      expect(item.options).toHaveLength(4);
    }
    expect(passages.size).toBe(2);
  });

  it("lands N1 大問13 with its two composed 情報素材", async () => {
    const state = await buildRealMergedReading("N1", "info-search-n1");
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "info-search"
    );
    expect(landed).toHaveLength(2);
    const passages = new Set<string>();
    const stems = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      expect(entry.bigQuestion).toBe(13);
      expect(item.level).toBe("N1");
      const { passage } = item;
      if (passage === null || !materialPassages("N1").has(passage)) {
        throw new Error("a real N1 情報検索 prints its own 素材");
      }
      expect([...passage].length).toBeLessThanOrEqual(800);
      passages.add(passage);
      if (item.stem === null) {
        throw new Error("a real 情報検索 prints its lookup question");
      }
      stems.add(item.stem);
    }
    // Two 小問 of one 大問 read two different documents and ask two different
    // things, which is what the passage spend and the per-material id guarantee.
    expect(passages.size).toBe(2);
    expect(stems.size).toBe(2);
  });
});
