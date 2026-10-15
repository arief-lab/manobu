import { createFileRoute } from "@tanstack/react-router";

import { Setup } from "@/features/setup/setup";

// data: local-state — Setup compound owns its selection state in the
// SetupScope context; the sensei probe rides react-query inside the rail
// (component-driven, Tier 2 per src/features/AGENTS.md). Chrome-free +
// full-screen comes from __root's chromeFree branch.
export const Route = createFileRoute("/setup")({
  component: SetupComponent,
});

function SetupComponent() {
  return (
    <Setup>
      <Setup.Rail />
      <Setup.Grid />
      <Setup.Begin />
    </Setup>
  );
}
