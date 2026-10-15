import { describe, expect, it } from "bun:test";

import {
  findKanjiEntry,
  type KanjiRecord,
  kanjiListRows,
  toKanjiResponse,
} from "../src/routes/jap-data";

const record = (over: Partial<KanjiRecord> = {}): KanjiRecord => ({
  character: "食",
  frequency: 307,
  grade: 2,
  jlpt_old: 4,
  jlpt_waller: "N5",
  meanings: { en: ["eat", "food"] },
  readings: { kun: ["く", "は"], on: ["ショク", "ジキ"] },
  stroke_count: 9,
  ...over,
});

describe("kanjiListRows (TASK-37 index grid)", () => {
  const kanji = [
    record(),
    record({ character: "水", jlpt_waller: "N5", stroke_count: 4 }),
    record({ character: "語", jlpt_waller: "N4" }),
    record({ character: "行", jlpt_waller: null }),
  ];

  it("keeps only rows matching the level", () => {
    expect(kanjiListRows(kanji, "N5").map((r) => r.character)).toEqual([
      "食",
      "水",
    ]);
  });

  it("projects character, first gloss, level, and stroke count", () => {
    expect(kanjiListRows(kanji, "N4")).toEqual([
      { character: "語", gloss: "eat", jlpt: "N4", strokeCount: 9 },
    ]);
  });

  it("glosses to empty string when no English meanings exist", () => {
    const rows = kanjiListRows([record({ meanings: {} })], "N5");
    expect(rows[0]?.gloss).toBe("");
  });

  it("returns no rows for an unmatched level", () => {
    expect(kanjiListRows(kanji, "N1")).toEqual([]);
  });
});

describe("findKanjiEntry", () => {
  const kanji = [record(), record({ character: "A" })];

  it("finds an exact character match", () => {
    expect(findKanjiEntry(kanji, "食")?.character).toBe("食");
  });

  it("case-folds romaji input so lowercase finds the uppercase record", () => {
    expect(findKanjiEntry(kanji, "a")?.character).toBe("A");
  });

  it("case-folds the other direction too", () => {
    const lowerOnly = [record({ character: "a" })];
    expect(findKanjiEntry(lowerOnly, "A")?.character).toBe("a");
  });

  it("returns undefined for an absent character", () => {
    expect(findKanjiEntry(kanji, "水")).toBeUndefined();
  });
});

describe("toKanjiResponse", () => {
  it("maps a full record to the API DTO", () => {
    expect(toKanjiResponse(record())).toEqual({
      character: "食",
      frequency: 307,
      grade: 2,
      jlpt: "N5",
      kun: ["く", "は"],
      meaningsEn: ["eat", "food"],
      on: ["ショク", "ジキ"],
      strokeCount: 9,
    });
  });

  it("falls back to the retired numeric jlpt_old when waller is null", () => {
    const dto = toKanjiResponse(record({ jlpt_old: 3, jlpt_waller: null }));
    expect(dto.jlpt).toBe("N4");
  });

  it("renders missing reading and meaning arrays as empty lists", () => {
    const dto = toKanjiResponse(record({ meanings: {}, readings: {} }));
    expect(dto.kun).toEqual([]);
    expect(dto.meaningsEn).toEqual([]);
    expect(dto.on).toEqual([]);
  });
});
