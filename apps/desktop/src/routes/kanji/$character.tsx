import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { KanjiDetail } from "@/features/kanji-detail/kanji-detail";
import { kanjiQueryOptions } from "@/lib/kanji-queries";

/*
 * SCR-09 Kanji Detail (TASK-71.1: was /kanji/detail?character=X + a manual
 * detail.lazy.tsx wrapper; the docs' canonical shape for a resource page is
 * a path segment, and autoCodeSplitting owns laziness now — the component
 * declared here still ships in its own lazy chunk).
 *
 * The character is a path param; ?level= stays search: it remembers which
 * grid the learner came from so ← returns to the same level.
 */
const kanjiDetailSearchSchema = z.object({
  level: z.enum(["N5", "N4", "N3", "N2", "N1"]).default("N5").catch("N5"),
});

export const Route = createFileRoute("/kanji/$character")({
  component: KanjiDetailComponent,
  errorComponent: ({ error }) => (
    <div className="p-4 text-destructive text-sm">
      Failed to load kanji: {error.message}
    </div>
  ),
  loader: ({ context: { queryClient }, params: { character } }) =>
    queryClient.ensureQueryData(kanjiQueryOptions(character)),
  notFoundComponent: () => (
    <div className="p-8 text-center text-muted-foreground text-sm">
      Kanji not found.
    </div>
  ),
  validateSearch: kanjiDetailSearchSchema,
});

function KanjiDetailComponent() {
  const { character } = Route.useParams();
  const { level } = Route.useSearch();
  return (
    <div className="flex flex-col gap-4">
      {/* Chrome-free focus surface (2026-09-14): same bar object as
       * /conjugate — pill back link + title row, subtitle below. */}
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
            data-testid="kanji-detail-back"
            search={{ level }}
            to="/kanji"
          >
            ← kanji
          </Link>
          <h1 className="font-mono font-semibold text-lg">
            {character}
            <span className="ml-2 font-sans text-muted-foreground text-sm">
              kanji detail
            </span>
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Stroke order, readings, and the words that use it.
        </p>
      </header>
      <KanjiDetail character={character}>
        <KanjiDetail.Hero />
        <KanjiDetail.Readings />
        <KanjiDetail.VocabRows />
        <KanjiDetail.DrawMini />
        <KanjiDetail.SenseiTip />
      </KanjiDetail>
    </div>
  );
}
