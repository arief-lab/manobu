import { describe, expect, it } from "bun:test";
import {
  DRILL_KINDS,
  drillSearchForSelection,
  drillSelectionSchema,
  matchesDrillSelection,
  parseDrillSearch,
} from "@/lib/drill-search";
import { Route as DrillRoute } from "@/routes/drill";

describe("drill search selection", () => {
  it("owns the shared kinds and CSV selection schema", () => {
    expect(DRILL_KINDS).toEqual([
      "gojuon",
      "katakana",
      "dakuten",
      "katakana-dakuten",
      "yoon",
      "katakana-yoon",
      "kanji",
    ]);
    expect(
      drillSelectionSchema.parse({ cell: "か", group: "gojuon:k" })
    ).toEqual({ cell: ["か"], group: ["gojuon:k"] });
  });

  it("backs the /drill route search validator", () => {
    const validate = DrillRoute.options.validateSearch;
    expect(typeof validate).toBe("function");
    if (typeof validate !== "function") {
      return;
    }
    expect(
      validate({ cell: "か,き", chart: 1, group: "gojuon:k", kind: "yoon" })
    ).toEqual({
      cell: ["か", "き"],
      chart: "1",
      group: ["gojuon:k"],
      kind: "yoon",
    });
  });

  it("keeps existing chart/kind values and parses cell/group CSV", () => {
    expect(
      parseDrillSearch({
        cell: "か, き",
        chart: 1,
        group: "gojuon:k, yoon:s",
        kind: "yoon",
      })
    ).toEqual({
      cell: ["か", "き"],
      chart: "1",
      group: ["gojuon:k", "yoon:s"],
      kind: "yoon",
    });
  });

  it("degrades unknown or malformed selections to safe defaults", () => {
    expect(
      parseDrillSearch({ cell: 42, chart: "yes", group: null, kind: "nope" })
    ).toEqual({ cell: [], chart: "0", group: [], kind: "gojuon" });
  });

  it("matches either an exact cell or its kind-row group", () => {
    const selection = { cell: ["か"], group: ["yoon:s"] };
    expect(
      matchesDrillSelection({ char: "か", kind: "gojuon", row: "k" }, selection)
    ).toBe(true);
    expect(
      matchesDrillSelection({ char: "し", kind: "yoon", row: "s" }, selection)
    ).toBe(true);
    expect(
      matchesDrillSelection({ char: "す", kind: "gojuon", row: "s" }, selection)
    ).toBe(false);
    expect(
      matchesDrillSelection(
        { char: "がっこう", kind: "word", row: "hiragana" },
        { cell: [], group: ["word:hiragana"] }
      )
    ).toBe(true);
  });

  it("builds one compact search shape for queue links", () => {
    expect(
      drillSearchForSelection({ cell: ["か"], group: ["gojuon:k"] }, "gojuon")
    ).toEqual({
      cell: ["か"],
      chart: "0",
      group: ["gojuon:k"],
      kind: "gojuon",
    });
    expect(drillSearchForSelection({ cell: [], group: [] })).toEqual({
      cell: [],
      chart: "0",
      group: [],
      kind: "gojuon",
    });
  });
});
