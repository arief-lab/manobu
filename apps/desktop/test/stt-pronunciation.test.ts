import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  downmixToMono,
  floatToPcm16,
  kanaMatch,
  type MicRecording,
  pronunciationGrade,
  recordAndTranscribe,
  resampleTo,
} from "../src/lib/mic-stt";
import { isStillRomaji } from "../src/lib/romaji";

/**
 * TASK-21.2 — STT pronunciation grading.
 *
 * The mic → STT pipeline is mocked at its two seams:
 *  - `invoke` (speech_write_temp_wav / speech_stt_file) via module mock
 *  - mic capture via the `capture` option of recordAndTranscribe
 * which keeps these tests offline + deterministic (bun test, no Tauri).
 */

const setTauri = (on: boolean): void => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__TAURI__ = on ? {} : undefined;
};

const fakeRecording = (pcm = new Uint8Array([1, 0, 2, 0])): MicRecording => ({
  sampleRate: 16_000,
  stop: async () => ({ pcm, sampleRate: 16_000 }),
});

// ---- pure helpers -------------------------------------------------------

describe("mic pcm helpers", () => {
  it("downmixToMono averages interleaved channels", () => {
    const out = downmixToMono([
      new Float32Array([1, 0.5]),
      new Float32Array([0, -0.5]),
    ]);
    expect(Array.from(out)).toEqual([0.5, 0]);
  });

  it("resampleTo 48k → 16k keeps the trough/peak shape", () => {
    // one 48-sample ramp == 16 samples at 16kHz
    const src = new Float32Array(48);
    for (let i = 0; i < src.length; i += 1) {
      src[i] = i / src.length;
    }
    const out = resampleTo(src, 48_000, 16_000);
    expect(out.length).toBe(16);
    expect(out[0]).toBeCloseTo(0, 2);
    expect(out[15]).toBeCloseTo(15 / 16, 2);
  });

  it("floatToPcm16 clamps and encodes little-endian", () => {
    const bytes = floatToPcm16(new Float32Array([0, 1, -1, 0.5]));
    expect(bytes.length).toBe(8);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0x7f_ff);
    expect(view.getInt16(4, true)).toBe(-0x80_00);
    expect(view.getInt16(6, true)).toBeGreaterThan(0x3f_00);
  });
});

// ---- grade mapping + normalization --------------------------------------

describe("kanaMatch + pronunciationGrade", () => {
  it("ignores punctuation and case when matching", () => {
    expect(kanaMatch("あ、い。", "あい")).toBe(true);
    expect(kanaMatch("AI", "あい")).toBe(false);
  });

  it("pronunciationGrade maps match → Good(3), miss → Again(1)", () => {
    expect(pronunciationGrade("あ", "あ")).toBe(3);
    expect(pronunciationGrade("こなやま", "あ")).toBe(1);
  });

  it("pronunciationGrade never grades on a failed transcription", () => {
    expect(pronunciationGrade(null, "あ")).toBe(1);
    expect(pronunciationGrade("", "あ")).toBe(1);
  });

  it("still-romaji guard: transcribed romaji cannot match kana target", () => {
    const t = "aiueo";
    expect(isStillRomaji(t)).toBe(true);
    expect(kanaMatch(t, "あいうえお")).toBe(false);
    expect(pronunciationGrade(t, "あ")).toBe(1);
  });
});

// ---- recordAndTranscribe gating (invoke + capture mocked) ----------------

const invokeMock = mock((_cmd: string, _args?: unknown) =>
  Promise.resolve("/tmp/x.wav")
);

mock.module("@tauri-apps/api/core", () => ({
  invoke: (...args: [string, unknown?]) => invokeMock(...args),
}));

// Explicit types keep Biome from narrowing the mutable test knobs.
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

afterEach(() => {
  invokeMock.mockImplementation(() => Promise.resolve("/tmp/x.wav"));
  invokeMock.mockClear();
  sttMock.mockClear();
  readyMock.mockClear();
  sttState.ready = true;
  sttState.text = "あ";
  sttState.fail = false;
  setTauri(false);
});

describe("recordAndTranscribe", () => {
  /** Tests reach the recording phase with a fake capture — keep the
   * bounded one-shot wait tiny so the suite stays fast. */
  const FAST = { maxMs: 10 };

  it("happy path: capture → temp wav invoke → transcribe mock → text", async () => {
    setTauri(true);
    const capture = mock(() => Promise.resolve(fakeRecording()));
    const out = await recordAndTranscribe("drill-a", { ...FAST, capture });
    expect(out).toEqual({ error: null, ok: true, text: "あ" });
    const [cmd, args] = invokeMock.mock.calls[0] as [string, unknown];
    expect(cmd).toBe("speech_write_temp_wav");
    expect(args).toEqual({
      request: { pcm: [1, 0, 2, 0], sample_rate: 16_000, stem: "drill-a" },
    });
  });

  it("STT not ready (no model) → stt:not-ready, no invoke", async () => {
    setTauri(true);
    sttState.ready = false;
    const out = await recordAndTranscribe("drill-a", {
      capture: () => Promise.resolve(fakeRecording()),
    });
    expect(out).toEqual({ error: "stt:not-ready", ok: false, text: null });
    expect(invokeMock.mock.calls.length).toBe(0);
  });

  it("no mic (getUserMedia rejects) → stt:no-mic, no throw", async () => {
    setTauri(true);
    const capture = mock(() =>
      Promise.reject(new Error("PermissionDeniedError: mic denied"))
    );
    const out = await recordAndTranscribe("drill-a", { ...FAST, capture });
    expect(out).toEqual({ error: "stt:no-mic", ok: false, text: null });
  });

  it("transcribe failure → stt:failed, no throw", async () => {
    setTauri(true);
    sttState.fail = true;
    const out = await recordAndTranscribe("drill-a", {
      ...FAST,
      capture: () => Promise.resolve(fakeRecording()),
    });
    expect(out).toEqual({ error: "stt:failed", ok: false, text: null });
  });

  it("stub STT echo is treated as not-transcribed (stt:stub)", async () => {
    setTauri(true);
    sttState.text =
      "[stub STT] transcription of drill-a (model not yet linked)";
    const out = await recordAndTranscribe("drill-a", {
      ...FAST,
      capture: () => Promise.resolve(fakeRecording()),
    });
    expect(out).toEqual({ error: "stt:stub", ok: false, text: null });
  });

  it("outside Tauri → stt:no-tauri without touching mic or invoke", async () => {
    const out = await recordAndTranscribe("drill-a", {
      capture: () => Promise.resolve(fakeRecording()),
    });
    expect(out).toEqual({ error: "stt:no-tauri", ok: false, text: null });
    expect(invokeMock.mock.calls.length).toBe(0);
  });
});
