/*
 * Settings (spec §SCR-11) — the canonical user-preferences object, its
 * defaults, validation, and localStorage persistence.
 *
 * Persistence (TASK-76): settings survive restart. The store follows the
 * learner-level.ts pattern — module-level state + subscribe + best-effort
 * localStorage — but the shape is validated on read, so a corrupt or
 * hand-edited blob degrades to defaults instead of poisoning the app.
 * `@manobu/db` can take over the same read/write surface later without
 * touching consumers.
 */

// The band is the wire's, not this module's: `GradeInputSchema` rejects a
// retention outside it, so the slider, the stored setting and the grade
// request cannot drift into three different answers (TASK-166). Consumers
// that need the numbers import them from the contract directly.
import {
  DEFAULT_RETENTION,
  RETENTION_MAX,
  RETENTION_MIN,
} from "@manobu/api-contract/schemas/cards";

export type ModelChoice = "local" | "byok" | "cache";
export type CorrectionStyle = "ask" | "tell";
export type VoiceChoice = "varied" | "female" | "male";

export interface Settings {
  correction: CorrectionStyle;
  fsrsAdvanced: boolean;
  model: ModelChoice;
  retention: number;
  telemetry: boolean;
  voice: VoiceChoice;
}

export const DEFAULT_SETTINGS: Settings = {
  correction: "ask",
  fsrsAdvanced: false,
  model: "local",
  retention: DEFAULT_RETENTION,
  telemetry: false,
  voice: "varied",
};

const STORAGE_KEY = "manobu.settings";

const MODEL_CHOICES: readonly ModelChoice[] = ["local", "byok", "cache"];
const CORRECTIONS: readonly CorrectionStyle[] = ["ask", "tell"];
const VOICES: readonly VoiceChoice[] = ["varied", "female", "male"];

export const validateRetention = (value: number): number =>
  Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, value));

export const isRetentionDoublingWarn = (value: number): boolean =>
  value >= 0.95;

/**
 * The "1 in N" denominator for a retention target: at 90% about 1 in 10
 * cards slips. Feeds the honest retention sentence (TASK-76); floored at
 * 2 so the copy never reads "1 in 1".
 */
export const retentionSlipOdds = (value: number): number =>
  Math.max(2, Math.round(1 / Math.max(0.01, 1 - value)));

const oneOf = <T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T
): T => (allowed.includes(value as T) ? (value as T) : fallback);

const boolOf = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

/**
 * Coerce any parsed blob into a valid Settings. Unknown keys are dropped,
 * bad enum values fall back, retention is clamped — the stored shape is
 * external input, so nothing is trusted.
 */
const parseSettings = (raw: unknown): Settings => {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const o = raw as Record<string, unknown>;
  return {
    correction: oneOf(CORRECTIONS, o.correction, DEFAULT_SETTINGS.correction),
    fsrsAdvanced: boolOf(o.fsrsAdvanced, DEFAULT_SETTINGS.fsrsAdvanced),
    model: oneOf(MODEL_CHOICES, o.model, DEFAULT_SETTINGS.model),
    retention:
      typeof o.retention === "number"
        ? validateRetention(o.retention)
        : DEFAULT_SETTINGS.retention,
    telemetry: boolOf(o.telemetry, DEFAULT_SETTINGS.telemetry),
    voice: oneOf(VOICES, o.voice, DEFAULT_SETTINGS.voice),
  };
};

/* ── store (module state + subscribe, learner-level.ts pattern) ── */

const readStored = (): Settings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_SETTINGS;
    }
    return parseSettings(JSON.parse(raw));
  } catch {
    // private mode / corrupt JSON — defaults, never a crash
    return DEFAULT_SETTINGS;
  }
};

let current: Settings = DEFAULT_SETTINGS;
let initialized = false;
const subscribers = new Set<() => void>();

const ensureSettingsLoaded = (): Settings => {
  if (!initialized) {
    current = readStored();
    initialized = true;
  }
  return current;
};

export const getSettings = (): Settings => ensureSettingsLoaded();

export const updateSettings = (
  prev: Settings,
  patch: Partial<Settings>
): Settings => {
  const next: Settings = { ...prev, ...patch };
  if (typeof patch.retention === "number") {
    next.retention = validateRetention(patch.retention);
  }
  return next;
};

/** Apply a patch to the store and persist it (best-effort). */
export const patchSettings = (patch: Partial<Settings>): Settings => {
  const next = updateSettings(ensureSettingsLoaded(), patch);
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // private mode: the in-memory value still applies this session
  }
  for (const notify of subscribers) {
    notify();
  }
  return current;
};

export const subscribeSettings = (notify: () => void): (() => void) => {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
};

/** Test/dev seam: drop stored prefs and go back to defaults. */
export const resetSettings = (): Settings => {
  current = DEFAULT_SETTINGS;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
  for (const notify of subscribers) {
    notify();
  }
  return current;
};

export const __test__ = {
  isRetentionDoublingWarn,
  parseSettings,
  RETENTION_MAX,
  RETENTION_MIN,
  retentionSlipOdds,
  STORAGE_KEY,
  validateRetention,
};
