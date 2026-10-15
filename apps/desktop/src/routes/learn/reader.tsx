import { createFileRoute, redirect } from "@tanstack/react-router";

// data: local-state — TASK-72 redirect. The reader moved to /reader (the
// chrome-free reading corner); this stub preserves old deep links + the
// ?story= search param with a 301-style beforeLoad redirect. No fetch.
export const Route = createFileRoute("/learn/reader")({
  beforeLoad: ({ search }) => {
    throw redirect({ search, to: "/reader" });
  },
  component: LegacyRedirectComponent,
});

function LegacyRedirectComponent() {
  return null;
}
