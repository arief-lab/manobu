import { describe, expect, it } from "bun:test";

import { file } from "./helpers/source-contract";

/** Each ▶ surface must import or receive the TTS speak path so the
 * button is wired rather than static. This mirrors the existing
 * walkthrough-copies.test.ts pattern: assert the contract exists in
 * source, not the runtime behaviour (runtime is verified by hand/
 * browser and by the existing speech.tsx debug route).
 */

// `speak` imported (as a specifier) from the speech tts module, across a
// multiline import block. Hoisted so `useTopLevelRegex` stays quiet.
const SPEAK_FROM_TTS = /speak[,\s}][\s\S]{0,80}from "@manobu\/speech\/tts"/;

describe("TTS surfaces (TASK-21.1)", () => {
  it("ListenType.Audio imports useTtsPrefs + speaks on [▶]", () => {
    const src = file("features/listen-type/listen-type.tsx");
    expect(src).toContain("useTtsPrefs");
    expect(src).toContain('import("@manobu/speech/tts")');
    expect(src).toContain("speak(target.jp");
  });

  it("DrillLab.Audio imports useTtsPrefs + speaks current.char (TASK-23.2.1)", () => {
    const src = file("features/drill/drill-lab.tsx");
    expect(src).toContain("useTtsPrefs");
    expect(src).toContain('import("@manobu/speech/tts")');
    // TASK-23.2.1: speak the kana itself, not the Latin romaji.
    expect(src).toContain("speak(current.char");
    // TASK-23.2.1: 0.8×/1× speed toggle mirroring ListenType.Audio.
    expect(src).toContain('data-speed="0.8"');
    expect(src).toContain('data-speed="1"');
  });

  it("Reader speaks via the shared ListenButton (TASK-72)", () => {
    const btn = file("shared/listen-button.tsx");
    expect(btn).toContain("useTtsPrefs");
    // The import is a multi-line `import { ensurePlaybackAudioContext,
    // playWavBytes, speak } from "@manobu/speech/tts"`. Assert the specifier
    // and the module path independently so a reordered or added specifier
    // does not break the guard.
    expect(btn).toMatch(SPEAK_FROM_TTS);
    const rc = file("features/reader/reading-corner.tsx");
    expect(rc).toContain("ListenButton");
    expect(rc).toContain('data-testid="reader-story"');
  });

  it("Worksheet speaks via the shared ListenButton (TASK-72)", () => {
    const btn = file("shared/listen-button.tsx");
    expect(btn).toContain("useTtsPrefs");
    expect(btn).toMatch(SPEAK_FROM_TTS);
    expect(btn).toContain("speak(text, { sid, speed })");
    const ws = file("features/lesson/worksheet.tsx");
    expect(ws).toContain("ListenButton");
    expect(ws).toContain('data-testid="worksheet-card"');
  });

  // TASK-73: the roleplay redesign moved clerk audio onto the shared
  // ListenButton (same cutover the reader + worksheet made) — the old
  // hand-rolled dynamic-import + useTtsPrefs path is gone by design.
  it("Roleplay.Clerk speaks via the shared ListenButton (TASK-73)", () => {
    const src = file("features/roleplay/roleplay.tsx");
    expect(src).toContain("ListenButton");
    expect(src).toContain("rp-audio-");
    expect(src).toContain("rp-audio-scene");
  });

  it("KanjiDetail.Audio uses direct speak() import (not dynamic mod.speak)", () => {
    const src = file("features/kanji-detail/kanji-detail.tsx");
    // Multi-line import (speak + the WebAudio playback helpers).
    expect(src).toMatch(SPEAK_FROM_TTS);
    expect(src).not.toContain("mod.speak");
    expect(src).toContain("speak(character");
  });

  it("Settings.VoiceTab plays preview speak() when isTtsReady", () => {
    const src = file("features/settings/settings.tsx");
    expect(src).toContain("isTtsReady");
    expect(src).toContain('"@manobu/speech/tts"');
    expect(src).toContain("playPreview");
  });

  it("tts-voice reads voice from the settings store (one source)", () => {
    // 2026-09-14 state audit: the provider mirrored voice in useState + a
    // subscription and Settings double-wrote. Now the store is the single
    // source: the provider subscribes via useSyncExternalStore, and there
    // is no setVoice/useTtsSetVoice seam left.
    const src = file("lib/tts-voice.tsx");
    expect(src).toContain("export const TtsProvider");
    expect(src).toContain("export function useTtsPrefs");
    expect(src).toContain("useSyncExternalStore");
    expect(src).toContain("subscribeSettings");
    expect(src).not.toContain("useTtsSetVoice");
    const settings = file("features/settings/settings.tsx");
    expect(settings).not.toContain("setVoice");
  });

  it("__root wires TtsProvider around the route tree", () => {
    const src = file("routes/__root.tsx");
    expect(src).toContain("TtsProvider");
    expect(src).toContain('from "@/lib/tts-voice"');
  });
});
