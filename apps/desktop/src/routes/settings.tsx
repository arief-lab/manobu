import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { Settings } from "@/features/settings/settings";
import type { SettingsTab } from "@/features/settings/settings-scope";
import {
  speechModelsQueryOptions,
  speechStatusQueryOptions,
} from "@/lib/tauri-queries";

/* TASK-76: two tabs (learning | app). Old deep links (?tab=model/data/
   appearance/about) catch to the default instead of 404ing. */
const settingsSearchSchema = z.object({
  tab: z.enum(["app", "learning"]).default("learning").catch("learning"),
});

export const Route = createFileRoute("/settings")({
  component: SettingsComponent,
  errorComponent: ({ error }) => (
    <div className="p-4 text-destructive text-sm">
      Failed to load settings: {error.message}
    </div>
  ),
  // TASK-25.2: warm speech_status + speech models before the Settings
  // component mounts so the SpeechModels row / auto-pick UI render with
  // real data on first paint. cron_jobs + cron history ride the same
  // cache via lib/tauri-queries.ts inside ScheduledTasks (2026-09-14).
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(speechStatusQueryOptions),
      queryClient.ensureQueryData(speechModelsQueryOptions),
    ]),
  validateSearch: settingsSearchSchema,
});

function SettingsComponent() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setTab = useCallback(
    (next: SettingsTab) => {
      navigate({ search: { tab: next } });
    },
    [navigate]
  );
  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-4 p-4">
      {/* 2026-09-14 (user): no top bar. The old header row (← desk ·
       * Settings · subtitle) duplicated what the tabs row already
       * carries; the page IS settings. The ← desk pill stays — this
       * route is chrome-free, so it is the only way back — but it sits
       * inline with the tabs now. */}
      <Settings activeTab={tab} onTabChange={setTab}>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="min-h-11 rounded-card border border-border px-3 py-1.5 text-sm hover:bg-muted"
            data-testid="settings-back-desk"
            to="/dashboard"
          >
            ← desk
          </Link>
          <Settings.Tabs />
        </div>
        <Settings.Section id="learning">
          <Settings.Learning />
        </Settings.Section>
        <Settings.Section id="app">
          <Settings.App />
        </Settings.Section>
      </Settings>
    </div>
  );
}
