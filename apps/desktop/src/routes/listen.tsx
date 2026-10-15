import kanaRaw from "@manobu/japanese/data/kana.json";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { type KanaCell, KanaChart } from "@/features/drill/kana-chart";
import { ListenType } from "@/features/listen-type/listen-type";

interface KanaEntry {
  char: string;
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

interface ListenSearch {
  chart?: "0" | "1";
}

const ALL_CELLS = (kanaRaw as KanaEntry[]).map<KanaCell>((k) => ({
  char: k.char,
  kind: k.kind,
  mnemonic: k.mnemonic,
  romaji: k.romaji,
  row: k.row,
}));

// data: local-state — ListenType is Tier 3 props-driven (initial.target
// + initial.audio). No fetch. TASK-23.2.2 adds the optional KanaChart
// drawer (mounted when ?chart=1). The `manobu:kana-chart-copy` window
// event is consumed by `ListenType.Input` (AC5).
// Router audit (2026-09-14): /listen was the last REAL child of the
// /learn layout — the other five surfaces had already moved to top-level
// chrome-free desks, leaving listen behind the sidebar. It joins them
// here: own `← desk` bar, no Header, no AI pane; /learn/listen is now
// the redirect stub for old deep links (the flipped direction).
export const Route = createFileRoute("/listen")({
  component: ListenComponent,
  validateSearch: (raw: Record<string, unknown>): ListenSearch => {
    // The default search parser turns ?chart=1 into the NUMBER 1, so a
    // hand-typed deep link must match both shapes (router audit
    // 2026-09-14: the old stub chain silently dropped chart=1).
    const c = raw.chart;
    return { chart: c === "1" || c === 1 ? "1" : "0" };
  },
});

function ListenComponent() {
  const { chart = "0" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setChart = useCallback(
    (next: "0" | "1") => {
      navigate({ search: (prev) => ({ ...prev, chart: next }) });
    },
    [navigate]
  );
  const onToggleChart = useCallback(() => {
    setChart(chart === "1" ? "0" : "1");
  }, [chart, setChart]);
  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-4 p-4">
      {/* focus bar: the surface carries its own chrome (reader/drill DNA) */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          data-testid="listen-back-desk"
          to="/dashboard"
        >
          ← desk
        </Link>
        <h1 className="font-semibold text-lg">Listen & Type</h1>
        <button
          aria-pressed={chart === "1"}
          className="ml-auto min-h-11 rounded-card border-2 border-border px-3 py-1 text-sm"
          data-testid="listen-chart-open"
          onClick={onToggleChart}
          type="button"
        >
          {chart === "1" ? "✕ kana chart" : "📋 kana chart"}
        </button>
      </header>
      <p className="text-muted-foreground text-sm">
        Ear → hand production. Audio ▶ with 0.8×/1× → type hiragana.
      </p>
      <ListenType
        initial={{
          audio: "no-speaker",
          target: {
            gloss: "to eat",
            jp: "たべる",
            pitch: "たべ˥る",
            romaji: "taberu",
          },
        }}
      >
        <ListenType.Banner />
        <ListenType.Audio />
        <ListenType.Pitch />
        <ListenType.Shadow />
        <ListenType.Input />
        <ListenType.Next />
      </ListenType>
      {chart === "1" ? (
        <KanaChart initial={{ cells: ALL_CELLS, open: true }}>
          <KanaChart.Header />
          <KanaChart.Grid />
        </KanaChart>
      ) : null}
    </div>
  );
}
