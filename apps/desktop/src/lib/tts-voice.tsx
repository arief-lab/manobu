/*
 * TTS voice wiring (TASK-21.1).
 *
 * Provides a lightweight app-level TtsContext so ▶ surfaces can read
 * voice + sid + speed without importing the Settings provider directly.
 *
 * Sid mapping follows the shipped TTS voice (TASK-174/154):
 * packages/speech/src/models.ts exports `TTS_MODEL_ID`, the Supertonic 3
 * manifest entry. Supertonic ships 10 built-in voices, so `sid` selects one
 * of them directly — no extra voice files are registered.
 *
 * Speed is taken from ListenType's existing 0.8×/1× control per spec;
 * surfaces that don't have their own speed control default to 1.
 */

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  getSettings,
  subscribeSettings,
  type VoiceChoice,
} from "@/lib/settings";

/**
 * Map Settings.voice → speak() opts { sid, speed }.
 *
 * varied / female → sid 0 (Supertonic built-in speaker 0).
 * male → sid 1 (Supertonic ships 10 built-in voices; sid 1 is the second.
 * Which sid sounds male is not documented upstream, so this mapping is
 * placeholder until a listening pass picks the real pair.)
 */
export const ttsVoiceOpts = (
  voice: VoiceChoice,
  speed = 1
): { sid: number; speed: number } => {
  const sid: number = voice === "male" ? 1 : 0;
  return { sid, speed };
};

export interface TtsPrefs {
  sid: number;
  speed: number;
  voice: VoiceChoice;
}

const TtsContext = createContext<TtsPrefs | null>(null);

interface TtsProviderProps {
  children: ReactNode;
}

/*
 * 2026-09-14 (state audit): the provider used to mirror the persisted
 * voice in useState + a subscription, and Settings wrote BOTH the store
 * and the mirror (double source of truth, with a setSpeed no surface
 * ever called). Now there is one source: the settings store. The
 * provider subscribes with useSyncExternalStore, so a patchSettings
 * write moves every ▶ surface in one render — no setter seam needed.
 * Speed is per-surface (drill/listen keep their own 0.8×/1× toggle),
 * so the provider speaks at the default 1×.
 */
export const TtsProvider = ({ children }: TtsProviderProps) => {
  const voice = useSyncExternalStore(
    subscribeSettings,
    () => getSettings().voice,
    () => getSettings().voice
  );
  const prefs = useMemo<TtsPrefs>(
    () => ({ ...ttsVoiceOpts(voice), voice }),
    [voice]
  );
  return <TtsContext.Provider value={prefs}>{children}</TtsContext.Provider>;
};

/**
 * Surfaces call this to read current TTS prefs. Throws if used outside
 * TtsProvider (mirrors existing useListen / useDrill / useReader guards).
 */
export function useTtsPrefs(): TtsPrefs {
  const ctx = useContext(TtsContext);
  if (!ctx) {
    throw new Error("useTtsPrefs must be used within TtsProvider");
  }
  return ctx;
}
