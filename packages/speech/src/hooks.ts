import { useCallback, useState } from "react";

import { isSttReady, transcribeFile } from "./stt";
import {
  ensurePlaybackAudioContext,
  isTtsReady,
  playWavBytes,
  speak,
} from "./tts";
import { detectVad } from "./vad";

/**
 * React hook for TTS · wraps `speak` with loading / error state.
 *
 * Usage:
 * ```tsx
 * const { speak, speaking, error } = useTts();
 * <button onClick={() => speak("こんにちは")}>Say it</button>
 * ```
 */
export function useTts() {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speakText = useCallback(
    async (text: string, opts?: { speed?: number; sid?: number }) => {
      setSpeaking(true);
      setError(null);
      // Capture the WebAudio context synchronously, before the first await,
      // so playback stays inside the click-turn user activation. Tauri's
      // Linux WebKitGTK webview closes the activation once an await resolves
      // and rejects HTMLMediaElement `.play()` with NotAllowedError.
      const audioCtx = ensurePlaybackAudioContext();
      try {
        if (!audioCtx) {
          throw new Error("WebAudio is unavailable in this environment");
        }
        const ready = await isTtsReady();
        if (!ready) {
          const isInTauri =
            typeof window !== "undefined" && "__TAURI__" in window;
          throw new Error(
            isInTauri
              ? "TTS not initialized · call initTts(modelId) first"
              : "TTS only available in Tauri desktop · stub in web/browser"
          );
        }
        const { wav } = await speak(text, opts);
        await playWavBytes(wav, audioCtx);
        setSpeaking(false);
      } catch (e) {
        setError(String(e));
        setSpeaking(false);
        throw e;
      }
    },
    []
  );

  return { error, speak: speakText, speaking };
}

export function useStt() {
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(async (wavPath: string) => {
    setTranscribing(true);
    setError(null);
    try {
      const ready = await isSttReady();
      if (!ready) {
        const isInTauri =
          typeof window !== "undefined" && "__TAURI__" in window;
        throw new Error(
          isInTauri
            ? "STT not initialized · call initStt(modelId) first"
            : "STT only available in Tauri desktop · stub in web/browser"
        );
      }
      const res = await transcribeFile(wavPath);
      return res.text;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setTranscribing(false);
    }
  }, []);

  return { error, transcribe, transcribing };
}

export function useVad() {
  const [segments, setSegments] = useState<import("./types").VadSegment[]>([]);

  const detect = useCallback(
    async (samples: Float32Array, sampleRate?: number) => {
      const segs = await detectVad(samples, sampleRate);
      setSegments(segs);
      return segs;
    },
    []
  );

  return { detect, segments };
}
