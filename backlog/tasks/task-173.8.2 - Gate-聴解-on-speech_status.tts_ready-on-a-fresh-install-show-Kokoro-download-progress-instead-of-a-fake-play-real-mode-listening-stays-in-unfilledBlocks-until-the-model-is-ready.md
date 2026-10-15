---
id: TASK-173.8.2
title: >-
  Gate 聴解 on TTS readiness: fresh install shows the Supertonic download offer up
  front, never a fake play
status: Done
assignee:
  - '@Buffy'
created_date: '2026-10-11 17:35'
updated_date: '2026-10-13 11:42'
labels: []
dependencies:
  - TASK-173.8.1
parent_task_id: TASK-173.8
priority: low
type: feature
ordinal: 985000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-154 replaced Kokoro with Supertonic 3 and shipped the consent-first in-exam offer; silent background auto-download was declined by the owner 2026-10-13. Remaining: ExamSpeechControl currently renders a live-looking ListenButton that only becomes the offer after a click fails (~1.1s dead round-trip). Gate it on isTtsBootstrapped()/ensureTts so a fresh install lands on the offer immediately, and print the listening script in the review row so the "The script is in the review" promise is true.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 A listening item on a machine with no voice shows the download offer without any click: the control never renders a fake play that only reports after a failed speak attempt
- [x] #2 #2 A machine with the voice installed renders the ready control with no offer flash
- [x] #3 #3 Outside Tauri the item reports Audio unavailable, not an offer that cannot work
- [x] #4 #4 After submit, the review row prints the listening script, making the unavailable line promise true
- [x] #5 #5 The desktop suite pins all three render states and a mutation-gate seam catches the proactive gate being reverted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified by test + one manual seam run: exam-voice-first-run.test.ts pins initialVoiceState mapping (Tauri+unproven=checking renders empty AC#1; bootstrapped=control, no offer flash AC#2; non-Tauri=control reactive, speak failure lands on the unavailable line AC#3, pinned also by the TASK-154 source tests). AC#4: reviewScriptLine called in exam-workspace.test.ts + JSX wiring source check. AC#5: mutation seam exam-voice-gate-always-control run manually (anchor -> 'if (true)') -> 2 tests FAIL, restored, baseline green; bun scripts/mutation-gate.ts --check: all 208 anchors resolve. Desktop suite 581 tests 0 fail, ultracite clean, check:dox clean. Commit e72e467.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ExamSpeechControl's readiness gate is now PROACTIVE: inside Tauri an unproven engine mounts as 'checking' (renders nothing) and resolves via ensureTts on mount into control-or-offer, so a fresh install lands on the Supertonic download offer with no dead click round-trip (AC#1); a ready voice renders the control with no offer flash (AC#2); outside Tauri the TASK-141 reactive path is unchanged and reports Audio unavailable (AC#3). The review row prints each listening item's script via reviewScriptLine, keeping the unavailable line's promise (AC#4). Pinned by exam-voice-first-run.test.ts gate renders, exam-workspace.test.ts helper calls, and mutation seam exam-voice-gate-always-control (manually proven: mutation -> 2 fails, restore -> green). Verified: desktop suite 581/0 fail, ultracite check clean, check:dox clean, mutation-gate --check 208 anchors resolve. Commit e72e467.
<!-- SECTION:FINAL_SUMMARY:END -->
