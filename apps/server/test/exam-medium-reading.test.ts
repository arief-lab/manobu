import { beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CorpusShortReadingEntry } from "../src/services/exam-corpus";
import {
  claimUnderstandingStoreFor,
  __test__ as corpusTest,
  jouhouStoreFor,
  mediumReadingStoreFor,
} from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertBigQuestionsNotHoled,
  assertSourceCarriesItsRow,
  connectExamClient,
  type ExamClient,
  newCatalog,
  prepareContentDb,
} from "./exam-harness";

/*
 * TASK-173.9.2: a real N2 (and N1) paper's 内容理解（中文） block (大問11 at N2,
 * 大問9 at N1) now prints a real multi-sentence passage with four Japanese
 * options, drawn from `packages/japanese/data/reading/
 * {level}-chuubun.json`. Before this it had no item type at all, so the block
 * was short and a real paper refused it. This file pins the seams against the
 * real store, never a reimplementation:
 *
 *   - the store (`mediumReadingStoreFor`): N3, N4 and N2 carry well-formed composed
 *     authored rows, whole passages written for the block (TASK-173.9.18,
 *     TASK-173.9.19 and TASK-173.9.20), N1 still carries composed masked-slot rows
 *     off the 白書, N5
 *     carries the licensed 中長文 rows, and a level whose file is not there must
 *     stay an honest absence, not borrow another level's text,
 *   - the picker (`mediumReadingSourceFor`): draws one row, spends the passage
 *     so a 大問 never prints the same text twice, and declines an empty level
 *     rather than inventing a passage,
 *   - the presentation branch (`candidatePresentationFor`), gated on ITEM TYPE
 *     so a 中文 keeps its OWN passage and never falls through to
 *     `LONG_READING_PASSAGE`,
 *   - the real N2 paper end to end: the block fills from the sourced store.
 */

const DB_URL = prepareContentDb("exam-medium-reading");

const { candidatePresentationFor, mediumReadingSourceFor } = __test__;

const LATIN_RE = /[A-Za-z]/;

/** An authored 中文 asks its question in the stem, and a Japanese question
 * closes on か. A stem that does not is a statement, which is what a cloze row
 * prints and what this route must never fall back to. */
const QUESTION_RE = /か。$/u;

type Catalog = Parameters<typeof mediumReadingSourceFor>[0]["catalog"];
type MediumSource = NonNullable<ReturnType<typeof mediumReadingSourceFor>>;

/* `CandidateCatalogState` is a private service shape, so the writable catalog is
 * derived from the picker's own parameter type. The walk mutates `seenAnchors`,
 * so it needs the writable `Set`, which is still assignable to the `ReadonlySet`
 * the picker declares. The return annotation is what keeps every member inference
 * honest: an unannotated literal widens `exhaustedFamilies` to `Set<string>` and
 * stops being a catalog at all. */
const sourceFor = (
  catalog: Catalog,
  level = "N2",
  index = 0,
  offset = 0
): MediumSource | null =>
  mediumReadingSourceFor({ catalog, index, level, offset });

/**
 * Run `body` against a data dir that holds no `reading/{level}-chuubun.json`, so
 * "the level ships no 中文" is a FACT about the directory rather than a claim
 * about a level that happens to be empty today. The corpus caches per process, so
 * the cache is cleared on both edges and `MANOBU_DATA_DIR` is restored.
 */
const withAbsentChineseStore = (body: () => void): void => {
  const previous = process.env.MANOBU_DATA_DIR;
  const scratch = mkdtempSync(join(tmpdir(), "medium-reading-absent-"));
  try {
    writeFileSync(join(scratch, "n5.json"), "[]");
    process.env.MANOBU_DATA_DIR = scratch;
    corpusTest.resetCorpusCache();
    body();
  } finally {
    if (previous === undefined) {
      delete process.env.MANOBU_DATA_DIR;
    } else {
      process.env.MANOBU_DATA_DIR = previous;
    }
    corpusTest.resetCorpusCache();
    rmSync(scratch, { force: true, recursive: true });
  }
};

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/** The row shape every 中文 construction shares, whatever route wrote it: a
 * passage inside the caller's band, four options carrying one answer, a
 * Latin-free question, and the tags real mode serves on. It RETURNS issues
 * rather than asserting them, because the three routes differ only in their band
 * and whether the text hides a slot, and four copies of this loop is the
 * duplication fallow flags (and the way a route quietly stops checking). */
const passageIssues = (
  entry: CorpusShortReadingEntry,
  band: readonly [number, number]
): string[] => {
  const [min, max] = band;
  const runes = [...entry.passage].length;
  const issues: string[] = [];
  if (runes < min) {
    issues.push(`passage-too-short:${String(runes)}<${String(min)}`);
  }
  if (runes > max) {
    issues.push(`passage-too-long:${String(runes)}>${String(max)}`);
  }
  return issues;
};

const optionIssues = (entry: CorpusShortReadingEntry): string[] => {
  const issues: string[] = [];
  if (entry.options.length !== 4) {
    issues.push(`options-not-four:${String(entry.options.length)}`);
  }
  if (entry.answerIndex < 0 || entry.answerIndex >= entry.options.length) {
    issues.push(`answer-index-out-of-range:${String(entry.answerIndex)}`);
  }
  return issues;
};

const questionIssues = ({
  entry,
  provenance,
}: {
  readonly entry: CorpusShortReadingEntry;
  readonly provenance: "composed" | "licensed";
}): string[] => {
  const issues: string[] = [];
  if (entry.stem.length === 0 || LATIN_RE.test(entry.stem)) {
    issues.push("stem-not-a-japanese-question");
  }
  if (entry.provenance !== provenance) {
    issues.push(`provenance-not-${provenance}`);
  }
  // A composed row reaches a real paper only behind the freeze; a licensed row
  // was vendored whole and carries no flag.
  if (provenance === "composed" && entry.validated !== true) {
    issues.push("unvalidated-composed-row");
  }
  return issues;
};

const rowIssues = ({
  band,
  entry,
  provenance,
}: {
  readonly band: readonly [number, number];
  readonly entry: CorpusShortReadingEntry;
  readonly provenance: "composed" | "licensed";
}): string[] => [
  ...passageIssues(entry, band),
  ...optionIssues(entry),
  ...questionIssues({ entry, provenance }),
];

/** Licensed rows have no band this file measures: the paper they came from sets
 * the length, so only "not empty" is claimed. */
const ANY_LENGTH: readonly [number, number] = [1, Number.POSITIVE_INFINITY];

describe("the sourced 中文 store", () => {
  it("ships well-formed composed authored rows at N3", () => {
    // TASK-173.9.18: N3 大問5 is the authored route. Each 中文 asks a 日本語の
    // 表現・内容 question, so the passage is printed whole and the question rides
    // in the stem, which is what separates it from the 白書 clozes below. The
    // 中文 gate (packages/japanese check:reading-chuubun --level N3) proves the
    // band and the evidence sentence; this pins the data boundary the server
    // actually reads: rows from this level's own file, composed and validated,
    // asking a Japanese comprehension question and hiding nothing.
    const store = mediumReadingStoreFor("N3");
    // Four 大問's worth of 3 小問: enough that one paper does not spend the
    // level, and far above the minimum a store could fill one 大問 with.
    expect(store.length).toBeGreaterThanOrEqual(12);
    for (const entry of store) {
      // The 中文 band this store composes into: 250-600 runes
      // (`PASSAGE_BAND.authored`, packages/japanese/scripts/
      // reading-chuubun-corpus.ts).
      expect(
        rowIssues({ band: [250, 600], entry, provenance: "composed" })
      ).toEqual([]);
      // An authored passage prints no blank: a blank here means a cloze row was
      // stamped onto this route.
      expect(entry.passage).not.toContain("＿＿");
      // The comprehension question, in Japanese, closing on か.
      expect(entry.stem).toMatch(QUESTION_RE);
    }
    // Depth: one repeated question over the whole store would be a 大問 that
    // trains a single ねらい.
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBeGreaterThanOrEqual(4);
  });

  it("ships well-formed composed authored rows at N2", () => {
    // TASK-173.9.20 changed this level's answer. N2 大問11 was the 白書 cloze of
    // TASK-173.9.11 (88 rows whose every stem was 「この文章の＿＿に入る語として…」,
    // so the block carrying the most 小問 in the section printed one vocabulary
    // question) and is now the authored route: whole passages written for the
    // block, one official 内容理解（中文） ねらい per 小問. A blank appearing here
    // would mean the old construction came back. The band is
    // `PASSAGE_BAND.authored` (250-600 runes), the same one N3 and N4 pay, and the
    // store gate (packages/japanese check:reading-chuubun --level N2) proves the
    // evidence sentence and the ねらい spread.
    const store = mediumReadingStoreFor("N2");
    // N2 大問11 prints 9 小問; four papers' worth of rows is the depth this store
    // ships rather than the minimum that fills one 大問, and it is the largest
    // 中文 store in the repo.
    expect(store.length).toBeGreaterThanOrEqual(36);
    for (const entry of store) {
      expect(
        rowIssues({ band: [250, 600], entry, provenance: "composed" })
      ).toEqual([]);
      expect(entry.passage).not.toContain("＿＿");
      expect(entry.stem).toMatch(QUESTION_RE);
    }
    // Depth, not just supply: one repeated stem over 36 rows would be the cloze
    // 大問 under another name.
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBeGreaterThanOrEqual(4);
  });

  it("ships well-formed composed authored rows at N1", () => {
    // TASK-173.9.21 changed this level's answer. N1 大問9 was the 白書 cloze of
    // TASK-173.9.11 (every stem 「この文章の＿＿に入る語として…」) and is now the
    // authored route: whole passages written for the block, one official
    // 内容理解（中文） ねらい per 小問. A blank appearing here would mean the old
    // construction came back. The band is `PASSAGE_BAND.authored` (250-600 runes),
    // the same one N2, N3 and N4 pay, and the store gate
    // (packages/japanese check:reading-chuubun --level N1) proves the evidence
    // sentence and the ねらい spread. The PASSAGE may carry Latin (written prose
    // here prints units and abbreviations), so only the stem is held to Japanese.
    const store = mediumReadingStoreFor("N1");
    // N1 大問9 prints 9 小問; four papers' worth of rows is the depth this store
    // ships rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(36);
    for (const entry of store) {
      expect(
        rowIssues({ band: [250, 600], entry, provenance: "composed" })
      ).toEqual([]);
      expect(entry.passage).not.toContain("＿＿");
      expect(entry.sourceIds).toBeUndefined();
      expect(entry.stem).toMatch(QUESTION_RE);
    }
    // Depth, not just supply: one repeated stem over 36 rows would be the cloze
    // 大問 under another name.
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBeGreaterThanOrEqual(4);
  });

  it("ships well-formed licensed rows at N5, from the 中長文 papers", () => {
    // Vendored verbatim from JLPTSuccess, so it is trusted like the N5 短文
    // store: licensed, not composed, and it prints no masked slot.
    const store = mediumReadingStoreFor("N5");
    expect(store.length).toBeGreaterThan(0);
    for (const entry of store) {
      expect(
        rowIssues({ band: ANY_LENGTH, entry, provenance: "licensed" })
      ).toEqual([]);
      expect(entry.passage).not.toContain("＿＿");
    }
  });

  it("ships well-formed composed authored rows at N4", () => {
    // TASK-173.9.19 changed this level's answer. N4 大問5 was the
    // `stitched-in-level` document of TASK-173.9.15 (a topic-coherent list of
    // licensed sentences with one noun blanked) and is now the authored route:
    // whole passages written for the block, each asking a Japanese 内容理解
    // question in its stem. That is the property that separates a 中文 from a
    // cloze, and a blank appearing here would mean the old construction came
    // back. The band is `PASSAGE_BAND.authored` (250-600 runes), the same one
    // N3 pays, and the store gate
    // (packages/japanese check:reading-chuubun --level N4) proves the evidence
    // sentence and the ねらい spread.
    const store = mediumReadingStoreFor("N4");
    // N4 大問5 prints 4 小問; four papers' worth of rows is the depth this store
    // ships rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(12);
    for (const entry of store) {
      expect(
        rowIssues({ band: [250, 600], entry, provenance: "composed" })
      ).toEqual([]);
      expect(entry.passage).not.toContain("＿＿");
      expect(entry.stem).toMatch(QUESTION_RE);
    }
    const stems = new Set(store.map((entry) => entry.stem));
    expect(stems.size).toBeGreaterThanOrEqual(4);
  });

  it("is an honest absence at a level whose 中文 file is not there", () => {
    // The absence is proven through a data dir that simply has no
    // `{level}-chuubun.json`, not by naming a real level: every level N5-N1 now
    // ships a 中文 store, and asserting "N4 is empty" would have quietly
    // reversed its meaning the moment TASK-173.9.15 filled it. An empty array
    // is what makes a short 中文 block a NAMED hole rather than a fabricated
    // passage (TASK-173.1).
    withAbsentChineseStore(() => {
      expect(mediumReadingStoreFor("N4")).toEqual([]);
    });
  });
});

describe("mediumReadingSourceFor", () => {
  it("turns one store row into a source that carries its own passage", () => {
    const store = mediumReadingStoreFor("N2");
    const source = sourceFor(newCatalog(), "N2", 0);
    expect(source).not.toBeNull();
    const found = source as MediumSource;
    const row = assertSourceCarriesItsRow({ found, level: "N2", rows: store });
    expect(found.passage).toBe(row.passage);
  });

  it("reads the store of the level it was asked for, at every shipped level", () => {
    // The picker echoes the level it was handed, so a picker that quietly reads ONE
    // fixed store still prints a paper with the right level stamp. What separates
    // the two is row identity: a passage lives in exactly one level's file, so the
    // served anchor must be in the store of the level asked for. This is the whole
    // point of TASK-173.9.15 filling N4 and the licensed N5 store being read at N5:
    // every level N5-N1 now has a 中文 store, so "empty levels" no longer proves
    // the level argument is used.
    for (const level of ["N5", "N4", "N3", "N2", "N1"]) {
      const store = mediumReadingStoreFor(level);
      expect(store.length).toBeGreaterThan(0);
      const source = sourceFor(newCatalog(), level, 0);
      expect(source).not.toBeNull();
      const row = source as MediumSource;
      const served = store.find(
        (entry) => `reading:${entry.id}` === row.anchorId
      );
      expect(served).toBeDefined();
      expect(row.passage).toBe((served as CorpusShortReadingEntry).passage);
    }
  });

  it("spends the passage, so a 大問 never prints one text twice", () => {
    const catalog = newCatalog();
    const first = sourceFor(catalog, "N2", 0);
    expect(first).not.toBeNull();
    const usedPassage = (first as MediumSource).passage as string;
    expect(catalog.usedMediumReadingPassages.has(usedPassage)).toBe(true);
    for (
      let index = 0;
      index < mediumReadingStoreFor("N2").length;
      index += 1
    ) {
      const next = sourceFor(catalog, "N2", index);
      if (next === null) {
        break;
      }
      expect(next.passage).not.toBe(usedPassage);
    }
  });

  it("declines an empty level rather than invent a passage", () => {
    // The presentation branch is where an invented 中文 would appear: the picker
    // returning null means the block reports its shortfall, while a fallback to
    // the canned `LONG_READING_PASSAGE` would print a passage nobody sourced.
    withAbsentChineseStore(() => {
      expect(sourceFor(newCatalog(), "N4", 0)).toBeNull();
    });
  });
});

describe("the 中文 presentation branch keeps its own passage", () => {
  it("prints the sourced passage and never the canned long passage", async () => {
    const source = sourceFor(newCatalog(), "N2", 0) as MediumSource;
    const result = await candidatePresentationFor({
      itemType: "medium-reading",
      section: "language-knowledge-reading",
      source,
      split: () => Promise.resolve(null),
    });
    expect(result.passage).toBe(source.passage ?? null);
    expect(result.mask).toBeNull();
    const passages = new Set(mediumReadingStoreFor("N2").map((e) => e.passage));
    expect(passages.has(result.passage as string)).toBe(true);
  });
});

describe("a real N2 paper asks a sourced 中文", () => {
  it("lands 内容理解（中文） 小問 from the store", async () => {
    // To reach 大問11 the walk must cover 大問1-10 first; their indicative
    // counts sum to 59, and 大問11 asks 9 more.
    const requested = await client.exam.request({
      budget: { "language-knowledge-reading": 68 },
      level: "N2",
      mode: "real",
      sections: ["language-knowledge-reading"],
      seed: "medium-reading-n2",
    });
    const assembled = await client.exam.assemble({ examId: requested.examId });
    const state = await client.exam.get({ examId: requested.examId });
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "medium-reading"
    );
    expect(landed.length).toBeGreaterThan(0);
    const passages = new Set(mediumReadingStoreFor("N2").map((e) => e.passage));
    const landedPassages = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      expect(passages.has(item.passage ?? "")).toBe(true);
      // The question is the item's own Japanese line (no Latin); options are
      // Japanese words.
      expect(item.stem).not.toMatch(LATIN_RE);
      expect(item.options).toHaveLength(4);
      for (const option of item.options) {
        expect(option).not.toMatch(LATIN_RE);
      }
      if (item.passage !== null && item.passage !== undefined) {
        landedPassages.add(item.passage);
      }
    }
    // A real 中文 大問 prints a distinct passage per 小問. The stem is a fixed
    // instruction, so distinctness must be checked on the PASSAGE.
    expect(landedPassages.size).toBe(landed.length);
    expect(assembled.refusedSections).not.toContain(
      "language-knowledge-reading"
    );
  });

  it("names the 大問 it still cannot ask, and none of the 読解 大問 it can", async () => {
    // TASK-173.9.2 AC#1's second arm: 情報検索 still has no content at this level,
    // so the receipt must NAME it (a hole in the plan no content fills) rather
    // than quietly print a shorter paper. `unfilledBlocks` is what
    // `context.ts` `startExam` reads to tell the learner which parts of the
    // official paper the app cannot ask.
    //
    // Since slice 2, 主張理解（長文） has an item type (`claim-understanding`)
    // and, since its store froze, it FILLS: 大問13 prints 3 小問 at N2, all
    // drawn verbatim from `{level}-chuushou.json`. The fabrication guard is
    // that every landed row is a store row (passage byte-equal to the store's)
    // instead of borrowing the canned long passage or a 中文 row. Since
    // TASK-173.9.3 the same holds for 統合理解 (大問12, `text-comparison`).
    //
    // The budget is deliberately larger than the section so the walk REACHES
    // 大問12-14: at the section's own 68 items the 大問 the walk asks for stop at
    // 中文 (大問11), and a block nobody asked for is not a hole, it is just not on
    // this paper. Clamped at parse time to the section's indicative total.
    const requested = await client.exam.request({
      budget: { "language-knowledge-reading": 400 },
      level: "N2",
      mode: "real",
      sections: ["language-knowledge-reading"],
      seed: "medium-reading-n2-receipt",
    });
    const assembled = await client.exam.assemble({ examId: requested.examId });
    const state = await client.exam.get({ examId: requested.examId });
    // The receipt names a hole by its 大問 number and official NAME, not
    // by a block id (the frame is what a learner-facing card reads), so the
    // assertion keys on those: 統合理解 12 and 情報検索 14 at N2 were named here
    // (doc-26 §3.4), and 主張理解 13 joined them once slice 2 shipped. Its item
    // type exists since slice 2 and its store froze since this session, so
    // neither block is unfillable or short: the walk must land its 小問 from the
    // store instead.
    assertBigQuestionsNotHoled({ assembled, bigQuestions: [11, 12, 13, 14] });
    const claimed = state.items.filter(
      (entry) => entry.item.itemType === "claim-understanding"
    );
    expect(claimed.length).toBeGreaterThan(0);
    // Fabrication guard: every landed 主張理解 passage IS a store passage.
    const storePassages = new Set(
      claimUnderstandingStoreFor("N2").map((entry) => entry.passage)
    );
    const claimedPassages = new Set<string>();
    for (const entry of claimed) {
      const passage = entry.item.passage ?? "";
      expect(storePassages.has(passage)).toBe(true);
      claimedPassages.add(passage);
    }
    // One passage per 小問, same rule as the 中文 大問 above.
    expect(claimedPassages.size).toBe(claimed.length);
    // TASK-173.9.13: 情報検索 (大問14) has a store at N2, so the holed 大問
    // above names it not, and its 小問 print a 素材 this store carries rather
    // than the canned passage.
    const searched = state.items.filter(
      (entry) => entry.item.itemType === "info-search"
    );
    expect(searched).toHaveLength(2);
    const materialPassages = new Set(
      jouhouStoreFor("N2").map((entry) => entry.passage)
    );
    const searchedPassages = new Set<string>();
    for (const entry of searched) {
      const passage = entry.item.passage ?? "";
      expect(materialPassages.has(passage)).toBe(true);
      searchedPassages.add(passage);
    }
    expect(searchedPassages.size).toBe(searched.length);
    // The 中文 大問 (11) is no longer a hole: the predicate above already
    // required it off the receipt.
    // Every hole carries a whole-numbered 大問 and a non-empty official name, so
    // the receipt reads as a list of the official paper's parts.
    for (const block of assembled.unfilledBlocks) {
      expect(Number.isInteger(block.bigQuestion)).toBe(true);
      expect(block.bigQuestion).toBeGreaterThan(0);
      expect(block.name.length).toBeGreaterThan(0);
      expect(block.requestedItems).toBeGreaterThan(0);
    }
  });
});
