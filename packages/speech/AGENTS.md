# packages/speech — Speech domain (sherpa-onnx via Tauri)

## Purpose

- Domain package that screams **speech** (TTS / STT / VAD) for manobu.
- Frontend counterpart to `apps/desktop/src-tauri/src/speech/` (Rust sherpa-onnx).
- No `apps/server` dependency — 100% offline, on-device via Tauri invoke.

## Ownership

- Project contributors.

## Local Contracts

- Subpaths (each is a subdomain):
  - `.` → `./src/index.ts` — barrel re-export
  - `./tts` → `tts.ts` — `initTts`, `speak(text)`, `isTtsReady()`, `speakAndPlay(text)`, `ensurePlaybackAudioContext()`, `playWavBytes(wav, ctx)` → Tauri `speech_tts` (real Supertonic 3 audio since TASK-154; no engine = error, never silent audio). Click-handler playback goes through `ensurePlaybackAudioContext()` **synchronously on the gesture**, then `playWavBytes(wav, ctx)` after `speak()` resolves: Tauri's Linux WebKitGTK webview closes the user activation once an `await` resolves, so `new Audio(url).play()` rejects with NotAllowedError and the ▶ animates silence. The `url` returned by `speak()` stays for `<audio src>` surfaces only.
  - `./stt` → `stt.ts` — `initStt`, `transcribeFile(path)` → Tauri `speech_stt_file`; streaming (TASK-21.5): `initSttStream(modelId, {modelDir?})`, `isSttStreamReady()`, `createSttStreamSession(sessionId)`, `acceptSttStreamChunk(sessionId, samples, sampleRate=16k)` → `SttStreamChunk {final, text}`, `finishSttStreamSession(sessionId)`, `closeSttStreamSession(sessionId)` — web stubs resolve inert values so UI code stays Tauri-shape identical
  - `./vad` → `vad.ts` — `initVad`, `detectVad(samples)` → Tauri `speech_vad_detect` (sherpa Silero when the engine is initialized, RMS>0.01 energy stub otherwise — AC4 web-dev path; returns `VadSegment[] {start_ms, end_ms}`)
  - `./models` → `models.ts` — `listModels`, `knownModels`, `ensureModelsDir`
  - `./hooks` → `hooks.ts` — React hooks `useTts`, `useStt`, `useVad`
- Depends on `@tauri-apps/api` (`invoke`). Falls back to stub when not in Tauri (web dev).
- Tauri Rust side lives at `apps/desktop/src-tauri/src/speech/` with matching commands:
  `speech_version`, `speech_status`, `speech_list_models`, `speech_init_tts`,
  `speech_tts`, `speech_init_stt`, `speech_stt_file`, `speech_init_vad`, `speech_vad_detect`,
  `speech_init_stt_stream`, `speech_stt_stream_is_ready`, `speech_stt_stream_create`,
  `speech_stt_stream_accept`, `speech_stt_stream_finish`, `speech_stt_stream_close` (TASK-21.5).

## Work Guidance

- Keep this package domain-pure — no `ai` SDK, no `ui` primitives. Those are consumers.
- Model ids are under `app_data_dir/speech/models/<id>` (see `models.ts` `KNOWN_MODELS`). Models are never bundled — downloaded on demand via `ensureModel`/`autoDownload`; manual fallback: extract the tar.bz2 from https://k2-fsa.github.io/sherpa/onnx/pretrained_models/ into the models dir.
- TTS returns WAV bytes — frontend creates `Blob` URL for `<audio>`; STT takes wav path.
- Mic recordings (TASK-21.2) are written by the Rust command `speech_write_temp_wav` (PCM16 bytes + sample rate in, absolute wav path out) under `app_data_dir/speech/tmp/` — the frontend never needs `tauri-plugin-fs`. `speech_stt_file` decodes with the real SenseVoice `OfflineRecognizer` when the model dir validates, else echoes a `[stub STT] …` marker (treated as not-transcribed upstream).
- VAD model (TASK-21.3): `sherpa-onnx-silero-vad` (~1MB single `silero_vad.onnx`, bare `.onnx` URL — no tar.bz2) auto-downloads alongside STT in Settings (non-blocking, AC3) or standalone; readiness is kind-aware (`model_ready`: VAD = `silero_vad.onnx` present, no tokens required), so `speech_status.vad_ready` flips true after `initVad`.
- TTS voice (TASK-154/174): `TTS_MODEL_ID` (`sherpa-onnx-supertonic-3-tts-int8-2026-05-11`, exported from `models.ts`) — Supertonic 3 int8 (OpenRAIL-M, ~123 MB tar.bz2, 10 built-in voices sid 0–9, 44.1kHz output). Never bundled; the skippable download is offered on the `setup` rail (`apps/desktop/src/features/setup/setup.tsx`, which warms `ensureTts` on success) and in Settings, never on the exam surface. Readiness keys on the 7-file stage set (`SUPERTONIC_FILES` in Rust `models.rs`), NOT `model.onnx`/`tokens.txt`. Desktop boot calls `ensureTts()` (`apps/desktop/src/lib/tts-init.ts`) once, mirroring `ensureVad`.
- Model lifecycle (TASK-21.4): `ensureModel` → `validateModel` (Rust `speech_validate_model` returns `ModelValidation {corrupt, kind, missing, ready}` — corrupt = leftover archive or truncated weights, drives the Settings UUIuC banner) → `initStt`. `[Re-download]` = `removeModel` (Rust `speech_remove_model`, path-guarded) then `ensureModel` again. `classifyModelDownloadError(e)` maps failures to `disk_full | offline | interrupted | corrupt | error` for the banner copy.
- Streaming STT (TASK-21.5): Zipformer JA (`sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01`) only; the session is caller-keyed (e.g. shadowing line id), `acceptSttStreamChunk` expects ~200ms 16kHz mono Float32 ticks (mic-stt `onTick` seam), endpoint detection returns `{final:true}` and resets the stream while the session lives; `finishSttStreamSession` flushes a 0.3s tail + `input_finished`. Auto-download tier logic already routes `spec.streaming=true` to this model (low tier included); on low-end without streaming the SenseVoice file path is the fallback.
- When adding a new sherpa voice, add to `KNOWN_MODELS` in Rust `models.rs` and TS `models.ts`.

## Verification

- `bun run check-types` (via Turbo).
- `bun run check` (Ultracite).

## Child DOX Index

_None._
