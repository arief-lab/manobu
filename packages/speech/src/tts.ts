import { invoke } from "@tauri-apps/api/core";

import type { TtsRequest, TtsResponse } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

export function initTts(modelId: string, modelDir?: string): Promise<string> {
  if (!isTauri) {
    return Promise.reject(new Error("TTS only in Tauri desktop"));
  }
  return invoke<string>("speech_init_tts", {
    request: { model_dir: modelDir ?? null, model_id: modelId },
  });
}

export function isTtsReady(): Promise<boolean> {
  if (!isTauri) {
    return Promise.resolve(false);
  }
  return invoke<boolean>("speech_tts_is_ready");
}

/**
 * Text → speech via sherpa-onnx OfflineTts (Supertonic 3).
 *
 * Returns the raw WAV bytes (16-bit PCM, 44.1 kHz mono) plus a convenience
 * `Blob` URL. Prefer `playWavBytes(wav, ctx)` from a click handler: the
 * `new Audio(url).play()` path rejects with NotAllowedError on Tauri's
 * Linux WebKitGTK webview once an await closes the user activation.
 */
export async function speak(
  text: string,
  opts?: { speed?: number; sid?: number }
): Promise<{ url: string; wav: Uint8Array; sampleRate: number }> {
  if (!isTauri) {
    throw new Error("TTS only in Tauri desktop · stub in web dev");
  }
  const req: TtsRequest = {
    sid: opts?.sid,
    speed: opts?.speed,
    text,
  };
  const res = await invoke<TtsResponse>("speech_tts", { request: req });
  const wav =
    res.wav instanceof Uint8Array
      ? res.wav
      : new Uint8Array(res.wav as number[]);
  const blob = new Blob([wav as BlobPart], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  return { sampleRate: res.sample_rate, url, wav };
}

export async function speakAndPlay(
  text: string,
  opts?: { speed?: number; sid?: number }
): Promise<void> {
  // Route through the WebAudio path so the click-turn user activation is
  // still open when playback starts. HTMLMediaElement `.play()` after an
  // await rejects with NotAllowedError on Tauri's Linux WebKitGTK webview.
  const ctx = ensurePlaybackAudioContext();
  if (!ctx) {
    throw new Error("WebAudio is unavailable in this environment");
  }
  const { wav } = await speak(text, opts);
  await playWavBytes(wav, ctx);
}

/**
 * Singleton AudioContext, created lazily and resumed if the browser paused
 * it. Call this synchronously from a click handler: WebKit only counts the
 * gesture as a user activation while the handler is still on the stack, so
 * `ensurePlaybackAudioContext()` must run before any `await` that gates
 * playback. Outside a DOM the function returns null and the caller falls
 * back to its demo path.
 */
let sharedPlaybackContext: AudioContext | null = null;
export function ensurePlaybackAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const Ctor = window.AudioContext;
  if (!Ctor) {
    return null;
  }
  if (!sharedPlaybackContext) {
    sharedPlaybackContext = new Ctor();
  }
  if (sharedPlaybackContext.state === "suspended") {
    sharedPlaybackContext.resume().catch(() => undefined);
  }
  return sharedPlaybackContext;
}

/**
 * Decode a RIFF/WAV byte buffer through an already-active AudioContext and
 * start it on an AudioBufferSourceNode. Resolves when the source's `ended`
 * event fires. Bypasses HTMLMediaElement entirely, so the WebKit autoplay
 * policy on `.play()` is not in the loop.
 *
 * `decodeAudioData` detaches the ArrayBuffer it is handed, so a private
 * copy is passed in and the caller's `wav` stays reusable.
 */
export async function playWavBytes(
  wav: Uint8Array,
  ctx: AudioContext
): Promise<void> {
  const copy = wav.slice();
  const buffer = await ctx.decodeAudioData(copy.buffer as ArrayBuffer);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  await new Promise<void>((resolve, reject) => {
    source.onended = () => {
      resolve();
    };
    try {
      source.start();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
