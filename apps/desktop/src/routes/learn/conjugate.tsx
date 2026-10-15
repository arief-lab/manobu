import { createFileRoute, redirect } from "@tanstack/react-router";

// data: local-state — SCR-06 redesign (2026-09-13): the conjugate lab moved
// to /conjugate as a chrome-free focus surface. This stub preserves old
// deep links with a beforeLoad redirect. No fetch.
export const Route = createFileRoute("/learn/conjugate")({
  beforeLoad: () => {
    throw redirect({ to: "/conjugate" });
  },
  component: LegacyRedirectComponent,
});

function LegacyRedirectComponent() {
  return null;
}
