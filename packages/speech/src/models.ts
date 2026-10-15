import { invoke } from "@tauri-apps/api/core";

import type { ModelInfo } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

/** The shipped Japanese TTS voice (TASK-154/174): Supertonic 3 int8. */
export const TTS_MODEL_ID = "sherpa-onnx-supertonic-3-tts-int8-2026-05-11";

export function listModels(): Promise<ModelInfo[]> {
  if (!isTauri) {
    return Promise.resolve([]);
  }
  return invoke<ModelInfo[]>("speech_list_models");
}

export function knownModels(): ModelInfo[] {
  // Static manifest — mirrors Rust `KNOWN_MODELS` in `apps/desktop/src-tauri/src/speech/models.rs`
  // Keep in sync when adding a new voice.
  return [
    {
      dir: "",
      display_name: "SenseVoice multilingual (JA/ZH/EN/KO)",
      id: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
      kind: "stt_offline",
      ready: false,
    },
    {
      dir: "",
      display_name: "ReazonSpeech Zipformer JA (streaming)",
      id: "sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01",
      kind: "stt_streaming",
      ready: false,
    },
    {
      dir: "",
      display_name: "Supertonic 3 JA (10 voices)",
      id: TTS_MODEL_ID,
      kind: "tts",
      ready: false,
    },
    {
      dir: "",
      display_name: "Silero VAD",
      id: "sherpa-onnx-silero-vad",
      kind: "vad",
      ready: false,
    },
  ];
}

export interface SpeechAutoSpec {
  device_tier?: string;
  language?: string;
  pc_cores?: number;
  pc_ram_gb?: number;
  streaming?: boolean;
  task?: string;
}

export function detectPcSpec(): {
  pc_ram_gb?: number;
  pc_cores?: number;
  device_tier: string;
} {
  // Browser hints (Chrome/Edge): navigator.deviceMemory (GB), hardwareConcurrency (cores)
  const nav =
    typeof navigator === "undefined"
      ? {}
      : (navigator as unknown as Record<string, unknown>);
  const ram = nav.deviceMemory as number | undefined;
  const cores = nav.hardwareConcurrency as number | undefined;

  // Also try to infer from Rust side via sysinfo, but we pass what we have
  let tier = "auto";
  if (ram !== undefined || cores !== undefined) {
    const r = ram ?? 8;
    const c = cores ?? 4;
    if (r < 8 || c <= 2) {
      tier = "low";
    } else if (r >= 16 && c >= 8) {
      tier = "high";
    } else {
      tier = "medium";
    }
  }

  return { device_tier: tier, pc_cores: cores, pc_ram_gb: ram };
}

export function ensureModel(modelId: string): Promise<string> {
  if (!isTauri) {
    return Promise.reject(new Error("only in Tauri"));
  }
  return invoke<string>("speech_ensure_model", { modelId });
}

export function autoDownload(spec: SpeechAutoSpec): Promise<ModelInfo> {
  if (!isTauri) {
    return Promise.reject(new Error("only in Tauri"));
  }
  // Auto-enrich with PC spec if not explicitly set — fits model to user's PC
  const pc = detectPcSpec();
  const enriched: SpeechAutoSpec = {
    device_tier: spec.device_tier ?? pc.device_tier,
    language: spec.language,
    pc_cores: spec.pc_cores ?? pc.pc_cores,
    pc_ram_gb: spec.pc_ram_gb ?? pc.pc_ram_gb,
    streaming: spec.streaming,
    task: spec.task,
  };
  return invoke<ModelInfo>("speech_auto_download", { spec: enriched });
}

export function knownModelsAsync(): Promise<ModelInfo[]> {
  if (!isTauri) {
    return Promise.resolve(knownModels());
  }
  return invoke<ModelInfo[]>("speech_known_models");
}

/** Result of `speech_validate_model` — drives the Settings UUIuC banner. */
export interface ModelValidation {
  corrupt: boolean;
  kind: string | null;
  missing: string[];
  model_id: string;
  ready: boolean;
}

/** Check a model dir for missing/truncated files (UUIuC corrupt flag). */
export function validateModel(modelId: string): Promise<ModelValidation> {
  if (!isTauri) {
    return Promise.resolve({
      corrupt: false,
      kind: null,
      missing: [],
      model_id: modelId,
      ready: false,
    });
  }
  return invoke<ModelValidation>("speech_validate_model", { modelId });
}

/**
 * Remove a model dir so the next `ensureModel` re-downloads cleanly
 * (UUIuC `[Re-download]` recovery step 1).
 */
export function removeModel(modelId: string): Promise<boolean> {
  if (!isTauri) {
    return Promise.resolve(false);
  }
  return invoke<boolean>("speech_remove_model", { modelId });
}

/**
 * Classify a download/init failure for the Settings banner:
 * `disk_full` (k7SrUT), `offline`, `interrupted` (qd6N1 resume),
 * `corrupt` (UUIuC), or `error` fallback.
 */
export const classifyModelDownloadError = (e: unknown): string => {
  const message = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (message.includes("no space") || message.includes("disk full")) {
    return "disk_full";
  }
  if (
    message.includes("network") ||
    message.includes("dns") ||
    message.includes("connection") ||
    message.includes("timeout")
  ) {
    return "offline";
  }
  if (message.includes("interrupted") || message.includes("incomplete")) {
    return "interrupted";
  }
  if (message.includes("corrupt") || message.includes("checksum")) {
    return "corrupt";
  }
  return "error";
};

export function ensureModelsDir(): Promise<string> {
  if (!isTauri) {
    return Promise.reject(new Error("not in Tauri"));
  }
  return invoke<string>("speech_ensure_models_dir");
}

export function speechVersion(): Promise<import("./types").SpeechVersion> {
  if (!isTauri) {
    return Promise.resolve({ git_date: "", git_sha1: "", version: "stub" });
  }
  return invoke("speech_version");
}

export function speechStatus(): Promise<import("./types").SpeechStatus> {
  if (!isTauri) {
    return Promise.resolve({
      models_dir: "",
      stt_ready: false,
      tts_ready: false,
      vad_ready: false,
    });
  }
  return invoke("speech_status");
}
