import { beforeAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExamSectionId } from "@manobu/api-contract";
import { PAPER_BLOCKS } from "@manobu/item-engine/paper";
import { __test__ as corpusTest } from "../src/services/exam-corpus";
import {
  connectExamClient,
  type ExamClient,
  fullBudget,
  prepareContentDb,
  requestAssembleRead,
} from "./exam-harness";

/*
 * A 大問 is unfilled for two different reasons and the receipt names BOTH: its
 * question kind does not exist in the item engine, or the kind exists but this
 * LEVEL has no store to ask it from (`packages/japanese/data/reading/{level}.json`,
 * `{level}-chuubun.json`, `{level}-chuushou.json`, `{level}-jouhou.json`,
 * `{level}-iikae.json`). Before this file the second
 * case was invisible: the 中文 大問 was empty at N4 (TASK-173.9.15 filled it with
 * the SECOND 中文 construction, a document stitched from licensed in-level
 * sentences, and TASK-173.9.19 replaced those rows with authored 中文, because no
 * 白書 paragraph is readable at N4), the 短文 大問 was empty
 * above N4 and N3 printed no reading at all (its 中文 store now ships,
 * TASK-173.9.3, and its 短文 store with TASK-173.9.11), and the receipt said none
 * of it, so the paper read as the learner having run the level dry.
 * `{level}-choubun.json` joins that
 * list with TASK-173.9.12, and it is the case where the kind and the store differ:
 * N1 and N3 share the 長文 kind, and they filled it differently until the last
 * level converted: authored comprehension rows at N3 since TASK-173.9.16, at N2
 * since TASK-173.9.20, and at N1 since TASK-173.9.21 replaced that level's masked
 * 白書 window (doc-27 §10, and the windowed proof stays exercised by a committed
 * fixture in `packages/japanese/test/check-reading-choubun.test.ts`).
 * `{level}-jouhou.json`
 * joins it at N2 and N1 with TASK-173.9.13. Since TASK-173.9.27 gave 言い換え類義
 * a question kind and a per-level store at N1/N2/N3, the first reason no longer
 * occurs anywhere in the 科目s this file requests: an over-large N2 paper and an
 * N1 one now name NO hole in 言語知識・読解 at all (表記 closed with TASK-173.9.25,
 * 語形成 with TASK-173.9.26, 用法 with TASK-173.9.23 and 文章の文法 with
 * TASK-173.9.24). TASK-179 then wrote the two legs below that line: 文章の文法 at
 * N4/N5 (the 流れ store, whose blank the N3 rows already trained) and, with
 * TASK-173.9.28, 言い換え類義 there too. So NO level names a hole on a full real
 * paper any more, which is why the shape claim on a named hole is now made behind
 * an overlay that stops one store existing: that is the only way left to make the
 * receipt print a hole at all.
 *
 * The line this file pins is that the receipt names the 大問 real mode cannot
 * ask, whether that is the engine's fault or the corpus's, and does NOT name the
 * 読解 大問 whose store does exist. It draws no distinction for the learner, but
 * it must not OVER-report either: a block real mode can fill is a filled block.
 */

const DB_URL = prepareContentDb("exam-reading-holes");

type Level = "N1" | "N2" | "N3" | "N4" | "N5";

/** N2/N1 print the merged 言語知識・読解 科目; the lower levels split 読解 off. */
const SECTIONS_BY_LEVEL: Readonly<Record<Level, readonly ExamSectionId[]>> = {
  N1: ["language-knowledge-reading"],
  N2: ["language-knowledge-reading"],
  N3: ["vocabulary", "grammar-reading"],
  N4: ["vocabulary", "grammar-reading"],
  N5: ["vocabulary", "grammar-reading"],
};

let client: ExamClient;

beforeAll(async () => {
  client = await connectExamClient(DB_URL);
});

/**
 * A real paper big enough to reach every 大問 of the level's reading section.
 * The ask is over-large on purpose and clamped to the official shape at parse
 * time, which is what makes every 大問 of the section `requested > 0` and so
 * eligible to be reported as a hole.
 */
const realPaper = async (level: Level, seed: string) => {
  const sections = SECTIONS_BY_LEVEL[level];
  const { assembled, state } = await requestAssembleRead(client, {
    budget: fullBudget(sections),
    level,
    mode: "real",
    sections: [...sections],
    seed,
  });
  const holes = new Set(
    assembled.unfilledBlocks.map(
      (block) =>
        `${block.section}:大問${String(block.bigQuestion)}:${block.name}`
    )
  );
  return { assembled, holes, state };
};

const itemTypesOf = (
  state: Awaited<ReturnType<typeof realPaper>>["state"]
): string[] => state.items.map((entry) => entry.item.itemType);

/** The 読解 大問 names, which is what this file's claims are about. A SECTION is
 * not the filter: `grammar-reading` also carries 文章の文法, and
 * `language-knowledge-reading` carries 表記, 語形成, 言い換え類義, 用法 and
 * 文章の文法 at N1-N2, all of which have
 * stores there: 表記 (TASK-173.9.25), 語形成 (TASK-173.9.26), 用法 (TASK-173.9.23),
 * 文章の文法 (TASK-173.9.24, and at N4/N5 since TASK-179) and 言い換え類義
 * (TASK-173.9.27, and at N4/N5 from the whole-SENTENCE paraphrase store of
 * TASK-173.9.28). None of them is a 読解 block, so filtering on the section alone
 * would let a 言語知識 hole into the reading claims below. */
const READING_BLOCK_NAMES = new Set([
  "内容理解（中文）",
  "内容理解（短文）",
  "内容理解（長文）",
  "主張理解（長文）",
  "統合理解",
  "情報検索",
]);

/** The 読解 大問 names. A SECTION is not the filter, because 聴解 大問5 at N2/N1
 * is also called 統合理解: the section is what separates the reading block from
 * the listening one that borrowed its name. */
const READING_SECTION_IDS = new Set([
  "grammar-reading",
  "language-knowledge-reading",
]);

const readingHolesOf = (holes: ReadonlySet<string>): string[] =>
  [...holes].filter(
    (hole) =>
      READING_SECTION_IDS.has(hole.slice(0, hole.indexOf(":"))) &&
      READING_BLOCK_NAMES.has(hole.slice(hole.lastIndexOf(":") + 1))
  );

describe("a 読解 大問 with no store for its level is named as a hole", () => {
  it("fills N4's 中文 大問 from the composed store, naming it no hole", async () => {
    const { holes, state } = await realPaper("N4", "reading-holes-N4");
    // TASK-173.9.19 changed this level's answer. 大問5 was filled by the stitched
    // document of TASK-173.9.15 and now ships authored 中文 rows, so the store is
    // non-empty either way: naming the block a hole would be the old bug.
    expect(holes.has("grammar-reading:大問5:内容理解（中文）")).toBe(false);
    // ...and it is filled with the item type the block actually asks for.
    expect(itemTypesOf(state)).toContain("medium-reading");
    // The 短文 大問 above it DOES have a store (authored at N4), so
    // over-reporting there would be the same bug in reverse.
    expect(holes.has("grammar-reading:大問4:内容理解（短文）")).toBe(false);
    expect(itemTypesOf(state)).toContain("short-reading");
    // TASK-173.9.19: 大問6 fills from the authored 書き下ろし 素材 rather than from
    // the N5 notices that used to be stamped for this level, so it is named neither
    // as a hole nor left silently absent.
    expect(holes.has("grammar-reading:大問6:情報検索")).toBe(false);
    expect(itemTypesOf(state)).toContain("info-search");
  });

  it("fills N5's 中文 大問 from the licensed store, not naming it", async () => {
    const { holes, state } = await realPaper("N5", "reading-holes-N5");
    // A licensed 中文 store ships at N5 (a slice of the JLPTSuccess 中長文
    // papers), so 大問5 fills and must NOT be named.
    expect(holes.has("grammar-reading:大問5:内容理解（中文）")).toBe(false);
    expect(itemTypesOf(state)).toContain("medium-reading");
    // Its 短文 大問 fills from the licensed N5 短文 store as before.
    expect(holes.has("grammar-reading:大問4:内容理解（短文）")).toBe(false);
    expect(itemTypesOf(state)).toContain("short-reading");
    // TASK-173.9.7: 大問6 情報検索 fills from the licensed N5 notice store.
    expect(holes.has("grammar-reading:大問6:情報検索")).toBe(false);
    expect(itemTypesOf(state)).toContain("info-search");
  });

  it("names no N3 読解 大問 at all: 短文, 中文, 長文 and 情報検索 all fill", async () => {
    const { assembled, holes, state } = await realPaper(
      "N3",
      "reading-holes-N3"
    );
    // TASK-173.9.11: a composed 短文 store ships at N3, so 大問4 fills and is
    // NOT named - naming a block real mode can ask is the over-report this file
    // exists to catch.
    expect(holes.has("grammar-reading:大問4:内容理解（短文）")).toBe(false);
    expect(itemTypesOf(state)).toContain("short-reading");
    // 中文 (5) has a composed store, so it fills and must NOT be named.
    expect(holes.has("grammar-reading:大問5:内容理解（中文）")).toBe(false);
    expect(itemTypesOf(state)).toContain("medium-reading");
    // TASK-173.9.16: 長文 (6) fills from the authored N3 store, so the block this
    // test named for two rounds is no longer a hole. The route changed rather
    // than the standard: the 白書 supply never reached the N3 長文 register
    // (doc-27 §4), so doc-27 §10 writes the prose instead of loosening the floor.
    expect(holes.has("grammar-reading:大問6:内容理解（長文）")).toBe(false);
    expect(itemTypesOf(state)).toContain("long-reading");
    // TASK-173.9.3 stamps the licensed notice set down to N3, so 情報検索 (7)
    // fills from those rows and is no longer a hole.
    expect(holes.has("grammar-reading:大問7:情報検索")).toBe(false);
    expect(itemTypesOf(state)).toContain("info-search");
    // Every 読解 大問 N3's paper declares now has a store behind it, so the
    // two asked 科目 band on their own: since TASK-173.9.29 widened the 読解
    // band to the types the real 大問 actually place, the 読解 floor is met and
    // the paper is READY, not merely hole-free. This assertion was false under
    // the old two-type band, which dropped the placed 短/中/長文 and 情報検索
    // 小問 and so could never clear its own floor.
    expect(readingHolesOf(holes)).toEqual([]);
    expect(assembled.ready).toBe(true);
    // No section is refused: 読解 fills from its stores and 用法 from its
    // validated store (TASK-173.9.23.1). A refusal here would mean a content
    // bug, not a content gap.
    expect(assembled.refusedSections ?? []).toEqual([]);
    // The 用法 大問 now lands: N3's 11 validated rows fill the blueprint's 5
    // slots (usage carries weight 5 in the N3 vocabulary flat mix).
    expect(itemTypesOf(state)).toContain("usage");
  });

  it("names no N2 読解 大問 that has a store: 短文, 中文, 統合理解, 主張理解, 情報検索", async () => {
    const { assembled, holes, state } = await realPaper(
      "N2",
      "reading-holes-N2"
    );
    // TASK-173.9.20: 5 小問 per paper come out of a 20-row authored store.
    expect(
      holes.has("language-knowledge-reading:大問10:内容理解（短文）")
    ).toBe(false);
    // 20 authored 短文 rows, 36 authored 中文 rows, 12 authored 主張理解 rows, 8
    // authored 統合理解 pairs and 8 sourced-table 情報検索 rows exist, so all five
    // 大問 fill and must not be named as holes.
    expect(
      holes.has("language-knowledge-reading:大問11:内容理解（中文）")
    ).toBe(false);
    expect(
      holes.has("language-knowledge-reading:大問13:主張理解（長文）")
    ).toBe(false);
    expect(holes.has("language-knowledge-reading:大問12:統合理解")).toBe(false);
    const types = itemTypesOf(state);
    expect(types).toContain("short-reading");
    expect(types).toContain("medium-reading");
    expect(types).toContain("claim-understanding");
    // TASK-173.9.3: 統合理解 now has a sourced question kind, so an N2 paper
    // prints it rather than turning the 大問 into a receipt line.
    expect(types).toContain("text-comparison");
    // TASK-173.9.13 put six rows over three PDL1.0 government 情報素材 behind
    // 大問14 and TASK-173.9.20 grew that to eight, so this block no longer depends
    // on the licensed N5/N4/N3 notices that TASK-173.9.7 shipped and
    // `data/LICENSE.md` §11 refuses to extend by stamp.
    expect(holes.has("language-knowledge-reading:大問14:情報検索")).toBe(false);
    expect(types).toContain("info-search");
    // The whole 読解 half of the merged 科目 is sourceable, and since
    // TASK-173.9.27 the 言語知識 half is too: 表記 (TASK-173.9.25), 語形成
    // (TASK-173.9.26), 用法 (TASK-173.9.23), 文章の文法 (TASK-173.9.24) and now
    // 言い換え類義 all have N2 stores, so an over-large N2 paper names no hole in
    // this 科目 at all.
    expect(assembled.unfilledBlocks).toEqual([]);
  });

  it("names no N1 読解 大問 that has a store: 短文, 中文, 長文, 統合理解, 主張理解, 情報検索", async () => {
    const { assembled, holes, state } = await realPaper(
      "N1",
      "reading-holes-N1"
    );
    // TASK-173.9.11 opened 大問8 with a composed masked-slot store; TASK-173.9.21
    // authored it, so every level's 短文 now asks comprehension (N3/N4/N2 went
    // first, TASK-173.9.18/.19/.20).
    expect(holes.has("language-knowledge-reading:大問8:内容理解（短文）")).toBe(
      false
    );
    // TASK-173.9.12 closed 大問10 with a composed 白書 WINDOW store;
    // TASK-173.9.21 replaced those rows with authored comprehension documents.
    // Naming a block real mode can ask is the over-report this file exists to
    // catch, so this assertion is the one that flipped when the store froze: the
    // hole was the store's absence, not the missing question kind.
    expect(
      holes.has("language-knowledge-reading:大問10:内容理解（長文）")
    ).toBe(false);
    expect(itemTypesOf(state)).toContain("long-reading");
    expect(holes.has("language-knowledge-reading:大問9:内容理解（中文）")).toBe(
      false
    );
    expect(
      holes.has("language-knowledge-reading:大問12:主張理解（長文）")
    ).toBe(false);
    // TASK-173.9.3 opened 大問11 with 7 sourced 白書 pairs for its 3 小問;
    // TASK-173.9.21 authored the pair store, so the relation is written rather
    // than looked up.
    expect(holes.has("language-knowledge-reading:大問11:統合理解")).toBe(false);
    const types = itemTypesOf(state);
    expect(types).toContain("short-reading");
    expect(types).toContain("medium-reading");
    expect(types).toContain("claim-understanding");
    expect(types).toContain("text-comparison");
    // TASK-173.9.13: the same sourced-table store backs 大問13 at N1, so the last
    // 読解 大問 hole at this level closes and the paper no longer names it.
    expect(holes.has("language-knowledge-reading:大問13:情報検索")).toBe(false);
    expect(types).toContain("info-search");
    // Same at N1: 大問8 through 大問13 all have a store, and 大問3 言い換え類義
    // joined them with TASK-173.9.27 (用法 and 文章の文法 closed with TASK-173.9.23
    // and TASK-173.9.24), so this level names no hole in the 科目 either.
    expect(assembled.unfilledBlocks).toEqual([]);
  });
});

describe("no 読解 大問 is a hole at any level", () => {
  /*
   * TASK-173.9.16 closed the last store this needed: with N3's authored 長文
   * file in place, every 読解 大問 that N5 through N1 declares has rows behind
   * it, and the receipt names 聴解 and 言語知識 blocks only. The claim is narrow
   * on purpose. It says a 読解 大問 CAN be asked; it does not say what it asks is
   * the exam's own ねらい, which is the separate claim
   * `REAL_NERAI_LEVELS` below makes, level by level, N1 included since
   * TASK-173.9.21 (TASK-146).
   */
  for (const level of ["N5", "N4", "N3", "N2", "N1"] as const) {
    it(`names no 読解 block at ${level}`, async () => {
      const { holes } = await realPaper(level, `reading-complete-${level}`);
      expect(readingHolesOf(holes)).toEqual([]);
    });
  }
});

/*
 * The store-sized-but-too-small boundary cannot be reached by DRAINING the
 * shipped corpus: a paper that comes up short is not one a learner can run
 * (`exam.start` answers NOT_READY), so no anchors are ever spent and nothing on
 * the test side thins a store. It is reached by SUBSTITUTING a store instead: the
 * scratch data root below overrides one reading file and symlinks the rest, so a
 * real N1 paper can be assembled against a 中文 store of any size (TASK-173.4.1).
 * Since TASK-179 wrote the last store a level was missing, that overlay is also
 * the only way left to make the receipt name a hole at all.
 */

const DATA_DIR = join(import.meta.dir, "../../../packages/japanese/data");
const N1_CHUUBUN = join(DATA_DIR, "reading", "n1-chuubun.json");
const N1_MEDIUM_HOLE = "language-knowledge-reading:大問9:内容理解（中文）";

/**
 * A scratch data root that overrides ONE reading store. Everything else is
 * symlinked, so the 154 MB tree is never copied and the vocab/grammar corpora
 * stay the real ones; the overridden filename is deliberately NOT linked, so
 * writing the overlay can never touch the shipped store.
 */
const scratchDataRoot = (rows: string | null): string => {
  const scratch = mkdtempSync(join(tmpdir(), "manobu-reading-holes-"));
  const root = join(scratch, "data");
  const reading = join(root, "reading");
  mkdirSync(reading, { recursive: true });
  for (const entry of readdirSync(DATA_DIR)) {
    if (entry !== "reading") {
      symlinkSync(join(DATA_DIR, entry), join(root, entry));
    }
  }
  for (const entry of readdirSync(join(DATA_DIR, "reading"))) {
    if (entry !== "n1-chuubun.json") {
      symlinkSync(join(DATA_DIR, "reading", entry), join(reading, entry));
    }
  }
  if (rows !== null) {
    writeFileSync(join(reading, "n1-chuubun.json"), rows);
  }
  return scratch;
};

/** One real N1 paper assembled against a 中文 store of the caller's size. */
const paperWithChuubunRows = async (rows: string | null) => {
  const scratch = scratchDataRoot(rows);
  process.env.MANOBU_DATA_DIR = join(scratch, "data");
  corpusTest.resetCorpusCache();
  try {
    return await realPaper(
      "N1",
      `reading-holes-store-${String(rows?.length ?? 0)}`
    );
  } finally {
    delete process.env.MANOBU_DATA_DIR;
    corpusTest.resetCorpusCache();
    rmSync(scratch, { force: true, recursive: true });
  }
};

describe("a store too small to fill its 大問 is a shortfall, not a hole", () => {
  it("keeps the 中文 大問 sourceable when the store holds too few rows", async () => {
    // The shipped N1 store holds 36 authored rows against a 9-小問 大問, so it
    // never shows this boundary. One row does: the block still has a SOURCE, which
    // is what `hasSource` asks, so it must stay out of `unfilledBlocks` and come up
    // short instead - TASK-148's diagnosis, a different fact from a part of the
    // paper nothing can ask.
    const shipped = JSON.parse(readFileSync(N1_CHUUBUN, "utf8")) as unknown[];
    const one = await paperWithChuubunRows(JSON.stringify(shipped.slice(0, 1)));
    expect(one.holes.has(N1_MEDIUM_HOLE)).toBe(false);
    expect(one.assembled.shortfall).toBeGreaterThan(0);
    // Non-vacuity, both ways: the one row it has is served, and the 主張理解 大問
    // two numbers above it is untouched by the overlay, so the scratch root is a
    // working data root rather than a broken one nothing could read.
    expect(
      itemTypesOf(one.state).filter((t) => t === "medium-reading")
    ).toHaveLength(1);
    expect(
      one.holes.has("language-knowledge-reading:大問12:主張理解（長文）")
    ).toBe(false);

    // An EMPTY store and a MISSING file are both absence, and both are named: the
    // rule keys on whether a source exists, not on how big it is.
    const empty = await paperWithChuubunRows("[]");
    expect(empty.holes.has(N1_MEDIUM_HOLE)).toBe(true);
    expect(itemTypesOf(empty.state)).not.toContain("medium-reading");
    const missing = await paperWithChuubunRows(null);
    expect(missing.holes.has(N1_MEDIUM_HOLE)).toBe(true);
  });
});

describe("every named hole is a 大問 nothing could ask", () => {
  it("carries a whole 大問 number, an official name and a positive count", async () => {
    // No level names a hole on a full real paper any more: 文章の文法 closed at
    // N4/N5 with TASK-179 and 言い換え類義 there with TASK-173.9.28, which leaves
    // the store substitution above as the way to make the receipt print one. An
    // empty 中文 store takes away exactly one 大問's supply from an N1 paper.
    const { assembled, holes } = await paperWithChuubunRows("[]");
    expect(assembled.unfilledBlocks.length).toBeGreaterThan(0);
    for (const block of assembled.unfilledBlocks) {
      expect(Number.isInteger(block.bigQuestion)).toBe(true);
      expect(block.bigQuestion).toBeGreaterThan(0);
      expect(block.name.length).toBeGreaterThan(0);
      expect(block.requestedItems).toBeGreaterThan(0);
    }
    // Non-vacuity: a second name here would be a 大問 the shipped corpus cannot
    // ask, and after TASK-179 there is no such thing to report.
    expect([...holes]).toEqual([N1_MEDIUM_HOLE]);
  });
});

/*
 * TASK-173.9.18 AC#7 (N3) and TASK-173.9.19 AC#7 (N4). A filled 大問 is not
 * automatically a 読解 大問: until those tasks N3 大問4 and 大問5 and N4's two
 * comprehension 大問 blanked one noun out of a licensed paragraph, which trains
 * vocabulary-in-context under a comprehension heading, and N3's and N4's 大問7 /
 * 大問6 were the N5 notice table re-stamped upward. The store existing was true
 * and the block training its ねらい was not, so the holes assertions alone could
 * not tell the difference. This is the other half: every 読解 大問 the BLUEPRINT
 * prints at a converted level is backed by rows that ask comprehension, and none
 * of them is a cloze.
 *
 * The block list is not written here. `PAPER_BLOCKS[level]` says which 大問 the
 * level prints, and each store row declares the block it belongs to, so a 大問
 * whose store stopped naming it fails the coverage check instead of quietly
 * dropping out of the assertion. The 長文 block is deliberately absent at N4,
 * whose blueprint has no 内容理解（長文）大問 (doc-26 §3.2).
 */

/** One store row, read off the shipped JSON: `construction` and `block` are the
 * two fields this claim needs, and neither is on the server's entry type because
 * serving does not read them. */
interface StoreRowShape {
  readonly block?: string;
  readonly construction?: string;
  readonly level?: string;
  readonly provenance?: string;
  readonly validated?: boolean;
}

/** The constructions that test which word was removed, which noun two documents
 * happen to share, or which slot a stitched list left open, rather than what the
 * passage means: the 白書 cloze, the stitched document with one noun blanked, and
 * the shared-topic lookup. doc-27 §10 refuses to keep serving any of them under a
 * comprehension heading. */
const CLOZE_CONSTRUCTIONS = new Set([
  "masked-slot",
  "stitched-in-level",
  "shared-topic-pair",
]);

/** Every reading store one level ships: `{level}.json` plus
 * `{level}-{block}.json`, with the judge records left out because they hold
 * ids, not rows. */
const readingRowsForLevel = (level: ReadingNeraiLevel): StoreRowShape[] => {
  const rows: StoreRowShape[] = [];
  const prefix = level.toLowerCase();
  for (const entry of readdirSync(join(DATA_DIR, "reading"))) {
    if (
      !entry.endsWith(".json") ||
      entry.endsWith("-rejected.json") ||
      !(entry === `${prefix}.json` || entry.startsWith(`${prefix}-`))
    ) {
      continue;
    }
    const parsed = JSON.parse(
      readFileSync(join(DATA_DIR, "reading", entry), "utf8")
    ) as unknown;
    if (!Array.isArray(parsed)) {
      continue;
    }
    rows.push(...(parsed as StoreRowShape[]));
  }
  return rows;
};

/** Every level this file claims a converted 読解 route for. N1 joined with
 * TASK-173.9.21, which is the conversion that empties `CLOZE_CONSTRUCTIONS` at
 * the top of the shelf rather than only at N2-N4. N5 joined with
 * TASK-173.9.22, which verified the bottom of the shelf rather than converting
 * it: its three 大問 are the licensed paper-7 set, already real comprehension. */
type ReadingNeraiLevel = "N1" | "N2" | "N3" | "N4" | "N5";

/** The levels whose 読解 stores train the blueprint's ねらい, with how many 読解
 * 大問 each blueprint prints. Adding a level here is what makes its
 * conversion reviewed: the count is asserted, so a level listed with the wrong
 * number of 大問 fails instead of checking fewer claims than it thinks. */
const REAL_NERAI_LEVELS: ReadonlyArray<{
  readonly count: number;
  readonly level: ReadingNeraiLevel;
}> = [
  // N1: 短文, 中文, 長文, 統合理解, 主張理解（長文）, 情報検索 (TASK-173.9.21).
  { count: 6, level: "N1" },
  // N2: 短文, 中文, 統合理解, 主張理解（長文）, 情報検索 (TASK-173.9.20).
  { count: 5, level: "N2" },
  // N3: 短文, 中文, 長文, 情報検索.
  { count: 4, level: "N3" },
  // N4: 短文, 中文, 情報検索. No 長文 大問 exists at this level.
  { count: 3, level: "N4" },
  // N5: 短文, 中文, 情報検索. No 長文 or 統合 大問 exists at this level, and none
  // of the three was ever converted: they shipped licensed (paper-7, CC BY-SA 4.0)
  // from the start and TASK-173.9.22 verified them against this loop rather than
  // re-routing them.
  { count: 3, level: "N5" },
];

for (const { count, level } of REAL_NERAI_LEVELS) {
  describe(`every ${level} 読解 block is backed by a real-ねらい store`, () => {
    const readingBlocks = PAPER_BLOCKS[level].filter(
      (block) =>
        READING_BLOCK_NAMES.has(block.name) &&
        READING_SECTION_IDS.has(block.sectionId)
    );

    it(`backs the ${count} 大問 the blueprint prints with rows that ask comprehension`, () => {
      // Non-vacuity first: the blueprint really does print this many 読解 大問, so
      // the loop below has that many claims to make rather than none.
      expect(readingBlocks).toHaveLength(count);
      const rows = readingRowsForLevel(level);
      expect(rows.length).toBeGreaterThan(0);
      for (const block of readingBlocks) {
        const ofBlock = rows.filter((row) => row.block === block.id);
        // Backed: the 大問 the blueprint prints has rows that declare it.
        expect(ofBlock.length).toBeGreaterThan(0);
        // Depth, read off the blueprint rather than from a count written here:
        // four papers' worth of the 小問 this 大問 actually prints. The owner
        // rule of 2026-10-09 counts a level as finished only when the block has
        // depth, so a store that just barely fills one 大問 fails.
        expect(ofBlock.length).toBeGreaterThanOrEqual(
          block.indicativeCount * 4
        );
        // Row identity: every row names the level whose file it lives in, so a
        // block cannot be filled by borrowing another level's store.
        for (const row of ofBlock) {
          expect(row.level).toBe(level);
          // Neither a cloze nor a shared-topic lookup: the block trains the
          // comprehension its ねらい names (doc-27 §10).
          expect(CLOZE_CONSTRUCTIONS.has(row.construction ?? "")).toBe(false);
          // A composed row reaches a real paper only behind the freeze; a licensed
          // row carries no flag because it was vendored whole.
          if (row.provenance === "composed") {
            expect(row.validated).toBe(true);
          }
        }
      }
    });

    it(`prints no cloze blank in a 読解 passage on a real ${level} paper`, async () => {
      // The learner-facing face of the same rule, read off the served paper rather
      // than the file: a masked-slot row is exactly a passage that hides its answer
      // behind ＿＿, so a blank anywhere in a served 読解 passage means a cloze row
      // was stamped onto an authored route.
      const { state } = await realPaper(
        level,
        `reading-holes-no-cloze-${level.toLowerCase()}`
      );
      const itemTypes = new Set(
        readingBlocks.flatMap((block) => block.itemTypes)
      );
      const landed = state.items.filter((entry) =>
        itemTypes.has(entry.item.itemType)
      );
      expect(landed.length).toBeGreaterThan(0);
      for (const entry of landed) {
        const { item } = entry;
        // The item view is a union over item types and a 聴解 item carries a
        // `script` rather than a `passage`, so the read is narrowed with `in`
        // rather than cast.
        const { passage } = "passage" in item ? item : { passage: null };
        expect(passage ?? "").not.toContain("＿＿");
      }
    });
  });
}
