---
id: TASK-171
title: 'Listen and Settings: the no-audio fallback is styled as an error'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 06:41'
updated_date: '2026-09-29 07:32'
labels:
  - desktop
  - listen
  - settings
  - ux
dependencies: []
references:
  - >-
    backlog/docs/qa/doc-25 -
    QA-pass-2026-09-29-desktop-surfaces-exam-flow-discoverability.md
priority: low
type: task
ordinal: 936000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA pass doc-25 (finding D7). When no TTS voice is available (outside Tauri, or a machine without the configured voice), /listen renders a red prohibition glyph "No speaker detected" and /settings renders a red "No audio output". The behaviour is a correct graceful fallback shipped by TASK-1.8, but the destructive red treatment signals breakage to a learner who is actually fine to continue with pitch diagrams plus type. Refs: apps/desktop/src/features/listen-type/listen-type.tsx, the Sensei voice section in settings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The expected no-voice state renders with a neutral/info treatment, not the destructive red.
- [x] #2 The copy still states the fallback (pitch plus type still work).
- [x] #3 Genuine failure states keep the destructive treatment; only the expected unavailable-voice case changes.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: the CSS was already neutral (text-muted-foreground); the red was the 🔇 emoji, which the system emoji font renders as a red prohibition circle. Fix = drop the glyph from the two in-scope strings (copy voice.no_output, listen audioMessage). Genuine errors untouched: listen input shake keeps border-destructive, settings previewError keeps text-destructive. Verified in-browser (vite preview :3010 + playwright): /listen and /settings no-voice lines render plain muted gray, no 🔇; typing un-transliterable 'xqz' still shows data-tone=error with a red border (oklch 43.6 hue). Screenshots /tmp/qa/171-*.png. Gates: desktop 545 pass, ui 172 pass, types 14/14, ultracite clean, dox complete, boundary 0, new seam voice-no-output-neutral-glyph caught (65 anchors).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The expected no-voice state no longer reads as breakage. Removed the red 🔇 prohibition glyph from the copy voice.no_output and the listen audioMessage (both already render in muted text; the emoji was the only red). The graceful-fallback wording (pitch + type) is unchanged. Genuine failure states keep the destructive treatment (listen romaji shake border-destructive, settings preview error text-destructive). Pinned by copy-snapshot.test.ts + new listen-fallback.test.ts (calls the audioMessage seam) and mutation seam voice-no-output-neutral-glyph; browser pass confirmed both surfaces and the preserved error red.
<!-- SECTION:FINAL_SUMMARY:END -->
