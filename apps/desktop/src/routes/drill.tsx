import kanaRaw from "@manobu/japanese/data/kana.json";
import kanjiN5Raw from "@manobu/japanese/data/kanji-n5.json";
import n5Raw from "@manobu/japanese/data/n5.json";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { type DrillChar, DrillLab } from "@/features/drill/drill-lab";
import { type KanaCell, KanaChart } from "@/features/drill/kana-chart";
import {
  DECK_TAB_ORDER,
  type DrillKind,
  KIND_LABELS,
  matchesDrillSelection,
  parseDrillSearch,
} from "@/lib/drill-search";

// data: local-state — kana.json + kanji-n5.json are bundled at build time
// via the @manobu/japanese/data/* subpath export. Static imports, no fetch,
// no queryOptions. The DrillLab compound consumes the chars via `initial`
// per apps/desktop/src/features/AGENTS.md Tier 3.
// SCR-03 redesign (2026-09-13): /drill is a CHROME-FOCUS surface like
// /reader and /roleplay — own `← desk` bar, no global Header, no sidebar,
// no AI pane. /learn/drill is a redirect stub for old deep links.
export const Route = createFileRoute("/drill")({
  component: DrillComponent,
  validateSearch: parseDrillSearch,
});

interface KanaEntry {
  char: string;
  katakana?: string;
  kind:
    | "gojuon"
    | "dakuten"
    | "yoon"
    | "katakana"
    | "katakana-dakuten"
    | "katakana-yoon";
  mnemonic: string;
  romaji: string;
  row: string;
}

/** Shape of data/kanji-n5.json (packages/japanese/scripts/gen-kanji-n5.ts). */
interface KanjiN5Entry {
  c: string;
  f: number;
  ku: string[];
  m: string[];
  on: string[];
  s: number;
}

type Kind = DrillKind;

const ALL_ENTRIES = kanaRaw as KanaEntry[];
const KANJI_N5 = kanjiN5Raw as KanjiN5Entry[];

const HIRAGANA_GOJUON = ALL_ENTRIES.filter(
  (k) => k.kind === "gojuon"
).map<DrillChar>((k) => ({
  char: k.char,
  kind: k.kind,
  level: "N5",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const KATAKANA_GOJUON = ALL_ENTRIES.filter(
  (k) => k.kind === "katakana"
).map<DrillChar>((k) => ({
  char: k.char,
  kind: k.kind,
  level: "N5",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

// Romaji for a kanji card = its first on-reading (katakana folded to
// hiragana so the [▶]/say affordances read consistently).
const foldKatakana = (s: string): string =>
  s.replace(/[ァ-ヴ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const KANJI_DECK = KANJI_N5.map<DrillChar>((k) => ({
  char: k.c,
  gloss: k.m.join("; "),
  kun: k.ku,
  level: "N5",
  on: k.on,
  romaji: foldKatakana(k.on[0] ?? k.ku[0] ?? "").replace(/[.\-\s]/g, ""),
  strokeCount: k.s,
}));

const KATAKANA_PAIRS = ALL_ENTRIES.filter(
  (k) => k.kind === "katakana"
).map<KanaCell>((k) => ({
  char: k.char,
  kind: "katakana",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const HIRAGANA_CELLS = ALL_ENTRIES.filter(
  (k) => k.kind === "gojuon"
).map<KanaCell>((k) => ({
  char: k.char,
  kind: "gojuon",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const HIRAGANA_DAKUTEN = ALL_ENTRIES.filter(
  (k) => k.kind === "dakuten"
).map<DrillChar>((k) => ({
  char: k.char,
  kind: k.kind,
  level: "N5",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const KATAKANA_DAKUTEN = ALL_ENTRIES.filter(
  (k) => k.kind === "katakana-dakuten"
).map<DrillChar>((k) => ({
  char: k.char,
  kind: k.kind,
  level: "N5",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const HIRAGANA_YOON = ALL_ENTRIES.filter(
  (k) => k.kind === "yoon"
).map<DrillChar>((k) => ({
  char: k.char,
  kind: k.kind,
  level: "N5",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const KATAKANA_YOON = ALL_ENTRIES.filter(
  (k) => k.kind === "katakana-yoon"
).map<DrillChar>((k) => ({
  char: k.char,
  kind: k.kind,
  level: "N5",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const HIRAGANA_DAKUTEN_CELLS = ALL_ENTRIES.filter(
  (k) => k.kind === "dakuten"
).map<KanaCell>((k) => ({
  char: k.char,
  kind: "dakuten",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const KATAKANA_DAKUTEN_CELLS = ALL_ENTRIES.filter(
  (k) => k.kind === "katakana-dakuten"
).map<KanaCell>((k) => ({
  char: k.char,
  kind: "katakana-dakuten",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const HIRAGANA_YOON_CELLS = ALL_ENTRIES.filter(
  (k) => k.kind === "yoon"
).map<KanaCell>((k) => ({
  char: k.char,
  kind: "yoon",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

const KATAKANA_YOON_CELLS = ALL_ENTRIES.filter(
  (k) => k.kind === "katakana-yoon"
).map<KanaCell>((k) => ({
  char: k.char,
  kind: "katakana-yoon",
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

// Word-level sokuon / chōonpu decks drawn from real n5 vocab (AC#2) — not synthesised
const N5_WORDS = n5Raw as readonly { word: string; reading: string }[];
const SOKUON_WORDS = N5_WORDS.filter((w) => w.word.includes("っ")).slice(0, 20);
const CHOONPU_WORDS = N5_WORDS.filter((w) => w.word.includes("ー")).slice(
  0,
  20
);
const WORD_DECK: readonly DrillChar[] = [...SOKUON_WORDS, ...CHOONPU_WORDS].map(
  (word) => ({
    char: word.word,
    kind: "word",
    level: "N5",
    romaji: word.reading,
    row: word.word.includes("ー") ? "katakana" : "hiragana",
  })
);

const ALL_KANA_CHARS: readonly DrillChar[] = [
  ...HIRAGANA_GOJUON,
  ...HIRAGANA_DAKUTEN,
  ...HIRAGANA_YOON,
  ...KATAKANA_GOJUON,
  ...KATAKANA_DAKUTEN,
  ...KATAKANA_YOON,
  ...WORD_DECK,
];

const ALL_KANA_CELLS: readonly KanaCell[] = [
  ...HIRAGANA_CELLS,
  ...HIRAGANA_DAKUTEN_CELLS,
  ...HIRAGANA_YOON_CELLS,
  ...KATAKANA_PAIRS,
  ...KATAKANA_DAKUTEN_CELLS,
  ...KATAKANA_YOON_CELLS,
];

const KindTabs = ({ kind }: { kind: Kind }) => {
  const navigate = useNavigate({ from: Route.fullPath });
  const setKind = useCallback(
    (next: Kind) => {
      navigate({
        search: (prev) => ({
          ...prev,
          cell: [],
          group: [],
          kind: next,
        }),
      });
    },
    [navigate]
  );
  return (
    <div
      aria-label="Deck"
      className="flex flex-wrap gap-2"
      data-testid="drill-kind-tabs"
      role="tablist"
    >
      {DECK_TAB_ORDER.map((k) => {
        const onPick = () => {
          setKind(k);
        };
        return (
          <button
            aria-selected={kind === k}
            className="min-h-11 rounded-card border border-border px-3 py-1 text-sm aria-selected:border-2 aria-selected:border-primary"
            data-kind={k}
            data-testid={`drill-kind-tab-${k}`}
            key={k}
            onClick={onPick}
            role="tab"
            type="button"
          >
            {KIND_LABELS[k]}
          </button>
        );
      })}
    </div>
  );
};

const ChartToggle = ({ chart, kind }: { chart: "0" | "1"; kind: Kind }) => {
  const navigate = useNavigate({ from: Route.fullPath });
  const onToggle = useCallback(() => {
    navigate({
      search: (prev) => ({ ...prev, chart: prev.chart === "1" ? "0" : "1" }),
    });
  }, [navigate]);
  if (kind === "kanji") {
    return null;
  }
  return (
    <button
      aria-pressed={chart === "1"}
      className="min-h-11 rounded-card border border-border px-3 py-1 text-sm hover:bg-muted aria-pressed:border-2 aria-pressed:border-primary"
      data-testid="drill-chart-toggle"
      onClick={onToggle}
      type="button"
    >
      表
    </button>
  );
};

const charsForKind = (kind: Kind): DrillChar[] => {
  if (kind === "katakana") {
    return KATAKANA_GOJUON;
  }
  if (kind === "dakuten") {
    return HIRAGANA_DAKUTEN;
  }
  if (kind === "katakana-dakuten") {
    return KATAKANA_DAKUTEN;
  }
  if (kind === "yoon") {
    return HIRAGANA_YOON;
  }
  if (kind === "katakana-yoon") {
    return KATAKANA_YOON;
  }
  if (kind === "kanji") {
    return KANJI_DECK;
  }
  return HIRAGANA_GOJUON;
};

const cellsForKind = (kind: Kind): KanaCell[] => {
  if (kind === "katakana") {
    return KATAKANA_PAIRS;
  }
  if (kind === "dakuten") {
    return HIRAGANA_DAKUTEN_CELLS;
  }
  if (kind === "katakana-dakuten") {
    return KATAKANA_DAKUTEN_CELLS;
  }
  if (kind === "yoon") {
    return HIRAGANA_YOON_CELLS;
  }
  if (kind === "katakana-yoon") {
    return KATAKANA_YOON_CELLS;
  }
  return HIRAGANA_CELLS;
};

const charsForSearch = (
  kind: Kind,
  selection: { cell: string[]; group: string[] }
): DrillChar[] => {
  const hasSelection = selection.cell.length > 0 || selection.group.length > 0;
  if (!hasSelection || kind === "kanji") {
    return charsForKind(kind);
  }
  return ALL_KANA_CHARS.filter((item) =>
    matchesDrillSelection(item, selection)
  );
};

const cellsForSearch = (
  kind: Kind,
  selection: { cell: string[]; group: string[] }
): KanaCell[] => {
  const hasSelection = selection.cell.length > 0 || selection.group.length > 0;
  if (!hasSelection || kind === "kanji") {
    return cellsForKind(kind);
  }
  return ALL_KANA_CELLS.filter((item) =>
    matchesDrillSelection(item, selection)
  );
};

function DrillComponent() {
  const { cell, chart = "0", group, kind = "gojuon" } = Route.useSearch();
  const selection = { cell, group };
  const chars = charsForSearch(kind, selection);
  const chartCells = cellsForSearch(kind, selection);
  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-4 p-4">
      {/* focus bar: the surface carries its own chrome (reader/roleplay DNA) */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          data-testid="drill-bar-desk"
          to="/dashboard"
        >
          ← desk
        </Link>
        <h1 className="font-semibold text-lg">Drill Lab</h1>
        <div className="ml-auto">
          <KindTabs kind={kind} />
        </div>
        <ChartToggle chart={chart} kind={kind} />
      </header>
      {/* key={kind}: a deck swap is a NEW set — order/pos/results must not
       * leak across decks (the ladder would mix 46 kana ticks with a
       * 79-kanji set). Remount also re-arms the first-card auto-play. */}
      <DrillLab
        initial={{ chars, deckLabel: KIND_LABELS[kind] }}
        key={`${kind}:${cell.join(",")}:${group.join(",")}`}
      />
      {chart === "1" && kind !== "kanji" ? (
        <KanaChart
          initial={{
            cells: chartCells,
            open: true,
          }}
        >
          <KanaChart.Header />
          {kind === "katakana" ? <KanaChart.LookAlike /> : null}
          <KanaChart.Grid />
        </KanaChart>
      ) : null}
    </div>
  );
}
