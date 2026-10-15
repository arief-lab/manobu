---
id: TASK-154
title: >-
  Ship a Japanese TTS voice so a new install can actually hear the listening
  section
status: Done
assignee:
  - '@Buffy'
created_date: '2026-09-28 03:18'
updated_date: '2026-10-13 11:08'
labels:
  - speech
  - exam
  - appimage
  - release
dependencies:
  - TASK-151
  - TASK-174
references:
  - doc-24
priority: low
type: enhancement
ordinal: 919000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every JLPT paper has 10 listening items and a fresh AppImage cannot play one of them. The audio is synthesised on the client: packages/speech/src/tts.ts:24 runs sherpa-onnx OfflineTts (VITS / Kokoro / Matcha), the manifest lists the Japanese voice as `vits-piper-ja_JP-kokoro` at packages/speech/src/models.ts:35, mirrored from `KNOWN_MODELS` in apps/desktop/src-tauri/src/speech/models.rs, and every entry starts `ready: false`. Getting a voice is a user action taken on a developer route (apps/desktop/src/routes/dev.speech.tsx:43, "Download TTS (Piper JA)"), which is why nothing has forced the question.

The exam surface already degrades honestly: apps/desktop/src/features/exam/exam-question.tsx:165 shows "Audio unavailable. The script is in the review." That line is the release-day experience for a new learner. It is also load-bearing in the design: packages/db/AGENTS.md:29 records that the listening script is projected to the client precisely because the sidecar has no TTS and the models live in the Tauri shell.

Two shapes and the task has to choose with the weight figures in hand: bundle the voice in the AppImage, or download it on first run and say so where the fallback text is now. Sequenced last by decision: it is packaging weight plus a download path, and it needs the release build of TASK-151 to test against.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A fresh install can hear a listening item without the user opening a developer route
- [x] #2 The voice resolves from a directory the app owns, and the resolution is the same in dev and in the packaged app
- [x] #3 The task records the model's size and licence and the resulting decision, bundle or first-run download
- [x] #4 If the decision is first-run download, the exam surface offers it where the unavailable message appears today, and reports the voice as not ready until it lands
- [x] #5 The existing fallback stays true when no voice is installed, and the two states are distinguishable without reading the log
- [x] #6 Verified against a built AppImage, not against vite dev
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rust manifest: swap KNOWN_MODELS[2] (models.rs:153 vits-piper-ja_JP-kokoro) to sherpa-onnx-supertonic-3-tts-int8-2026-05-11 with the TASK-174 URL-verified asset; fix stale 'Piper Kokoro is the lightest' comments in resolve_for_spec.
2. Rust readiness: make model_ready + validate_model_dir supertonic-layout-aware (duration_predictor/text_encoder/vector_estimator/vocoder .int8.onnx + tts.json + unicode_indexer.bin + voice.bin); keep legacy VITS/espeak path; update unit tests (models.rs:764).
3. Rust tts.rs: replace the silence stub with real sherpa_onnx::OfflineTts (OfflineTtsSupertonicModelConfig from the model dir; GenerationConfig with sid/speed + extra lang=ja; PCM16 WAV at engine sample_rate 44100, not hardcoded 16000).
4. TS mirror: packages/speech/src/models.ts knownModels() tts entry; stale comments in tts.ts (:24-28) and lib/tts-voice.tsx sid mapping; dev.speech.tsx:255 hint string.
5. Bootstrap + first-run: ensureTts (mirror ensureVad in lib/mic-stt.ts:337) init-once at __root.tsx boot; ExamSpeechControl distinguishes 'no voice installed' (offer download via ensureModel + speech_download_progress, then init) from 'failed' (current unavailable line) - AC4/AC5.
6. Verify: cargo test + bun test + ultracite + cargo fmt + mutation-gate --check + DOX pass; confirm on a BUILT AppImage that a fresh install hears a listening item - AC1/AC2/AC6.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-10-13: the manifest URL for `vits-piper-ja_JP-kokoro` (`apps/desktop/src-tauri/src/speech/models.rs:156`) is HTTP 404, and the upstream `tts-models` release carries zero Japanese TTS assets (647 checked via API); `kokoro-multi-lang-v1_0/v1_1` are zh+en only per sherpa docs. Fresh installs therefore cannot reach AC#1/#4 with the current manifest: a voice source must be chosen first, which is tracked as TASK-174 and set as a dependency here. Everything else in this task still holds: models dir is app-owned (`app_data_dir/speech/models/<id>`, models.rs:37-42), the download+progress machinery (TASK-21.4) exists, the dev-route button at `dev.speech.tsx:43` is still the only entry point, and the fallback string lives at `exam-question.tsx:173` (description says :165, drifted).

Implemented 2026-10-13: Rust KNOWN_MODELS[2] swapped to sherpa-onnx-supertonic-3-tts-int8-2026-05-11 (models.rs); model_ready/validate_model_dir are supertonic-layout-aware (SUPERTONIC_FILES) with 4 new cargo tests; tts.rs now drives real sherpa_onnx::OfflineTts (OfflineTtsSupertonicModelConfig, GenerationConfig lang=ja, num_steps 8, PCM16 WAV at engine rate 44100; stub_wav_silence deleted). TS: TTS_MODEL_ID exported from packages/speech/src/models.ts, knownModels() mirror updated, stale VITS/16kHz comments fixed (tts.ts, tts-voice.tsx, listen-button.tsx, dev.speech.tsx). Bootstrap: apps/desktop/src/lib/tts-init.ts ensureTts mirrors ensureVad; __root.tsx boots it. Exam surface: ExamSpeechControl gained a 4th state; speak failure inside Tauri with no model renders ExamVoiceOffer (ensureModel + byte progress + status invalidation) instead of the unavailable line (AC#4/#5). New tests: apps/desktop/test/exam-voice-first-run.test.ts (4). Collateral: fixed the 2 pre-existing rendered em dashes in apps/server/src/parent-watchdog.ts (from TASK-153) that failed the R-02 guard. cargo test speech: 36 pass; desktop suite 577 pass; ultracite clean; cargo fmt clean; mutation-gate --check: 207 anchors resolve.

AC#3 record (model choice, from TASK-174 spike): Supertonic 3 int8, asset sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2 = 128,774,318 bytes (~123 MB) download (HTTP 200 verified on the k2-fsa tts-models release). Licence: OpenRAIL-M (model weights Supertone Inc., inference code Apache-2.0) - commercial use permitted, no usage restrictions to enforce in-app. DECISION: first-run download, NOT bundled. Reasons: 123 MB would more than double the ~170 MB AppImage; the existing ensureModel + speech_download_progress machinery (TASK-21.4) already does download with byte progress; AC#4 defines the exam offer surface this decision requires. Consequence for readiness: until the download lands the voice reports not-ready and the exam surface shows the download offer, never silent audio.

Live AppImage verification 2026-10-13 (built AppImage, clean XDG dirs, Xvfb): fresh install shows the ExamVoiceOffer on the listening item (AC#1/#4), download reports byte progress and the 7 files land flat at app_data_dir/speech/models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11 (139M on disk, AC#2), the offer is replaced by the ready ListenButton only after the download completes, and playback runs to onended with no 'Audio unavailable' state (AC#5; the two states are visually distinct on the exam surface). During the check the post-install 'Audio unavailable' bug was found and fixed: the tarball sat inside the model dir so flatten_single_subdir no-op'd and weights landed at <id>/<id>/ (models.rs: archive removed before flatten, flatten errors propagated instead of .ok()). One limit recorded honestly: physical speaker output is not observable under Xvfb (webkit webview audio does not route to the PipeWire monitor; a paplay 440 Hz tone proves the harness carries audio), so audibility rests on the engine having no silent success path (tts.rs errors or returns real samples) plus the play-to-onended duration evidence. AC#6 satisfied: everything above ran against the packaged AppImage, never vite dev.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped the Japanese TTS voice as Supertonic 3 (sherpa-onnx-supertonic-3-tts-int8-2026-05-11, ~123 MB, OpenRAIL-M) with a first-run download decision, not bundling. Rust: real sherpa OfflineTts engine replacing the silence stub (speech/tts.rs), supertonic-layout-aware manifest and readiness (speech/models.rs), plus the live-check fix: the tarball is removed before flatten_single_subdir so the weights land flat instead of nested at <id>/<id>/ (this was the post-install 'Audio unavailable' bug). TS: TTS_MODEL_ID + mirror, one-shot ensureTts boot strap (lib/tts-init.ts, __root.tsx), and ExamSpeechControl's 4th state renders the in-exam download offer (ExamVoiceOffer with byte progress) where the unavailable line appears, so no-voice and failure are distinguishable without the log. withGlobalTauri enabled so the packaged webview sees window.__TAURI__. Verified on the built AppImage under clean XDG dirs (never vite dev): offer shows on the listening item, download lands 7 files flat (139M), ready ListenButton plays to onended with no error state; cargo test 54 pass, desktop bun suite 577 pass, ultracite + cargo fmt + mutation-gate --check + check:dox clean. Honest limit: physical speaker output not observable under Xvfb (webview audio unrouted; paplay differential proves the harness), audibility rests on the engine's lack of a silent-success path.
<!-- SECTION:FINAL_SUMMARY:END -->
