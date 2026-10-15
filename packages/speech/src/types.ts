export type ModelKind = "tts" | "stt_offline" | "stt_streaming" | "vad";

export interface ModelInfo {
  dir: string;
  display_name: string;
  id: string;
  kind: ModelKind;
  ready: boolean;
}

export interface SpeechStatus {
  models_dir: string;
  stt_ready: boolean;
  tts_ready: boolean;
  vad_ready: boolean;
}

export interface SpeechVersion {
  git_date: string;
  git_sha1: string;
  version: string;
}

export interface TtsRequest {
  sid?: number;
  speed?: number;
  text: string;
}

export interface TtsResponse {
  num_samples: number;
  sample_rate: number;
  wav: number[] | Uint8Array;
}

export interface SttFileRequest {
  wav_path: string;
}

export interface SttResponse {
  language?: string | null;
  text: string;
}

/** One streaming STT update: running partial or finalized utterance. */
export interface SttStreamChunk {
  final: boolean;
  text: string;
}

export interface VadSegment {
  end_ms: number;
  start_ms: number;
}
