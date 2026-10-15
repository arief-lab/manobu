import { describe, expect, it } from "bun:test";

import { file } from "./helpers/source-contract";

/**
 * TASK-21.4 focused slice — Settings speech-model management.
 *
 * Mirrors tts-surfaces.test.ts: assert the wiring contract exists in
 * source (the download path is Tauri-only and cannot run under bun test;
 * the invoke round-trip is covered by the Rust unit test in
 * speech::stt::tests and manual QA via the /speech debug route).
 */
describe("Settings speech models (TASK-21.4 slice)", () => {
  it("AppTab mounts the SpeechModels section", () => {
    const host = file("features/settings/settings.tsx");
    expect(host).toContain("<SpeechModels />");
    const mod = file("features/settings/settings-speech-models.tsx");
    expect(mod).toContain("export const SpeechModels");
  });

  it("SpeechModels uses the speech_status query + known STT manifests", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("useSpeechStatus()");
    expect(src).toContain('from "@manobu/speech/models"');
    expect(src).toContain("knownModels()");
    // Only STT kinds get Download buttons (TTS model ships via TASK-21.1 flow)
    expect(src).toContain('"stt_offline"');
    expect(src).toContain('"stt_streaming"');
  });

  it("Download wires ensureModel → initStt(ja) → status invalidation", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("await ensureModel(modelId)");
    expect(src).toContain('await initStt(modelId, { language: "ja" })');
    expect(src).toContain("SPEECH_STATUS_QUERY_KEY");
    expect(src).toContain("invalidateQueries");
  });

  it("tauri-queries exposes a typed speech status query + stable key", () => {
    const src = file("lib/tauri-queries.ts");
    expect(src).toContain("SPEECH_STATUS_QUERY_KEY");
    expect(src).toContain("SpeechStatus | null");
    expect(src).toContain('from "@manobu/speech/types"');
  });

  it("web/dev (no Tauri) renders the desktop-only hint, no Download buttons", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("settings-speech-desktop-only");
    expect(src).toContain("available in the desktop app");
  });

  it("download errors surface in a polite alert region", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("settings-speech-error");
    expect(src).toContain('role="alert"');
  });

  // ---- UUIuC corrupt-model recovery (AC1 remainder) ----------------------

  it("downloads validate the model dir (UUIuC corrupt check)", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("await validateModel(modelId)");
    expect(src).toContain("settings-speech-corrupt-banner");
  });

  it("corrupt banner offers [Re-download] + [Continue offline] (UUIuC)", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("settings-speech-redownload");
    expect(src).toContain("settings-speech-continue-offline");
    expect(src).toContain("[Continue offline]");
    expect(src).toContain("checksum/size mismatch");
  });

  it("[Re-download] removes the corrupt dir before fetching again", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("const reDownload");
    expect(src).toContain("await removeModel(modelId)");
    expect(src).toContain("await ensureModel(modelId)");
  });

  it("[Continue offline] acknowledges per-model without deleting anything", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("onContinueOffline");
    expect(src).toContain("offlineAck");
  });

  it("speech wrappers expose removeModel/validateModel/error classifier", () => {
    const src = file("../../../packages/speech/src/models.ts");
    expect(src).toContain("export function removeModel");
    expect(src).toContain("export function validateModel");
    expect(src).toContain("export const classifyModelDownloadError");
    expect(src).toContain("speech_remove_model");
    expect(src).toContain("speech_validate_model");
  });

  it("classifyModelDownloadError maps disk/offline/interrupted/corrupt", async () => {
    const mod = await import("@manobu/speech/models");
    const { classifyModelDownloadError } = mod;
    expect(
      classifyModelDownloadError(new Error("No space left on device"))
    ).toBe("disk_full");
    expect(
      classifyModelDownloadError(new Error("Connection refused (dns error)"))
    ).toBe("offline");
    expect(
      classifyModelDownloadError(new Error("download interrupted by user"))
    ).toBe("interrupted");
    expect(classifyModelDownloadError(new Error("checksum mismatch"))).toBe(
      "corrupt"
    );
    expect(classifyModelDownloadError(new Error("unknown"))).toBe("error");
  });

  it("manual-fallback doc hint (AC4) rendered with pretrained_models URL", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("settings-speech-manual-fallback");
    expect(src).toContain("k2-fsa.github.io/sherpa/onnx/pretrained_models/");
    expect(src).toContain("never bundled");
  });

  // ---- tier-aware auto-download + progress (AC1 remainder) ----------------

  it("offers tier-aware [Auto-pick for my PC] via autoDownload", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("settings-speech-auto-download");
    expect(src).toContain("autoMutation.mutateAsync");
    expect(src).toContain('task: "stt"');
    expect(src).toContain('language: "ja"');
  });

  it("shows a live byte/percent progress indicator while downloading", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("useSpeechDownloadProgress(downloading)");
    expect(src).toContain("settings-speech-progress");
    expect(src).toContain("progressLabel");
  });

  it("per-model buttons use the useEnsureModel mutation (AC3)", () => {
    const src = file("features/settings/settings-speech-models.tsx");
    expect(src).toContain("ensureMutation.mutateAsync(modelId)");
    expect(src).toContain(
      'invalidateQueries({ queryKey: ["speech", "models"] })'
    );
  });

  it("tauri-queries exports offlineFirst model lifecycle hooks (AC3)", () => {
    const src = file("lib/tauri-queries.ts");
    expect(src).toContain("speechModelsQueryOptions");
    expect(src).toContain("useSpeechModels");
    expect(src).toContain("useAutoDownloadModel");
    expect(src).toContain("useEnsureModel");
    expect(src).toContain("speech_download_progress");
    expect(src).toContain('networkMode: "offlineFirst"');
  });

  it("speech package still exposes autoDownload + detectPcSpec tier enrichment", () => {
    const src = file("../../../packages/speech/src/models.ts");
    expect(src).toContain("export function autoDownload");
    expect(src).toContain("export function detectPcSpec");
    // Frontend hints are enriched into the spec before the invoke.
    expect(src).toContain("device_tier: spec.device_tier ?? pc.device_tier");
  });
});
