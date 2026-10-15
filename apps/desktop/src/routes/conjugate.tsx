import { createFileRoute, Link } from "@tanstack/react-router";

import { Conjugate } from "@/features/lesson/conjugate";

// data: local-state — verbs-n5.json is bundled at build time via the
// @manobu/japanese/data/* subpath export; classify()/conjugate() are pure
// TS. No fetch, no queryOptions. SCR-06 redesign (2026-09-13): /conjugate
// is a CHROME-FREE focus surface (own `← desk` bar, like /drill, /reader,
// /roleplay); /learn/conjugate is the redirect stub for old deep links.
export const Route = createFileRoute("/conjugate")({
  component: ConjugateComponent,
});

function ConjugateComponent() {
  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
          data-testid="conj-bar-desk"
          to="/dashboard"
        >
          ← desk
        </Link>
        <h1 className="font-semibold text-lg">Conjugate</h1>
      </header>
      <Conjugate />
    </div>
  );
}
