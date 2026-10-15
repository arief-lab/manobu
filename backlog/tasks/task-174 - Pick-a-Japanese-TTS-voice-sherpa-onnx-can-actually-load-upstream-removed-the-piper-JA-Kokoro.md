---
id: TASK-174
title: >-
  Pick a Japanese TTS voice sherpa-onnx can actually load (upstream removed the
  piper JA Kokoro)
status: Done
assignee:
  - '@Buffy'
created_date: '2026-10-13 05:16'
updated_date: '2026-10-13 06:33'
labels:
  - tts
  - speech
  - exam
dependencies: []
priority: medium
type: spike
ordinal: 989000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The shipped plan for hearing the listening section names one voice: `vits-piper-ja_JP-kokoro`, mirrored in `packages/speech/src/models.ts:35` and `apps/desktop/src-tauri/src/speech/models.rs:153-156`, downloaded from `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-ja_JP-kokoro.tar.bz2`. Audit 2026-10-13: that URL is HTTP 404, and the upstream `tts-models` release (647 assets enumerated via the GitHub API) contains NO Japanese TTS model at all; the surviving `kokoro-multi-lang-v1_0/v1_1` are documented Chinese + English only. So TASK-154 (fresh-install listening audio) and transitively TASK-173.8 are blocked on a model-source decision, not on code. Candidates known today: Kokoro-82M-v1.0-ONNX community exports (onnx-community, speaches-ai; Apache-2.0; have JA voices) but they ship in a layout sherpa `OfflineTts` cannot read — `apps/desktop/src-tauri/src/speech/tts.rs` expects `model.onnx` + `tokens.txt` (piper-style) or `espeak-ng-data` under `app_data_dir/speech/models/<id>/`; self-hosting an archived copy of the removed asset (provenance and licence unclear); or a different engine entirely. Bundle-vs-download is already decided by weight: the AppImage is 171 MB and Kokoro-class voices run 100–350 MB, so the source must be a reachable first-run download URL.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The task records the final download URL, asset byte size, and licence, and the URL answers HTTP 200 from outside the dev shell
- [x] #2 If the route needs a conversion/export step (e.g. Kokoro ONNX to the piper-style layout), the produced directory validates with `speech_validate_model` for kind tts and plays in the dev.speech route
- [x] #3 The licence permits redistribution in a closed-source desktop app and any attribution obligation is written into the task notes
- [x] #4 A note names the route taken and the candidates rejected with one-line reasons, so TASK-154 becomes a manifest edit plus the surface work
- [x] #5 The chosen voice loads and synthesizes an audible Japanese sample WAV through the app's pinned sherpa-onnx Rust binding (v1.13.7, OfflineTts Supertonic config), proven on this machine; owner listened to out-ja.wav and approved the quality (2026-10-13). In-app speech_tts is a silence stub for every voice, so real command wiring is TASK-154's owned work.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Choose the voice: supertonic-3 (sherpa-onnx host it; Japanese; OpenRAIL; 123 MB int8 tar.bz2, HTTP 200 confirmed from outside the dev shell).
2. Prove AC#1 on this machine: the current `speech_tts` in apps/desktop/src-tauri/src/speech/tts.rs is a silence stub, so wire the real sherpa_onnx::OfflineTts Supertonic config (the crate at our pinned 1.13.7 already exposes OfflineTtsSupertonicModelConfig) behind the existing command.
3. Synthesize an audible Japanese sample WAV through that path and play it in the dev.speech route.
4. Record URL/size/licence/attribution in the task notes; name the rejected candidates (removed piper JA Kokoro, Kokoro-82M community ONNX, MMS, kokoro-multi-lang, matcha) with one-line reasons.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SPIKE RESULT (2026-10-13) — route taken: Supertonic 3 (sherpa-onnx hosted).
- Chosen voice: supertonic-3-ja. Download URL: https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2 — HTTP 200 from outside the dev shell, 128,774,318 bytes (123 MB), byte-exact vs the GitHub asset listing.
- Licence: model weights OpenRAIL-M (HF Supertone/supertonic-3 card + LICENSE file; permits commercial use and redistribution in closed-source apps, with the Section-III use restrictions flowing downstream and the copyright notice kept). Sample code MIT. Attribution to write into the app: "Supertonic 3 TTS model © Supertone Inc., licensed under OpenRAIL-M".
- Proof (AC#1, amended wording): the tarball extracted to ~/.cache/manobu-task174/sherpa-onnx-supertonic-3-tts-int8-2026-05-11; loaded via sherpa_onnx::OfflineTts with OfflineTtsSupertonicModelConfig using the app's EXACT pinned crate version (sherpa-onnx 1.13.7, static) — the 1.13.7 Rust binding already exposes Supertonic (verified in sherpa-onnx/rust/sherpa-onnx/src/tts.rs at tag v1.13.7). Synthesized "明日は雨ですから、早く帰宅しましょう。" with extra lang=ja, sid 0: sample_rate 44100, num_speakers 10, 3.57 s audio in 2.05 s on a DEBUG build (RTF ~0.57), peak 0.37, saved ~/.cache/manobu-task174/out-ja.wav. Round-trip intelligibility proof: SenseVoice ASR (the app's existing STT model) transcribed the WAV back to the exact input string. Spike source preserved at ~/.cache/manobu-task174/supertonic_spike.rs (was apps/desktop/src-tauri/examples/ during the run; not committed).
- Deviation from AC#1 wording: speech_init_tts's file check (model.onnx + tokens.txt/espeak-ng-data) does not fit the Supertonic layout (duration_predictor/text_encoder/vector_estimator/vocoder .onnx + tts.json + unicode_indexer.bin + voice.bin), AND speech_tts in apps/desktop/src-tauri/src/speech/tts.rs is a silence stub (sherpa was never linked for TTS; `inner: Option<()>` at tts.rs:30). So "audible through the existing path" is only reachable once TASK-154 wires the real OfflineTts and relaxes the file check; this spike proves the model loads and speaks Japanese through the same crate the app links.
- AC#3: N/A — no conversion step; sherpa ships the loadable layout.
- Rejected candidates: (1) upstream vits-piper-ja_JP-kokoro — deleted from the tts-models release, no JA asset among all 646. (2) piper-voices ja_JP-hi_fi_captain-medium (the only Japanese Piper voice, downloadable at huggingface.co/rhasspy/piper-voices/resolve/main/ja/ja_JP/hi_fi_captain/medium/ja_JP-hi_fi_captain-medium.onnx) — MODEL_CARD: dataset NICT hi-fi-captain, CC BY-NC-SA 4.0, fails AC#4. (3) Kokoro-82M v1.0 community ONNX exports — sherpa's Kokoro engine is zh+en only (v1.0 scripts: generate_lexicon_en/zh; kokoro-multi-lang sample wavs are en/zh), sherpa cannot load JA Kokoro without a new JA phonemization path. (4) MMS-TTS — facebook/mms-tts has no Japanese TTS model (models/jpn_female_1 404) and the repo is CC-BY-NC-4.0 anyway. (5) matcha — sherpa ships only en/zh matcha-icefall models. (6) zipvoice — sherpa's hosted asset is zh+en emilia only.
- For TASK-154: manifest url swap to the supertonic asset; models.rs kind-aware validation must accept the Supertonic file set (new kind or per-file manifest); tts.rs stub replacement with real OfflineTts (sid/lang via GenerationConfig.extra["lang"]="ja"); pick default sid among the 10 speakers; first-run download only (123 MB vs 171 MB AppImage).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Chose supertonic-3-ja (sherpa-onnx hosted, OpenRAIL-M, 123 MB int8, HTTP 200 verified): loads through the app's pinned sherpa-onnx 1.13.7 Rust binding, synthesized an audible Japanese WAV (44.1 kHz, RTF ~0.57 debug) that SenseVoice transcribed back exactly; owner approved quality. No conversion step needed. Rejected: removed upstream piper JA asset (gone), Piper ja_JP-hi_fi_captain (CC BY-NC-SA), Kokoro-82M community ONNX (sherpa cannot load JA Kokoro), MMS (no JA model + CC BY-NC), matcha/zipvoice sherpa assets (no JA). TASK-154 is now manifest swap + real OfflineTts wiring + Supertonic-layout validation + default sid.
<!-- SECTION:FINAL_SUMMARY:END -->
