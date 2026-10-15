/**
 * `gen:reading-choubun` pins the 長文 screens with real data assertions, over
 * fixtures the SAME functions the shipped rows came from — not source-text reads
 * (TASK-134). The two things that make a 長文 row a 長文 rather than a 中文 that
 * happens to be long both live in `choubunWindowsFor`, so that builder is tested
 * directly: 2 to 5 paragraphs, one page, adjacency strict (a short paragraph
 * BREAKS the run rather than being skipped), the 900-1200 band, and the
 * all-store exclusion. Then the row half: this block's own 0.85 coverage floor
 * (which is BELOW N1's 0.9 `COVERAGE_FLOOR`, doc-27 §1), the byte-exact blank,
 * the 一つ stem-leak, determinism, one row per answer word, and no two rows of
 * one batch sharing a paragraph.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChoubunBatch,
  buildChoubunEntry,
} from "../scripts/gen-reading-choubun";
import {
  CHOUBUN_BLOCK,
  CHOUBUN_COVERAGE_FLOOR,
  CHOUBUN_MAX_PARAGRAPHS,
  CHOUBUN_MAX_PASSAGE_LENGTH,
  CHOUBUN_MIN_PARAGRAPH_RUNES,
  CHOUBUN_MIN_PASSAGE_LENGTH,
  CHOUBUN_SIGNER,
  CHOUBUN_STEM,
  type ChoubunWindow,
  choubunIdFor,
  choubunSpentSourceIds,
  choubunWindowsFor,
  readChoubunRejections,
} from "../scripts/reading-choubun-corpus";
import {
  COVERAGE_FLOOR,
  coverageOf,
  type HakushoParagraph,
  LEVEL_RANKS,
} from "../scripts/reading-chuubun-corpus";
import { buildVocabIndex } from "../scripts/reading-n4-corpus";
import { INDEX, VOCAB } from "./reading-noun-vocab";

/** The 49-rune filler sentence, the same prose the 短文 fixture is built on. */
const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。";

/** Twenty-two kanji with no entry in this fixture's index: every one of them is
 * an uncovered rune, so eight copies put a window under the 0.85 floor. None of
 * them spells a distractor (風, 手紙, 道具) or the answer. */
const KANJI = "継続的発展推進検討会構成員選出方法改善措置実施";

/** Two paragraphs that join inside the band: what a real 長文 window is. */
const P1 = FILLER.repeat(10);
const P2 = `${FILLER.repeat(9)}電車が降る。`;
/** The batch's second answer. A slot needs two runes AND a content word in its
 * collocation frame, so this fixture pairs 道具 with 降る, the only verb in the
 * shared index (風, 雨 and 雪 are one rune). */
const TOOL = `${FILLER.repeat(9)}道具が降る。`;

const paragraph = (id: string, text: string): HakushoParagraph => ({
  id,
  license: "PDL-1.0",
  pageId: "t",
  pageUrl: "https://example.test/",
  source: "credit",
  text,
  title: "t",
});

const windowOf = (
  ids: readonly string[],
  texts: readonly string[]
): ChoubunWindow => {
  const text = texts.join("\n");
  return {
    ids,
    pageId: "t",
    pageUrl: "https://example.test/",
    runes: [...text].length,
    sourceCredit: "credit",
    text,
  };
};

const ADMISSIBLE = windowOf(["t-1", "t-2"], [P1, P2]);
// These two records are `Record<string, number>`, so every reader in this
// package takes a variable key plus a fallback: tsc's noUncheckedIndexedAccess
// demands the fallback and biome's useLiteralKeys forbids the shorthand that
// would satisfy it.
const LEVEL: string = "N1";
const N1_RANK = LEVEL_RANKS[LEVEL] ?? 0;
const N1_COVERAGE_FLOOR = COVERAGE_FLOOR[LEVEL] ?? 1;

const build = (window: ChoubunWindow) =>
  buildChoubunEntry(window, "N1", INDEX, new Map());

const windowsOf = (paragraphs: readonly HakushoParagraph[]) =>
  choubunWindowsFor({ paragraphs, spent: new Set() });

const batchFor = (
  paragraphs: readonly HakushoParagraph[],
  count: number,
  rejections: ReadonlySet<string> = new Set()
) =>
  buildChoubunBatch({
    count,
    fillers: new Map(),
    index: INDEX,
    level: "N1",
    paragraphs,
    rejections,
    spent: new Set(),
  });

/** Four paragraphs, two answers: the walk admits overlapping windows, so this
 * fixture exercises the spend and the distinct-answer rules at once. */
const FOUR = [
  paragraph("t-1", P1),
  paragraph("t-2", P2),
  paragraph("t-3", P1),
  paragraph("t-4", TOOL),
];

describe("choubunWindowsFor: the window contract", () => {
  it("admits two consecutive prose paragraphs that join inside the band", () => {
    const windows = windowsOf([paragraph("t-1", P1), paragraph("t-2", P2)]);
    expect(windows).toHaveLength(1);
    const found = windows[0] as ChoubunWindow;
    expect(found.ids).toEqual(["t-1", "t-2"]);
    expect(found.text).toBe(`${P1}\n${P2}`);
    expect(found.runes).toBeGreaterThanOrEqual(CHOUBUN_MIN_PASSAGE_LENGTH);
    expect(found.runes).toBeLessThanOrEqual(CHOUBUN_MAX_PASSAGE_LENGTH);
  });

  it("refuses a single paragraph, however long, because that is a 中文", () => {
    expect(windowsOf([paragraph("t-1", `${P1}${P2}`)])).toEqual([]);
  });

  it("breaks the run at a heading rather than skipping it", () => {
    // 10-1 and 10-3 are prose, 10-2 is a 22-rune column title. A collage of the
    // two paragraphs that happened to measure well is not a 長文.
    expect(
      windowsOf([
        paragraph("v-10-1", P1),
        paragraph("v-10-2", "コラム：地球温暖化が進行した将来の台風の姿"),
        paragraph("v-10-3", P2),
      ])
    ).toEqual([]);
    expect([...P1].length).toBeGreaterThanOrEqual(CHOUBUN_MIN_PARAGRAPH_RUNES);
  });

  it("never crosses a page boundary", () => {
    expect(
      choubunWindowsFor({
        paragraphs: [
          paragraph("a-1", P1),
          { ...paragraph("b-2", P2), pageId: "b" },
        ],
        spent: new Set(),
      })
    ).toEqual([]);
  });

  it("refuses a window that overshoots the server's long-reading budget", () => {
    // Two 735-rune paragraphs join to 1471: above `CHOUBUN_MAX_PASSAGE_LENGTH`,
    // so the start yields nothing rather than a truncated text.
    const long = FILLER.repeat(15);
    expect(windowsOf([paragraph("t-1", long), paragraph("t-2", long)])).toEqual(
      []
    );
  });

  it("caps a window at the paragraph maximum", () => {
    const small = FILLER.repeat(4);
    const windows = windowsOf(
      [1, 2, 3, 4, 5, 6].map((position) =>
        paragraph(`w-${String(position)}`, small)
      )
    );
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      expect(window.ids.length).toBeLessThanOrEqual(CHOUBUN_MAX_PARAGRAPHS);
    }
  });

  it("refuses every paragraph another store already spends", () => {
    expect(
      choubunWindowsFor({
        paragraphs: [paragraph("t-1", P1), paragraph("t-2", P2)],
        spent: new Set(["t-2"]),
      })
    ).toEqual([]);
  });

  it("orders by the page paragraph number, not the file order", () => {
    // `fetch-hakusho.ts` numbers paragraphs per page, so the trailing `-n` is
    // the document position: an out-of-file-order pair must still join 1 then 2.
    expect(
      windowsOf([paragraph("x-2", P2), paragraph("x-1", P1)])[0]?.ids
    ).toEqual(["x-1", "x-2"]);
  });
});

describe("buildChoubunEntry: this block's own coverage floor", () => {
  it("screens 長文 looser than the 中文 floor at N1", () => {
    expect(CHOUBUN_COVERAGE_FLOOR).toBeLessThan(N1_COVERAGE_FLOOR);
    // And the fixture window clears BOTH bars, so a green row here proves the
    // divergence is the screen, not an easy passage.
    expect(coverageOf(ADMISSIBLE.text, INDEX, N1_RANK)).toBeGreaterThanOrEqual(
      N1_COVERAGE_FLOOR
    );
  });

  it("refuses a window under its own floor", () => {
    const hard = windowOf(
      ["h-1", "h-2"],
      [
        `${P1}${KANJI.repeat(4)}`,
        `${FILLER.repeat(5)}${KANJI.repeat(4)}電車が降る。`,
      ]
    );
    expect(coverageOf(hard.text, INDEX, N1_RANK)).toBeLessThan(
      CHOUBUN_COVERAGE_FLOOR
    );
    expect(build(hard)).toBeNull();
  });

  it("keeps the floor of every OTHER 大問 where it was", () => {
    // The claim is that THIS block's looser bar never enters the shared table.
    // `N4: 0.8` belongs there because the 中文 stitch needed an N4 entry at the
    // 中文 floor (TASK-173.9.15), not because a 長文 floor leaked into it: the
    // 長文 screen lives only in `CHOUBUN_COVERAGE_FLOOR`, asserted above.
    expect(COVERAGE_FLOOR).toEqual({ N1: 0.9, N2: 0.8, N3: 0.8, N4: 0.8 });
  });
});

describe("buildChoubunEntry: the masked-slot construction", () => {
  it("blanks the kanji noun once and carries the window's own ids", () => {
    const entry = build(ADMISSIBLE);
    if (entry === null) {
      throw new Error("fixture must produce a 長文 row");
    }
    expect(entry.options[entry.answerIndex]).toBe("電車");
    expect(entry.passage.split("＿＿")).toHaveLength(2);
    expect(entry.passage).not.toContain("電車");
    expect(entry.options).toHaveLength(4);
    expect(entry.block).toBe(CHOUBUN_BLOCK);
    expect(entry.stem).toBe(CHOUBUN_STEM);
    expect(entry.level).toBe("N1");
    expect(entry.provenance).toBe("composed");
    expect(entry.validated).toBe(true);
    expect(entry.validatedBy).toBe(CHOUBUN_SIGNER);
    expect(entry.construction).toBe("masked-slot");
    // A window is identified by where it starts, exactly as 中文's `n1c-`.
    expect(entry.sourceIds).toEqual(["t-1", "t-2"]);
    expect(entry.id).toBe(choubunIdFor("N1", "t-1"));
    // The window prints one line per source paragraph.
    expect(entry.passage.split("\n")).toHaveLength(2);
  });

  it("skips a slot the fixed stem itself prints (the 一つ stem-leak)", () => {
    expect(CHOUBUN_STEM.includes("一つ")).toBe(true);
    const stemIndex = buildVocabIndex([
      ...VOCAB,
      {
        level: "N5",
        partOfSpeech: "noun",
        reading: "ひとつ",
        senses: [["one"]],
        word: "一つ",
      },
    ]);
    // 手紙 and 電車 each print twice, so `slotsFor` drops them and 一つ is the
    // only slot left: without the skip the row would print its own answer inside
    // the question.
    expect(
      buildChoubunEntry(
        windowOf(
          ["u-1", "u-2"],
          [
            `${FILLER.repeat(5)}手紙は一つ。${P1}`,
            `${FILLER.repeat(4)}手紙が届く。電車が降る。電車が走る。`,
          ]
        ),
        "N1",
        stemIndex,
        new Map()
      )
    ).toBeNull();
  });

  it("is deterministic: the same window yields byte-identical rows", () => {
    const first = build(ADMISSIBLE);
    expect(first).not.toBeNull();
    expect(JSON.stringify(first)).toBe(JSON.stringify(build(ADMISSIBLE)));
  });
});

describe("buildChoubunBatch: one 大問 of distinct windows", () => {
  it("keeps a batch to distinct answer words", () => {
    const batch = batchFor(FOUR, 4);
    const answers = batch.map((entry) => entry.options[entry.answerIndex]);
    // Asserted before the set check so a batch that came back empty cannot pass
    // a variety check by being empty.
    expect(answers).toEqual(["電車", "道具"]);
    expect(new Set(answers).size).toBe(answers.length);
  });

  it("spends each paragraph once, so one 大問 never prints one text twice", () => {
    const batch = batchFor(
      [paragraph("t-1", P1), paragraph("t-2", P2), paragraph("t-3", P2)],
      3
    );
    // The second admissible window re-uses t-2, so it is skipped.
    expect(batch).toHaveLength(1);
    const sources = batch.flatMap((entry) => entry.sourceIds);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("skips a row the blind judge rejected and walks deeper instead", () => {
    // The same rule the 中文 and 短文 freezes run: a rejected id drops out and
    // the walk moves to the next admissible window, it does not shrink the store.
    const frozen = batchFor(FOUR, 4);
    expect(frozen.map((entry) => entry.id)).toEqual(["n1b-t-1", "n1b-t-3"]);
    const next = batchFor(FOUR, 4, new Set(["n1b-t-1"]));
    expect(next.map((entry) => entry.id)).not.toContain("n1b-t-1");
    expect(next).toHaveLength(1);
  });

  it("stops at the requested count", () => {
    expect(batchFor(FOUR, 1)).toHaveLength(1);
    expect(batchFor(FOUR, 4)).toHaveLength(2);
  });
});

describe("the family's own exclusion lists", () => {
  /** A store directory holding only the files each case names, so no test can
   * read a sibling test's fixture. */
  const storeWith = (files: Readonly<Record<string, unknown>>): string => {
    const dir = mkdtempSync(join(tmpdir(), "choubun-spent-"));
    for (const [name, rows] of Object.entries(files)) {
      writeFileSync(join(dir, name), JSON.stringify(rows), "utf8");
    }
    return dir;
  };

  it("unions every shipped store, at every level, in every family", () => {
    // A 長文 window overlaps every band, so the exclusion is the whole shelf:
    // another level's 中文 and 情報検索 spend a paragraph against it too.
    const spent = choubunSpentSourceIds(
      storeWith({
        "n2-chuubun.json": [{ sourceIds: ["a2"] }, { sourceIds: ["a3"] }],
        "n2-tougou.json": [{ sourceIds: ["d1"] }],
        "n2.json": [{ sourceIds: ["a1"] }],
        "n3-chuushou.json": [{ sourceIds: ["b1"] }],
        "n4-jouhou.json": [{ sourceIds: ["c1", "c2"] }],
      })
    );
    expect([...spent].sort()).toEqual([
      "a1",
      "a2",
      "a3",
      "b1",
      "c1",
      "c2",
      "d1",
    ]);
  });

  it("never reads its own file, so a regeneration is not blocked by its last freeze", () => {
    const spent = choubunSpentSourceIds(
      storeWith({
        "n1-choubun-claims.json": [{ sourceIds: ["e3"] }],
        "n1-choubun-rejected.json": [{ rejectedIds: ["e2"] }],
        "n1-choubun.json": [{ sourceIds: ["e1"] }],
        "n2-chuubun.json": [{ sourceIds: ["e4"] }],
      })
    );
    expect([...spent].sort()).toEqual(["e4"]);
  });

  it("contributes nothing when no store exists", () => {
    const dir = storeWith({});
    expect(choubunSpentSourceIds(dir).size).toBe(0);
    expect(readChoubunRejections(dir, "N1").size).toBe(0);
  });

  it("reads the freeze-time judge record", () => {
    const dir = storeWith({
      "n1-choubun-rejected.json": [{ rejectedIds: ["n1b-x1", "n1b-x2"] }],
    });
    expect([...readChoubunRejections(dir, "N1")].sort()).toEqual([
      "n1b-x1",
      "n1b-x2",
    ]);
  });
});
