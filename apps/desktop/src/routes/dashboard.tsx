import { createFileRoute } from "@tanstack/react-router";

import { Dashboard } from "@/features/dashboard/dashboard";

// data: local-state — the Dashboard provider reads synchronous sources at
// mount: learner-setup store (goal), learner-level, practice-days, and
// the cards-due query (cached, offlineFirst). Tier 2 per
// src/features/AGENTS.md. Chrome-free by design: the tiles ARE the
// navigation (Ask replaces the AI pane, Browse replaces the sidebar,
// rail footer carries theme + redo setup).
export const Route = createFileRoute("/dashboard")({
  component: DashboardComponent,
});

function DashboardComponent() {
  return (
    <Dashboard>
      <Dashboard.Rail />
      <Dashboard.Hero />
      <Dashboard.Due />
      <Dashboard.Momentum />
      <Dashboard.Ask />
      <Dashboard.Browse />
      <Dashboard.Nudge />
    </Dashboard>
  );
}
