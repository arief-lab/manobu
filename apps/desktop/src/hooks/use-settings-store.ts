import { useSyncExternalStore } from "react";
import { getSettings, type Settings, subscribeSettings } from "@/lib/settings";

/**
 * The React read seam for the persisted settings store (2026-09-14 state
 * audit). Surfaces outside the Settings page — the review desk reads
 * `retention` + `fsrsAdvanced` — subscribe through this so a
 * `patchSettings` write re-renders every consumer from ONE source of truth.
 * `lib/settings.ts` stays framework-free (module state + subscribe +
 * localStorage); this hook is the only React binding, mirroring how
 * `learner-level` keeps its store pure.
 */
export const useSettingsStore = (): Settings =>
  useSyncExternalStore(subscribeSettings, getSettings, getSettings);
