---
id: TASK-21.3
title: VAD turn-taking and silence trimming — Silero everywhere STT is used
status: Done
assignee:
  - '@arif'
created_date: '2026-09-06 03:58'
updated_date: '2026-09-06 11:36'
labels:
  - speech
  - vad
  - tauri
dependencies: []
parent_task_id: TASK-21
priority: medium
type: feature
ordinal: 601000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
VAD via Silero (packages/speech/src/vad.ts:detectVad -> speech_vad_detect vad.rs:65) is scaffolded as a ~1MB silero_vad.onnx (models.rs:132) but never used. STT currently would transcribe leading/trailing silence and has no turn-taking signal, so mic UX is push-to-stop only.

Wire VAD as pre-processor for every STT path and as live mic activity indicator. In Rust the engine is speech_init_vad (vad.rs:45) defaulting to app_data_dir/speech/models/sherpa-onnx-silero-vad/silero_vad.onnx. In TS, detectVad(Float32Array, 16000) returns VadSegment[] {start_ms,end_ms}. Use it to trim wav before STT, to auto-stop recording after silence, and to show speaking/silent UI. The JS fallback in vad.ts already does RMS >0.01 energy check for web-dev.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 initVad() called on app boot when VAD model present; speech_status.vad_ready reflected in /speech Status and Settings
- [x] #2 STT flow trims silence via detectVad() before transcribeFile(); auto-stop after 800ms silence; UI shows mic activity (speaking/silent) via VAD segments
- [x] #3 VAD is always ~1MB — auto-download it with TTS/STT or standalone via speech_auto_download({task:"vad"}) without blocking lesson
- [x] #4 Web-dev still works via JS RMS fallback; Tauri path uses sherpa VAD when linked, stub energy VAD otherwise — both covered by tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rust vad.rs — real sherpa VoiceActivityDetector (VadEngine { detector: Arc<Mutex<>> }, VadInitRequest.sample_rate, streaming accept_waveform 512 windows + flush, speech segments → {start_ms, end_ms}); stub RMS path when engine absent; unit tests (stub energy path). 2. Rust models.rs — kind-aware model_ready (VAD → silero_vad.onnx, TTS → tokens/espeak, STT → model.onnx) for speech_list_models + speech_ensure_model + speech_auto_download so vad_ready becomes true; validate: VAD kind = weights-only; test for vad readiness. 3. mic-stt.ts — VAD pre-processor: onLevel → 200ms window detectVad ticks → onActivity({speaking,silentMs}); auto-stop 800ms silence (STOP_SILENCE_MS) via early-resolve wait; vadTrim(samples) before WAV write; degrade silently when VAD missing (stub/RMS tick). 4. UI — drill-lab.Speak + roleplay speak button show speaking/silent state; Settings vad row + initVad + non-blocking useEnsureModel(sherpa-onnx-silero-vad) after STT ready; boot initVad hook in __root.tsx. 5. Tests — test/vad-flow.test.ts + settings-speech-models additions. 6. Verify + DOX + finalize.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Evidence per AC — AC1: root route (__root.tsx) useEffect calls ensureVad() once at boot (best-effort, cached per session, retries after failure so mid-session downloads activate); speech_status.vad_ready now flips true after download+initVad because Rust model_ready is kind-aware (VAD = silero_vad.onnx present; unit-tested in models.rs::model_ready_vad_requires_silero_onnx_only + validate_vad_dir_reports_ready_with_silero_weights); Settings status line and /speech Status card already render vad_ready. AC2: recordAndTranscribe forwards 200ms VAD ticks via onActivity({speaking,silentMs}) from startMicCapture aggregation (JS/RMS degrade when VAD down), silence watchdog auto-stops after STOP_SILENCE_MS=800 (deterministic manual-clock test), vadTrim(samples, pcm) strips leading/trailing silence (±100ms pad) before speech_write_temp_wav (tested: 1000ms clip → 11200-sample payload); Drill.Speak + Roleplay speak button expose data-speaking + 🗣 speaking… live state. AC3: Silero (~1MB, bare .onnx URL, no tar.bz2) auto-downloads alongside any STT download via ensureVadAlongside (fire-and-forget, non-blocking) + standalone Settings VAD row [Download] → ensureMutation → initVad → status invalidate; speech_auto_download({task:vad}) also resolves KNOWN_MODELS[3]. AC4: Rust speech_vad_detect falls back to stub RMS>0.01 energy VAD when the engine is absent (5 unit tests), packages/speech vad.ts keeps the JS RMS fallback for web-dev, mic-stt degrades to RMS-only ticks + untrimmed PCM on VAD failure — all covered in test/vad-flow.test.ts (23 tests).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @arif
created: 2026-09-06 10:45
---
Scope confirmed by user: full AC1-4. Existing speech_auto_download({task:vad}) already resolves KNOWN_MODELS[3] and download_and_extract handles bare .onnx (silero ~1MB, non-blocking after STT init). JS RMS fallback in packages/speech/src/vad.ts stays as the web-dev path.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired Silero VAD as pre-processor and turn-taking signal for every STT path (TASK-21.3). Rust vad.rs now runs a real sherpa VoiceActivityDetector (Silero, 512-sample windows, reset→accept_waveform→flush) with a stub RMS fallback; models.rs gained kind-aware model_ready (VAD=silero_vad.onnx) so vad_ready reflects reality, plus 8 new Rust unit tests. TS mic-stt.ts added ensureVad boot init, 200ms live onActivity ticks, 800ms silence auto-stop watchdog, and vadTrim before the wav write; Drill/Roleplay show live 🗣 speaking state, Settings gained a standalone VAD [Download] row and non-blocking VAD auto-ensure alongside STT. Verified: 23 TS VAD tests + 23 Rust speech tests pass, desktop suite 121 pass/0 fail, check-types only 2 pre-existing ai.tsx errors, Ultracite clean on all 7 touched files. DOX updated (apps/desktop, src, src-tauri, packages/speech AGENTS.md).
<!-- SECTION:FINAL_SUMMARY:END -->
