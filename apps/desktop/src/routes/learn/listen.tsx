import { createFileRoute, redirect } from "@tanstack/react-router";

// data: local-state — router audit (2026-09-14): /listen is the real
// chrome-free desk now (the last /learn child moved up, joining
// lesson/reader/roleplay/drill/conjugate). This stub preserves old
// deep links + the ?chart search param with a beforeLoad redirect.
// No fetch.
export const Route = createFileRoute("/learn/listen")({
  beforeLoad: ({ search }) => {
    throw redirect({ search, to: "/listen" });
  },
  component: LegacyRedirectComponent,
});

function LegacyRedirectComponent() {
  return null;
}
