/*
 * Settings (SCR-11) compound component — redesign 2026-09-14 (TASK-76).
 *
 * What changed and why (the pre-redesign surface was broken, not just
 * ugly — browser-verified): the four tab pills were decorative (every
 * section rendered unconditionally, clicking a tab only moved the URL +
 * aria-pressed), "Appearance" had zero content (one theme per DESIGN.md),
 * nothing persisted (v1 was in-memory), and the copy was the spec sheet
 * rendered as UI (the fallback-chain title, the keychain/SQLite note, the
 * 21-param lists). Now:
 *   - Two real tabs split by audience: Learning (the learner's 10%) and
 *     App (the infra the learner rarely touches). Sections gate on
 *     activeTab — `Settings.Section id="learning"` renders children only
 *     when their tab is active.
 *   - Persistence: lib/settings.ts is a localStorage store (learner-level
 *     pattern, validated reads); the provider binds to it directly, so
 *     retention/correction/voice/telemetry survive restart and every
 *     surface (tts-voice, drill grading) reads the same source.
 *   - Copy is learner-voice: retention explains itself as a slip rate,
 *     correction style shows two example cards instead of radios, the
 *     spec dumps are gone (they live in this file + the DOX where they
 *     belong).
 *
 * Composition (Vercel pattern, no boolean-prop explosion):
 *   <Settings>                  provider (tab state + persisted store)
 *     <Settings.Tabs            Learning | App
 *     <Settings.Section id>     gates children on the active tab
 *     <Settings.Learning        retention + correction cards + voice +
 *                               level/goal + collapsed Advanced
 *     <Settings.App             model chain + speech + cron + privacy + about
 *   </Settings>
 */

import {
  RETENTION_MAX,
  RETENTION_MIN,
} from "@manobu/api-contract/schemas/cards";
import {
  ensurePlaybackAudioContext,
  isTtsReady,
  playWavBytes,
  speak,
} from "@manobu/speech/tts";
import { t } from "@manobu/ui/lib/copy";
import {
  type ReactNode,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { PrivacyTab } from "@/features/settings/settings-privacy";
import { ScheduledTasks } from "@/features/settings/settings-scheduled-tasks";
import {
  SettingsScopeProvider,
  type SettingsState,
  type SettingsTab,
  useSettings,
} from "@/features/settings/settings-scope";
import { SpeechModels } from "@/features/settings/settings-speech-models";
import { isTauriAvailable } from "@/lib/queue";
import {
  type CorrectionStyle,
  getSettings,
  isRetentionDoublingWarn,
  type ModelChoice,
  patchSettings,
  retentionSlipOdds,
  type Settings as SettingsShape,
  subscribeSettings,
  type VoiceChoice,
} from "@/lib/settings";
import { ttsVoiceOpts } from "@/lib/tts-voice";
import { GoalPicker } from "./settings-goal";
import { LevelPicker } from "./settings-level";

const TABS: ReadonlyArray<{
  id: SettingsTab;
  key: "set.tab.app" | "set.tab.learning";
}> = [
  { id: "learning", key: "set.tab.learning" },
  { id: "app", key: "set.tab.app" },
];

const Tabs = () => {
  const { activeTab, setActiveTab } = useSettings();
  return (
    <nav
      aria-label="Settings tabs"
      className="flex gap-2"
      data-active-tab={activeTab}
      data-testid="settings-tabs"
    >
      {TABS.map((tab) => {
        const onClick = () => {
          setActiveTab(tab.id);
        };
        const active = activeTab === tab.id;
        return (
          <button
            aria-pressed={active}
            className={
              active
                ? "min-h-11 rounded-card border-2 border-primary bg-card px-3 py-1 text-sm"
                : "min-h-11 rounded-card border-2 border-border px-3 py-1 text-muted-foreground text-sm hover:bg-muted"
            }
            data-tab={tab.id}
            data-testid="settings-tab"
            key={tab.id}
            onClick={onClick}
            type="button"
          >
            {t(tab.key)}
          </button>
        );
      })}
    </nav>
  );
};

/**
 * The gating primitive the old compound lacked: children render only when
 * their tab is active. Without this the "tabs" were decoration (2026-09-14
 * diagnosis: every section rendered at once, clicking only moved the URL).
 */
const Section = ({
  children,
  id,
}: {
  children: ReactNode;
  id: SettingsTab;
}) => {
  const { activeTab } = useSettings();
  if (activeTab !== id) {
    return null;
  }
  return <div className="flex flex-col gap-6">{children}</div>;
};

/* ── Learning tab ──────────────────────────────────────────────── */

const RetentionCard = () => {
  const { settings } = useSettings();
  const pct = Math.round(settings.retention * 100);
  const onSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    patchSettings({ retention: Number(e.target.value) / 100 });
  };
  return (
    <section
      aria-label="Review challenge"
      className="flex flex-col gap-3"
      data-testid="settings-retention-card"
    >
      <h2 className="font-semibold text-lg">
        {t("set.learning.retention.title")}
      </h2>
      <p
        className="text-muted-foreground text-sm"
        data-testid="settings-retention-body"
      >
        {t("set.learning.retention.body", {
          pct,
          slips: retentionSlipOdds(settings.retention),
        })}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <span>70%</span>
        <input
          aria-label="Desired retention"
          aria-valuemax={Math.round(RETENTION_MAX * 100)}
          aria-valuemin={Math.round(RETENTION_MIN * 100)}
          aria-valuenow={pct}
          className="flex-1"
          data-testid="settings-retention-slider"
          max={Math.round(RETENTION_MAX * 100)}
          min={Math.round(RETENTION_MIN * 100)}
          onChange={onSlider}
          type="range"
          value={pct}
        />
        <span className="font-mono" data-testid="settings-retention-value">
          {pct}%
        </span>
      </label>
      {isRetentionDoublingWarn(settings.retention) ? (
        <p
          aria-live="polite"
          className="text-muted-foreground text-xs"
          data-testid="settings-retention-warn"
        >
          {t("set.learning.retention.doubling_warn", { pct })}
        </p>
      ) : null}
    </section>
  );
};

const CorrectionCard = () => {
  const { settings } = useSettings();
  const pick = (value: CorrectionStyle) => () => {
    patchSettings({ correction: value });
  };
  const card = (value: CorrectionStyle) =>
    settings.correction === value
      ? "flex flex-1 flex-col items-start gap-1 rounded-card border-2 border-primary bg-card p-3 text-left"
      : "flex flex-1 flex-col items-start gap-1 rounded-card border-2 border-border bg-card p-3 text-left hover:bg-muted";
  return (
    <section
      aria-label="Correction style"
      className="flex flex-col gap-3"
      data-testid="settings-correction-card"
    >
      <h2 className="font-semibold text-lg">{t("set.corr.title")}</h2>
      <div
        className="flex flex-wrap gap-2"
        data-testid="settings-correction-fieldset"
      >
        <button
          aria-pressed={settings.correction === "ask"}
          className={card("ask")}
          data-correction="ask"
          data-testid="settings-correction-ask"
          onClick={pick("ask")}
          type="button"
        >
          <span className="font-medium text-sm">{t("set.corr.ask")}</span>
          <span className="text-muted-foreground text-xs">
            {t("set.corr.ask.desc")}
          </span>
        </button>
        <button
          aria-pressed={settings.correction === "tell"}
          className={card("tell")}
          data-correction="tell"
          data-testid="settings-correction-tell"
          onClick={pick("tell")}
          type="button"
        >
          <span className="font-medium text-sm">{t("set.corr.tell")}</span>
          <span className="text-muted-foreground text-xs">
            {t("set.corr.tell.desc")}
          </span>
        </button>
      </div>
    </section>
  );
};

const VoiceCard = () => {
  const { settings } = useSettings();
  /* State, not ref: the old previewError ref never re-rendered, so the
   * failure line was invisible. Preview speaks only when a TTS engine is
   * ready (TASK-21.1); otherwise the quiet no-output note stands. */
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [heard, setHeard] = useState<VoiceChoice | null>(null);
  const playPreview = useCallback(async (voice: VoiceChoice) => {
    setPreviewError(null);
    // Capture the AudioContext synchronously on this change turn, before any
    // `await`. Tauri's Linux WebKitGTK webview closes the user activation once
    // an await resolves, so `Audio(url).play()` after `speak()` rejects with
    // NotAllowedError and the preview is silent (see shared/listen-button.tsx).
    const audioCtx = ensurePlaybackAudioContext();
    try {
      if (!audioCtx) {
        throw new Error("WebAudio is unavailable in this environment");
      }
      if (!(await isTtsReady())) {
        return;
      }
      const { sid } = ttsVoiceOpts(voice);
      const { wav } = await speak("こんにちは", { sid });
      await playWavBytes(wav, audioCtx);
      setHeard(voice);
    } catch (e) {
      setPreviewError(String(e));
    }
  }, []);
  const pick = (value: VoiceChoice) => () => {
    /* One write: the store. TtsProvider subscribes to it, so every ▶
     * surface follows in the same render (2026-09-14 state audit: the
     * old code also pushed into a provider mirror — two sources). */
    patchSettings({ voice: value });
    playPreview(value);
  };
  const row = (value: VoiceChoice, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        checked={settings.voice === value}
        data-testid={`settings-voice-${value}`}
        name="voice"
        onChange={pick(value)}
        type="radio"
      />
      <span>{label}</span>
      {heard === value ? (
        <span aria-hidden className="text-muted-foreground text-xs">
          🔊
        </span>
      ) : null}
    </label>
  );
  return (
    <section
      aria-label="Voice"
      className="flex flex-col gap-3"
      data-testid="settings-voice-card"
    >
      <h2 className="font-semibold text-lg">{t("set.voice.title")}</h2>
      <p className="text-muted-foreground text-sm">{t("set.voice.body")}</p>
      <div className="flex flex-col gap-1">
        {row("varied", t("voice.varied"))}
        {row("female", t("voice.female"))}
        {row("male", t("voice.male"))}
      </div>
      {previewError === null ? (
        <p
          aria-live="polite"
          className="text-muted-foreground text-xs"
          data-testid="settings-voice-no-output"
        >
          {t("voice.no_output")}
        </p>
      ) : (
        <p
          aria-live="polite"
          className="text-destructive text-xs"
          data-testid="settings-voice-preview-error"
        >
          {previewError}
        </p>
      )}
    </section>
  );
};

const AdvancedCard = () => {
  const { settings } = useSettings();
  const onAdvanced = () => {
    patchSettings({ fsrsAdvanced: !settings.fsrsAdvanced });
  };
  return (
    <section
      aria-label="Advanced review settings"
      className="flex flex-col gap-2"
      data-testid="settings-advanced-card"
    >
      <button
        aria-expanded={settings.fsrsAdvanced}
        className="min-h-11 self-start rounded-card border-2 border-border px-3 py-1 text-xs"
        data-testid="settings-fsrs-advanced-toggle"
        onClick={onAdvanced}
        type="button"
      >
        {t("set.learning.advanced")} {settings.fsrsAdvanced ? "▴" : "▸"}
      </button>
      {settings.fsrsAdvanced ? (
        <section
          aria-label="21-params D/S/R"
          className="rounded-card border-2 border-border p-2"
          data-testid="settings-fsrs-advanced-panel"
        >
          <p className="font-mono text-xs">
            D / S / R · 21-params FSRS-6 · defaults loaded · reschedule on
            change
          </p>
        </section>
      ) : null}
    </section>
  );
};

const LearningTab = () => (
  <>
    <RetentionCard />
    <CorrectionCard />
    <VoiceCard />
    <LevelPicker />
    <GoalPicker />
    <AdvancedCard />
  </>
);

/* ── App tab ───────────────────────────────────────────────────── */

const ModelCard = () => {
  const { settings } = useSettings();
  const chain: readonly ModelChoice[] = ["local", "byok", "cache"];
  const storageUsed = 0;
  const storageCap = 100;
  return (
    <section
      aria-label="Answer source"
      className="flex flex-col gap-3"
      data-testid="settings-model-tab"
    >
      <h2 className="font-semibold text-lg">{t("app.model.title")}</h2>
      <p className="text-muted-foreground text-sm">{t("app.model.body")}</p>
      <ol className="flex flex-col gap-1 text-sm">
        {chain.map((step, idx) => (
          <li
            className="flex items-center gap-2"
            data-active={settings.model === step}
            data-step={step}
            key={step}
          >
            <span aria-hidden>{idx + 1}.</span>
            <span>{step.toUpperCase()}</span>
            {settings.model === step ? <span aria-hidden>●</span> : null}
          </li>
        ))}
      </ol>
      <output
        aria-label="Storage usage"
        className="block text-muted-foreground text-xs"
        data-testid="settings-storage-bar"
      >
        Storage: {storageUsed}MB / {storageCap}MB
      </output>
    </section>
  );
};

const DesktopOnlyNote = () => {
  const desktop = useSyncExternalStore(
    () => () => undefined,
    () => isTauriAvailable(),
    () => false
  );
  if (desktop) {
    return null;
  }
  return (
    <p
      className="text-muted-foreground text-xs"
      data-testid="settings-desktop-only"
    >
      {t("app.desktop.only")}
    </p>
  );
};

const AppTab = () => (
  <>
    <ModelCard />
    <DesktopOnlyNote />
    <section
      aria-label="Speech and tasks"
      className="flex flex-col gap-3"
      data-testid="settings-speech-section"
    >
      <h2 className="font-semibold text-lg">{t("app.speech.title")}</h2>
      <p className="text-muted-foreground text-sm">{t("app.speech.body")}</p>
      <SpeechModels />
      <ScheduledTasks />
    </section>
    <PrivacyTab />
    <section
      aria-label="About"
      className="flex flex-col gap-3"
      data-testid="settings-about-tab"
    >
      <h2 className="font-semibold text-lg">About</h2>
      <p className="text-sm">{t("set.about.shortcuts")}</p>
      <p className="text-muted-foreground text-sm">{t("set.about.offline")}</p>
    </section>
  </>
);

/* ── root provider ─────────────────────────────────────────────── */

interface SettingsProps {
  activeTab?: SettingsTab;
  children: ReactNode;
  initial?: Partial<SettingsShape>;
  onTabChange?: (tab: SettingsTab) => void;
}

const SettingsRoot = ({
  activeTab: controlledTab,
  children,
  initial,
  onTabChange,
}: SettingsProps) => {
  const [internalTab, setInternalTab] = useState<SettingsTab>("learning");
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = useCallback(
    (tab: SettingsTab) => {
      if (onTabChange) {
        onTabChange(tab);
      } else {
        setInternalTab(tab);
      }
    },
    [onTabChange]
  );
  /* The persisted store is the source of truth; `initial` overrides for
   * tests/dev. useSyncExternalStore re-renders every Settings surface on
   * any patchSettings write (learner-level.ts pattern). */
  const storeSettings = useSyncExternalStore(
    subscribeSettings,
    getSettings,
    getSettings
  );
  const settings = initial ? { ...storeSettings, ...initial } : storeSettings;
  const update = useCallback((patch: Partial<SettingsShape>) => {
    patchSettings(patch);
  }, []);
  const ctx: SettingsState = useMemo(
    () => ({ activeTab, setActiveTab, settings, update }),
    [activeTab, setActiveTab, settings, update]
  );
  return <SettingsScopeProvider value={ctx}>{children}</SettingsScopeProvider>;
};

export const Settings = Object.assign(SettingsRoot, {
  App: AppTab,
  Learning: LearningTab,
  Section,
  Tabs,
});
