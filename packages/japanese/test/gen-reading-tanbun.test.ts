/**
 * `gen:reading-tanbun` pins the 短文 screens with real data assertions: the
 * band that makes a 白書 paragraph a 短文 rather than a 中文, the surfaces that
 * must never be keyed, the byte-exact blank, determinism, one row per answer
 * word, and the two exclusion lists the family runs (a paragraph another store
 * already prints, and a row the judge rejected).
 *
 * The fixtures drive the SAME functions the pipeline runs, so a screen cannot
 * exist in one half only: `buildEntry` is what generated every shipped row, and
 * `tanbunSpentSourceIds` is what `check:reading-tanbun` re-runs on the store.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBatch,
  buildEntry,
  type TanbunReadingEntry,
} from "../scripts/gen-reading-tanbun";
import { buildVocabIndex } from "../scripts/reading-n4-corpus";
import {
  readTanbunRejections,
  TANBUN_BLOCK,
  TANBUN_MAX_PASSAGE_LENGTH,
  TANBUN_MIN_PASSAGE_LENGTH,
  TANBUN_SIGNER,
  TANBUN_STEM,
  tanbunSpentSourceIds,
} from "../scripts/reading-tanbun-corpus";
import { INDEX, VOCAB } from "./reading-noun-vocab";

/** Four copies of the 49-rune sentence is 196 runes: above the 短文 floor and
 * under the server's 240-rune `short-reading` cap. */
const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。".repeat(
    4
  );

const dataDir = "/nonexistent";
/** `buildBatch` reads the index and the sibling stores off disk itself, so its
 * tests use the real shipped vocabulary. */
const REAL_DATA = join(import.meta.dir, "..", "data");

const paragraph = (id: string, text: string) => ({
  id,
  license: "PDL-1.0",
  pageId: "t",
  pageUrl: "https://example.test/",
  source: "credit",
  text,
  title: "t",
});

const build = (id: string, text: string): TanbunReadingEntry | null =>
  buildEntry(paragraph(id, text), dataDir, "N2", INDEX, new Map());

describe("buildEntry: the 短文 band", () => {
  it("refuses a paragraph shorter than the floor (a heading, not a passage)", () => {
    expect([...FILLER].length).toBeGreaterThanOrEqual(
      TANBUN_MIN_PASSAGE_LENGTH
    );
    expect(build("p1", "電車が降る。")).toBeNull();
  });

  it("refuses a paragraph longer than the server's short-reading cap", () => {
    expect(build("p2", `${FILLER}${FILLER}電車が降る。`)).toBeNull();
  });

  it("fits the printed passage inside the band", () => {
    const entry = build("p3", `${FILLER}電車が降る。`);
    if (entry === null) {
      throw new Error("fixture must produce a row");
    }
    const runes = [...entry.passage].length;
    expect(runes).toBeGreaterThanOrEqual(TANBUN_MIN_PASSAGE_LENGTH);
    expect(runes).toBeLessThanOrEqual(TANBUN_MAX_PASSAGE_LENGTH);
  });
});

describe("buildEntry: the masked-slot construction", () => {
  it("blanks the kanji noun once and keeps the key out of the passage", () => {
    const entry = build("p4", `${FILLER}電車が降る。`);
    if (entry === null) {
      throw new Error("fixture must produce a row");
    }
    expect(entry.options[entry.answerIndex]).toBe("電車");
    expect(entry.passage.split("＿＿")).toHaveLength(2);
    expect(entry.passage).not.toContain("電車");
    expect(entry.options).toHaveLength(4);
    expect(entry.block).toBe(TANBUN_BLOCK);
    expect(entry.stem).toBe(TANBUN_STEM);
    expect(entry.level).toBe("N2");
    expect(entry.provenance).toBe("composed");
    expect(entry.validated).toBe(true);
    expect(entry.validatedBy).toBe(TANBUN_SIGNER);
    expect(entry.sourceIds).toEqual(["p4"]);
  });

  it("refuses a reading fragment printed inside a longer word", () => {
    // こうし is 講師's reading, printed inside こうした. Requiring the listed
    // kanji form of a segmented noun is what removes it.
    expect(build("p5", `こうした${FILLER}`)).toBeNull();
  });

  it("skips a slot the fixed stem itself prints (the 一つ stem-leak)", () => {
    expect(TANBUN_STEM.includes("一つ")).toBe(true);
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
    // 手紙 prints twice so slotsFor drops it, leaving 一つ as the only slot:
    // without the skip the row would print its own answer inside the question.
    const entry = buildEntry(
      paragraph("p6", `手紙は一つ。${FILLER}手紙だ。`),
      dataDir,
      "N2",
      stemIndex,
      new Map()
    );
    expect(entry).toBeNull();
  });
});

describe("buildEntry and buildBatch: determinism and variety", () => {
  it("is deterministic: the same corpus yields byte-identical rows", () => {
    const corpus = [paragraph("p7", `${FILLER}電車が降る。`)];
    const first = buildBatch(corpus, REAL_DATA, "N2", 1);
    // Asserted before the comparison so a batch that came back empty cannot
    // pass a determinism check by being empty twice.
    expect(first).toHaveLength(1);
    expect(JSON.stringify(first)).toBe(
      JSON.stringify(buildBatch(corpus, REAL_DATA, "N2", 1))
    );
  });

  it("keeps a batch to distinct answer words", () => {
    const batch = buildBatch(
      [
        paragraph("p9", `${FILLER}電車が降る。`),
        paragraph("p10", `${FILLER}電車が行く。`),
      ],
      REAL_DATA,
      "N2",
      2
    );
    const answers = batch.map((entry) => entry.options[entry.answerIndex]);
    expect(answers).toHaveLength(1);
    expect(new Set(answers).size).toBe(answers.length);
  });
});

describe("the family's own exclusion lists", () => {
  /** A store directory holding only the files each case names, so no test can
   * read a sibling test's fixture. */
  const storeWith = (files: Readonly<Record<string, unknown>>): string => {
    const dir = mkdtempSync(join(tmpdir(), "tanbun-spent-"));
    for (const [name, rows] of Object.entries(files)) {
      writeFileSync(join(dir, name), JSON.stringify(rows), "utf8");
    }
    return dir;
  };

  it("unions the level's sibling stores; no other level spends a 短文 paragraph", () => {
    // The sibling half is unchanged: a 中文, 主張理解 or 統合理解 row of the SAME
    // level spends the paragraph and a 短文 may not print it again. The cross-level
    // half reads nothing since TASK-173.9.21, because `TANBUN_SOURCE` calls every
    // composed level `authored` and a written row prints no `sourceIds` at all. The
    // N1 file below is therefore shaped the way that level actually ships, which is
    // itself the fact this case pins: an authored store contributes no exclusion.
    const spent = tanbunSpentSourceIds(
      storeWith({
        "n1.json": [
          { block: TANBUN_BLOCK, construction: "authored" },
          { block: "naiyou-rikai-chuubun", construction: "authored" },
        ],
        "n2-chuubun.json": [{ sourceIds: ["a1"] }, { sourceIds: ["a2"] }],
        "n2-tougou.json": [{ sourceIds: ["a1", "b7"] }],
      }),
      "N2"
    );
    expect([...spent].sort()).toEqual(["a1", "a2", "b7"]);
  });

  it("never reads the level being generated, and no level besides it any more", () => {
    // Two facts, both properties of the route table rather than of this file: a
    // generator must not skip a paragraph the file it is about to rewrite already
    // prints, and since TASK-173.9.21 every 短文 store is written (N1-N4) or
    // licensed (N5), so there is no second 白書 短文 level to exclude. The
    // windowed ids below are what an N1 store looked like; reading them for
    // another level is the half that closed, and it re-opens automatically if a
    // level ever goes back through `TANBUN_SOURCE`.
    const dir = storeWith({
      "n1.json": [{ block: TANBUN_BLOCK, sourceIds: ["d1"] }],
      "n2.json": [{ block: TANBUN_BLOCK, sourceIds: ["d2"] }],
    });
    expect(tanbunSpentSourceIds(dir, "N1").has("d1")).toBe(false);
    expect(tanbunSpentSourceIds(dir, "N1").has("d2")).toBe(false);
    expect(tanbunSpentSourceIds(dir, "N2").has("d1")).toBe(false);
  });

  it("contributes nothing when no sibling store exists", () => {
    const dir = storeWith({});
    expect(tanbunSpentSourceIds(dir, "N3").size).toBe(0);
    expect(readTanbunRejections(dir, "N3").size).toBe(0);
  });

  it("reads the freeze-time judge record", () => {
    const dir = storeWith({
      "n3-rejected.json": [{ rejectedIds: ["n3t-x1", "n3t-x2"] }],
    });
    expect([...readTanbunRejections(dir, "N3")].sort()).toEqual([
      "n3t-x1",
      "n3t-x2",
    ]);
  });
});
