import { createFileRoute, redirect } from "@tanstack/react-router";

// data: local-state — TASK-72 redirect. The lesson moved to /lesson (the
// chrome-free worksheet); this stub preserves old deep links + the desk
// hero's history with a 301-style beforeLoad redirect, forwarding search
// params (level/goal). No fetch.
export const Route = createFileRoute("/learn/lesson")({
  beforeLoad: ({ search }) => {
    throw redirect({ search, to: "/lesson" });
  },
  component: LegacyRedirectComponent,
});

function LegacyRedirectComponent() {
  return null;
}
