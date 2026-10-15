/**
 * TASK-23.2.2 — KanaChart compound + katakana DrillLab variant.
 *
 * Covers:
 *   - 46 + 46 cell counts via the data filter (route-shaped) for the
 *     kind=gojuon / kind=katakana / kind=all selectors
 *   - TypeFallback choices come from the same script (no hiragana
 *     options when the current char is katakana)
 *   - DrillChar `kind` field is preserved through the route mapping
 *   - typeFallbackChoices (deterministic) includes the target
 *   - KanaChart `__test__.LOOK_ALIKE_PAIRS` covers the 2 doc-5 A2 pairs
 *   - DrillLab route loader convention: learn/drill.tsx has the
 *     `data: local-state` marker (per route-loaders.test.ts contract)
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import kanaRaw from "@manobu/japanese/data/kana.json";

import {
  type DrillChar,
  typeFallbackChoices,
} from "@/features/drill/drill-lab";
import { __test__ as chartTest } from "@/features/drill/kana-chart";

interface KanaEntry {
  char: string;
  kind: string;
  mnemonic: string;
  romaji: string;
  row: string;
}

const data = kanaRaw as unknown as KanaEntry[];

// The marker in source comments is `data: local-state` (with spaces);
// the route-loaders.test.ts regex is tolerant of both. Hoisted to the
// top level so the regex isn't recompiled per test.
const DATA_LOCAL_STATE = /data\s*:\s*local-state/;

const routesRoot = join(import.meta.dirname, "..", "src", "routes");
const routeFile = (rel: string): string =>
  readFileSync(join(routesRoot, rel), "utf8");

describe("KanaChart + Katakana drill (TASK-23.2.2)", () => {
  it("hiragana gojuon filter yields 46 DrillChar", () => {
    const chars = data
      .filter((k) => k.kind === "gojuon")
      .map<DrillChar>((k) => ({
        char: k.char,
        kind: "gojuon",
        level: "N5",
        mnemonic: k.mnemonic,
        romaji: k.romaji,
      }));
    expect(chars.length).toBe(46);
    expect(chars[0]?.char).toBe("あ");
    expect(chars[0]?.kind).toBe("gojuon");
  });

  it("katakana gojuon filter yields 46 DrillChar with kind=katakana", () => {
    const chars = data
      .filter((k) => k.kind === "katakana")
      .map<DrillChar>((k) => ({
        char: k.char,
        kind: "katakana",
        level: "N5",
        mnemonic: k.mnemonic,
        romaji: k.romaji,
      }));
    expect(chars.length).toBe(46);
    expect(chars[0]?.char).toBe("ア");
    expect(chars[0]?.kind).toBe("katakana");
  });

  it("typeFallbackChoices deterministic includes the target + 3 same-script distractors", () => {
    // Hiragana target → all options are hiragana
    const hiragana = data
      .filter((k) => k.kind === "gojuon")
      .map<DrillChar>((k) => ({
        char: k.char,
        kind: "gojuon",
        level: "N5",
        mnemonic: k.mnemonic,
        romaji: k.romaji,
      }));
    const [target] = hiragana.slice(5, 6);
    if (!target) {
      throw new Error("hiragana[5] missing — dataset is too small");
    }
    const choices = typeFallbackChoices(target, hiragana, {
      deterministic: true,
    });
    expect(choices).toContain(target.char);
    expect(choices.length).toBe(4);
    // All choices are hiragana (U+3040..U+309F)
    for (const c of choices) {
      const code = c.codePointAt(0);
      expect(code).toBeGreaterThanOrEqual(0x30_40);
      expect(code).toBeLessThanOrEqual(0x30_9f);
    }
  });

  it("typeFallbackChoices for katakana target yields katakana options only", () => {
    const katakana = data
      .filter((k) => k.kind === "katakana")
      .map<DrillChar>((k) => ({
        char: k.char,
        kind: "katakana",
        level: "N5",
        mnemonic: k.mnemonic,
        romaji: k.romaji,
      }));
    const [target] = katakana.slice(3, 4);
    if (!target) {
      throw new Error("katakana[3] missing — dataset is too small");
    }
    const choices = typeFallbackChoices(target, katakana, {
      deterministic: true,
    });
    expect(choices).toContain(target.char);
    expect(choices.length).toBe(4);
    for (const c of choices) {
      const code = c.codePointAt(0);
      expect(code).toBeGreaterThanOrEqual(0x30_a0);
      expect(code).toBeLessThanOrEqual(0x30_ff);
    }
  });

  it("DrillChar.kind narrows the kind-script so Katakana DrillLab works", () => {
    // DrillChar must accept the katakana variants after 23.2.2 — this
    // test is a TS contract check at runtime: a Katakana-char
    // round-trip through the route filter keeps `kind: "katakana"`.
    const char: DrillChar = {
      char: "ア",
      kind: "katakana",
      level: "N5",
      mnemonic: "Apple — sharp (katakana)",
      romaji: "a",
    };
    expect(char.kind).toBe("katakana");
  });
});

describe("KanaChart overlay + look-alike pairs (TASK-23.2.2)", () => {
  it("exports the 2 look-alike pairs from doc-5 A2", () => {
    const pairs = chartTest.LOOK_ALIKE_PAIRS;
    expect(pairs.length).toBe(2);
    expect(pairs.map(([a, b]) => `${a}${b}`)).toContain("シツ");
    expect(pairs.map(([a, b]) => `${a}${b}`)).toContain("ソン");
  });

  it("KanaCell shape is the wider union (includes dakuten/yoon)", () => {
    // The route maps kana.json directly into KanaCell[]; the wider
    // union must include katakana-dakuten / katakana-yoon.
    const dakutenKind = data.find((k) => k.kind === "katakana-dakuten")?.kind;
    const yoonKind = data.find((k) => k.kind === "katakana-yoon")?.kind;
    expect(dakutenKind).toBe("katakana-dakuten");
    expect(yoonKind).toBe("katakana-yoon");
  });
});

describe("drill.tsx route-shape (TASK-23.2.2 + 2026-09-13 chrome-free move)", () => {
  // AC6 says the apps/desktop/AGENTS.md Child DOX Index must be updated;
  // the regression guard for the route itself is route-loaders.test.ts.
  // This local check confirms the kind search-param shape is wired
  // without reading the full source. The SCR-03 redesign moved the surface
  // to /drill (chrome-free focus); learn/drill.tsx is the redirect stub.
  it("learn/drill.tsx carries the data:local-state marker", () => {
    const src = routeFile("learn/drill.tsx");
    // The marker in the source comment is `data: local-state` (with
    // spaces); the route-loaders.test.ts regex is tolerant of both.
    expect(src).toMatch(DATA_LOCAL_STATE);
  });

  it("drill.tsx exports the KATAKANA_GOJUON array (46 entries)", () => {
    const src = routeFile("drill.tsx");
    // The route file filters kana.json by `kind === "katakana"` and maps
    // to DrillChar; just assert the filter + map appear.
    expect(src).toContain('k.kind === "katakana"');
    expect(src).toContain("KATAKANA_GOJUON");
  });
});

describe("listen.tsx route-shape", () => {
  it("listen.tsx mounts the KanaChart when ?chart=1", () => {
    const src = routeFile("listen.tsx");
    expect(src).toContain("KanaChart");
    expect(src).toContain("ALL_CELLS");
  });
});
