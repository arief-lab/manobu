---
id: TASK-21.5
title: Streaming shadowing + conversation STT — Zipformer live loop (follow-up)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-06 03:58'
updated_date: '2026-09-06 12:49'
labels:
  - speech
  - stt
  - streaming
  - tauri
dependencies: []
parent_task_id: TASK-21
priority: medium
type: feature
ordinal: 603000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Offline STT today is file-at-once (speech_stt_file, stt.rs:86 OfflineRecognizer stub). For live shadowing and free-talk with the Teacher Agent (apps/desktop/src/routes/learn/conversation/$sessionId.tsx SSE to POST /learn/chat, packages/agent orchestrator), learners need low-latency streaming — the Zipformer JA model sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01 already in KNOWN_MODELS[1] (stt_streaming).

This is a follow-up after TTS ubiquitous + file STT + VAD land. Implement speech_stt_stream chunked OnlineRecognizer path (stt.rs:4 TODO) fed by VAD-gated mic chunks, yielding partial transcripts for shadowing score and final text for Teacher Agent. Keep offline-first: no Cloud STT, 16kHz mono PCM, app_data_dir temp files for fallback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 speech_stt_stream Tauri command streams Float32 chunks -> partial + final text; frontend hook useSttStream() with onPartial/onFinal, VAD-gated
- [x] #2 Shadowing lab (or ListenType variant) shows live kana vs target diff; Roleplay/Conversation can use mic as alternative to typing, still gated by isSttReady + Settings telemetry OFF default
- [x] #3 Zipformer JA selected automatically when spec.streaming=true and PC tier allows it (autoDownload tier logic); falls back to SenseVoice file STT on low-end or when streaming not requested
- [x] #4 No regression: file STT transcribeFile() still works; streaming is additive; tests mock streaming invoke, web-dev shows RMS VAD + stub transcription
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rust stt.rs — OnlineSttEngine { recognizer: Arc<OnlineRecognizer> } created at init when the Zipformer streaming layout validates (encoder/decoder/joiner .onnx + tokens.txt, greedy_search, endpoint rule1 0.5s/rule2 0.75s); SpeechState gains stt_online slot; new commands speech_stt_stream_init (model_id/model_dir, independent from offline init), speech_stt_stream_create (session_id -> stream), speech_stt_stream_accept (session_id, f32 chunk -> {partial, final, text} — decode-while-ready per chunk, endpoint resets stream and flags final), speech_stt_stream_finish (flush + input_finished + final tail), speech_stt_stream_close (drop session). 2. packages/speech stt.ts — initSttStream, createSttStream, acceptSttStream, finishSttStream, closeSttStream wrappers (web-dev stubs); new lib/stt-stream.ts hook useSttStream({onPartial,onFinal}) — VAD-gated 200ms mic chunks via startMicCapture onLevel aggregation, isSttReady gating, RMS VAD fallback in web-dev. 3. Shadowing UI — ListenType.Shadow subcomponent: live partial kana vs target diff (char-set overlap %), final ≥80% maps FSRS Good(3); mount on /listen route behind mic availability; mic alternative in Roleplay uses streaming partials when stt_stream ready. 4. autoDownload tier: resolve_for_spec already returns Zipformer for streaming=true; Settings streaming toggle row (task=stt, streaming=true) + telemetry default-OFF gate for teacher-conversation mic forwarding. 5. Tests — Rust: stub stream round-trip + endpoint final; TS: stt-stream hook via mocked invoke seam, ListenType.Shadow contracts. 6. Verify (bun test, check-types, cargo test, ultracite) + DOX + finalize.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: cargo test speech:: --lib → 29 pass (6 new streaming tests: init layout validation, stub degradation via missing tokens.txt — never dummy ONNX payloads, sherpa aborts the process; create gating; close idempotence; serde final contract). bun test test/stt-stream.test.ts → 19 pass (shadowScore math incl. multiset repeat + extra-char denominator semantics, controller loop start→ticks→partial→endpoint-final→stop-finalized via mocked @manobu/speech/stt seam, restart finalizes previous session, subscribe/unsubscribe, UI contracts for Shadow/Settings streaming row/Roleplay upgrade). Full desktop suite 142 pass / 0 fail / 2 skip. check-types only the 2 pre-existing ai.tsx errors. Ultracite clean on all 10 touched files. AC evidence: AC1 = speech_stt_stream_accept round-trip in Rust + useSttStream controller loop in TS (both with partial+final). AC2 = ListenType.Shadow mounted on /listen with live shadowScore diff + FSRS Good(3) at ≥0.8 (tested math) + Roleplay onSpeakStream/onSpeakFile upgrade-fallback; telemetry remains default-OFF (settings.ts DEFAULT_SETTINGS). AC3 = resolve_for_spec already routes spec.streaming=true to Zipformer (Rust tier tests from TASK-21.4 cover low-tier streaming) + new Settings [Auto-pick] — live shadowing (streaming) row calling autoDownload(true) (source contract test). AC4 = file STT untouched (transcribeFile suites green), streaming purely additive (new commands + new files), web-dev stubs verified by wrapper tests resolving inert values outside Tauri.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @arif
created: 2026-09-06 11:56
---
sherpa 1.13.7 OnlineRecognizer API confirmed: create_stream/accept_waveform(sample_rate, &[f32])/decode-while-is_ready/get_result->RecognizerResult{text,tokens,is_final}/is_endpoint/reset/input_finished. Recognizer is Send+Sync; sessions will be a Mutex<HashMap<String, OnlineStream>> so streams can be fed from any invoke. Zipformer JA layout = encoder/decoder/joiner + tokens.txt (~70MB, already KNOWN_MODELS[1] and resolve_for_spec returns it for streaming=true).
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Streaming shadowing + conversation STT (TASK-21.5): Rust OnlineSttEngine (Zipformer OnlineRecognizer, endpoint 0.5s/0.75s) + SpeechState.stt_online/stt_streams + 6 speech_stt_stream_* commands with stub degradation; @manobu/speech stt.ts streaming wrappers + types; lib/stt-stream.ts createSttStreamController + thin useSttStream (VAD-tick-fed, onFinal, stt-stream:* error codes, never throws); lib/shadow.ts shadowScore; ListenType.Shadow live diff UI on /listen grading FSRS Good(3) at ≥80% overlap; Roleplay streaming mic upgrade with file-STT equal fallback; Settings streaming auto-pick row. Verified: cargo 29 pass, TS 142 pass/0 fail, typecheck baseline, Ultracite clean; DOX updated in 4 AGENTS.md files.
<!-- SECTION:FINAL_SUMMARY:END -->
