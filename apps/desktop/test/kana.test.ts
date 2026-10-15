import { describe, expect, it } from "bun:test";

import kanaRaw from "@manobu/japanese/data/kana.json";

import { __test__ as drillTest } from "@/features/drill/drill-lab";

describe("kana dataset (TASK-23.2.1)", () => {
  const data = kanaRaw as unknown as Array<{
    char: string;
    kind: string;
    mnemonic: string;
    romaji: string;
    row: string;
  }>;

  it("ships 46 hiragana gojuon entries", () => {
    const gojuon = data.filter((k) => k.kind === "gojuon");
    expect(gojuon.length).toBe(46);
    // canonical a-row
    expect(gojuon.find((k) => k.char === "あ")?.romaji).toBe("a");
    expect(gojuon.find((k) => k.char === "ん")?.romaji).toBe("n");
    expect(gojuon.find((k) => k.char === "を")?.romaji).toBe("wo");
  });

  it("ships 46 katakana gojuon entries", () => {
    const katakana = data.filter((k) => k.kind === "katakana");
    expect(katakana.length).toBe(46);
    expect(katakana.find((k) => k.char === "ア")?.romaji).toBe("a");
    expect(katakana.find((k) => k.char === "ン")?.romaji).toBe("n");
  });

  it("ships dakuten + yoon for hiragana and katakana (TASK-23.2.2 exact counts)", () => {
    // TASK-23.2.2: lock the exact counts so the dataset doesn't drift
    // (25 hiragana dakuten = 5 rows × 5 letters; 33 yoon = 11 rows × 3
    // columns; ditto katakana). The KanaChart drawer renders every entry,
    // and a count drift would silently break cell counts.
    expect(data.filter((k) => k.kind === "dakuten").length).toBe(25);
    expect(data.filter((k) => k.kind === "katakana-dakuten").length).toBe(25);
    expect(data.filter((k) => k.kind === "yoon").length).toBe(33);
    expect(data.filter((k) => k.kind === "katakana-yoon").length).toBe(33);
  });

  it("ships the full 92+92 dataset (TASK-23.2.2)", () => {
    // 46 gojuon + 46 katakana + 25 + 25 + 33 + 33 = 208 (per
    // packages/japanese/AGENTS.md). The KanaChart Grid mounts every entry.
    expect(data.length).toBe(208);
  });

  it("includes the look-alike pairs for the katakana overlay (TASK-23.2.2)", () => {
    // Doc-5 A2: シ/ツ ソ/ン are visually similar and need a callout
    // before the first katakana drill. Lock the four pairs so the
    // overlay's data-driven cell list doesn't drift.
    const katakana = data.filter((k) => k.kind === "katakana");
    for (const ch of ["シ", "ツ", "ソ", "ン"]) {
      expect(katakana.find((k) => k.char === ch)).toBeDefined();
    }
  });

  it("every entry has char, romaji, mnemonic, row, kind", () => {
    for (const k of data) {
      expect(k.char.length).toBeGreaterThan(0);
      expect(k.romaji.length).toBeGreaterThan(0);
      expect(k.mnemonic.length).toBeGreaterThan(0);
      expect(k.row.length).toBeGreaterThan(0);
      expect(k.kind.length).toBeGreaterThan(0);
    }
  });

  it("(char, romaji) pairs are unique per script", () => {
    const seenHira = new Set<string>();
    const seenKata = new Set<string>();
    for (const k of data) {
      const seen = k.kind.startsWith("katakana") ? seenKata : seenHira;
      const key = `${k.char}:${k.romaji}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("DrillChar + gradeShape (TASK-23.2.1 backward compat)", () => {
  it("exports GHOST_TOLERANCE_PX = 40", () => {
    expect(drillTest.GHOST_TOLERANCE_PX).toBe(40);
  });

  it("gradeShape rejects too-few-point draws", () => {
    expect(
      drillTest.gradeShape(
        [{ x: 0, y: 0 }],
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]
      )
    ).toBe(false);
  });

  it("gradeShape accepts an exact ghost stroke", () => {
    const ghost = [
      { x: 40, y: 40 },
      { x: 140, y: 70 },
      { x: 240, y: 100 },
    ];
    expect(drillTest.gradeShape(ghost, ghost)).toBe(true);
  });
});
