import { invoke } from "@tauri-apps/api/core";

import type { VadSegment } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

export function initVad(opts?: {
  modelId?: string;
  modelPath?: string;
}): Promise<string> {
  if (!isTauri) {
    return Promise.reject(new Error("VAD only in Tauri desktop"));
  }
  return invoke<string>("speech_init_vad", {
    request: {
      model_id: opts?.modelId ?? null,
      model_path: opts?.modelPath ?? null,
    },
  });
}

export function detectVad(
  samples: Float32Array,
  sampleRate = 16_000
): Promise<VadSegment[]> {
  if (!isTauri) {
    // Stub: naive energy check in JS so web dev doesn't crash
    const rms = Math.sqrt(
      Array.from(samples).reduce((s, v) => s + v * v, 0) / samples.length
    );
    if (rms > 0.01) {
      return Promise.resolve([
        { end_ms: (samples.length * 1000) / sampleRate, start_ms: 0 },
      ]);
    }
    return Promise.resolve([]);
  }
  // sherpa expects f32 array
  return invoke<VadSegment[]>("speech_vad_detect", {
    sample_rate: sampleRate,
    samples: Array.from(samples),
  });
}
