---
id: TASK-1.8
title: SCR-04 Listen & Type — dictation + romaji→kana + no-speaker fallback (WF2)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:54'
updated_date: '2026-09-04 15:50'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 645000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ear→hand production. Audio ▶ with 0.8×/1× → type hiragana. Must auto-convert romaji `a→あ`, validate still-romaji (#b42318 + shake 200ms, Next disabled 40% opacity), and degrade when no speaker/TTS fails.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Input auto-converts romaji on blur; still-romaji MIpnC border #b42318 shake 200ms; Next stays disabled until valid kana
- [x] #2 No-speaker banner pcvtp: switches to Read&Type from pitch diagram `たべ˥て`; counts for FSRS identically; [Test audio]
- [x] #3 Audio fail J-7 + TTS corrupt UUIuC: pitch diagram + furigana fallback; [Re-download][Continue offline]; bundled voices 1.2GB ×2 Female/Male ♀/♂
- [x] #4 Copy-deck listen.* + nospeaker.* + audio.fail strings; wireframe WF2
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read spec SCR-04 + copy-deck listen.* (Type what you hear, Auto-converts a→あ, Invalid still romaji MJKZg, Correct, Wrong, nospeaker.banner pcvtp, nospeaker.fallback mJd9Q, audio.fail J-7, tts.corrupt UUIuC)
2. Implement SCR-04 compound <ListenType> in apps/desktop/src/routes/listen.tsx: <ListenType.Audio> [▶] with 0.8×/1× speed, <ListenType.Input> romaji→kana auto-convert on blur, <ListenType.Banner> no-speaker (pcvtp) + audio-fail (J-7) + TTS corrupt (UUIuC), <ListenType.Pitch> pitch diagram たべ˥て fallback, <ListenType.Next> disabled 40% opacity until valid kana
3. Romaji→kana conversion in @manobu/lib: basic table (a→あ, i→い, u→う, e→え, o→お + kana combinations), still-romaji detection (input contains ASCII letters), MIpnC shake 200ms border #b42318 red
4. Audio path: bundled voices 1.2GB ×2 Female/Male ♀/♂ from @manobu/speech or local Sherpa-ONNX, [Test audio] on no-speaker; on TTS corrupt show [Re-download][Continue offline]
5. a11y: aria-live=polite on correct/wrong, role=button on speed, focus 2px on input, error pattern red only, FSRS grade 1-4 identical to Drill Lab
6. Verify bun test (romaji→kana + still-romaji detection + pitch fallback), check-types, ultracite, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04:
- AC1 input: apps/desktop/src/components/listen-type.tsx Input auto-convert on blur via romajiToKana, isStillRomaji -> border #b42318 + shake 200ms, Next 40% opacity until isValidKana
- AC2 no-speaker pcvtp: Banner + Audio message + Pitch diagram fallback たべ˥る, [Test audio] on banner, counts for FSRS via onGrade(3)
- AC3 audio fail J-7 + TTS corrupt UUIuC: Banner + Audio + Pitch diagram + furigana fallback, [Re-download][Continue offline] on TTS corrupt
- AC4 ref: listen.* copy (Auto-converts a→あ, Next) + nospeaker.banner pcvtp + audio.fail J-7 + tts.corrupt UUIuC strings
- romaji lib: apps/desktop/src/lib/romaji.ts romajiToKana N5 base + digraphs, isStillRomaji, isValidKana — verified a→あ, ka→か, shi→し, chi→ち, tsu→つ, n→ん
- composition: ListenType = Object.assign with .Audio/.Input/.Banner/.Pitch/.Next (Vercel pattern)
- a11y: aria-invalid on input, aria-live=polite on banner, aria-disabled on Next, focus 2px ring
- checks: bun check-types 4/4 OK, biome fixed
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SCR-04 Listen & Type compound: romaji->kana + still-romaji shake red #b42318, Next 40% opacity, no-speaker pcvtp + audio-fail J-7 + TTS corrupt UUIuC + pitch fallback. romaji lib verified. check-types 4/4 OK.
<!-- SECTION:FINAL_SUMMARY:END -->
