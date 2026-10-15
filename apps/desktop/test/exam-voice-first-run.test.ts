import { describe, expect, it, mock } from "bun:test";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TtsProvider } from "@/lib/tts-voice";

/**
 * TASK-154 — first-run voice: the Tauri-side bootstrap (`ensureTts`, the
 * `ensureVad` mirror) and the exam surface's download offer.
 *
 * Mirrors vad-flow.test.ts: module-mock the `@manobu/speech/tts` wrapper
 * and `@tauri-apps/api/core`, toggle `__TAURI__` on globalThis, and assert
 * the offer component directly (this suite has no DOM-event harness, so the
 * state transition itself is asserted through the wiring in source).
 */

const srcFile = (rel: string): string =>
  readFileSync(resolve(import.meta.dirname, "..", "src", rel), "utf8");

const setTauri = (on: boolean): void => {
  // `tts-init` gates on `"__TAURI__" in window` (the packages/speech
  // check). bun test runs without a DOM, so alias window to globalThis
  // and toggle the key there.
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.window === undefined) {
    g.window = g;
  }
  if (on) {
    g.__TAURI__ = {};
  } else {
    Reflect.deleteProperty(g, "__TAURI__");
  }
};

const initState: { ok: boolean } = { ok: true };
const initTtsMock = mock(() =>
  initState.ok
    ? Promise.resolve("/models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11")
    : Promise.reject(new Error("model file not found: voice.bin"))
);

mock.module("@manobu/speech/tts", () => ({
  ensurePlaybackAudioContext: () => null,
  initTts: () => initTtsMock(),
  isTtsReady: () => Promise.resolve(initState.ok),
  playWavBytes: () => Promise.reject(new Error("mocked: no engine")),
  speak: () => Promise.reject(new Error("mocked: no engine")),
  speakAndPlay: () => Promise.reject(new Error("mocked: no engine")),
}));
mock.module("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(null),
}));

// Import after the mocks so the module binds the mocked `initTts`.
const { ensureTts, resetTtsReady } = await import("@/lib/tts-init");
const { ExamSpeechControl, __test__ } = await import(
  "@/features/exam/exam-question"
);

describe("ensureTts bootstrap (TASK-154 AC1)", () => {
  it("caches success; stays false outside Tauri; retries after failure", async () => {
    setTauri(false);
    resetTtsReady();
    expect(await ensureTts()).toBe(false);
    expect(initTtsMock.mock.calls.length).toBe(0);

    setTauri(true);
    resetTtsReady();
    initState.ok = true;
    expect(await ensureTts()).toBe(true);
    // Cached: a second call does not re-init.
    expect(await ensureTts()).toBe(true);
    expect(initTtsMock.mock.calls.length).toBe(1);

    // A failed init (no model on disk) retries on the next call, so a voice
    // downloaded mid-session activates without an app restart.
    resetTtsReady();
    initState.ok = false;
    expect(await ensureTts()).toBe(false);
    initState.ok = true;
    expect(await ensureTts()).toBe(true);
    setTauri(false);
  });

  it("root route boots ensureTts once (AC1)", () => {
    const root = srcFile("routes/__root.tsx");
    expect(root).toContain("ensureTts().catch(() => undefined)");
    expect(root).toContain('from "@/lib/tts-init"');
  });
});

describe("exam voice: no download offer, the report instead (TASK-154 AC5)", () => {
  it("has no download affordance left in the exam surface", () => {
    const control = srcFile("features/exam/exam-question.tsx");
    // The voice is downloaded on /setup, never here. The exam surface keeps
    // only the control and the honest unavailable line.
    expect(control).toContain('data-testid="exam-speech"');
    expect(control).toContain('data-testid="exam-speech-unavailable"');
    expect(control).not.toContain("exam-speech-offer");
    expect(control).not.toContain("ExamVoiceOffer");
    expect(control).not.toContain("Download voice");
    // The three-state union (no `offer`) collapses the readiness result to
    // control-or-report, so a voice-less machine never sees a dead CTA.
    expect(control).toContain(
      'type VoiceState = "control" | "checking" | "failed";'
    );
  });
});

describe("proactive voice gate (TASK-173.8.2 AC#1/AC#2)", () => {
  const renderControl = (text: string | null): string =>
    renderToStaticMarkup(
      createElement(
        TtsProvider,
        null,
        createElement(ExamSpeechControl, { text })
      )
    );

  it("maps the first render: proven or unfixable engine is the control, else checking", async () => {
    // Outside Tauri nothing can ever install, so the TASK-141 demo path stays
    // reactive: a control that reports on the first failed speak, never a
    // pre-emptive complaint.
    setTauri(false);
    resetTtsReady();
    expect(__test__.initialVoiceState()).toBe("control");

    // Inside Tauri with no proven engine the mount must NOT be a play button.
    setTauri(true);
    expect(__test__.initialVoiceState()).toBe("checking");

    // A boot-time ensureTts success promotes every later mount to the control.
    initState.ok = true;
    expect(await ensureTts()).toBe(true);
    expect(__test__.initialVoiceState()).toBe("control");
    resetTtsReady();
    setTauri(false);
  });

  it("holds the pane empty before readiness is proven (AC#1)", () => {
    // A fresh install: inside Tauri, no bootstrapped engine. The static render
    // never runs effects, so this is exactly the mount frame the learner
    // sees first: the gate is `checking` and the pane holds empty rather than
    // offering a click that cannot produce sound. The effect then resolves
    // the gate via ensureTts (tested above) into the offer.
    setTauri(true);
    resetTtsReady();
    initState.ok = false;
    const pane = renderControl("駅まで歩きます。");
    expect(pane).toBe("");
    expect(pane).not.toContain('data-testid="exam-speech"');
    setTauri(false);
  });

  it("renders the control, not the offer, once the voice is ready (AC#2)", async () => {
    setTauri(true);
    resetTtsReady();
    initState.ok = true;
    expect(await ensureTts()).toBe(true);
    const pane = renderControl("駅まで歩きます。");
    expect(pane).toContain('data-testid="exam-speech"');
    expect(pane).not.toContain('data-testid="exam-speech-offer"');
    expect(pane).not.toContain('data-testid="exam-speech-unavailable"');
    resetTtsReady();
    setTauri(false);
  });
});
