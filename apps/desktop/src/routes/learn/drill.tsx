import { createFileRoute, redirect } from "@tanstack/react-router";

// data: local-state — SCR-03 redesign (2026-09-13): the drill moved to
// /drill as a chrome-free focus surface (own `← desk` bar, like /reader
// and /roleplay). This stub preserves old deep links + the kind/chart
// search params with a beforeLoad redirect. No fetch.
export const Route = createFileRoute("/learn/drill")({
  beforeLoad: ({ search }) => {
    throw redirect({
      search: { cell: [], chart: "0", group: [], kind: "gojuon", ...search },
      to: "/drill",
    });
  },
  component: LegacyRedirectComponent,
});

function LegacyRedirectComponent() {
  return null;
}
