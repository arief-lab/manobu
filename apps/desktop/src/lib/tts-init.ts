/*
 * TTS engine bootstrap (TASK-154).
 *
 * Mirrors `ensureVad` in `lib/mic-stt.ts`: one-shot init at boot, success
 * cached for the session, failures retry on the next call so a voice
 * downloaded mid-session (Settings, or the exam's first-run offer) activates
 * without an app restart.
 *
 * The engine itself lives in the Tauri shell; outside Tauri (web dev) there
 * is no voice at all and this resolves `false` without touching invoke.
 */

import { TTS_MODEL_ID } from "@manobu/speech/models";
import { initTts } from "@manobu/speech/tts";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI__" in window;

let ttsReady = false;

/**
 * One-shot Supertonic init. Best-effort: resolves `false` outside Tauri or
 * when the model is absent — callers must not block on it.
 */
export const ensureTts = async (): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  if (ttsReady) {
    return true;
  }
  try {
    await initTts(TTS_MODEL_ID);
    ttsReady = true;
  } catch {
    ttsReady = false;
  }
  return ttsReady;
};

/** Test-only reset so the init-once cache doesn't leak between tests. */
export const resetTtsReady = (): void => {
  ttsReady = false;
};

/** Whether the session already holds an initialized TTS engine. */
export const isTtsBootstrapped = (): boolean => ttsReady;
