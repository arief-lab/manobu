import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  ensureVad,
  floatToPcm16,
  type MicRecording,
  recordAndTranscribe,
  resetVadReady,
  STOP_SILENCE_MS,
  VAD_TICK_MS,
  vadTrim,
} from "../src/lib/mic-stt";

/**
 * TASK-21.3 — VAD turn-taking + silence trimming.
 *
 * Mocked at the same seams as stt-pronunciation.test.ts:
 *  - `invoke` (speech_write_temp_wav / speech_stt_file) via module mock
 *  - mic capture via the `capture` option (receives onActivity so tests
 *    can simulate VAD ticks)
 *  - VAD via the `@manobu/speech/vad` module mock
 */

const setTauri = (on: boolean): void => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__TAURI__ = on ? {} : undefined;
};

const fakeRecording = (
  pcm = new Uint8Array([1, 0, 2, 0]),
  samples?: Float32Array
): MicRecording => ({
  sampleRate: 16_000,
  stop: async () => ({ pcm, sampleRate: 16_000, samples }),
});

// ---- module mocks: tauri invoke + stt + vad ------------------------------

const invokeMock = mock((_cmd: string, _args?: unknown) =>
  Promise.resolve("/tmp/x.wav")
);

mock.module("@tauri-apps/api/core", () => ({
  invoke: (...args: [string, unknown?]) => invokeMock(...args),
}));

const sttState: { fail: boolean; ready: boolean; text: string } = {
  fail: false,
  ready: true,
  text: "あ",
};
const sttMock = mock(() =>
  sttState.fail
    ? Promise.reject(new Error("boom"))
    : Promise.resolve({ language: null, text: sttState.text })
);
const readyMock = mock(() => Promise.resolve(sttState.ready));

mock.module("@manobu/speech/stt", () => ({
  isSttReady: () => readyMock(),
  transcribeFile: () => sttMock(),
}));

/** VAD mock state — segments returned by detectVad / initVad verdict. */
const vadState: {
  fail: boolean;
  initOk: boolean;
  segments: Array<{ end_ms: number; start_ms: number }>;
} = { fail: false, initOk: true, segments: [] };
const detectMock = mock(() =>
  vadState.fail
    ? Promise.reject(new Error("vad down"))
    : Promise.resolve(vadState.segments)
);
const initVadMock = mock(() =>
  vadState.initOk
    ? Promise.resolve("/models/silero_vad.onnx")
    : Promise.reject(new Error("model file not found"))
);

mock.module("@manobu/speech/vad", () => ({
  detectVad: () => detectMock(),
  initVad: () => initVadMock(),
}));

// ---- vadTrim (TASK-21.3 AC2) ---------------------------------------------

describe("vadTrim", () => {
  afterEach(() => {
    vadState.fail = false;
    vadState.segments = [];
    detectMock.mockClear();
  });

  it("trims leading/trailing silence around detected speech with padding", async () => {
    // 2000 samples @16kHz = 125ms. Speech 300–800ms of a 1000ms clip.
    const n = 16_000;
    const samples = new Float32Array(n);
    vadState.segments = [{ end_ms: 800, start_ms: 300 }];
    const pcm = floatToPcm16(samples);
    const out = await vadTrim(samples, pcm);
    const trimmed = out.length / 2; // pcm16 → samples
    // Kept: [200ms, 900ms] + 100ms pad both sides → 700ms → 11200 samples.
    expect(trimmed).toBe(11_200);
  });

  it("returns pcm untouched when VAD reports no speech (all-silent clip)", async () => {
    const samples = new Float32Array(16_000);
    const pcm = floatToPcm16(samples);
    vadState.segments = [];
    const out = await vadTrim(samples, pcm);
    expect(out).toBe(pcm);
  });

  it("returns pcm untouched when VAD throws (AC4 degrade)", async () => {
    const samples = new Float32Array(16_000);
    const pcm = floatToPcm16(samples);
    vadState.fail = true;
    const out = await vadTrim(samples, pcm);
    expect(out).toBe(pcm);
  });

  it("returns pcm untouched when speech covers the whole clip", async () => {
    const samples = new Float32Array(16_000);
    const pcm = floatToPcm16(samples);
    vadState.segments = [{ end_ms: 1000, start_ms: 0 }];
    const out = await vadTrim(samples, pcm);
    expect(out).toBe(pcm);
  });

  it("handles missing samples (pre-stop payloads) by passing pcm through", async () => {
    const pcm = floatToPcm16(new Float32Array(8));
    const out = await vadTrim(undefined, pcm);
    expect(out).toBe(pcm);
    expect(detectMock.mock.calls.length).toBe(0);
  });

  it("clips trim bounds to the clip duration", async () => {
    const n = 16_000; // 1000ms
    const samples = new Float32Array(n);
    vadState.segments = [{ end_ms: 5000, start_ms: -200 }];
    const out = await vadTrim(samples, floatToPcm16(samples));
    // Whole clip after clamping → same pcm reference (nothing to trim).
    expect(out.length).toBe(n * 2);
  });
});

// ---- silence watchdog + trim integration ---------------------------------

describe("recordAndTranscribe VAD integration (TASK-21.3)", () => {
  /** Manual clock so the 800ms watchdog resolves deterministically.
   * `drain` processes one generation per call (the watchdog poll re-queues
   * itself, so an unbounded drain would never exit); `pump` interleaves
   * microtask settling with drains so async flow progresses. */
  const makeClock = () => {
    const tasks: Array<() => void> = [];
    const setTimeoutFn = (fn: () => void, _ms: number): unknown => {
      tasks.push(fn);
      return tasks.length;
    };
    const drain = (): void => {
      for (const t of tasks.splice(0, tasks.length)) {
        t();
      }
    };
    const pump = async (rounds = 64): Promise<void> => {
      if (rounds <= 0) {
        return;
      }
      // Manual clock: settle microtasks, then run the queued callbacks,
      // recursing so each generation is drained without a linted loop.
      await Promise.resolve();
      await Promise.resolve();
      drain();
      return pump(rounds - 1);
    };
    return { pump, setTimeoutFn };
  };

  afterEach(() => {
    invokeMock.mockImplementation(() => Promise.resolve("/tmp/x.wav"));
    invokeMock.mockClear();
    sttMock.mockClear();
    readyMock.mockClear();
    detectMock.mockClear();
    initVadMock.mockClear();
    vadState.fail = false;
    vadState.initOk = true;
    vadState.segments = [];
    sttState.ready = true;
    sttState.text = "あ";
    sttState.fail = false;
    setTauri(false);
  });

  it("constants: 800ms stop-silence budget, 200ms VAD tick", () => {
    expect(STOP_SILENCE_MS).toBe(800);
    expect(VAD_TICK_MS).toBe(200);
  });

  it("auto-stops early when the VAD reports sustained silence", async () => {
    setTauri(true);
    const clock = makeClock();
    const onActivityCalls: Array<{ silentMs: number; speaking: boolean }> = [];
    const capture = mock(
      (_onActivity?: (a: { silentMs: number; speaking: boolean }) => void) =>
        Promise.resolve(fakeRecording())
    );
    const maxMs = 60_000; // would hang a real clock — watchdog must fire first
    const done = recordAndTranscribe("drill-a", {
      capture: (onActivity) => {
        // Simulate the mic reporting 800ms+ of silence via live ticks.
        onActivity?.({ silentMs: 900, speaking: false });
        return capture(onActivity);
      },
      maxMs,
      onActivity: (a) => {
        onActivityCalls.push(a);
      },
      setTimeoutFn: clock.setTimeoutFn,
      vadTrim: false,
    });
    await clock.pump();
    const out = await done;
    expect(out).toEqual({ error: null, ok: true, text: "あ" });
    // onActivity forwarded from the custom capture to the caller.
    expect(onActivityCalls).toEqual([{ silentMs: 900, speaking: false }]);
    expect(capture.mock.calls.length).toBe(1);
  });

  it("keeps listening while speech continues, until maxMs", async () => {
    setTauri(true);
    const clock = makeClock();
    // Speech every tick → watchdog never resolves; maxMs does.
    const capture = mock(
      (onActivity?: (a: { silentMs: number; speaking: boolean }) => void) => {
        onActivity?.({ silentMs: 0, speaking: true });
        return Promise.resolve(fakeRecording());
      }
    );
    const done = recordAndTranscribe("drill-a", {
      capture,
      maxMs: 10,
      setTimeoutFn: clock.setTimeoutFn,
      vadTrim: false,
    });
    await clock.pump();
    const out = await done;
    expect(out.ok).toBe(true);
  });

  it("trims captured samples via vadTrim before the wav write", async () => {
    setTauri(true);
    const clock = makeClock();
    const n = 16_000;
    const samples = new Float32Array(n);
    vadState.segments = [{ end_ms: 800, start_ms: 300 }];
    const capture = mock(() =>
      Promise.resolve(fakeRecording(new Uint8Array(n * 2), samples))
    );
    const done = recordAndTranscribe("drill-a", {
      capture,
      maxMs: 10,
      setTimeoutFn: clock.setTimeoutFn,
    });
    await clock.pump();
    await done;
    const wavCall = invokeMock.mock.calls.find(
      (c) => c[0] === "speech_write_temp_wav"
    ) as [string, { request: { pcm: number[] } }] | undefined;
    expect(wavCall).toBeDefined();
    // Trimmed to [200ms, 900ms] = 700ms @16kHz = 11200 samples = 22400 bytes.
    expect(wavCall?.[1].request.pcm.length).toBe(22_400);
  });

  it("inits VAD best-effort at record start (AC1), never fails the flow", async () => {
    setTauri(true);
    resetVadReady();
    const clock = makeClock();
    vadState.initOk = false;
    const done = recordAndTranscribe("drill-a", {
      capture: () => Promise.resolve(fakeRecording()),
      maxMs: 10,
      setTimeoutFn: clock.setTimeoutFn,
      vadTrim: false,
    });
    await clock.pump();
    const out = await done;
    expect(out.ok).toBe(true); // init failure did not break STT
    expect(initVadMock.mock.calls.length).toBe(1);
  });

  it("ensureVad caches success; ensureVad outside Tauri is false", async () => {
    setTauri(false);
    resetVadReady();
    expect(await ensureVad()).toBe(false);
    expect(initVadMock.mock.calls.length).toBe(0);
    setTauri(true);
    resetVadReady();
    expect(await ensureVad()).toBe(true);
    resetVadReady();
    vadState.initOk = false;
    expect(await ensureVad()).toBe(false);
    setTauri(false);
  });
});

// ---- UI contracts (source assertions, Tauri-only paths) -------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const srcFile = (rel: string): string =>
  readFileSync(resolve(import.meta.dirname, "..", "src", rel), "utf8");

describe("VAD UI contracts (TASK-21.3)", () => {
  it("Drill + Roleplay show live speaking state via VAD ticks", () => {
    const drill = srcFile("features/drill/drill-lab.tsx");
    expect(drill).toContain("onActivity");
    expect(drill).toContain("data-speaking={speaking}");
    expect(drill).toContain('"🗣 speaking…"');
    const rp = srcFile("features/roleplay/roleplay.tsx");
    expect(rp).toContain("onActivity");
    expect(rp).toContain("data-speaking={speaking}");
    expect(rp).toContain('"🗣 speaking…"');
  });

  it("root route boots ensureVad once (AC1)", () => {
    const root = srcFile("routes/__root.tsx");
    expect(root).toContain("ensureVad().catch(() => undefined)");
    expect(root).toContain('from "@/lib/mic-stt"');
  });

  it("Settings has a VAD row + download + auto-ensure alongside STT (AC3)", () => {
    const settings = srcFile("features/settings/settings-speech-models.tsx");
    expect(settings).toContain('data-testid="settings-speech-vad"');
    expect(settings).toContain("settings-speech-vad-download");
    expect(settings).toContain("downloadVad");
    expect(settings).toContain("initVad");
    expect(settings).toContain("ensureVadAlongside");
    expect(settings).toContain("vad_ready");
  });
});
