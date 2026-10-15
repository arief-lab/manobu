import { z } from "zod";

export const DRILL_KINDS = [
  "gojuon",
  "katakana",
  "dakuten",
  "katakana-dakuten",
  "yoon",
  "katakana-yoon",
  "kanji",
] as const;

export type DrillKind = (typeof DRILL_KINDS)[number];

/**
 * The deck tabs, in the order the drill shows them: the hiragana family, then
 * the katakana family, then kanji. `test/drill-search.test.ts` pins that this
 * covers exactly `DRILL_KINDS`, so the two cannot drift.
 */
export const DECK_TAB_ORDER = [
  "gojuon",
  "dakuten",
  "yoon",
  "katakana",
  "katakana-dakuten",
  "katakana-yoon",
  "kanji",
] as const satisfies readonly DrillKind[];

/** Tab labels, kept short enough to fit one row of seven. */
export const KIND_LABELS: Record<DrillKind, string> = {
  dakuten: "Dakuten",
  gojuon: "Hiragana",
  kanji: "Kanji N5",
  katakana: "Katakana",
  "katakana-dakuten": "Kata-Daku",
  "katakana-yoon": "Kata-Yoon",
  yoon: "Yoon",
};

const selectionValues = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}, z.array(z.string()).catch([]));

export const drillSelectionSchema = z.object({
  cell: selectionValues.default([]),
  group: selectionValues.default([]),
});

export type DrillSelection = z.infer<typeof drillSelectionSchema>;

export interface DrillSearch {
  cell: string[];
  chart: "0" | "1";
  group: string[];
  kind: DrillKind;
}

export const parseDrillSearch = (raw: Record<string, unknown>): DrillSearch => {
  const kind = DRILL_KINDS.includes(raw.kind as DrillKind)
    ? (raw.kind as DrillKind)
    : "gojuon";
  const chart = raw.chart === "1" || raw.chart === 1 ? "1" : "0";
  const parsed = drillSelectionSchema.safeParse({
    cell: raw.cell,
    group: raw.group,
  });
  return {
    ...(parsed.success ? parsed.data : { cell: [], group: [] }),
    chart,
    kind,
  };
};

export const drillSearchForSelection = (
  selection: DrillSelection,
  kind: DrillKind = "gojuon"
) => ({
  cell: selection.cell,
  chart: "0" as const,
  group: selection.group,
  kind,
});

export const matchesDrillSelection = (
  cell: { char: string; kind?: string; row?: string },
  selection: DrillSelection
): boolean => {
  if (selection.cell.length === 0 && selection.group.length === 0) {
    return true;
  }
  if (selection.cell.includes(cell.char)) {
    return true;
  }
  const group = cell.kind && cell.row ? `${cell.kind}:${cell.row}` : null;
  return group !== null && selection.group.includes(group);
};
