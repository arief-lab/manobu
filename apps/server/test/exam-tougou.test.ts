import { beforeAll, describe, expect, it } from "bun:test";
import type { CorpusTougouReadingEntry } from "../src/services/exam-corpus";
import { tougouStoreFor } from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertBigQuestionsNotHoled,
  assertSourceCarriesItsRow,
  connectExamClient,
  type ExamClient,
  newCatalog,
  prepareContentDb,
  requestAssembleRead,
} from "./exam-harness";

/*
 * TASK-173.9.3: the 統合理解 block (大問12 at N2, 大問11 at N1) prints TWO real
 * 白書 paragraphs behind one comparison question, drawn from
 * `packages/japanese/data/reading/{level}-tougou.json`. This is the first
 * real-mode reading block answered from more than one document, so the seams are
 * pinned against the shipped store rather than a reimplementation:
 *
 *   - the store (`tougouStoreFor`): N2 carries composed authored pairs asking one
 *     of the three 比較・統合 relations (TASK-173.9.20), N1 carries the composed
 *     `shared-topic-pair` lookups with TWO passages, and a level whose file is not
 *     there is an honest absence,
 *   - the picker (`tougouSourceFor`): draws one pair, spends the PAIR (not one
 *     document) so a 大問 never prints the same two texts twice, and declines a
 *     level with no store rather than inventing a comparison,
 *   - the presentation branch (`candidatePresentationFor`): the pair travels as
 *     two `stimuli` passages and the singular `passage` column stays empty, so a
 *     real 統合理解 can never land on `LONG_READING_PASSAGE` (AC#3),
 *   - the real papers end to end: N2 大問12 fills its 2 小問 and N1 大問11 its 3,
 *     each printing both of its documents.
 */

const DB_URL = prepareContentDb("exam-tougou");

const { candidatePresentationFor, tougouSourceFor } = __test__;

/** The 統合理解 question is one fixed Japanese line; an ASCII letter in it means
 * it stopped being the shipped stem and became a paraphrase. */
const LATIN_RE = /[A-Za-z]/;

/** The pair total the ねらい names: 合計600字程度. The generator caps it at 800
 * runes, and this asserts the cap holds on the shipped bytes. */
const MAX_PAIR_RUNES = 800;

/** The three 比較・統合 questions the authored route asks (TASK-173.9.20 at N2 and
 * TASK-173.9.21 at N1): what both writers state, where the two documents fail to
 * agree, and the premise either side assumes. Each is a relation neither text
 * states alone, which is what separates the block's ねらい from the surface lookup
 * 「両方に挙げられている」 that the shared-topic route of TASK-173.9.3 printed. */
const AUTHORED_TOUGOU_STEMS = new Set([
  "二つの文章の書き手が共通して述べていることはどれか。",
  "二つの文章を比べて、内容が一致しないものはどれか。",
  "二つの文章のどちらにも共通する前提として最も適切なものはどれか。",
]);

type Catalog = Parameters<typeof tougouSourceFor>[0]["catalog"];
type TougouSource = NonNullable<ReturnType<typeof tougouSourceFor>>;

const sourceFor = (
  catalog: Catalog,
  level = "N2",
  index = 0,
  offset = 0
): TougouSource | null => tougouSourceFor({ catalog, index, level, offset });

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/** The pair a row prints, as a canonical key: order-insensitive, because the
 * same two documents swapped are still the same 小問. Mirrors the spend the
 * picker applies, which is why a test can compare against it. */
const pairKeyOf = (passages: readonly string[]): string =>
  [...passages].sort().join("\n");

const pairKeysOf = (level: string): Set<string> =>
  new Set(tougouStoreFor(level).map((entry) => pairKeyOf(entry.passages)));

const passagesOf = (source: TougouSource): readonly string[] =>
  source.passages ?? [];

describe("the sourced 統合理解 store", () => {
  it("ships composed authored 比較・統合 pairs at N2", () => {
    // TASK-173.9.20 changed this level's answer. N2 大問12 was the
    // `shared-topic-pair` lookup of TASK-173.9.3 (two 白書 paragraphs, four bare
    // nouns, the key being the one noun BOTH print), and the fixed stem proves
    // that is a surface lookup rather than the 比較・統合 the ねらい names. These
    // rows are written pairs behind one of the three relation questions, and the
    // claim screen inverts: the key is the relation, so NEITHER document prints
    // it, while every distractor is a detail exactly ONE side states. Mirrors
    // `TOUGOU_AUTHORED_STEMS` in packages/japanese/scripts/
    // reading-tougou-corpus.ts, the list the store gate screens against.
    const store = tougouStoreFor("N2");
    // N2 大問12 prints 2 小問; four papers' worth of pairs is the depth this store
    // ships rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(8);
    for (const entry of store) {
      expect(entry.level).toBe("N2");
      expect(entry.block).toBe("tougou-rikai");
      expect(entry.passages).toHaveLength(2);
      expect(entry.options).toHaveLength(4);
      expect(new Set(entry.options).size).toBe(4);
      expect(entry.answerIndex).toBeGreaterThanOrEqual(0);
      expect(entry.answerIndex).toBeLessThan(4);
      expect(entry.provenance).toBe("composed");
      expect(entry.validated).toBe(true);
      // One of the three relation asks, never the lookup line.
      expect(AUTHORED_TOUGOU_STEMS.has(entry.stem)).toBe(true);
      for (const option of entry.options) {
        expect(option).not.toMatch(LATIN_RE);
      }
      const [first, second] = entry.passages;
      if (first === undefined || second === undefined) {
        throw new Error(`row ${entry.id} must print exactly two documents`);
      }
      // The 合計600字程度 band, measured on the pair and floored: two sentences
      // glued together are not a 読み比べ.
      const runes = first.length + second.length;
      expect(runes).toBeGreaterThanOrEqual(400);
      expect(runes).toBeLessThanOrEqual(MAX_PAIR_RUNES);
      const printedIn = (surface: string): number =>
        Number(first.includes(surface)) + Number(second.includes(surface));
      const key = entry.options[entry.answerIndex];
      if (key === undefined) {
        throw new Error(`row ${entry.id} has no option at its answer index`);
      }
      expect(printedIn(key)).toBe(0);
      for (const [optionIndex, option] of entry.options.entries()) {
        if (optionIndex === entry.answerIndex) {
          continue;
        }
        // Each distractor is true of one side only, which is what makes reading
        // BOTH documents necessary rather than optional.
        expect(printedIn(option)).toBe(1);
      }
    }
    // All three relation classes present: one 同意点 question repeated over eight
    // rows would train one read, not the 大問.
    expect(
      new Set(store.map((entry) => entry.stem)).size
    ).toBeGreaterThanOrEqual(3);
  });

  it("ships composed authored 比較・統合 pairs at N1", () => {
    // TASK-173.9.21 changed this level's answer. N1 大問11 was the
    // `shared-topic-pair` lookup of TASK-173.9.3 (two 白書 paragraphs, four bare
    // nouns, the key being the one noun BOTH print), a surface scan that needs
    // neither document read. These rows are written pairs behind one of the three
    // relation asks, and the claim screen inverts: the key is the relation, so
    // NEITHER document prints it, while every distractor is a detail exactly ONE
    // side states. The store gate (packages/japanese check:reading-tougou
    // --level N1) proves the band and the relation spread; what the SERVER
    // boundary keeps proving is that it hands out only this level's pairs.
    const store = tougouStoreFor("N1");
    // N1 大問11 prints 3 小問; four papers' worth of pairs is the depth this store
    // ships rather than the minimum that fills one 大問.
    expect(store.length).toBeGreaterThanOrEqual(12);
    for (const entry of store) {
      expect(entry.level).toBe("N1");
      expect(entry.block).toBe("tougou-rikai");
      expect(entry.passages).toHaveLength(2);
      expect(entry.options).toHaveLength(4);
      expect(new Set(entry.options).size).toBe(4);
      expect(entry.answerIndex).toBeGreaterThanOrEqual(0);
      expect(entry.answerIndex).toBeLessThan(4);
      expect(entry.provenance).toBe("composed");
      expect(entry.validated).toBe(true);
      // One of the three relation asks, never the lookup line.
      expect(AUTHORED_TOUGOU_STEMS.has(entry.stem)).toBe(true);
      for (const option of entry.options) {
        expect(option).not.toMatch(LATIN_RE);
      }
      const [first, second] = entry.passages;
      if (first === undefined || second === undefined) {
        throw new Error(`row ${entry.id} must print exactly two documents`);
      }
      // The 合計600字程度 band, measured on the pair and floored: two sentences
      // glued together are not a 読み比べ.
      const runes = first.length + second.length;
      expect(runes).toBeGreaterThanOrEqual(400);
      expect(runes).toBeLessThanOrEqual(MAX_PAIR_RUNES);
      const printedIn = (surface: string): number =>
        Number(first.includes(surface)) + Number(second.includes(surface));
      const key = entry.options[entry.answerIndex];
      if (key === undefined) {
        throw new Error(`row ${entry.id} has no option at its answer index`);
      }
      expect(printedIn(key)).toBe(0);
      for (const [optionIndex, option] of entry.options.entries()) {
        if (optionIndex === entry.answerIndex) {
          continue;
        }
        // Each distractor is true of one side only, which is what makes reading
        // BOTH documents necessary rather than optional.
        expect(printedIn(option)).toBe(1);
      }
    }
    // All three relation classes present: one 同意点 question repeated over twelve
    // rows would train one read, not the 大問.
    expect(
      new Set(store.map((entry) => entry.stem)).size
    ).toBeGreaterThanOrEqual(3);
  });

  it("carries no pairs for a level with no sourced store", () => {
    // The honest absence TASK-173.9.3 ships with: N5/N4/N3 keep 統合理解 as a
    // named hole rather than borrowing a pair from the level above.
    expect(tougouStoreFor("N5")).toEqual([]);
    expect(tougouStoreFor("N4")).toEqual([]);
    expect(tougouStoreFor("N3")).toEqual([]);
  });

  it("prints every pair once, so no document backs two rows at one level", () => {
    for (const level of ["N2", "N1"]) {
      const store = tougouStoreFor(level);
      const keys = store.map((entry) => pairKeyOf(entry.passages));
      expect(new Set(keys).size).toBe(keys.length);
      const documents = store.flatMap((entry) => [...entry.passages]);
      expect(new Set(documents).size).toBe(documents.length);
    }
  });
});

describe("tougouSourceFor", () => {
  it("turns one store row into a source that carries BOTH documents", () => {
    const store = tougouStoreFor("N2");
    const source = sourceFor(newCatalog(), "N2", 0);
    expect(source).not.toBeNull();
    const found = source as TougouSource;
    const row = assertSourceCarriesItsRow({ found, level: "N2", rows: store });
    // The comparison question is the line a real 小問 prints, and the pair is
    // verbatim in reading order. A 統合理解 has no singular passage: the unit
    // is the pair.
    expect(found.passages).toEqual(row.passages);
    expect(found.passage).toBeUndefined();
    expect(found.provenance).toBe("composed");
    expect(found.validated).toBe(true);
  });

  it("spends the PAIR, so one comparison backs one 小問", () => {
    const catalog = newCatalog();
    const first = sourceFor(catalog, "N2", 0) as TougouSource;
    const used = pairKeyOf(passagesOf(first));
    expect(catalog.usedTougouPairs.has(used)).toBe(true);
    // Neither document may resurface in a later slot either, which is what the
    // generator's once-per-paragraph spend guarantees and the picker inherits.
    for (let index = 0; index < tougouStoreFor("N2").length; index += 1) {
      const next = sourceFor(catalog, "N2", index);
      if (next === null) {
        break;
      }
      expect(pairKeyOf(passagesOf(next))).not.toBe(used);
    }
  });

  it("skips an anchor this learner has already been served", () => {
    const entry = tougouStoreFor("N2")[0] as CorpusTougouReadingEntry;
    const catalog = newCatalog();
    catalog.seenAnchors.add(`reading:${entry.id}`);
    const found = sourceFor(catalog, "N2", 0) as TougouSource;
    expect(found.anchorId).not.toBe(`reading:${entry.id}`);
  });

  it("declines a level with no pairs rather than invent a comparison", () => {
    // AC#2: this null is what becomes a named hole instead of a fabricated
    // 読み比べ, and it is the arm a real N3 paper cannot reach any other way.
    expect(sourceFor(newCatalog(), "N3", 0)).toBeNull();
    expect(sourceFor(newCatalog(), "N4", 0)).toBeNull();
    expect(sourceFor(newCatalog(), "N5", 0)).toBeNull();
  });

  it("runs out once every pair is spent", () => {
    const catalog = newCatalog();
    const distinct = new Set<string>();
    for (let index = 0; index < tougouStoreFor("N1").length + 5; index += 1) {
      const source = sourceFor(catalog, "N1", index);
      if (source === null) {
        break;
      }
      distinct.add(pairKeyOf(passagesOf(source)));
    }
    // One 小問 per pair, so the store's size is the block's ceiling and the next
    // ask gets nothing.
    expect(distinct.size).toBe(pairKeysOf("N1").size);
    expect(sourceFor(catalog, "N1", 0)).toBeNull();
  });
});

describe("the 統合理解 presentation branch prints the pair as two stimuli", () => {
  it("carries both documents and never the canned long passage", async () => {
    const source = sourceFor(newCatalog(), "N2", 0) as TougouSource;
    const result = await candidatePresentationFor({
      itemType: "text-comparison",
      // The branch is gated on the ITEM TYPE, not the section.
      section: "language-knowledge-reading",
      source,
      split: () => Promise.resolve(null),
    });
    // AC#3: the singular passage stays empty. One document is not the reading the
    // 小問 can be answered from, and the only way this column could be non-empty
    // is a fallback to canned text.
    expect(result.passage).toBeNull();
    expect(result.mask).toBeNull();
    expect(result.script).toBeNull();
    const texts = (result.stimuli ?? []).map((stimulus) => stimulus.text);
    expect(texts).toEqual([...(source.passages ?? [])]);
    expect(pairKeysOf("N2").has(pairKeyOf(texts))).toBe(true);
    for (const stimulus of result.stimuli ?? []) {
      expect(stimulus.kind).toBe("passage");
      expect(stimulus.text.length).toBeGreaterThan(0);
    }
  });

  it("emits no stimuli for a source that lost its pair", async () => {
    // The branch reads the pair rather than a constant, so a source that cannot
    // name two documents prints nothing. That is the shape the real paper
    // refuses, and it is why a canned pair cannot ride in behind it.
    const source = sourceFor(newCatalog(), "N2", 0) as TougouSource;
    const half = passagesOf(source)[0] as string;
    const result = await candidatePresentationFor({
      itemType: "text-comparison",
      section: "language-knowledge-reading",
      source: { ...source, passages: [half] },
      split: () => Promise.resolve(null),
    });
    expect(result.stimuli).toBeNull();
    expect(result.passage).toBeNull();
  });
});

const realReadingPaper = (level: "N1" | "N2", seed: string) =>
  // The budget is clamped at parse time to the section's indicative total, so
  // 400 asks for the WHOLE reading section: the walk has to cover every earlier
  // 大問 before it reaches 統合理解.
  requestAssembleRead(client, {
    budget: { "language-knowledge-reading": 400 },
    level,
    mode: "real",
    sections: ["language-knowledge-reading"],
    seed,
  });

describe("a real paper asks a sourced 統合理解", () => {
  it("lands N2 大問12 with both documents of its own pair", async () => {
    const { assembled, state } = await realReadingPaper("N2", "tougou-n2");
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "text-comparison"
    );
    expect(landed).toHaveLength(2);
    const byPair = new Map(
      tougouStoreFor("N2").map((entry) => [pairKeyOf(entry.passages), entry])
    );
    const pairs = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      expect(item.options).toHaveLength(4);
      expect(new Set(item.options).size).toBe(4);
      const texts = (item.stimuli ?? []).map((stimulus) => stimulus.text);
      expect(texts).toHaveLength(2);
      // Fabrication guard: the landed pair IS a store pair, whole.
      const row = byPair.get(pairKeyOf(texts)) as CorpusTougouReadingEntry;
      expect(row).toBeDefined();
      expect(row.passages).toEqual(texts);
      // Row identity, question included: the 小問 prints the row's own relation
      // ask rather than a stem the block stamped over it (TASK-173.9.20).
      expect(item.stem).toBe(row.stem);
      expect(AUTHORED_TOUGOU_STEMS.has(row.stem)).toBe(true);
      // The singular `passage` column is the store's single-stimulus projection
      // of THIS item (`packages/db/src/item-store.ts:2738`: `passage` falls back
      // to the first passage stimulus), and the desktop render reads `stimuli`
      // whenever it has them (`apps/desktop/src/features/exam/exam-question.tsx:81`).
      // So the service branch's null stays null on the wire except as that
      // projection: it is this pair's own first document, never the canned 長文
      // text (AC#3).
      expect(item.passage).toBe(texts[0] ?? null);
      expect(new Set(item.options)).toEqual(new Set(row.options));
      const key = row.options[row.answerIndex] as string;
      // Neither the English prompt nor the fixed stem may name the key.
      expect(item.prompt).not.toContain(key);
      expect(item.stem ?? "").not.toContain(key);
      pairs.add(pairKeyOf(texts));
    }
    // Two 小問, two different pairs.
    expect(pairs.size).toBe(2);
    // 統合理解 is filled, so it must not be named as a hole.
    assertBigQuestionsNotHoled({ assembled, bigQuestions: [12] });
  });

  it("lands N1 大問11 with three pairs that share no document", async () => {
    const { assembled, state } = await realReadingPaper("N1", "tougou-n1");
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "text-comparison"
    );
    // AC#1: N1's 大問11 asks 3 小問 and real mode fills all three from the
    // shipped pair store.
    expect(landed).toHaveLength(3);
    const documents = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      const texts = (item.stimuli ?? []).map((stimulus) => stimulus.text);
      expect(texts).toHaveLength(2);
      for (const text of texts) {
        // One paragraph may back one 小問 in a paper: the generator spends it
        // once and the picker must not hand it out twice.
        expect(documents.has(text)).toBe(false);
        documents.add(text);
      }
      // Same single-stimulus projection guard as N2: the `passage` column is this
      // item's own first document, never canned text.
      expect(item.passage).toBe(texts[0] ?? null);
    }
    expect(documents.size).toBe(6);
    assertBigQuestionsNotHoled({ assembled, bigQuestions: [11] });
  });

  it("names no 統合理解 at a level whose paper has no such 大問", async () => {
    // AC#2 in receipt form. N3's reading lives in 文法・読解 and its blueprint has
    // no 統合理解 大問 at all, so an N3 paper must neither emit a `text-comparison`
    // item nor put a 統合理解 hole on the receipt: a level with no sourced pair
    // prints nothing, and a level that never asks for one is not reported as
    // missing one. The refusal-without-fabrication arm for a level that DOES ask
    // is the picker test above (`declines a level with no pairs`).
    const requested = await client.exam.request({
      budget: { "grammar-reading": 400 },
      level: "N3",
      mode: "real",
      sections: ["grammar-reading"],
      seed: "tougou-n3",
    });
    const assembled = await client.exam.assemble({ examId: requested.examId });
    const state = await client.exam.get({ examId: requested.examId });
    const comparison = state.items.filter(
      (entry) => entry.item.itemType === "text-comparison"
    );
    expect(comparison).toHaveLength(0);
    expect(
      assembled.unfilledBlocks.some((block) => block.name === "統合理解")
    ).toBe(false);
  });
});
