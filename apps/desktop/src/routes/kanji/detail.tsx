import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// data: local-state — TASK-71.1: the detail page moved to /kanji/$character
// (path param, the docs' canonical resource-page shape). This stub keeps old
// ?character= deep links alive: the static `detail` segment matches before
// `$character`, so the redirect wins for that exact path. Unknown/absent
// character falls back to 食 (the old schema default).
const legacyDetailSearch = z.object({
  character: z.string().min(1).max(4).catch("食"),
  level: z.enum(["N5", "N4", "N3", "N2", "N1"]).default("N5").catch("N5"),
});

export const Route = createFileRoute("/kanji/detail")({
  beforeLoad: ({ search }) => {
    const { character, level } = legacyDetailSearch.parse(search);
    throw redirect({
      params: { character },
      replace: true,
      search: { level },
      to: "/kanji/$character",
    });
  },
  component: LegacyRedirectComponent,
});

function LegacyRedirectComponent() {
  return null;
}
