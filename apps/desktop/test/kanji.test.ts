import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { __test__ as detailTest } from "@/features/kanji-detail/kanji-detail";
import {
  __test__,
  type KanjiEntry,
  type VocabRow,
  vocabContaining,
} from "@/lib/kanji";
import {
  cellState,
  progressNote,
  __test__ as progressTest,
} from "@/lib/kanji-progress";
import { filterRows, type KanjiListRow } from "@/lib/kanji-queries";

const srcFile = (rel: string): string =>
  readFileSync(join(import.meta.dirname, "..", "src", rel), "utf8");

/* ── TASK-75: progress store + search (pure) ────────────────────── */

describe("kanji-progress store (pure transitions)", () => {
  const empty = { learned: {}, seen: [] };
  const row = (character: string, gloss: string): KanjiListRow => ({
    character,
    gloss,
    jlpt: "N5",
    strokeCount: 5,
  });

  it("seen is idempotent", () => {
    const once = progressTest.withSeen(empty, "食");
    expect(progressTest.withSeen(once, "食")).toBe(once);
  });

  it("saving a word marks learned AND seen", () => {
    const next = progressTest.withLearned(empty, "食", "食べる\0たべる");
    expect(next.seen).toContain("食");
    expect(next.learned.食).toEqual(["食べる\0たべる"]);
  });

  it("undo falls back to seen on the last word", () => {
    const learned = progressTest.withLearned(empty, "食", "食べる\0たべる");
    const undone = progressTest.withoutLearned(learned, "食", "食べる\0たべる");
    expect(undone.learned.食).toBeUndefined();
    expect(undone.seen).toContain("食"); // seen survives
  });

  it("undo keeps other words", () => {
    let p = progressTest.withLearned(empty, "食", "食べる\0たべる");
    p = progressTest.withLearned(p, "食", "食事\0しょくじ");
    const undone = progressTest.withoutLearned(p, "食", "食べる\0たべる");
    expect(undone.learned.食).toEqual(["食事\0しょくじ"]);
  });

  it("cellState: learned beats seen beats none", () => {
    const learned = progressTest.withLearned(empty, "食", "w");
    expect(cellState(learned, "食")).toBe("learned");
    expect(cellState(progressTest.withSeen(empty, "水"), "水")).toBe("seen");
    expect(cellState(empty, "火")).toBe("none");
  });

  it("corrupt blobs parse to empty, never throw", () => {
    expect(progressTest.parseProgress(null)).toEqual(empty);
    expect(progressTest.parseProgress("{oops")).toEqual(empty);
    expect(progressTest.parseProgress('"a string"')).toEqual(empty);
    // empty word lists are not "learned"
    expect(
      progressTest.parseProgress('{"seen":[],"learned":{"食":[]}}').learned
    ).toEqual({});
  });

  it("filterRows matches gloss case-insensitively and passes empty query", () => {
    const rows = [row("水", "water"), row("学", "study")];
    expect(filterRows(rows, "")).toHaveLength(2);
    expect(filterRows(rows, "WATER").map((r) => r.character)).toEqual(["水"]);
    expect(filterRows(rows, "st").map((r) => r.character)).toEqual(["学"]);
    expect(filterRows(rows, "学").map((r) => r.character)).toEqual(["学"]);
    expect(filterRows(rows, "nope")).toHaveLength(0);
  });

  it("progressNote counts facts and hides when nothing", () => {
    let p = progressTest.withLearned(empty, "水", "w");
    p = progressTest.withSeen(p, "火");
    expect(progressNote(p, ["水", "火", "一"])).toBe(" · 1 learned, 1 seen");
    expect(progressNote(p, ["一"])).toBe("");
    expect(progressNote(p, ["水"])).toBe(" · 1 learned");
  });
});

describe("lookupKanji", () => {
  it("looks up 食 with on ショク, kun た.べる, N5, grade 2", async () => {
    // Use test helper when server is not available
    const k = await __test__.testLookupKanji("食");
    expect(k).not.toBeNull();
    expect(k?.character).toBe("食");
    expect(k?.on).toContain("ショク");
    expect(k?.kun).toContain("た.べる");
    expect(k?.jlpt).toBe("N5");
    expect(k?.grade).toBe(2);
    expect(k?.strokeCount).toBe(9);
    expect(k?.meaningsEn).toContain("eat");
  });

  it("returns null for a character not in the corpus", async () => {
    const k = await __test__.testLookupKanji("𪚥");
    expect(k).toBeNull();
  });
});

describe("honest failure states (2026-09-14)", () => {
  const lib = srcFile("lib/kanji.ts");
  const queries = srcFile("lib/kanji-queries.ts");
  const index = srcFile("routes/kanji/index.tsx");

  it("lookupKanji treats only the declared NOT_FOUND as a miss", () => {
    // the isNotFound guard narrows on the code, and the catch re-throws
    // everything else — a down server must not render as "not found"
    expect(lib).toContain('error.code === "NOT_FOUND"');
    expect(lib).toContain("throw error;");
  });

  it("the list query no longer swallows failures into an empty grid", () => {
    // the old body was `try { ... } catch { return { level, rows: [] } }`
    expect(queries).not.toContain("rows: [] as KanjiListRow[]");
    expect(queries).toContain("queryFn: () => orpc.jap.kanji.list({ level })");
  });

  it("the grid renders an error state with retry, not a fake-empty message", () => {
    expect(index).toContain("kanji-error");
    expect(index).toContain("kanji-retry");
    // the lie is gone from user copy
    expect(index).not.toContain("the server may be offline");
  });

  it("total vocab failure throws, partial failure degrades", () => {
    expect(lib).toContain("results.every((r) => r === null)");
  });
});

describe("strokeNote", () => {
  const entry = {
    character: "食",
    frequency: 100,
    grade: 2,
    jlpt: "N5",
    kun: [],
    meaningsEn: ["eat"],
    on: ["ショク"],
    strokeCount: 9,
  } satisfies KanjiEntry;
  it("distinguishes loading, corpus-miss, and no-art", () => {
    expect(detailTest.strokeNote("食", true, null)).toContain("Loading");
    expect(detailTest.strokeNote("𪚥", false, null)).toContain(
      "isn't in the corpus yet"
    );
    expect(detailTest.strokeNote("食", false, entry)).toContain(
      "isn't available"
    );
  });
});

describe("vocabContaining", () => {
  // Skip if no server - requires /grammar endpoint
  const hasServer =
    typeof window !== "undefined" && "VITE_SERVER_URL" in window;
  const runIfServer = hasServer ? it : it.skip;

  runIfServer("finds vocabulary containing a kanji", async () => {
    const rows = await vocabContaining("食", ["N5", "N4"]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.word.includes("食"))).toBe(true);
  });

  runIfServer("respects level filter", async () => {
    const onlyN5 = await vocabContaining("食", ["N5"]);
    expect(onlyN5.every((r) => r.level === "N5")).toBe(true);
  });

  // Gated like the others: without a server every level fetch throws
  // (honest-failure semantics), so "no matches" can only be asserted live.
  runIfServer("returns empty when no matches", async () => {
    const none = await vocabContaining("𪚥", ["N5", "N4"]);
    expect(none).toHaveLength(0);
  });
});

/* ── SCR-09 redesign contracts (2026-09-14) ─────────────────────── */

describe("readingRomaji", () => {
  it("folds katakana on-yomi to romaji", () => {
    expect(detailTest.readingRomaji("ショク")).toBe("shoku");
    expect(detailTest.readingRomaji("しょくどう")).toBe("shokudou");
  });

  it("keeps the kun stem dot readable", () => {
    expect(detailTest.readingRomaji("た.べる")).toBe("ta.beru");
  });
});

describe("dedupeVocab", () => {
  const row = (
    word: string,
    reading: string,
    level: "N5" | "N4"
  ): VocabRow => ({ gloss: "", level, reading, word });

  it("keeps the first occurrence of a word+reading pair", () => {
    const rows = [row("食事", "しょくじ", "N5"), row("食事", "しょくじ", "N4")];
    const out = detailTest.dedupeVocab(rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.level).toBe("N5");
  });

  it("keeps same word with different readings", () => {
    const rows = [row("食う", "くう", "N5"), row("食らう", "くらう", "N5")];
    expect(detailTest.dedupeVocab(rows)).toHaveLength(2);
  });
});

describe("kanji detail surface contracts", () => {
  const detail = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "src",
      "features/kanji-detail/kanji-detail.tsx"
    ),
    "utf8"
  );
  const lazy = readFileSync(
    join(import.meta.dirname, "..", "src", "routes", "kanji", "$character.tsx"),
    "utf8"
  );

  it("no spec inventory or debug telemetry in user copy", () => {
    // the old telemetry element is gone (its data-testid must not return)
    expect(detail).not.toContain("kanji-draw-pointer-type");
    expect(lazy).not.toContain("polyhierarchy");
    expect(lazy).not.toContain("draw mini");
    expect(detail).not.toContain(">[Type");
  });

  it("the route binds the $character path param (no hardcoded 食 default render)", () => {
    expect(lazy).toContain("Route.useParams()");
    expect(lazy).toContain("<KanjiDetail character={character}>");
  });

  it("vocab saves mark immediately and un-mark on undo", () => {
    // saveFsrsToast resolves true on UNDO — awaiting it to confirm would
    // record saves exactly when cancelled (the inverted-RightRail bug).
    const saveIdx = detail.indexOf("const onSaveClick");
    const block = detail.slice(saveIdx, saveIdx + 500);
    const marked = block.indexOf("onSaved(row)");
    const toasted = block.indexOf("saveFsrsToast({");
    expect(marked).toBeGreaterThan(-1);
    expect(toasted).toBeGreaterThan(marked);
  });

  it("the stroke player degrades honestly without KanjiVG data", () => {
    expect(detail).toContain("kanji-stroke-note");
    expect(detail).toContain("Stroke-order art isn't available");
  });
});
