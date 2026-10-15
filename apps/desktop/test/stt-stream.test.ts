import { afterEach, describe, expect, it, mock } from "bun:test";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SHADOW_GRADE_THRESHOLD, shadowScore } from "../src/lib/shadow";
import {
  createSttStreamController,
  STREAMING_STT_MODEL_ID,
  type SttStreamCapture,
} from "../src/lib/stt-stream";

/**
 * TASK-21.5 — streaming shadowing + conversation STT.
 *
 * Layers, mirroring the repo's other speech tests:
 *  - pure math (`shadowScore`) asserts directly
 *  - `createSttStreamController` runs the full start → chunk → final →
 *    stop loop offline via a fake capture + mocked `@manobu/speech/stt`
 *  - UI contracts (Shadow / Settings streaming row / Roleplay upgrade)
 *    assert the wiring exists in source (Tauri-only surfaces cannot render
 *    in bun test — see settings-speech-models.test.ts for the precedent)
 */

const setTauri = (on: boolean): void => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__TAURI__ = on ? {} : undefined;
};

// ---- pure helper --------------------------------------------------------

describe("shadowScore", () => {
  it("perfect match scores 1", () => {
    expect(shadowScore("たべる", "たべる")).toBe(1);
  });

  it("partial overlap is proportional", () => {
    // たえる shares た + る with たべる → 2 hits / max(3,3) = 2/3
    expect(shadowScore("たべる", "たえる")).toBeCloseTo(2 / 3, 5);
  });

  it("repeats beyond the target multiset do not count", () => {
    // あ twice in target; spoken has あ four times → 2 hits, denom 4
    expect(shadowScore("ああ", "ああああ")).toBeCloseTo(0.5, 5);
  });

  it("extra chars the target lacks lower the denominator share", () => {
    // hits 3 (た,べ,る), denom = max(3, 6) = 6
    expect(shadowScore("たべる", "たべるわわわ")).toBeCloseTo(0.5, 5);
  });

  it("whitespace is ignored", () => {
    expect(shadowScore("た べ る", " たべる ")).toBe(1);
  });

  it("empty spoken scores 0; empty target scores 0", () => {
    expect(shadowScore("たべる", "")).toBe(0);
    expect(shadowScore("", "たべる")).toBe(0);
  });

  it("threshold constant is the FSRS Good(3) bar", () => {
    expect(SHADOW_GRADE_THRESHOLD).toBe(0.8);
  });
});

// ---- controller loop (mocked invoke seam) --------------------------------

interface ChunkResult {
  final: boolean;
  text: string;
}

const streamState: { failCreate: boolean; ready: boolean } = {
  failCreate: false,
  ready: true,
};

const streamMocks = {
  accept: mock((_sessionId: string, _samples: unknown) =>
    Promise.resolve<ChunkResult>({ final: false, text: "" })
  ),
  close: mock((_sessionId: string) => Promise.resolve(true)),
  create: mock((_sessionId: string) => Promise.resolve()),
  finish: mock((_sessionId: string) =>
    Promise.resolve<ChunkResult>({ final: true, text: "" })
  ),
  init: mock((_modelId: string) => Promise.resolve("/models/zipformer")),
  ready: mock(() => Promise.resolve(streamState.ready)),
};

mock.module("@manobu/speech/stt", () => ({
  acceptSttStreamChunk: (sessionId: string, samples: unknown) =>
    streamMocks.accept(sessionId, samples),
  closeSttStreamSession: (sessionId: string) => streamMocks.close(sessionId),
  createSttStreamSession: (sessionId: string) => streamMocks.create(sessionId),
  finishSttStreamSession: (sessionId: string) => streamMocks.finish(sessionId),
  initSttStream: (modelId: string) => streamMocks.init(modelId),
  isSttReady: () => Promise.resolve(false),
  isSttStreamReady: () => streamMocks.ready(),
  transcribeFile: () => Promise.resolve({ language: null, text: "" }),
}));

// mic-stt (imported by stt-stream for the default capture) also resolves
// these at module load — keep the Vad stubs inert; these tests inject a
// fake capture so VAD never runs.
mock.module("@manobu/speech/vad", () => ({
  detectVad: () => Promise.resolve([]),
  initVad: () => Promise.resolve(false),
}));

const makeFakeCapture =
  (
    ticks: Float32Array[],
    sink: (emit: (tick: Float32Array) => void) => void
  ): SttStreamCapture =>
  (opts) => {
    sink((tick) => {
      opts?.onTick?.(tick);
    });
    ticks.length = 0; // captured — the sink drives ticks from here
    return Promise.resolve({
      sampleRate: 16_000,
      stop: async () => ({ pcm: new Uint8Array([1, 0]), sampleRate: 16_000 }),
    });
  };

const resetMockDefaults = (): void => {
  streamState.failCreate = false;
  streamState.ready = true;
  streamMocks.accept.mockReset();
  streamMocks.close.mockReset();
  streamMocks.create.mockReset();
  streamMocks.finish.mockReset();
  streamMocks.init.mockReset();
  streamMocks.ready.mockReset();
  streamMocks.accept.mockImplementation(() =>
    Promise.resolve<ChunkResult>({ final: false, text: "" })
  );
  streamMocks.close.mockImplementation(() => Promise.resolve(true));
  streamMocks.create.mockImplementation(() => Promise.resolve());
  streamMocks.finish.mockImplementation(() =>
    Promise.resolve<ChunkResult>({ final: true, text: "" })
  );
  streamMocks.init.mockImplementation(() =>
    Promise.resolve("/models/zipformer")
  );
  streamMocks.ready.mockImplementation(() =>
    Promise.resolve(streamState.ready)
  );
};

afterEach(() => {
  setTauri(false);
  resetMockDefaults();
});

const TICK = new Float32Array(3200); // 200ms @16k

const pump = (): Promise<void> => {
  let chain = Promise.resolve();
  for (let i = 0; i < 5; i += 1) {
    chain = chain.then(() => Promise.resolve());
  }
  return chain;
};

describe("createSttStreamController", () => {
  it("model id is the Zipformer JA manifest", () => {
    expect(STREAMING_STT_MODEL_ID).toBe(
      "sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01"
    );
  });

  it("start → ticks → partial updates → stop finalizes", async () => {
    setTauri(true);
    const emit: { fn: ((tick: Float32Array) => void) | null } = {
      fn: null,
    };
    const capture = makeFakeCapture([TICK, TICK, TICK], (e) => {
      emit.fn = e;
    });
    const controller = createSttStreamController(capture);

    let call = 0;
    const chunks: ChunkResult[] = [
      { final: false, text: "た" },
      { final: false, text: "たべ" },
      { final: true, text: "たべる" },
    ];
    streamMocks.accept.mockImplementation(() => {
      const next = chunks[Math.min(call, chunks.length - 1)];
      call += 1;
      return Promise.resolve(next);
    });

    const finals: string[] = [];
    await controller.start("line-1", {
      onFinal: (t) => {
        finals.push(t);
      },
    });
    // 3 ticks through the production onTick seam → 3 accept invokes.
    emit.fn?.(TICK);
    emit.fn?.(TICK);
    emit.fn?.(TICK);
    await pump();
    expect(streamMocks.accept.mock.calls.length).toBe(3);
    expect(streamMocks.create.mock.calls[0]?.[0]).toBe("line-1");
    expect(controller.partial).toBe("たべる");
    expect(finals).toEqual(["たべる"]); // endpoint fired on chunk 3

    // stop() flushes the tail → finish resolves the utterance again.
    streamMocks.finish.mockImplementation(() =>
      Promise.resolve({ final: true, text: "たべる" })
    );
    const final = await controller.stop();
    expect(final).toBe("たべる");
    expect(finals).toEqual(["たべる", "たべる"]);
    expect(streamMocks.finish.mock.calls[0]?.[0]).toBe("line-1");
    expect(controller.listening).toBe(false);
  });

  it("stop without start is a no-op returning null", async () => {
    const controller = createSttStreamController(
      makeFakeCapture([], () => undefined)
    );
    const final = await controller.stop();
    expect(final).toBeNull();
    expect(streamMocks.finish.mock.calls.length).toBe(0);
  });

  it("outside Tauri start records the unavailable error, never throws", async () => {
    setTauri(false);
    const controller = createSttStreamController(
      makeFakeCapture([], () => undefined)
    );
    await controller.start("line-1");
    expect(controller.error).toBe("stt-stream:unavailable");
    expect(controller.listening).toBe(false);
    expect(streamMocks.create.mock.calls.length).toBe(0);
  });

  it("create failure lands in error state, mic torn down", async () => {
    setTauri(true);
    streamState.failCreate = true;
    streamMocks.create.mockImplementation(() =>
      Promise.reject(new Error("no engine"))
    );
    let stopped = false;
    const capture: SttStreamCapture = () =>
      Promise.resolve({
        sampleRate: 16_000,
        stop: () => {
          stopped = true;
          return Promise.resolve({
            pcm: new Uint8Array(),
            sampleRate: 16_000,
          });
        },
      });
    const controller = createSttStreamController(capture);
    await controller.start("line-1");
    expect(controller.error).toBe("stt-stream:unavailable");
    expect(controller.listening).toBe(false);
    // The mic was never opened (create failed before capture).
    expect(stopped).toBe(false);
  });

  it("not-ready engine triggers one init attempt then session create", async () => {
    setTauri(true);
    streamState.ready = false;
    const controller = createSttStreamController(
      makeFakeCapture([], () => undefined)
    );
    await controller.start("line-9");
    expect(streamMocks.init.mock.calls[0]?.[0]).toBe(STREAMING_STT_MODEL_ID);
    expect(streamMocks.create.mock.calls.length).toBe(1);
    await controller.stop();
  });

  it("restart finalizes the previous session first", async () => {
    setTauri(true);
    const controller = createSttStreamController(
      makeFakeCapture([], () => undefined)
    );
    await controller.start("line-1");
    await controller.start("line-2");
    expect(streamMocks.finish.mock.calls[0]?.[0]).toBe("line-1");
    expect(streamMocks.create.mock.calls.map((c) => c[0])).toEqual([
      "line-1",
      "line-2",
    ]);
    await controller.stop();
  });

  it("subscribe fires on snapshot changes and unsubscribes", async () => {
    setTauri(true);
    const controller = createSttStreamController(
      makeFakeCapture([], () => undefined)
    );
    let events = 0;
    const unsub = controller.subscribe(() => {
      events += 1;
    });
    await controller.start("line-1");
    expect(events).toBeGreaterThan(0);
    unsub();
    const before = events;
    await controller.stop();
    expect(events).toBe(before);
  });
});

// ---- UI source contracts (Tauri-only surfaces) ---------------------------

const root = resolve(import.meta.dirname, "..", "src");
const file = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

describe("streaming UI contracts (TASK-21.5 AC2/AC3)", () => {
  it("ListenType.Shadow: live diff + FSRS Good(3) threshold wiring", () => {
    const src = file("features/listen-type/listen-type.tsx");
    expect(src).toContain("const Shadow = () =>");
    expect(src).toContain("ListenType = Object.assign(ListenTypeRoot, {");
    expect(src).toContain("Shadow,");
    expect(src).toContain("useSttStream()");
    expect(src).toContain("shadowScore(");
    expect(src).toContain("SHADOW_GRADE_THRESHOLD");
    expect(src).toContain("onGrade(3)");
    expect(src).toContain('data-testid="listen-shadow"');
    expect(src).toContain('data-testid="shadow-partial"');
    expect(src).toContain('data-testid="shadow-score"');
    expect(src).toContain('aria-live="polite"');
  });

  it("/listen route mounts the Shadow loop", () => {
    const src = file("routes/listen.tsx");
    expect(src).toContain("<ListenType.Shadow />");
  });

  it("Settings: streaming auto-pick row feeds spec.streaming=true (AC3)", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain('data-testid="settings-speech-auto-streaming"');
    expect(src).toContain("autoDownload(true)");
    expect(src).toContain("data-streaming");
  });

  it("Roleplay: streaming is an upgrade over file STT, not a gate", () => {
    const src = file("features/roleplay/roleplay.tsx");
    expect(src).toContain("isSttStreamReady");
    expect(src).toContain("onSpeakStream");
    expect(src).toContain("onSpeakFile");
    expect(src).toContain('source: "stt-stream"');
  });
});
