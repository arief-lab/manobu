import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RETENTION_MAX,
  RETENTION_MIN,
} from "@manobu/api-contract/schemas/cards";
import {
  __test__,
  DEFAULT_SETTINGS,
  getSettings,
  isRetentionDoublingWarn,
  patchSettings,
  resetSettings,
  subscribeSettings,
  updateSettings,
  validateRetention,
} from "@/lib/settings";

describe("DEFAULT_SETTINGS", () => {
  it("has the spec defaults (90% retention, local model, ask, varied, telemetry off)", () => {
    expect(DEFAULT_SETTINGS.retention).toBe(0.9);
    expect(DEFAULT_SETTINGS.model).toBe("local");
    expect(DEFAULT_SETTINGS.correction).toBe("ask");
    expect(DEFAULT_SETTINGS.voice).toBe("varied");
    expect(DEFAULT_SETTINGS.telemetry).toBe(false);
    expect(DEFAULT_SETTINGS.fsrsAdvanced).toBe(false);
  });
});

describe("validateRetention", () => {
  it("clamps to [0.7, 0.97]", () => {
    expect(validateRetention(0.5)).toBe(RETENTION_MIN);
    expect(validateRetention(1.0)).toBe(RETENTION_MAX);
    expect(validateRetention(0.85)).toBe(0.85);
  });
});

describe("isRetentionDoublingWarn", () => {
  it("warns at >= 0.95", () => {
    expect(isRetentionDoublingWarn(0.94)).toBe(false);
    expect(isRetentionDoublingWarn(0.95)).toBe(true);
    expect(isRetentionDoublingWarn(0.97)).toBe(true);
  });
});

describe("updateSettings", () => {
  it("merges partial patches and clamps retention", () => {
    const result = updateSettings(DEFAULT_SETTINGS, {
      correction: "tell",
      retention: 1.5,
    });
    expect(result.correction).toBe("tell");
    expect(result.retention).toBe(RETENTION_MAX);
  });
});

describe("__test__ exports", () => {
  it("re-exports the retention range", () => {
    expect(__test__.RETENTION_MIN).toBe(0.7);
    expect(__test__.RETENTION_MAX).toBe(0.97);
  });
});

/* ── TASK-76: persistence store + real tabs ─────────────────────── */

describe("parseSettings (validated reads)", () => {
  it("degrades corrupt, null, and wrong-typed input to defaults", () => {
    expect(__test__.parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(__test__.parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(__test__.parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(__test__.parseSettings({ retention: "high" })).toEqual(
      DEFAULT_SETTINGS
    );
  });

  it("clamps retention, falls back per-field on bad enums, drops unknowns", () => {
    // batchSize is a dropped field (2026-09-14 state audit: it had no UI
    // and no reader — the review desk keeps its own ?batch= URL control);
    // an old stored blob carrying it must degrade cleanly, not survive.
    const parsed = __test__.parseSettings({
      batchSize: -3,
      correction: "yell",
      retention: 0.99,
      voice: "female",
      wat: true,
    });
    expect(parsed.retention).toBe(RETENTION_MAX);
    expect(parsed.correction).toBe(DEFAULT_SETTINGS.correction);
    expect("batchSize" in parsed).toBe(false);
    expect(parsed.voice).toBe("female");
    expect("wat" in parsed).toBe(false);
  });
});

describe("settings store (patchSettings roundtrip)", () => {
  it("writes, reads back via getSettings, notifies subscribers", () => {
    resetSettings();
    let notified = 0;
    const unsubscribe = subscribeSettings(() => {
      notified += 1;
    });
    patchSettings({ correction: "tell" });
    expect(getSettings().correction).toBe("tell");
    expect(notified).toBe(1);
    unsubscribe();
    patchSettings({ correction: "ask" });
    expect(notified).toBe(1); // unsubscribed
    resetSettings();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("retentionSlipOdds", () => {
  it("is the honest 1-in-N denominator, floored at 2", () => {
    expect(__test__.retentionSlipOdds(0.9)).toBe(10);
    expect(__test__.retentionSlipOdds(0.96)).toBe(25);
    expect(__test__.retentionSlipOdds(0.7)).toBe(3);
    expect(__test__.retentionSlipOdds(0.99)).toBeGreaterThanOrEqual(2);
  });
});

describe("settings surface contracts (TASK-76)", () => {
  const src = (rel: string): string =>
    readFileSync(join(import.meta.dirname, "..", "src", rel), "utf8");
  const compound = src("features/settings/settings.tsx");
  const route = src("routes/settings.tsx");

  it("tabs gate content: sections render through Settings.Section", () => {
    // the old compound rendered every section unconditionally — the
    // "tabs" only moved the URL. Section() must early-return off-tab.
    expect(compound).toContain("if (activeTab !== id)");
    expect(route).toContain('<Settings.Section id="learning">');
    expect(route).toContain('<Settings.Section id="app">');
  });

  it("the store is the source of truth for the provider", () => {
    expect(compound).toContain("useSyncExternalStore(");
    expect(compound).toContain("subscribeSettings");
    expect(compound).toContain("patchSettings(");
  });

  it("spec-voice copy is gone from the surface", () => {
    expect(compound).not.toContain("keychain never SQLite");
    expect(compound).not.toContain("fallback chain");
    expect(compound).not.toContain("Fuzz prevents spikes");
    const copy = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "packages/ui/src/lib/copy.ts"
      ),
      "utf8"
    );
    expect(copy).not.toContain("fallback chain: Local");
    expect(copy).not.toContain("Slider 70%");
  });

  it("the old four tabs are dead: two-tab schema with catch for deep links", () => {
    expect(route).toContain('enum(["app", "learning"])');
    expect(route).toContain('.catch("learning")');
    expect(compound).not.toContain("set.tab.appearance");
  });

  it("settings is chrome-free with its own desk bar", () => {
    const chromeFree = src("shared/chrome-free.ts");
    expect(chromeFree).toContain("CHROME_FREE_PATHS");
    expect(chromeFree).toContain('"/settings"');
    expect(route).toContain("settings-back-desk");
  });
});
