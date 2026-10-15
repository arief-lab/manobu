import { invoke } from "@tauri-apps/api/core";

import type { SttResponse, SttStreamChunk } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

export function initStt(
  modelId: string,
  opts?: { modelDir?: string; language?: string }
): Promise<string> {
  if (!isTauri) {
    return Promise.reject(new Error("STT only in Tauri desktop"));
  }
  return invoke<string>("speech_init_stt", {
    request: {
      language: opts?.language ?? null,
      model_dir: opts?.modelDir ?? null,
      model_id: modelId,
    },
  });
}

export function isSttReady(): Promise<boolean> {
  if (!isTauri) {
    return Promise.resolve(false);
  }
  return invoke<boolean>("speech_stt_is_ready");
}

/**
 * Transcribe a wav file on disk (offline STT).
 *
 * `wavPath` must be an absolute path under `app_data_dir` or a temp file
 * the app has permission to read. For mic input, record to a temp wav first.
 */
export function transcribeFile(wavPath: string): Promise<SttResponse> {
  if (!isTauri) {
    return Promise.reject(new Error("STT only in Tauri desktop"));
  }
  return invoke<SttResponse>("speech_stt_file", {
    request: { wav_path: wavPath },
  });
}

// --- Streaming STT (TASK-21.5) -------------------------------------------
//
// Zipformer online recognizer for the live shadowing loop. Same stub
// philosophy as the offline path: without a linked model the backend echoes
// chunk sizes so the frontend contract stays exercisable; `initSttStream`
// still resolves when the directory is valid (stub engine) so callers can
// bootstrap in dev.

/**
 * Load the streaming recognizer (Zipformer JA layout:
 * `encoder/decoder/joiner .onnx` + `tokens.txt`). Resolves with the model
 * directory; degrades to a stub engine when sherpa cannot build it.
 */
export function initSttStream(
  modelId: string,
  opts?: { modelDir?: string }
): Promise<string> {
  if (!isTauri) {
    return Promise.reject(new Error("streaming STT only in Tauri desktop"));
  }
  return invoke<string>("speech_init_stt_stream", {
    request: {
      model_dir: opts?.modelDir ?? null,
      model_id: modelId,
    },
  });
}

export function isSttStreamReady(): Promise<boolean> {
  if (!isTauri) {
    return Promise.resolve(false);
  }
  return invoke<boolean>("speech_stt_stream_is_ready");
}

/**
 * Open a recognition session. `sessionId` is caller-chosen (e.g. the
 * shadowing line index) so re-invokes are idempotent on reconnects.
 */
export function createSttStreamSession(sessionId: string): Promise<void> {
  if (!isTauri) {
    return Promise.resolve();
  }
  return invoke<void>("speech_stt_stream_create", { sessionId });
}

/**
 * Feed one mic chunk (16kHz mono Float32). Returns the running partial, or
 * the finalized utterance when endpoint detection fired (`final: true` —
 * the backend stream resets and the session continues fresh).
 */
export function acceptSttStreamChunk(
  sessionId: string,
  samples: Float32Array | number[],
  sampleRate = 16_000
): Promise<SttStreamChunk> {
  if (!isTauri) {
    return Promise.resolve({ final: false, text: "" });
  }
  return invoke<SttStreamChunk>("speech_stt_stream_accept", {
    request: {
      sample_rate: sampleRate,
      samples: Array.from(samples),
      session_id: sessionId,
    },
  });
}

/**
 * Flush trailing audio and finalize: resolves the last utterance with
 * `final: true` and drops the session (re-create for the next line).
 */
export function finishSttStreamSession(
  sessionId: string
): Promise<SttStreamChunk> {
  if (!isTauri) {
    return Promise.resolve({ final: true, text: "" });
  }
  return invoke<SttStreamChunk>("speech_stt_stream_finish", { sessionId });
}

/** Drop a session without finalizing. Returns whether one existed. */
export function closeSttStreamSession(sessionId: string): Promise<boolean> {
  if (!isTauri) {
    return Promise.resolve(false);
  }
  return invoke<boolean>("speech_stt_stream_close", { sessionId });
}
