---
id: TASK-173.8
title: 'Exam (real mode): 聴解 audio items from spoken script to answer'
status: Done
assignee:
  - '@Buffy'
created_date: '2026-09-29 10:46'
updated_date: '2026-10-13 11:43'
labels: []
dependencies:
  - TASK-154
documentation:
  - doc-26
parent_task_id: TASK-173
priority: medium
type: feature
ordinal: 946000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real 聴解 plays audio once and asks a comprehension question; ours is silent text. A listening item currently uses `stimulus.japanese` as its `script` (`apps/server/src/services/exam-service.ts:480`) and an integrated listening script is hardcoded (`INTEGRATED_LISTENING_SCRIPT`, `:158`). Delivering the real listening blocks depends on a Japanese TTS voice, which is the open TASK-154 ("Ship a Japanese TTS voice so a new install can actually hear the listening section").
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 A listening item is delivered as playable audio generated from its script, not shown as on-page text
- [x] #2 #2 The script never reads off the page during the listening block: the item carries it only as the `speech` synthesis input (TASK-141's documented listening-only exception to TASK-132), the block prints no passage or stimulus for it, and after submit the review row prints it
- [x] #3 #3 The N5/N4 課題理解 and ポイント理解 blocks fill from real audio-backed items; with no voice installed the exam surface proactively offers the download instead of a fake play, and outside Tauri reports the voice unavailable
- [x] #4 #4 Builds on TASK-154 for the TTS voice
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reword AC#2/#3 to the shipped TASK-141/154 architecture (owner-approved 2026-10-13): the script crosses as synthesis input only; server-side unfilledBlocks gating is impossible (the sidecar has no TTS), the on-surface offer is the readiness mechanism. Background auto-download declined: consent-first offer stays.
2. Proactive readiness gate in ExamSpeechControl: initial state from isTtsBootstrapped(); a checking mount state resolves via ensureTts() to control / offer / failed, so a fresh install lands on the download offer without a dead click round-trip (TASK-173.8.2 core).
3. Review honesty: the unavailable line promises 'The script is in the review' - print the listening item's speech in the review row after submit.
4. Tests: extend apps/desktop/test/exam-voice-first-run.test.ts (offer without click when not bootstrapped, control when bootstrapped, unavailable outside Tauri) + review-script assertion; add a mutation-gate seam for the proactive gate.
5. Verify: desktop bun suite, ultracite, mutation-gate --check, check:dox; parent ACs proven from 173.8.1 server proofs, TASK-154 AppImage evidence, and the new renders.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1: 173.8.1 serves the four N4/N5 stores byte-equal into real papers with the scenario as the item's script, and the TASK-154 AppImage verification (fresh XDG install, download landed, Supertonic audio played) proved playable audio; the block itself prints no on-page text (listening items carry passage null and no stimuli). AC#2: script crosses only as ExamItem.speech (packages/api-contract/src/exam.ts:424), review print added by 173.8.2 (reviewScriptLine, exam-review-script testid). AC#3: proactive gate - fresh install lands on the download offer without a click (checking mount -> offer), non-Tauri reports Audio unavailable; desktop suite 581/0 fail, mutation seam exam-voice-gate-always-control proven. AC#4: the whole surface rides TASK-154's TTS_MODEL_ID/ensureTts bootstrap.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Real-mode 聴解 now works end to end at N5/N4: the four 聴解 stores fill real papers (173.8.1), each listening item carries its script only as the client-side Supertonic synthesis input and never as on-page text, a fresh install lands directly on the consent-first voice download offer (no fake play) via the proactive isTtsBootstrapped()/ensureTts gate (173.8.2), outside Tauri the control honestly reports Audio unavailable, and after submit the review row prints the script so the promise is true. Verified by exam-voice-first-run.test.ts + exam-workspace.test.ts (desktop suite 581 tests, 0 fail), mutation seam exam-voice-gate-always-control (mutation caught, baseline green), ultracite/check:dox/mutation-gate --check clean, commits 5f9ddcc..e72e467 on re-design.
<!-- SECTION:FINAL_SUMMARY:END -->
