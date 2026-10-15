---
id: TASK-21.2
title: STT pronunciation grading — Drill and Roleplay voice input
status: Done
assignee:
  - '@arif'
created_date: '2026-09-06 03:58'
updated_date: '2026-09-06 08:16'
labels:
  - speech
  - stt
  - tauri
dependencies: []
parent_task_id: TASK-21
priority: high
type: feature
ordinal: 600000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drill Lab and Roleplay score only typed input today (roleplay.ts:politeneScore/particleScore, drill-lab.tsx:gradeShape). Learners have no way to practice speaking and get feedback, even though packages/speech/src/stt.ts:transcribeFile(path) -> speech_stt_file (stt.rs:86) and the SenseVoice JA model manifest are already defined (models.rs:112 KNOWN_MODELS[0]).

Add opt-in mic input: navigator.mediaDevices.getUserMedia -> record 16kHz mono PCM -> temp wav under app_data_dir -> transcribeFile(). Compare transcription to target kana (normalized) for Drill (correct vs current.char) and for Roleplay (politeness + particle + STT kana match). Gate with isSttReady()/speech_status; when no mic or no model show the existing drill-mic-missing banner and allow Type fallback to keep mastery ≥90% achievable without mic (SCR-03 spec).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DrillLab gains [🎤 speak] alongside [Type instead] — transcribed kana graded via gradeShape or direct string match; mic missing / STT not ready falls back to TypeFallback, no throw
- [x] #2 Roleplay.Input gains [🎤 speak instead] that fills input from STT transcription and updates live politeness/particles scores; Save still requires 3 saves to end, endAfter3Saves unchanged
- [x] #3 STT path is temp-file based (16kHz mono WAV), validates wav exists, uses spawn_blocking in Rust; stub behavior replaced by real OfflineRecognizer when model present, but tests mock invoke
- [x] #4 Unit tests cover: transcribe mock, still-romaji guard, no-mic fallback, and grade mapping; bun run check-types + cargo check pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add mic capture lib apps/desktop/src/lib/mic-stt.ts: getUserMedia -> AudioWorklet/ScriptProcessor 16kHz mono PCM16 -> WAV bytes (frontend WAV writer) -> write temp file under app_data_dir via tauri-plugin-fs basePath; export recordAndTranscribe() + pcmToWav() + listMics().
2. Wire DrillLab: add Speak subcomponent with [🎤 speak] button alongside TypeFallback; uses micAvailable + isSttReady()/speech_status gating; grade via direct string match on normalized transcription (correct->3 else 1); on mic missing / STT not ready / any error -> show drill-mic-missing banner and never throw; TypeFallback remains equal path.
3. Wire Roleplay.Input: [🎤 speak instead] button fills input state from STT transcription, live politeness/particle scores update from context input; Save/NextLine/End unchanged (endAfter3Saves).
4. Rust stt.rs: replace stub echo with real sherpa-onnx OfflineRecognizer (SenseVoice config) when model dir validated; keep spawn_blocking + wav exists validation; Wave::read inside blocking task; graceful error when model missing.
5. Unit tests (test/stt-pronunciation.test.ts): transcribe mock contract, still-romaji guard, no-mic fallback, grade mapping, pcmToWav shape, politeness/particle live updates.
6. bun run check-types (desktop) + cargo check (src-tauri) + bun test + ultracite.
7. DOX pass: update apps/desktop/AGENTS.md + src/AGENTS.md indexes, packages/speech/AGENTS.md contract, backlog finalization.

Note: dev-time behavior — STT stub echo remains when no model downloaded (speech_stt_file returns [stub STT] text), so graded string match will fail vs target kana; acceptable, UI shows banner/score, no throw. Real grading only with SenseVoice model present.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified: bun test test/stt-pronunciation.test.ts 13 pass (transcribe mock happy path asserting speech_write_temp_wav payload, stt:not-ready no-invoke, stt:no-mic, stt:failed, stt:stub treated as not-transcribed, no-tauri, still-romaji guard, kanaMatch normalization, pronunciationGrade 3/1 mapping, pcm helpers). Full desktop suite 76 pass / 3 pre-existing mock.test.ts failures (confirmed identical on stashed clean tree). check-types clean except 2 pre-existing ai.tsx errors. cargo check clean + speech::stt wav-header unit test passes. Rust speech_stt_file now builds a real SenseVoice OfflineRecognizer (Arc, Send+Sync) when model[.int8].onnx + tokens.txt validate, decodes via Wave::read inside spawn_blocking, wav existence validated before decode; stub echo retained when files absent. New speech_write_temp_wav writes 44-byte-header WAV under app_data_dir/speech/tmp/ (no extra fs capability needed), registered in lib.rs invoke_handler. DrillLab.Speak ([🎤 speak], 3s bounded clip, grades via pronunciationGrade direct string match, drill-stt-error hint + TypeFallback unchanged) rendered in routes/drill.tsx. Roleplay.Input [🎤 speak instead] (5s clip) fills the same input state so politeness/particle scores recompute live; Save/NextLine/End + endAfter3Saves untouched.

Dev-time note: without the SenseVoice model downloaded, STT returns the stub echo which maps to stt:stub → UI hint, never a grade; pronunciation grading activates only when a real model is initialized (isSttReady + valid model dir). Mic-missing path: getUserMedia rejection maps to stt:no-mic and surfaces the hint; DrillLab.Speak returns null when navigator.mediaDevices.getUserMedia is absent, and TypeFallback remains the equal path (SCR-03 mastery ≥90% without mic).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added opt-in STT pronunciation input (TASK-21.2): new lib/mic-stt.ts bridge (getUserMedia → 16kHz mono PCM16 → Rust speech_write_temp_wav → transcribeFile, no-throw stt:* error codes, kanaMatch + pronunciationGrade); DrillLab gained [🎤 speak] graded by direct string match with TypeFallback as equal path; Roleplay.Input gained [🎤 speak instead] that fills input so politeness/particle scores update live (endAfter3Saves unchanged); Rust stt.rs replaced the stub with a real SenseVoice OfflineRecognizer when the model dir validates while keeping spawn_blocking + wav validation, plus speech_write_temp_wav for mic temp files. Verified with 13 new bun tests (invoke/capture mocked), bun run check-types (2 pre-existing ai.tsx errors only), cargo check + Rust wav-header unit test, and Ultracite clean on all 5 touched TS files.
<!-- SECTION:FINAL_SUMMARY:END -->
