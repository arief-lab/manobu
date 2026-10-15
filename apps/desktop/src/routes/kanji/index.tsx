import type { JlptLevel } from "@manobu/api-contract";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import {
  cellState,
  type KanjiProgress,
  progressNote,
  readProgress,
} from "@/lib/kanji-progress";
import {
  filterRows,
  type KanjiListRow,
  kanjiListQueryOptions,
} from "@/lib/kanji-queries";
import { JLPT_LEVELS } from "@/lib/learner-level";
import Loader from "@/shared/loader";

const kanjiIndexSearchSchema = z.object({
  level: z.enum(["N5", "N4", "N3", "N2", "N1"]).default("N5").catch("N5"),
});

export const Route = createFileRoute("/kanji/")({
  // Router audit (2026-09-14): loader-warm like the detail sibling · the
  // grid query fills the cache before the component mounts, so first
  // paint shows rows instead of the in-page Loader. The .catch is
  // deliberate: a rejected loader would route to the generic
  // errorComponent and kill the in-page KanjiError + [Try again]
  // affordance; swallowed here, the component's useQuery still sees the
  // cached error state and renders it.
  component: KanjiIndex,
  loaderDeps: ({ search: { level } }) => ({ level }),
  loader: ({ context: { queryClient }, deps: { level } }) =>
    queryClient
      .ensureQueryData(kanjiListQueryOptions(level))
      .catch(() => undefined),
  validateSearch: kanjiIndexSearchSchema,
});

function KanjiIndex() {
  const { level } = Route.useSearch();
  const { data, isPending, isError, refetch, isFetching } = useQuery(
    kanjiListQueryOptions(level)
  );
  const [query, setQuery] = useState("");

  const rows: KanjiListRow[] = data?.rows ?? [];
  // Read once per mount; the detail page writes on save/undo, and route
  // remounts pick it up. localStorage reads never throw (store contract).
  const progress = useMemo(() => readProgress(), []);
  const onRetry = useCallback(() => {
    refetch();
  }, [refetch]);
  const shown = useMemo(() => filterRows(rows, query), [rows, query]);
  const onQueryChange = useCallback((e: { target: { value: string } }) => {
    setQuery(e.target.value);
  }, []);
  const onClearQuery = useCallback(() => {
    setQuery("");
  }, []);
  const progressNoteText = progressNote(
    progress,
    rows.map((r) => r.character)
  );
  const ready = !(isPending || isError);

  return (
    <section className="flex flex-col gap-3">
      {/* Chrome-free shelf (2026-09-14): the desk's browse tile is the
       * only way in, so the ← desk bar is the way out. Same object as
       * the reader shelf / conjugate headers. */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          data-testid="kanji-back-desk"
          to="/dashboard"
        >
          ← desk
        </Link>
        <h1 className="font-semibold text-lg">Kanji</h1>
      </header>
      <p className="text-muted-foreground text-sm">
        {gridSubtitle(level, rows.length, progressNoteText)}
      </p>
      <nav
        aria-label="Kanji level filter"
        className="flex flex-wrap gap-2"
        data-testid="kanji-levels"
      >
        {JLPT_LEVELS.map((lvl: JlptLevel) => (
          <LevelTab active={lvl === level} key={lvl} level={lvl} />
        ))}
      </nav>
      {isPending ? <Loader /> : null}
      {isError ? (
        <KanjiError isFetching={isFetching} level={level} onRetry={onRetry} />
      ) : null}
      {ready && rows.length > 0 ? (
        <KanjiSearch onChange={onQueryChange} value={query} />
      ) : null}
      {ready ? (
        <KanjiGrid
          level={level}
          onClearQuery={onClearQuery}
          progress={progress}
          query={query}
          rows={shown}
        />
      ) : null}
    </section>
  );
}

/*
 * 2026-09-14: the list query used to swallow failures into an empty list,
 * so a CORS-blocked or down server rendered the empty grid with an
 * "offline?" note as if it were data. Now it's an error state, and it
 * says what to do. (The kanji.test.ts source guard pins the old copy out.)
 */
function KanjiError({
  isFetching,
  level,
  onRetry,
}: {
  isFetching: boolean;
  level: JlptLevel;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2" data-testid="kanji-error">
      <p className="text-sm">
        Couldn't reach the kanji service for {level}. Check the app server is
        running, then try again.
      </p>
      <button
        className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        data-testid="kanji-retry"
        disabled={isFetching}
        onClick={onRetry}
        type="button"
      >
        {isFetching ? "retrying…" : "retry"}
      </button>
    </div>
  );
}

/** Subtitle: counts + progress facts once the level has rows. */
const gridSubtitle = (level: JlptLevel, count: number, note: string): string =>
  count > 0
    ? `${count} ${level} kanji${note} · tap one for strokes, readings, and vocabulary`
    : "Browse by JLPT level · tap a kanji for strokes, readings, and vocabulary";

/** Meaning/character search over the loaded level (TASK-75). */
function KanjiSearch({
  onChange,
  value,
}: {
  onChange: (e: { target: { value: string } }) => void;
  value: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="sr-only">Search kanji by meaning or character</span>
      <input
        className="min-h-11 rounded-card border border-border bg-card px-3 py-1.5 text-sm outline-none focus-visible:border-primary"
        data-testid="kanji-search"
        onChange={onChange}
        placeholder="search by meaning (water, study…) or character"
        type="search"
        value={value}
      />
    </label>
  );
}

function LevelTab({ active, level }: { active: boolean; level: JlptLevel }) {
  // Stable per-level handler (noJsxPropsBind); the Link would navigate
  // anyway, but preventDefault + explicit search swap keeps the query
  // cache keyed identically across tab switches.
  const navigate = Route.useNavigate();
  const handleSelect = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      navigate({ search: { level } });
    },
    [level, navigate]
  );
  return (
    <Link
      className={
        active
          ? "rounded-card border-2 border-primary px-3 py-1 text-sm"
          : "rounded-card border-2 border-border px-3 py-1 text-sm"
      }
      data-active={active}
      data-testid="kanji-level"
      onClick={handleSelect}
      search={{ level }}
      to="/kanji"
    >
      {level}
    </Link>
  );
}

interface KanjiGridProps {
  level: JlptLevel;
  onClearQuery: () => void;
  progress: KanjiProgress;
  query: string;
  rows: readonly KanjiListRow[];
}

function KanjiGrid({
  level,
  onClearQuery,
  progress,
  query,
  rows,
}: KanjiGridProps) {
  if (rows.length === 0) {
    // A search miss says so and offers the way out; a genuinely empty
    // level (reachable-but-no-rows) stays the plain honest note. The
    // error state lives in KanjiIndex, not here.
    if (query.trim() !== "") {
      return (
        <div
          className="flex items-center gap-2"
          data-testid="kanji-search-empty"
        >
          <p className="text-muted-foreground text-sm">
            Nothing in {level} matches “{query.trim()}”.
          </p>
          <button
            className="min-h-11 rounded-card px-2 py-1 text-muted-foreground text-sm underline hover:text-foreground"
            data-testid="kanji-search-clear"
            onClick={onClearQuery}
            type="button"
          >
            clear search
          </button>
        </div>
      );
    }
    return (
      <p className="text-muted-foreground text-sm" data-testid="kanji-empty">
        No kanji listed for {level} yet.
      </p>
    );
  }
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2"
      data-testid="kanji-grid"
    >
      {rows.map((row) => (
        <KanjiCell
          key={row.character}
          level={level}
          progress={progress}
          row={row}
        />
      ))}
    </ul>
  );
}

function KanjiCell({
  level,
  progress,
  row,
}: {
  level: JlptLevel;
  progress: KanjiProgress;
  row: KanjiListRow;
}) {
  const state = cellState(progress, row.character);
  const learned = state === "learned";
  const seen = state === "seen";
  const frame =
    "relative flex h-full flex-col items-center rounded-card border-2 px-2 py-3 text-center transition-colors hover:bg-accent hover:text-accent-foreground";
  return (
    <li>
      <Link
        aria-label={`${row.character} · ${row.gloss || "kanji"} (${
          row.strokeCount
        } strokes)${state === "none" ? "" : ` ${state}`}`}
        className={
          learned ? `${frame} border-primary bg-card` : `${frame} border-border`
        }
        data-learned={learned}
        data-seen={seen}
        data-testid="kanji-cell"
        params={{ character: row.character }}
        search={{ level }}
        to="/kanji/$character"
      >
        {state === "none" ? null : (
          <span
            aria-hidden="true"
            className={
              learned
                ? "absolute end-1.5 top-1.5 size-2 rounded-full bg-primary"
                : "absolute end-1.5 top-1.5 size-2 rounded-full bg-muted-foreground/40"
            }
            data-testid="kanji-cell-dot"
          />
        )}
        <span className="font-mono text-3xl">{row.character}</span>
        <span className="mt-1 line-clamp-2 text-[11px] text-muted-foreground leading-tight">
          {row.gloss}
        </span>
        <span className="mt-1 text-[10px] text-muted-foreground">
          {row.strokeCount} strokes
        </span>
      </Link>
    </li>
  );
}
