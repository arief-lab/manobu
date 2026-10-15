import { createFileRoute, Outlet } from "@tanstack/react-router";

// data: local-state — /kanji is a layout wrapper (no loader, no fetch).
// TASK-31: /kanji parent; TASK-71.1: hosts the /kanji/ index grid +
// /kanji/$character (SCR-09 Kanji Detail, path param), and gives kanji
// surfaces a proper hierarchy with room for shared chrome later.
export const Route = createFileRoute("/kanji")({
  component: KanjiLayout,
});

function KanjiLayout() {
  // Same container as the conjugate/reader focus surfaces (2026-09-14):
  // centered, capped — the grid ran full-bleed at wide viewports.
  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-4 p-4">
      <Outlet />
    </div>
  );
}
