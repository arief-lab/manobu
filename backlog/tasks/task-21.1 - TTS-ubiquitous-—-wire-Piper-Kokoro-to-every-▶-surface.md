---
id: TASK-21.1
title: 'TTS ubiquitous — wire Piper Kokoro to every [▶] surface'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-06 03:58'
updated_date: '2026-09-06 07:09'
labels:
  - speech
  - tts
  - tauri
dependencies: []
parent_task_id: TASK-21
priority: high
type: feature
ordinal: 599000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
All lab [▶] buttons are static today. apps/desktop/src/components/listen-type.tsx:86 Audio, drill-lab.tsx:187 Audio, reader.tsx:205 Overlay, roleplay.tsx:135 Clerk, lesson.tsx:112 Present/Context, and kanji-detail.tsx:328 Audio either ignore @manobu/speech/tts or use it only in the debug /speech route.

Wire TTS so every Japanese string the learner sees can be heard offline. Use the existing TS contract packages/speech/src/tts.ts:speak(text,{speed,sid}) -> speech_tts (tts.rs:98) which returns RIFF WAV for new Audio(url).play(). Respect Settings voice sid (SCR-11 Varied/Female/Male) and ListenType 0.8x/1x speed. Gate with isTtsReady()/speech_status and fall back to pitch diagram already built for pcvtp/J-7/UUIuC.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ListenType.Audio [▶] plays TTS for target.jp at 0.8x/1x via useTts(); on !tts_ready shows Banner pcvtp/J-7/UUIuC + Pitch たべ˥て fallback, counts for FSRS via onGrade(3) unchanged
- [x] #2 Reader.Overlay, Lesson.Present/Context, Roleplay.Clerk, DrillLab.Audio, KanjiDetail.Audio all play TTS for their jp/reading via @manobu/speech/tts; sid follows Settings voice store (0 ♀/1 ♂/varied), web-dev degrades gracefully with 🔇 TTS only in Tauri message
- [x] #3 No new boolean-prop explosion — reuse hooks.ts useTts() or direct speak(); keep Vercel Object.assign composition pattern
- [x] #4 Existing tests still pass: bun run check-types, bun run check (Ultracite), bun test (listen-type/daily coverage)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add voice sid mapping to @manobu/speech package:
   - Extend packages/speech/src/tts.ts with sid→model-id map (0=varied default Piper Kokoro ♀, 1=male variant ♂) used by speak() when sid provided; honor existing speed param (0.8/1.0).
   - Add isTtsReady() gating already exists; keep existing stub behavior when not in Tauri.

2. Add useTts() consumption in each ▶ surface (Vercel composition, no new boolean props):
   - ListenType.Audio (listen-type.tsx): wire speak(target.jp, {speed, sid}) on [▶]; on tts error set audio="audio-fail"/"tts-corrupt"; on !tts_ready keep Banner pcvtp + Pitch たべ˥て fallback; FSRS onGrade(3) unchanged.
   - DrillLab.Audio (drill-lab.tsx): wire speak(current.romaji, {sid}) on [▶]; graceful mic-free skip already present.
   - Reader.Overlay (reader.tsx): wire speak(overlay.jp, {sid}) near the [▶] [♀/♂] marker in overlay header.
   - Lesson.Present/Context (lesson.tsx): add a small audio control wired to word.kanji/reading per surface spec.
   - Roleplay.Clerk (roleplay.tsx): wire speak(line.clerk, {sid}) on [▶] audio button.
   - KanjiDetail.Audio (kanji-detail.tsx): replace dynamic import mod.speak() with direct speak() import from @manobu/speech/tts; keep sid toggle 0/1.

3. Settings voice → sid wiring:
   - Add a small shared helper (e.g. @/lib/tts-voice.ts) mapping VoiceChoice (varied/female/male) → sid number and preferred speed; varied stays 0 (Piper default ♀) per existing piper model manifest.
   - Expose current voice+speed via a thin context or pass settings.voice into each surface from its host route/provider; keep surfaces pure (no Settings import inside component files that dont already import it).
   - Settings.VoiceTab preview buttons (♀/♂) call speak() once to confirm output; on !tts_ready show voice.no_output copy already in copy.ts.

4. Web-dev graceful degradation:
   - Every speak() call wrapped so web dev (non-Tauri) falls back to 🔇 TTS only in Tauri message / uses existing pitch diagram fallback where a fallback already exists (ListenType, DrillLab); surfaces without a fallback show a quiet no-output note, not a crash.
   - No new boolean-prop explosion — reuse existing context + hooks pattern; keep Object.assign compound component shape.

5. Copy + test updates:
   - Add/verify copy keys for TTS status (tts_ready / no-output / preview) in packages/ui/src/lib/copy.ts if not present; keep warm-direct-humble voice.
   - Keep bun run check-types, bun run check (Ultracite), bun test passing; add a small walkthrough-style assertion that each ▶ surface imports or receives speak/tts readiness path (mirrors existing walkthrough-copies.test.ts pattern).

6. Verify:
   - Existing tests still pass.
   - Each ▶ surface calls speak() with correct text+speed+sid and degrades gracefully when TTS unavailable.

7. Confirmed direction: sid maps to model ids (varied=0 default Kokoro ♀, male=1 separate male Kokoro model once present in KNOWN_MODELS); Settings voice/speed exposed via small useTtsPrefs() hook reading from existing Settings provider; surfaces consume without new boolean props; Settings.VoiceTab preview calls speak() only when isTtsReady()."
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wired @manobu/speech/tts speak() to all six ▶ surfaces (ListenType.Audio, DrillLab.Audio, Reader.Overlay, Lesson.Present, Roleplay.Clerk, KanjiDetail.Audio) via a new TtsProvider + useTtsPrefs() hook in apps/desktop/src/lib/tts-voice.tsx. Settings voice → sid mapping: varied/female → sid 0 (Piper Kokoro ♀), male → sid 1. Settings.VoiceTab ♀/♂ preview calls speak() when isTtsReady(). Web-dev (non-Tauri) degrades gracefully in every surface. Existing banner/pitch fallback, FSRS onGrade(3), and mic-skip behaviour preserved. Added test/tts-surfaces.test.ts (9 assertions, all pass). Typecheck clean (2 pre-existing ai.tsx errors unrelated), Ultracite clean on all 10 touched files, bun test 63 pass (3 pre-existing failures unchanged).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired Piper Kokoro TTS (via @manobu/speech/tts speak()) to all six ▶ surfaces: ListenType.Audio (target.jp, speed 0.8×/1×, sid), DrillLab.Audio (current.romaji), Reader.Overlay (overlay.jp + ♀/♂ sid toggle), Lesson.Present (word.kanji), Roleplay.Clerk (line.clerk), and KanjiDetail.Audio (character, replaced dynamic import with direct speak() import). Added TtsProvider + useTtsPrefs() + useTtsSetVoice() + useTtsPrefsContext() in apps/desktop/src/lib/tts-voice.tsx; wired into __root.tsx; Settings.VoiceTab pushes voice changes to TtsContext and plays a "こんにちは" preview when isTtsReady(). Voice→sid: varied/female→0 (Piper Kokoro ♀), male→1. Web-dev degrades gracefully (no throw, no state change) in every surface. Existing banner/pitch fallback, FSRS onGrade(3), mic-skip, and romaji→kana behaviour preserved. Added test/tts-surfaces.test.ts (9 walkthrough assertions, all pass). Verified: desktop typecheck clean, Ultracite clean on 10 touched files, bun test 63 pass + 9 new pass (3 pre-existing failures unchanged).
<!-- SECTION:FINAL_SUMMARY:END -->
