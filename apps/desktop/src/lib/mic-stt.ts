/*
 * Mic → STT bridge (TASK-21.2).
 *
 * Flow: getUserMedia → 16kHz mono downmix → PCM16 frames → invoke
 * `speech_write_temp_wav` (Rust writes the WAV under app_data_dir) →
 * `transcribeFile()` → kana text. Opt-in only: every step degrades to
 * `null` / an error string instead of throwing so the Drill Lab and
 * Roleplay can keep their Type fallback paths (SCR-03 equal-path rule).
 *
 * Grade mapping for pronunciation drills lives in `pronunciationGrade`.
 */

import { isSttReady, transcribeFile } from "@manobu/speech/stt";
import type { VadSegment } from "@manobu/speech/types";
import { detectVad, initVad } from "@manobu/speech/vad";
import { invoke } from "@tauri-apps/api/core";

/** Drill Lab + Roleplay record at 16kHz mono — SenseVoice's native rate. */
const MIC_SAMPLE_RATE = 16_000;

/** Hard cap so a forgotten stop button can't fill app_data_dir with wavs. */
const MAX_RECORDING_MS = 15_000;

/**
 * Auto-stop silence budget (TASK-21.3 AC2): when the VAD reports no speech
 * for this long, the bounded wait resolves early and capture stops.
 */
export const STOP_SILENCE_MS = 800;

/** Live-activity tick: aggregate mic audio into 200ms VAD windows. */
export const VAD_TICK_MS = 200;

/** Silence budget in samples @16kHz for the tick clock. */
const VAD_TICK_SAMPLES = (VAD_TICK_MS * MIC_SAMPLE_RATE) / 1000;

/** Trim padding (ms) added around detected speech before the wav write. */
const TRIM_PAD_MS = 100;

const isTauri = (): boolean =>
  typeof globalThis !== "undefined" &&
  Boolean((globalThis as Record<string, unknown>).__TAURI__);

/**
 * Downmix an arbitrary capture buffer to mono Float32.
 *
 * WebAudio delivers channel-interleaved data; averaging all channels is
 * the standard mono downmix. `channelCount: 1` in getUserMedia usually
 * yields a single channel already — this is the safe fallback.
 */
export const downmixToMono = (channels: Float32Array[]): Float32Array => {
  const frames = channels[0]?.length ?? 0;
  if (channels.length === 1) {
    return channels[0] ?? new Float32Array(0);
  }
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (const ch of channels) {
      sum += ch[i] ?? 0;
    }
    out[i] = sum / channels.length;
  }
  return out;
};

/**
 * Permission-denied / NotFound / NotReadable → no-mic fallback; anything
 * else is a generic STT failure. Top-level regex per Ultracite.
 */
const NO_MIC_RE = /denied|notfound|notreadable|permission/i;

/** Chars SenseVoice may add around the spoken kana — stripped before match. */
const KANA_NOISE_RE = /[\s。、！？!?,.「」『』・]/g;

/** Linear resample to `targetRate` (mic rates are 44.1k/48k, STT is 16k). */
export const resampleTo = (
  samples: Float32Array,
  sourceRate: number,
  targetRate = MIC_SAMPLE_RATE
): Float32Array => {
  if (sourceRate === targetRate || samples.length === 0) {
    return samples;
  }
  const ratio = sourceRate / targetRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = src - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i1] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
};

/** Float32 [-1..1] → little-endian PCM16 bytes. */
export const floatToPcm16 = (samples: Float32Array): Uint8Array => {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x80_00 : s * 0x7f_ff, true);
  }
  return out;
};

/** Per-tick VAD verdict for the live mic indicator (TASK-21.3 AC2). */
export interface VadActivity {
  /** Ms since the last speech-positive tick (0 while speaking). */
  silentMs: number;
  /** True when the latest VAD window contained speech. */
  speaking: boolean;
}

export type VadActivityListener = (activity: VadActivity) => void;

/**
 * Trim leading/trailing silence from a captured clip using `detectVad`
 * (TASK-21.3 AC2). Never throws: VAD unavailable or all-silent clips fall
 * back to the untrimmed PCM so STT keeps its chance (stub/energy VAD and
 * pre-download engines both degrade gracefully — AC4).
 */
export const vadTrim = async (
  samples: Float32Array | undefined,
  pcm: Uint8Array
): Promise<Uint8Array> => {
  if (!samples || samples.length === 0) {
    return pcm;
  }
  let segments: VadSegment[];
  try {
    segments = await detectVad(samples);
  } catch {
    return pcm;
  }
  const speech = segments.filter((s) => s.end_ms > s.start_ms);
  if (speech.length === 0) {
    return pcm;
  }
  const durationMs = (samples.length * 1000) / MIC_SAMPLE_RATE;
  const firstStart = speech.reduce(
    (min, s) => Math.min(min, s.start_ms),
    Number.MAX_SAFE_INTEGER
  );
  const lastEnd = speech.reduce((max, s) => Math.max(max, s.end_ms), 0);
  const startMs = Math.max(0, firstStart - TRIM_PAD_MS);
  const endMs = Math.min(durationMs, lastEnd + TRIM_PAD_MS);
  if (startMs <= 0 && endMs >= durationMs) {
    return pcm; // nothing to trim
  }
  const from = Math.floor((startMs * MIC_SAMPLE_RATE) / 1000);
  const to = Math.min(
    samples.length,
    Math.ceil((endMs * MIC_SAMPLE_RATE) / 1000)
  );
  if (to <= from) {
    return pcm;
  }
  return floatToPcm16(samples.slice(from, to));
};

export interface MicRecording {
  /** Capture sample rate (pre-downsample) — informational. */
  sampleRate: number;
  /** Resolves with the captured payload once capture is torn down. */
  stop: () => Promise<{
    pcm: Uint8Array;
    /** Resampled 16kHz floats — enables VAD trim post-stop. */
    samples?: Float32Array;
    sampleRate: number;
  }>;
}

/**
 * Per-VAD-tick callback (TASK-21.5): receives the ~200ms merged Float32
 * chunk (16kHz mono) as it lands — the streaming STT seam.
 */
export type MicTickListener = (tick: Float32Array) => void;

export interface MicCaptureOpts {
  /**
   * VAD live-activity callback (TASK-21.3): invoked every ~200ms with the
   * aggregated tick's speech verdict. Best-effort — VAD failures degrade
   * to a silent RMS tick rather than breaking capture.
   */
  onActivity?: VadActivityListener;
  /** Peak level callback (existing TASK-21.2 seam, kept for UI meters). */
  onLevel?: (level: number) => void;
  /**
   * Streaming STT seam (TASK-21.5): invoked every ~200ms with the merged
   * 16kHz mono Float32 tick for live Zipformer recognition.
   */
  onTick?: MicTickListener;
}

/**
 * Open the mic and start capturing mono PCM. The caller decides when to
 * stop; the returned `stop()` resolves once capture is torn down.
 *
 * Every `VAD_TICK_MS` of audio is aggregated and run through `detectVad`
 * (sherpa Silero when linked, JS/Rust RMS stub otherwise — AC4) so the UI
 * can show speaking/silent state without blocking the audio pump.
 *
 * Throws only on `getUserMedia` failure (no mic / permission denied) —
 * the UI layer catches and falls back to Type. Not for direct use by
 * components; prefer `recordAndTranscribe`.
 */
export const startMicCapture = async (
  opts?: MicCaptureOpts
): Promise<MicRecording> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  // 200ms VAD tick aggregation (TASK-21.3 AC2).
  let tickBuf: Float32Array[] = [];
  let tickSamples = 0;
  let silentMs = 0;
  let stopped = false;

  const runVadTick = (merged: Float32Array): void => {
    const sampleRate = MIC_SAMPLE_RATE;
    const speakingRms =
      Math.sqrt(merged.reduce((sum, v) => sum + v * v, 0) / merged.length) >
      0.01;
    detectVad(merged, sampleRate)
      .then((segments) => {
        const speaking =
          speakingRms && segments.some((s) => s.end_ms > s.start_ms);
        silentMs = speaking ? 0 : silentMs + VAD_TICK_MS;
        opts?.onActivity?.({ silentMs, speaking });
      })
      .catch(() => {
        // VAD unavailable → RMS-only tick so the indicator still moves (AC4).
        silentMs = speakingRms ? 0 : silentMs + VAD_TICK_MS;
        opts?.onActivity?.({ silentMs, speaking: speakingRms });
      });
  };

  /** Drain the tick buffer: onTick (streaming) + VAD activity. */
  const flushTick = (): void => {
    const mergedTick = downmixToMono(tickBuf);
    tickBuf = [];
    tickSamples = 0;
    // Per-tick samples (TASK-21.5): streaming STT feeds each ~200ms
    // chunk to the Zipformer session as it lands.
    opts?.onTick?.(mergedTick);
    if (opts?.onActivity) {
      runVadTick(mergedTick);
    }
  };

  /** Peak level callback (TASK-21.2 UI meters). */
  const reportLevel = (input: Float32Array): void => {
    let peak = 0;
    for (const s of input) {
      const abs = Math.abs(s);
      if (abs > peak) {
        peak = abs;
      }
    }
    opts?.onLevel?.(peak);
  };

  processor.onaudioprocess = (e) => {
    if (stopped) {
      return;
    }
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    if (opts?.onActivity || opts?.onTick) {
      tickBuf.push(new Float32Array(input));
      tickSamples += input.length;
      if (tickSamples >= VAD_TICK_SAMPLES) {
        flushTick();
      }
    }
    if (opts?.onLevel) {
      reportLevel(input);
    }
  };
  source.connect(processor);
  // ScriptProcessor requires a destination connection to pump; route
  // through a zero-gain node so nothing is audible.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  processor.connect(silent);
  silent.connect(ctx.destination);

  const teardown = async (): Promise<void> => {
    stopped = true;
    processor.disconnect();
    silent.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) {
      track.stop();
    }
    await ctx.close().catch(() => undefined);
  };

  const sourceRate = ctx.sampleRate;
  return {
    sampleRate: sourceRate,
    async stop() {
      await teardown();
      const merged = downmixToMono(chunks);
      const resampled = resampleTo(merged, sourceRate);
      return {
        pcm: floatToPcm16(resampled),
        sampleRate: MIC_SAMPLE_RATE,
        samples: resampled,
      };
    },
  };
};

/** VAD is best-effort: init once per app run; failures keep the stub path. */
let vadReady = false;

/**
 * One-shot Silero VAD init (TASK-21.3 AC1). Best-effort: resolves `false`
 * outside Tauri or when the model is absent — callers must not block on it.
 * Success is cached for the session; failures retry next call so a model
 * downloaded mid-session (Settings) activates without an app restart.
 */
export const ensureVad = async (): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  if (vadReady) {
    return true;
  }
  try {
    await initVad();
    vadReady = true;
  } catch {
    vadReady = false;
  }
  return vadReady;
};

/** Test-only reset so the init-once cache doesn't leak between tests. */
export const resetVadReady = (): void => {
  vadReady = false;
};

const writeTempWav = async (
  pcm: Uint8Array,
  sampleRate: number,
  stem: string
): Promise<string> =>
  invoke<string>("speech_write_temp_wav", {
    request: {
      pcm: Array.from(pcm),
      sample_rate: sampleRate,
      stem,
    },
  });

export interface SttAttempt {
  error: string | null;
  ok: boolean;
  text: string | null;
}

export interface RecordOpts {
  /**
   * Capture seam — defaults to real mic capture. Tests inject a fake
   * recording so the STT invoke path stays mockable end to end. Receives
   * the caller's `onActivity` sink so fake captures can simulate VAD ticks.
   */
  capture?: (onActivity?: VadActivityListener) => Promise<MicRecording>;
  maxMs?: number;
  /**
   * Live VAD activity sink (TASK-21.3 AC2) — forwarded to the default
   * capture; the UI shows speaking/silent from this.
   */
  onActivity?: VadActivityListener;
  /**
   * Test seam for the silence watchdog clock. Defaults to `setTimeout`;
   * tests inject a manual clock to avoid real 800ms waits.
   */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** Disable the VAD pre-STT trim (tests / debug). */
  vadTrim?: boolean;
}

const STT_ERROR_PREFIX = "stt:";

/**
 * One-shot mic → transcription. Never throws: failures come back as
 * `{ ok: false, error }` with `error` prefixed `stt:` so callers can
 * distinguish STT problems from other failures without parsing messages.
 *
 * Gating (all inside, in order): Tauri shell → mic permission → STT
 * initialized (`isSttReady`) → temp wav written → `transcribeFile`.
 *
 * VAD integration (TASK-21.3 AC2):
 * - live activity is forwarded via `onActivity` (speaking/silentMs)
 * - auto-stop: the bounded wait resolves early after `STOP_SILENCE_MS`
 *   of reported silence (watchdog), else at `maxMs`
 * - silence is trimmed from the captured clip via `vadTrim` before the
 *   temp wav write, so STT never transcribes dead air
 */
export const recordAndTranscribe = async (
  stem: string,
  opts?: RecordOpts
): Promise<SttAttempt> => {
  if (!isTauri()) {
    return { error: `${STT_ERROR_PREFIX}no-tauri`, ok: false, text: null };
  }
  let recording: MicRecording | null = null;
  try {
    const ready = await isSttReady();
    if (!ready) {
      return {
        error: `${STT_ERROR_PREFIX}not-ready`,
        ok: false,
        text: null,
      };
    }
    // VAD init is best-effort and non-fatal (AC1/AC4): a missing model
    // keeps the stub energy path alive below.
    await ensureVad();
    let lastSilentMs = 0;
    const onTick = (activity: VadActivity): void => {
      lastSilentMs = activity.silentMs;
      opts?.onActivity?.(activity);
    };
    const capture =
      opts?.capture ?? (() => startMicCapture({ onActivity: onTick }));
    recording = await capture(onTick);
    const maxMs = opts?.maxMs ?? MAX_RECORDING_MS;
    const sleep = opts?.setTimeoutFn ?? setTimeout;
    const maxGate = new Promise<void>((resolve) => {
      sleep(resolve, maxMs);
    });
    // Silence watchdog (AC2): poll the live activity sink every tick;
    // a sustained `STOP_SILENCE_MS` silent run resolves the race early.
    const watchdog = new Promise<void>((resolve) => {
      sleep(function poll() {
        if (lastSilentMs >= STOP_SILENCE_MS) {
          resolve();
          return;
        }
        sleep(poll, VAD_TICK_MS);
      }, VAD_TICK_MS);
    });
    await Promise.race([watchdog, maxGate]);
    const { pcm, sampleRate, samples } = await recording.stop();
    recording = null;
    if (pcm.length === 0) {
      return { error: `${STT_ERROR_PREFIX}empty`, ok: false, text: null };
    }
    // VAD pre-processor (AC2): strip dead air before STT. Degrades to the
    // untrimmed pcm when VAD is unavailable or the clip is all-speech.
    const trimmedPcm =
      opts?.vadTrim === false ? pcm : await vadTrim(samples, pcm);
    const wavPath = await writeTempWav(trimmedPcm, sampleRate, stem);
    const res = await transcribeFile(wavPath);
    const text = res.text.trim();
    // Stub STT (model not linked) echoes a bracketed marker — treat it
    // as "not transcribed" so grading never fires on stub text.
    if (text.startsWith("[stub STT]")) {
      return {
        error: `${STT_ERROR_PREFIX}stub`,
        ok: false,
        text: null,
      };
    }
    if (text.length === 0) {
      return { error: `${STT_ERROR_PREFIX}empty-text`, ok: false, text: null };
    }
    return { error: null, ok: true, text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = NO_MIC_RE.test(message) ? "no-mic" : "failed";
    return {
      error: `${STT_ERROR_PREFIX}${code}`,
      ok: false,
      text: null,
    };
  } finally {
    if (recording) {
      await recording.stop().catch(() => undefined);
    }
  }
};

/**
 * Normalized comparison of a transcription against the target kana:
 * whitespace/punctuation stripped. Returns `true` when the normalized
 * transcription contains the normalized target (SenseVoice may add
 * punctuation or ITN variants around the spoken kana).
 */
export const kanaMatch = (transcribed: string, target: string): boolean => {
  const norm = (s: string): string =>
    s.replace(KANA_NOISE_RE, "").toLowerCase();
  const t = norm(transcribed);
  const g = norm(target);
  return t.length > 0 && t.includes(g);
};

/**
 * Grade mapping for pronunciation drills: a normalized kana match maps to
 * FSRS `Good` (3); anything else — including unmatched speech — maps to
 * `Again` (1), mirroring the TypeFallback mapping in drill-lab.
 */
export const pronunciationGrade = (
  transcribed: string | null,
  target: string
): 1 | 3 => (transcribed !== null && kanaMatch(transcribed, target) ? 3 : 1);
