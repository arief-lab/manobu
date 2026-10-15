---
id: TASK-21
title: Sherpa-ONNX offline speech — TTS/STT/VAD integration across labs
status: Done
assignee: []
created_date: '2026-09-06 03:58'
updated_date: '2026-09-06 12:56'
labels:
  - speech
  - sherpa-onnx
  - tauri
dependencies: []
priority: high
type: feature
ordinal: 598000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Manobu is offline-first Tauri desktop. packages/speech (TS) + apps/desktop/src-tauri/src/speech (Rust sherpa-onnx) already scaffold OfflineTts/Recognizer/VAD but only the debug /speech route and KanjiDetail sid toggle use it — all engines return stub silence/text/energy. Every lab that teaches listening/speaking currently shows static [▶] placeholders.

Goal: wire sherpa-onnx to the actual learning loops (listen→type, read→speak, roleplay, drill, lesson) so learners can hear native-like JA and get pronunciation feedback offline, with model auto-download fit to PC spec (detectPcSpec + sysinfo tier). No server dependency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Parent tracks delivery of TTS ubiquitous + STT grading + VAD + streaming shadowing + model lifecycle — each subtask independently shippable
- [x] #2 All speech stays 100% on-device via Tauri invoke (@manobu/speech <-> speech_* commands); never calls apps/server
- [x] #3 Docs updated: packages/speech/AGENTS.md, apps/desktop/src-tauri/AGENTS.md, and Child DOX Indexes reflect new wiring
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Parent epic finalized. Subtask delivery evidence: TASK-21.1 (TTS ubiquitous — Piper Kokoro wired to all 6 ▶ surfaces via useTtsPrefs + speak(), commit 83c75bb), TASK-21.2 (STT pronunciation grading — mic-stt bridge + Drill/Roleplay speak paths, commits 6f74e52/cd76d4f), TASK-21.3 (VAD — real Silero engine + 200ms activity ticks + 800ms auto-stop + vadTrim, root boot hook, Settings VAD row), TASK-21.4 (model lifecycle — UUIuC validate/remove, byte-counted download progress, tier-aware auto-download + streaming row), TASK-21.5 (streaming Zipformer — speech_stt_stream_* session commands, useSttStream controller, ListenType.Shadow live diff on /listen, commits 98b7a27/a3fc52b/75e990c/71c658c). AC2 evidence: grep of packages/speech/src shows zero fetch()/server references — all 18 invoked speech_* commands are registered in src-tauri lib.rs generate_handler (verified by exact list diff), speech runs 100% on-device. AC3 evidence: packages/speech/AGENTS.md, apps/desktop/src-tauri/AGENTS.md, apps/desktop/src/AGENTS.md, apps/desktop/AGENTS.md all updated with TTS/STT/VAD/models/streaming contracts + Child DOX Indexes present. Final verification at epic close: cargo test speech:: --lib 29 pass, desktop bun test 142 pass / 0 fail / 2 skip, check-types 0 errors, Ultracite clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Sherpa-ONNX offline speech epic delivered through 5 subtasks: Piper Kokoro TTS on every ▶ surface, SenseVoice STT pronunciation grading in Drill/Roleplay, Silero VAD turn-taking + silence trimming everywhere STT runs, full model lifecycle (validate/remove/progress/tier-aware auto-download incl. streaming), and streaming Zipformer shadowing with live kana diff. All speech on-device via Tauri invoke; DOX contracts recorded in 4 AGENTS.md files. Verified at close: 29 Rust + 142 TS tests passing, 0 type errors, Ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
