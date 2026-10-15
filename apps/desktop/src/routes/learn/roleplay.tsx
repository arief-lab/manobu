import { createFileRoute, redirect } from "@tanstack/react-router";

// data: local-state — TASK-73 redirect. Roleplay moved to /roleplay (the
// chrome-free exchange); this stub preserves old deep links + the ?scene=
// search param with a 301-style beforeLoad redirect. No fetch.
export const Route = createFileRoute("/learn/roleplay")({
  beforeLoad: ({ search }) => {
    throw redirect({ search, to: "/roleplay" });
  },
  component: LegacyRedirectComponent,
});

function LegacyRedirectComponent() {
  return null;
}
