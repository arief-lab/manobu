import { createContext, useContext } from "react";

import type { Settings as SettingsShape } from "@/lib/settings";

/**
 * Two tabs, split by audience (TASK-76). The old four (model/data/
 * appearance/about) were decorative — every section rendered at once —
 * and "appearance" had no content (one theme per DESIGN.md, no toggle).
 */
export type SettingsTab = "app" | "learning";

export interface SettingsState {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
  settings: SettingsShape;
  update: (patch: Partial<SettingsShape>) => void;
}

const Scope = createContext<SettingsState | null>(null);

export const SettingsScopeProvider = Scope.Provider;

export const useSettings = (): SettingsState => {
  const ctx = useContext(Scope);
  if (!ctx) {
    throw new Error("useSettings must be used within Settings");
  }
  return ctx;
};
