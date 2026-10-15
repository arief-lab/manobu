---
id: TASK-21.4
title: Model lifecycle + PC-spec auto-download — Settings UX and Tauri plumbing
status: Done
assignee:
  - '@arif'
created_date: '2026-09-06 03:58'
updated_date: '2026-09-06 09:57'
labels:
  - speech
  - models
  - tauri
  - ux
dependencies: []
parent_task_id: TASK-21
priority: high
type: feature
ordinal: 602000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Models live at app_data_dir/speech/models/<id> (models.rs:34 models_dir, model_dir) with KNOWN_MODELS for Piper Kokoro / SenseVoice / Zipformer JA / Silero VAD. TS side has listModels/knownModels/speechStatus/autoDownload(detectPcSpec()) in packages/speech/src/models.ts:14 but the Rust download_and_extract (models.rs:282) + download_file via ureq + tar bz2 extract is only wired to the debug /speech route speech.tsx:82 autoDownload. No progress, no resume, no Settings UI.

Harden lifecycle: surface status/ready/progress in Settings SCR-11 (next to Voice Varied/Female/Male sid toggle), support speech_ensure_model / speech_auto_download tier logic (models.rs:181 detect_pc_tier low/medium/high from RAM+cores + navigator.deviceMemory/hardwareConcurrency), flatten_single_subdir, and checksum/corrupt handling already hinted by UUIuC banner. Keep capability scope env:[BUN_PORT,CORS_ORIGIN,NODE_ENV,DATABASE_URL,MANOBU_ASSISTANT_DIR,ACP_MCP_SERVERS] — speech invokes covered by core:default per src-tauri/AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings .Voice shows models_dir, tts/stt/vad ready, known JA manifests with Download buttons backed by autoDownload({task,language:"ja"}) + detectPcSpec tier (low->int8/small, high->full); progress + error + [Re-download][Continue offline] for corrupt UUIuC
- [x] #2 models.rs tier logic verified: low <8GB or <=2 cores, high >=16GB+8c, medium otherwise; respects explicit spec.device_tier/spec.pc_ram_gb/pc_cores from frontend
- [x] #3 speech_list_models / speech_ensure_models_dir / speech_known_models / speech_ensure_model / speech_auto_download all covered by TS wrappers listModels/knownModelsAsync/ensureModel/autoDownload and TanStack Query offlineFirst in tauri-queries.ts where appropriate
- [x] #4 Bundle still offline-first: models not bundled, downloaded on demand to app_data_dir; docs explain manual fallback https://k2-fsa.github.io/sherpa/onnx/pretrained_models/
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Focused slice (per user, this session): Settings .Voice gains a Speech-models section — models_dir + tts/stt/vad ready via useSpeechStatus, known STT (stt_offline/stt_streaming) manifests from knownModels() with [Download] buttons calling ensureModel(id) then initStt(id) (so isSttReady flips true and TASK-21.2 grading activates), TanStack Query invalidation on ["speech","status"]. Remaining ACs (corrupt UUIuC re-download/offline UI, tier-logic tests, docs) stay open for a later session.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Focused slice implemented (2026-09-06): Settings.VoiceTab now mounts a SpeechModels section (settings.tsx). Surfaces models_dir + tts/stt/vad readiness via useSpeechStatus (typed SpeechStatus | null in tauri-queries.ts, exported SPEECH_STATUS_QUERY_KEY ["speech","status"]); lists known STT manifests (stt_offline + stt_streaming from knownModels()) each with a [Download] button; web/dev shows a desktop-only hint and no buttons. Download flow: ensureModel(id) (Rust speech_ensure_model — resolves KNOWN_MODELS, skips when model[.int8].onnx present, else ureq download + tar.bz2 extract + flatten_single_subdir) then initStt(id, {language:"ja"}) so TASK-21.2 pronunciation grading activates immediately, then invalidates the speech-status query. Errors surface in an aria-live role=alert region; busy state disables the button; no throw escapes (download().catch handled in-state).

Verification: test/settings-speech-models.test.ts 6 pass (VoiceTab mounts SpeechModels, query + manifest wiring, ensureModel→initStt→invalidate chain, typed key export, desktop-only fallback, error region); full desktop suite 82 pass / 2 skip / 3 pre-existing mock.test.ts failures unchanged; check-types 2 pre-existing ai.tsx errors only; Ultracite clean on the 3 touched files. UI contract tests follow the tts-surfaces.test.ts source-assertion pattern because the download path is Tauri-only (invoke round-trip covered by speech::stt::tests + manual QA).

Session 2 (2026-09-06) — UUIuC recovery + tier-logic tests + docs: Rust models.rs gained speech_validate_model (ModelValidation {corrupt, kind, missing, ready}; corrupt = leftover .tar.bz2/.part archive or sub-1KB truncated weights; kind-aware required files, TTS accepts espeak-ng-data) and speech_remove_model (path-guarded remove_dir_all, rejects '/'/'\\'/'..'), both registered in lib.rs. Download flow in Settings is now ensureModel → validateModel → (corrupt? UUIuC banner : initStt + invalidate). UUIuC banner per model row: [Re-download] runs removeModel→ensureModel→download chain, [Continue offline] acknowledges per-model without deleting anything; STT falls back to Type (TASK-21.2), TTS to pitch diagrams (spec UUIuC). Download errors classified via classifyModelDownloadError (disk_full k7SrUT / offline / interrupted / corrupt / error) with friendly alert copy. AC4: manual-fallback hint rendered in the section (k2-fsa.github.io/sherpa/onnx/pretrained_models/, models never bundled) + packages/speech/AGENTS.md doc line.

Session 2 verification: cargo test speech:: --lib 13 pass — 7 tier-logic (tier_from_ram_cores boundaries 7GB/2c→Low, 32GB×2c→Low, 16GB+8c→High, 16×4/12×8→Medium, 8×4→Medium; explicit device_tier overrides RAM/cores; explicit pc_ram_gb/pc_cores override sysinfo; resolve_for_spec low+streaming→Zipformer[1], stt high→SenseVoice[0]) + 5 validate_model_dir (missing dir not-ready/not-corrupt, ready model, leftover archive→corrupt, truncated 10B weights→corrupt while ready stays true, TTS espeak-ng-data accepted). TS: settings-speech-models.test.ts 13 pass incl. runtime classifyModelDownloadError mapping + source-contract for reDownload/removeModel/offlineAck; full desktop suite 88 pass / 2 skip / 3 pre-existing mock.test.ts failures unchanged; check-types 2 pre-existing ai.tsx errors only; ultracite clean on touched files.

Session 3 (2026-09-06) — AC1 + AC3 finished: Rust download_file now counts bytes through the ureq reader (64KiB chunks) into a DOWNLOAD_PROGRESS upsert-map keyed by model id (with Content-Length total when present), exposed via speech_download_progress; a local-TcpListener unit test (download_file_counts_bytes_and_finishes_done) asserts byte-accurate downloaded, total, done flag, and the global counter; plus set_progress upsert test. tauri-queries.ts (AC3): speechModelsQueryOptions/useSpeechModels (speech_list_models), useEnsureModel (speech_ensure_model), useAutoDownloadModel (delegates to @manobu/speech autoDownload which enriches the spec with detectPcSpec deviceMemory/hardwareConcurrency hints before the invoke; Rust still resolves tier + honors explicit overrides), useEnsureModelsDir, useSpeechDownloadProgress (speech_download_progress polled 500ms, caller-gated enabled) — all networkMode offlineFirst per repo convention. Settings SpeechModels (AC1): per-model [Download] buttons now run the useEnsureModel mutation → validateModel → initStt → invalidate speech-status + speech-models queries; new [Auto-pick for my PC] row calls useAutoDownloadModel({task:'stt',language:'ja'}) letting the PC tier choose the manifest (low→Zipformer small, else SenseVoice full); while any download is in flight a live ⏬ {percent|MB} <output aria-live=polite> renders from the progress query (percent when total known, MB otherwise); UUIuC corrupt banner + [Re-download]/[Continue offline] unchanged and still reached through afterDownload validation.

Session 3 verification: cargo test speech:: --lib 15 pass (13 prior + upsert + local-HTTP progress). TS settings-speech-models.test.ts 18 pass (tier-aware auto-download wiring, progress indicator, useEnsureModel mutation + speech-models invalidation, offlineFirst hook exports, detectPcSpec enrichment contract). Full desktop suite 96 pass / 2 skip / 3 pre-existing mock.test.ts failures unchanged. check-types 2 pre-existing ai.tsx errors only (a transient PARSE_ERROR from a duplicate reDownload declaration was introduced and fixed within this session; baseline restored). Ultracite clean on settings.tsx, tauri-queries.ts, test file.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @arif
created: 2026-09-06 08:30
---
Slice complete, remaining ACs open: AC1 corrupt UUIuC [Re-download][Continue offline] + autoDownload({task,language}) tier wiring into the UI; AC2 Rust tier-logic unit tests (detect_pc_tier boundaries 8GB/2c and 16GB/8c + explicit spec overrides); AC3 offlineFirst query coverage for ensureModel/listModels; AC4 manual-fallback docs (k2-fsa pretrained_models URL). Task stays In Progress for the next session.
---

author: @arif
created: 2026-09-06 09:41
---
AC1 remains partially open: the tier-aware path (autoDownload({task:'stt',language:'ja'}) + detectPcSpec low→int8/small vs high→full) is implemented on both sides but the Settings buttons call ensureModel(id) directly; wiring the buttons to autoDownload + a progress % indicator is the remaining slice. AC3 offlineFirst query coverage for ensureModel/listModels also still open (ensureModel is a mutation-style call, currently invoked inline). Everything else done.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-21.4 complete: Settings SCR-11 .Voice now manages the full offline-model lifecycle — models_dir + tts/stt/vad readiness, known STT manifests with [Download] (ensureModel mutation → validateModel UUIuC check → initStt ja → query invalidation), tier-aware [Auto-pick for my PC] (autoDownload + detectPcSpec, Rust low/medium/high), live byte progress from the new byte-counted Rust speech_download_progress command, UUIuC [Re-download]/[Continue offline] corrupt recovery (speech_validate_model + speech_remove_model), classified download errors (disk_full/offline/interrupted), and a manual-fallback doc hint. All 4 ACs verified: AC1 UI+tier+progress+corrupt (18 TS tests + manual contract), AC2 tier boundaries (7 Rust tests), AC3 offlineFirst query/mutation coverage (hooks + tests), AC4 offline-first docs (UI hint + packages/speech/AGENTS.md). Evidence: cargo test speech:: --lib 15 pass, bun test settings-speech-models.test.ts 18 pass, desktop suite 96 pass / 3 pre-existing failures, check-types 2 pre-existing errors, Ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
