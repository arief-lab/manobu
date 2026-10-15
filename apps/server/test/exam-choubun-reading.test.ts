import { beforeAll, describe, expect, it } from "bun:test";
import type { CorpusShortReadingEntry } from "../src/services/exam-corpus";
import { choubunStoreFor } from "../src/services/exam-corpus";
import { __test__ } from "../src/services/exam-service";
import {
  assertJudgedFourOptionRow,
  assertSourceCarriesItsRow,
  connectExamClient,
  type ExamClient,
  newCatalog,
  prepareContentDb,
} from "./exam-harness";

/*
 * TASK-173.9.12 gave a real N1 paper's 内容理解（長文） block (大問10) a source at
 * all: until then the block declared no question kind and `long-reading` was the
 * one reading type the server answered off a hardcoded sentence
 * (`LONG_READING_PASSAGE`), so every 長文 小問 in every mode printed the same
 * canned text. The store it reads is `packages/japanese/data/reading/n1-choubun.
 * json`, and what that file holds has changed once since: 900-1200 rune 白書
 * windows with one noun masked at first, and since TASK-173.9.21 authored
 * multi-paragraph documents whose 小問 asks what the document means (doc-27 §10
 * refuses the cloze under a comprehension heading). The 900-1200 band is the one
 * thing both generations answer to, because it is the official 大問10 length.
 *
 * Two things had to stay separate, and this file pins both:
 *
 *   - REAL mode reads its own document and never the canned text, exactly as the
 *     中文 and 短文 families do,
 *   - FLAT mode (the practice papers: `shortened`, `exam-conditions`) keeps the
 *     canned text, because those mixes still weight `long-reading` 20 and draw
 *     their source from the grammar pool, which carries no passage at all. That
 *     is the standing decision not to move flat weights (doc-27 §6), so the
 *     sourced picker is reached on the MODE as well as the item type.
 *
 * The row contract itself (the band, the paragraph minimum, the ねらい spread, the
 * coverage floor, unspent by any other store) is `check:reading-choubun`'s job and
 * runs there against the corpus. What this file checks is the shape the SERVER can
 * see: the printed passage is multi-paragraph, no two rows share one, and the
 * served row is the level's own.
 */

const DB_URL = prepareContentDb("exam-choubun-reading");

const { candidatePresentationFor, choubunSourceFor, longReadingPassage } =
  __test__;

const LATIN_RE = /[A-Za-z]/;

/** One 長文 小問's printed window: 900-1200 runes, and the store's own rows are
 * the only thing that has to clear it. */
const MIN_WINDOW_RUNES = 900;
const MAX_WINDOW_RUNES = 1200;

/** The authored N3 長文 band (`CHOUBUN_AUTHORED_BAND`): the official N3 長文
 * sample measures 658 runes under this instrument and the official 中文 382, so
 * a shipped N3 row sits between them, never at the 中文 length it replaced. */
const MIN_AUTHORED_RUNES = 500;
const MAX_AUTHORED_RUNES = 700;

type Catalog = Parameters<typeof choubunSourceFor>[0]["catalog"];
type ChoubunSource = NonNullable<ReturnType<typeof choubunSourceFor>>;

/* `CandidateCatalogState` is a private service shape, so the writable catalog is
 * derived from the picker's own parameter type, exactly as the 中文 file does. */
const sourceFor = (
  catalog: Catalog,
  level = "N1",
  index = 0,
  offset = 0
): ChoubunSource | null => choubunSourceFor({ catalog, index, level, offset });

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

describe("the sourced 長文 store", () => {
  it("ships authored comprehension rows at N1, one per 大問10 小問", () => {
    const store = choubunStoreFor("N1");
    // 大問10 asks 4 小問 (packages/item-engine/src/paper.ts), and a row is spent
    // once per paper, so a store smaller than 4 could never fill the block. The
    // depth rule lives in `exam-reading-holes.test.ts`, which reads the count off
    // the blueprint; this test is the shape of one row.
    expect(store.length).toBeGreaterThanOrEqual(4);
    for (const entry of store) {
      expect(entry.level).toBe("N1");
      expect(entry.block).toBe("naiyou-rikai-choubun");
      assertJudgedFourOptionRow(entry);
      expect(entry.validatedBy).toBe("authored:agent-blind-judged");
      // TASK-173.9.21 converts this level the way TASK-173.9.16 did N3: the row
      // writes its own document and asks what it means, so it holds out no blank
      // to restore and cites no 白書 paragraph. The masked-slot branch this
      // assertion used to pin stays exercised by a committed fixture in
      // `packages/japanese/test/check-reading-choubun.test.ts`.
      expect(entry.sourceIds).toBeUndefined();
      expect(entry.passage).not.toContain("＿＿");
      expect(entry.stem).not.toMatch(LATIN_RE);
      const runes = [...entry.passage].length;
      // The authored N1 band is the window the masked branch was already cut to,
      // because both answer to the official 大問10 length rather than to a
      // generator's convenience.
      expect(runes).toBeGreaterThanOrEqual(MIN_WINDOW_RUNES);
      expect(runes).toBeLessThanOrEqual(MAX_WINDOW_RUNES);
      // A 長文 is a multi-paragraph document, not a sentence: the canned text is
      // one line, so this is the assertion that a real document reached the store.
      expect(entry.passage.split("\n").length).toBeGreaterThanOrEqual(2);
      expect(entry.passage).not.toBe(longReadingPassage);
    }
  });

  it("ships no two rows printing the same document", () => {
    // The property the 白書-paragraph test used to pin. An authored row carries no
    // sourceIds at all, so what keeps 大問10 from printing one text twice is that
    // the documents themselves differ.
    const seen = new Set<string>();
    for (const entry of choubunStoreFor("N1")) {
      expect(seen.has(entry.passage)).toBe(false);
      seen.add(entry.passage);
    }
  });

  it("is an honest absence at every level with no 長文 store", () => {
    // N3 used to be in this list. It shares the `long-reading` kind and had no
    // store, so 大問6 stayed a named hole rather than printing canned text
    // (doc-27 §4); TASK-173.9.16 fills it with authored rows, leaving only the
    // levels whose paper has no 長文 大問 at all.
    for (const level of ["N5", "N4", "N2"]) {
      expect(choubunStoreFor(level)).toEqual([]);
    }
  });

  it("ships authored comprehension rows at N3 that claim no 白書 provenance", () => {
    const store = choubunStoreFor("N3");
    // 大問6 asks 4 小問 (packages/item-engine/src/paper.ts:555) and one row is
    // spent per 小問, so a store under 4 could never fill the block.
    expect(store.length).toBeGreaterThanOrEqual(4);
    for (const entry of store) {
      expect(entry.level).toBe("N3");
      expect(entry.block).toBe("naiyou-rikai-choubun");
      assertJudgedFourOptionRow(entry);
      // doc-27 §11. It names the two legs that ran and no others: there is no
      // human reader in this project, so no row may sign a review that happened.
      expect(entry.validatedBy).toBe("authored:agent-blind-judged");
      // An authored row writes its own text, so it holds out no licence claim and
      // no blank to restore.
      expect(entry.sourceIds).toBeUndefined();
      expect(entry.passage).not.toContain("＿＿");
      const runes = [...entry.passage].length;
      expect(runes).toBeGreaterThanOrEqual(MIN_AUTHORED_RUNES);
      expect(runes).toBeLessThanOrEqual(MAX_AUTHORED_RUNES);
      // A 長文 is a multi-paragraph document; the canned passage is one line.
      expect(entry.passage.split("\n").length).toBeGreaterThanOrEqual(2);
      expect(entry.passage).not.toBe(longReadingPassage);
    }
  });
});

describe("choubunSourceFor", () => {
  it("turns one store row into a source that carries its own window", () => {
    const store = choubunStoreFor("N1");
    const source = sourceFor(newCatalog(), "N1", 0);
    expect(source).not.toBeNull();
    const found = source as ChoubunSource;
    const row = assertSourceCarriesItsRow({ found, level: "N1", rows: store });
    expect(found.passage).toBe(row.passage);
    expect(found.provenance).toBe("composed");
    expect(found.validated).toBe(true);
  });

  it("spends the window, so a 大問 never prints one text twice", () => {
    const catalog = newCatalog();
    const first = sourceFor(catalog, "N1", 0);
    expect(first).not.toBeNull();
    const usedPassage = (first as ChoubunSource).passage as string;
    expect(catalog.usedChoubunPassages.has(usedPassage)).toBe(true);
    for (let index = 0; index < choubunStoreFor("N1").length; index += 1) {
      const next = sourceFor(catalog, "N1", index);
      if (next === null) {
        break;
      }
      expect(next.passage).not.toBe(usedPassage);
    }
  });

  it("serves N3 大問6 a row from N3's own file, not the N1 window", () => {
    // Row identity, not emptiness (doc-27 §6's lesson from TASK-173.9.15): the
    // old assertion for this level was `null`, so hardwiring the store read to
    // N1 kept a hole-free N3 paper serving N1 prose and nothing noticed. This
    // pins the served anchor to a row of the requested level's own store.
    const store = choubunStoreFor("N3");
    const source = sourceFor(newCatalog(), "N3", 0);
    expect(source).not.toBeNull();
    const found = source as ChoubunSource;
    const entry = store.find((each) => `reading:${each.id}` === found.anchorId);
    expect(entry).toBeDefined();
    const row = entry as CorpusShortReadingEntry;
    expect(row.level).toBe("N3");
    expect(found.level).toBe("N3");
    expect(found.anchorId).toBe(`reading:${row.id}`);
    expect(found.passage).toBe(row.passage);
    expect(found.cue).toBe(row.stem);
    // Read the key off the row's own option list rather than indexing it: the
    // store type is `readonly string[]`, so `options[answerIndex]` is
    // `string | undefined` under noUncheckedIndexedAccess and the served
    // `target` is a `string`. Position is the property, so ask for it directly.
    expect(row.options.indexOf(found.target)).toBe(row.answerIndex);
    expect(found.distractors).toHaveLength(3);
    expect(found.distractors).not.toContain(found.target);
    expect(found.provenance).toBe("composed");
    expect(found.validated).toBe(true);
    // The served text is the authored document, never a masked 白書 window and
    // never the canned passage the flat mixes print.
    expect(found.passage).not.toContain("＿＿");
    expect(found.passage).not.toBe(longReadingPassage);
  });

  it("declines a level with no store rather than invent a window", () => {
    expect(sourceFor(newCatalog(), "N2", 0)).toBeNull();
  });
});

describe("the 長文 presentation branch", () => {
  it("prints the sourced window and never the canned long passage", async () => {
    const source = sourceFor(newCatalog(), "N1", 0) as ChoubunSource;
    const result = await candidatePresentationFor({
      itemType: "long-reading",
      section: "language-knowledge-reading",
      source,
      split: () => Promise.resolve(null),
    });
    expect(result.passage).toBe(source.passage ?? null);
    expect(result.passage).not.toBe(longReadingPassage);
    expect(result.mask).toBeNull();
    const windows = new Set(
      choubunStoreFor("N1").map((entry) => entry.passage)
    );
    expect(windows.has(result.passage as string)).toBe(true);
  });

  it("still prints the canned text for a source that carries no passage", async () => {
    // The flat path's own shape: a grammar-pool source has no `passage` column,
    // and the `??` is what keeps it on the text those papers always printed.
    const source = {
      ...(sourceFor(newCatalog(), "N1", 0) as ChoubunSource),
      passage: undefined,
    };
    const result = await candidatePresentationFor({
      itemType: "long-reading",
      section: "language-knowledge-reading",
      source,
      split: () => Promise.resolve(null),
    });
    expect(result.passage).toBe(longReadingPassage);
  });
});

describe("a real N1 paper asks a sourced 長文", () => {
  it("lands 内容理解（長文） 小問 from the store, one window per 小問", async () => {
    // Over-large budget so the walk REACHES 大問10; it is clamped to the
    // official shape at parse time.
    const requested = await client.exam.request({
      budget: { "language-knowledge-reading": 400 },
      level: "N1",
      mode: "real",
      sections: ["language-knowledge-reading"],
      seed: "choubun-reading-n1",
    });
    const assembled = await client.exam.assemble({ examId: requested.examId });
    const state = await client.exam.get({ examId: requested.examId });
    const landed = state.items.filter(
      (entry) => entry.item.itemType === "long-reading"
    );
    // 大問10 is 4 小問, and the store has more than that, so the block fills.
    expect(landed.length).toBe(4);
    const windows = new Map(
      choubunStoreFor("N1").map((entry) => [entry.passage, entry])
    );
    const landedWindows = new Set<string>();
    for (const entry of landed) {
      const { item } = entry;
      // Fabrication guard: the printed text IS a store window, byte for byte.
      const row = windows.get(item.passage ?? "");
      if (row === undefined) {
        throw new Error(
          `printed 長文 window is not a store row: ${item.passage?.slice(0, 40)}`
        );
      }
      expect(item.passage).not.toBe(longReadingPassage);
      // And the 小問 line is the row's own question, not a generated prompt: a
      // real reading 小問 with no stem would print four nouns and nothing to
      // answer (the case `long-reading` was in until its store froze).
      expect(item.stem).toBe(row.stem);
      expect(item.stem).not.toMatch(LATIN_RE);
      expect(item.options).toHaveLength(4);
      for (const option of item.options) {
        expect(option).not.toMatch(LATIN_RE);
      }
      landedWindows.add(item.passage ?? "");
    }
    expect(landedWindows.size).toBe(landed.length);
    expect(assembled.refusedSections).not.toContain(
      "language-knowledge-reading"
    );
    // The block filled, so the receipt must not name it.
    expect(
      assembled.unfilledBlocks.some(
        (block) => block.name === "内容理解（長文）"
      )
    ).toBe(false);
  });
});

describe("a flat paper keeps the canned 長文 it always printed", () => {
  it("lands long-reading rows on LONG_READING_PASSAGE at N1 and N3, in both flat modes", async () => {
    // AC#6: the sourced picker is reached in real mode only. Both flat mixes that
    // still weight `long-reading` 20 — N3 `grammar-reading` and N1
    // `language-knowledge-reading` — draw their source from the grammar pool,
    // which carries no passage at all, so their 長文 keeps printing the canned
    // sentence rather than a 白書 window screened for the real blueprint.
    // N1 is the arm with teeth: it is the one level that HAS a 長文 store, so a
    // picker that ignored the mode would print a window here. The four cases are
    // independent papers, so they run concurrently rather than in an awaited loop.
    const flatCases = [
      { level: "N1", mode: "shortened", section: "language-knowledge-reading" },
      {
        level: "N1",
        mode: "exam-conditions",
        section: "language-knowledge-reading",
      },
      { level: "N3", mode: "shortened", section: "grammar-reading" },
      { level: "N3", mode: "exam-conditions", section: "grammar-reading" },
    ] as const;
    await Promise.all(
      flatCases.map(async ({ level, mode, section }) => {
        const requested = await client.exam.request({
          budget: { [section]: 100 },
          level,
          mode,
          sections: [section],
          seed: `choubun-flat-${level}-${mode}`,
        });
        const assembled = await client.exam.assemble({
          examId: requested.examId,
        });
        const state = await client.exam.get({ examId: requested.examId });
        expect(assembled.ready).toBe(true);
        const landed = state.items.filter(
          (entry) => entry.item.itemType === "long-reading"
        );
        expect(landed.length).toBeGreaterThan(0);
        for (const entry of landed) {
          expect(entry.item.passage).toBe(longReadingPassage);
        }
      })
    );
  });
});
