import { beforeAll, describe, expect, it } from "bun:test";
import { claimUnderstandingStoreFor } from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertBigQuestionsNotHoled,
  assertJudgedFourOptionRow,
  assertSourceCarriesItsRow,
  connectExamClient,
  type ExamClient,
  newCatalog,
  prepareContentDb,
} from "./exam-harness";

/*
 * TASK-173.9.2 slice 2: the 主張理解（長文） block (大問13 at N2, 大問12 at N1)
 * prints a real passage with the fixed 主張理解 stem and four Japanese
 * options, drawn from `packages/japanese/data/reading/{level}-chuushou.json`.
 * This file pins the seams against the real store, never a reimplementation:
 *
 *   - the store (`claimUnderstandingStoreFor`): N2 carries the 12 AUTHORED
 *     argument rows written whole for this block (TASK-173.9.20), N1 carries
 *     well-formed composed authored-key 白書 rows; N3 is an honest absence,
 *   - the picker (`claimUnderstandingSourceFor`): draws one row, spends the
 *     passage so a 大問 never prints the same text twice, and declines an
 *     empty level rather than inventing a passage,
 *   - the presentation branch (`candidatePresentationFor`), gated on ITEM TYPE
 *     so a 主張理解 keeps its OWN passage and never falls through to
 *     `LONG_READING_PASSAGE`,
 *   - the real N1 paper end to end: 大問12 fills from the sourced store while
 *     the receipt still names the blocks it cannot ask (N2's end-to-end fill
 *     is pinned in exam-medium-reading.test.ts's receipt test).
 */

const DB_URL = prepareContentDb("exam-claim-understanding");

const { candidatePresentationFor, claimUnderstandingSourceFor } = __test__;

const LATIN_RE = /[A-Za-z]/;

type Catalog = Parameters<typeof claimUnderstandingSourceFor>[0]["catalog"];
type ClaimSource = NonNullable<ReturnType<typeof claimUnderstandingSourceFor>>;

/* `CandidateCatalogState` is a private service shape, so the writable catalog
 * is derived from the picker's own parameter type. Same derivation as
 * exam-medium-reading.test.ts, for the same reason. */
const sourceFor = (
  catalog: Catalog,
  level = "N2",
  index = 0,
  offset = 0
): ClaimSource | null =>
  claimUnderstandingSourceFor({ catalog, index, level, offset });

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

describe("the sourced 主張理解 store", () => {
  it("ships composed authored 主張理解 rows at N2", () => {
    // TASK-173.9.20 changed this level's answer. N2's 大問13 rows were the
    // `authored-key` shape (a licensed 白書 paragraph whose own sentence is
    // printed as the key, 284-521 runes under a 長文 heading). They are now
    // written multi-paragraph 長文 (700-1200 runes, `CHUUSHOU_AUTHORED_BAND.N2`),
    // and the key is the row's own paraphrase of the argument rather than a
    // sentence copied out of the document. So the containment test flips: the key
    // is NOT printed verbatim, while the row's deciding sentence is, and the
    // distractors are each true of one detail, the reversed stance, or an invented
    // counter-position. The store gate
    // (packages/japanese check:reading-chuushou --level N2) proves the evidence
    // line and the band; what the SERVER boundary keeps proving is that it hands
    // out only this level's rows, composed and validated, four options deep.
    const store = claimUnderstandingStoreFor("N2");
    // N2 大問13 prints 3 小問; four papers' worth is the depth this store ships
    // rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(12);
    for (const entry of store) {
      assertJudgedFourOptionRow(entry);
      expect(entry.passage).not.toContain("＿＿");
      // A 主張理解 document is a 長文: one paragraph would be the 中文 block
      // wearing this heading.
      expect(entry.passage.split("\n").length).toBeGreaterThanOrEqual(4);
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(700);
      expect(runes).toBeLessThanOrEqual(1200);
      // The fixed 主張理解 stem, in Japanese.
      expect(entry.stem).not.toMatch(LATIN_RE);
      expect(entry.stem).toContain("主張");
      // Four distinct options, and the key is not one of the distractors.
      expect(new Set(entry.options).size).toBe(4);
    }
    // Every row asks the same ねらい, which is what the block is: the depth lives
    // in the documents, so no two rows may print the same passage.
    expect(new Set(store.map((entry) => entry.passage)).size).toBe(
      store.length
    );
  });

  it("ships composed authored 主張理解 rows at N1", () => {
    // TASK-173.9.21 changed this level's answer. N1's 大問12 rows were the
    // `authored-key` shape (a licensed 白書 paragraph whose own sentence is printed
    // as the key), which asks a learner to find a line rather than to work out
    // what the writer argues. They are now written multi-paragraph 長文
    // (`CHUUSHOU_AUTHORED_BAND.N1`, 800-1200 runes), and the key is the row's own
    // paraphrase of the argument rather than a sentence copied out of the
    // document. So the containment test flips: the key is NOT printed verbatim,
    // while the row's deciding sentence is, and the distractors are each true of
    // one detail, the reversed stance, or an invented counter-position. The store
    // gate (packages/japanese check:reading-chuushou --level N1) proves the
    // evidence line and the band; what the SERVER boundary keeps proving is that it
    // hands out only this level's rows, composed and validated, four options deep.
    const store = claimUnderstandingStoreFor("N1");
    // N1 大問12 prints 4 小問; four papers' worth is the depth this store ships
    // rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(16);
    for (const entry of store) {
      assertJudgedFourOptionRow(entry);
      expect(entry.passage).not.toContain("＿＿");
      // A 主張理解 document is a 長文: one paragraph would be the 中文 block
      // wearing this heading.
      expect(entry.passage.split("\n").length).toBeGreaterThanOrEqual(4);
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(800);
      expect(runes).toBeLessThanOrEqual(1200);
      // The fixed 主張理解 stem, in Japanese. The passage may carry Latin (written
      // prose here prints units and abbreviations).
      expect(entry.stem).not.toMatch(LATIN_RE);
      expect(entry.stem).toContain("主張");
      // Four distinct options, and the key is not one of the distractors.
      expect(new Set(entry.options).size).toBe(4);
      const answer = entry.options[entry.answerIndex];
      if (answer === undefined) {
        throw new Error(`row ${entry.id} has no option at its answer index`);
      }
      expect(entry.passage).not.toContain(answer);
    }
    // Every row asks the same ねらい, which is what the block is: the depth lives
    // in the documents, so no two rows may print the same passage.
    expect(new Set(store.map((entry) => entry.passage)).size).toBe(
      store.length
    );
  });

  it("is an honest absence at a level with no 主張理解 store", () => {
    expect(claimUnderstandingStoreFor("N3")).toEqual([]);
  });
});

describe("claimUnderstandingSourceFor", () => {
  it("turns one store row into a source that carries its own passage", () => {
    const store = claimUnderstandingStoreFor("N2");
    const source = sourceFor(newCatalog(), "N2", 0);
    expect(source).not.toBeNull();
    const found = source as ClaimSource;
    const row = assertSourceCarriesItsRow({ found, level: "N2", rows: store });
    expect(found.passage).toBe(row.passage);
  });

  it("spends the passage, so a 大問 never prints one text twice", () => {
    const catalog = newCatalog();
    const first = sourceFor(catalog, "N2", 0);
    expect(first).not.toBeNull();
    const usedPassage = (first as ClaimSource).passage as string;
    expect(catalog.usedClaimUnderstandingPassages.has(usedPassage)).toBe(true);
    for (
      let index = 0;
      index < claimUnderstandingStoreFor("N2").length;
      index += 1
    ) {
      const next = sourceFor(catalog, "N2", index);
      if (next === null) {
        break;
      }
      expect(next.passage).not.toBe(usedPassage);
    }
  });

  it("declines an empty level rather than inventing a passage", () => {
    expect(sourceFor(newCatalog(), "N3", 0)).toBeNull();
  });
});

describe("the 主張理解 presentation branch keeps its own passage", () => {
  it("prints the sourced passage and never the canned long passage", async () => {
    const source = sourceFor(newCatalog(), "N2", 0) as ClaimSource;
    const result = await candidatePresentationFor({
      itemType: "claim-understanding",
      section: "language-knowledge-reading",
      source,
      split: () => Promise.resolve(null),
    });
    expect(result.passage).toBe(source.passage ?? null);
    expect(result.mask).toBeNull();
    const passages = new Set(
      claimUnderstandingStoreFor("N2").map((e) => e.passage)
    );
    expect(passages.has(result.passage as string)).toBe(true);
  });
});

describe("a real N1 paper asks a sourced 主張理解", () => {
  it("fills 大問12 from the store and still names the holes it cannot ask", async () => {
    // The budget is clamped at parse time to the section's indicative total,
    // so 400 asks for the WHOLE reading section: the walk must cover 大問1-11
    // before it reaches 主張理解 (大問12, 4 小問).
    const requested = await client.exam.request({
      budget: { "language-knowledge-reading": 400 },
      level: "N1",
      mode: "real",
      sections: ["language-knowledge-reading"],
      seed: "claim-understanding-n1",
    });
    const assembled = await client.exam.assemble({ examId: requested.examId });
    const state = await client.exam.get({ examId: requested.examId });
    const claimed = state.items.filter(
      (entry) => entry.item.itemType === "claim-understanding"
    );
    expect(claimed.length).toBeGreaterThan(0);
    // Fabrication guard: every landed passage IS a store passage, one passage
    // per 小問, and every option set is four distinct Japanese options with
    // the fixed stem above them.
    const store = claimUnderstandingStoreFor("N1");
    const passages = new Set(store.map((entry) => entry.passage));
    const rowByPassage = new Map(store.map((entry) => [entry.passage, entry]));
    const landedPassages = new Set<string>();
    for (const entry of claimed) {
      const { item } = entry;
      const passage = item.passage as string;
      expect(passages.has(passage)).toBe(true);
      expect(item.stem).not.toMatch(LATIN_RE);
      expect(item.options).toHaveLength(4);
      expect(new Set(item.options).size).toBe(4);
      for (const option of item.options) {
        expect(option.length).toBeGreaterThan(0);
      }
      // The landed row IS the store row: same four options, same key. The
      // client-readable item has no answerIndex (the key never reaches the
      // client), so the key is resolved through the store row it came from.
      const row = rowByPassage.get(passage);
      expect(row).toBeDefined();
      const stored = row as (typeof store)[number];
      expect(new Set(item.options)).toEqual(new Set(stored.options));
      const key = stored.options[stored.answerIndex] as string;
      // Neither the English prompt nor the printed Japanese stem may carry
      // the key: the claim is a long passage sentence, so a prompt leak would
      // print it right above the options. (The deterministic leak screen is
      // item-engine's hasStemLeak; this pins the wire copy of it.)
      expect(item.prompt).not.toContain(key);
      expect(item.stem as string).not.toContain(key);
      landedPassages.add(passage);
    }
    expect(landedPassages.size).toBe(claimed.length);
    // 大問12 (主張理解) is filled, so it must NOT be named as a hole. Neither is
    // 統合理解 (大問11), which TASK-173.9.3 sourced at N1.
    assertBigQuestionsNotHoled({ assembled, bigQuestions: [12, 11] });
  });
});
