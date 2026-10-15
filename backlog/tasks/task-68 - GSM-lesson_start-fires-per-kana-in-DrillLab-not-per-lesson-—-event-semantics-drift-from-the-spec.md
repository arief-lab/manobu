---
id: TASK-68
title: >-
  GSM lesson_start fires per kana in DrillLab, not per lesson — event semantics
  drift from the spec
status: Done
assignee: []
created_date: '2026-09-10 09:56'
updated_date: '2026-09-10 11:27'
labels:
  - bug
  - frontend
  - telemetry
dependencies: []
priority: low
ordinal: 531000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spotted during the TASK-60 browser pass. DrillLabRoot has useEffect(() => log("lesson_start", { char: current.char }), [current.char]) — fires on EVERY kana advance, so a 46-char drill set writes 46 lesson_start events into the GSM buffer (packages/ui/src/lib/gsm.ts). The spec (§Measurement: lesson_start / lesson_complete) treats them as lesson-scoped; the buffer is local-only (no network, GDPR-clean) so impact is measurement fidelity only — the 7-day/lesson-completion metrics would over-count sessions if ever aggregated. Fix: log once on mount (empty deps or session id), keep the char prop off or move it to a per-char event name if that data is actually wanted. Found while wiring the victory overlay (TASK-60) — the effect sits directly above it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 drill-lab.tsx logs lesson_start once per drill session (mount), not on every current.char change — spec §Measurement defines lesson_start/lesson_complete as lesson-scoped events
- [x] #2 walkthrough/gsm consumers (Settings → Data export, test-plan copy-matrix gates) unaffected — verify by reading the export path
- [x] #3 bun run test + check-types + ultracite clean (apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed locally): AC1 — drill-lab.tsx lesson_start effect now keys on [initial.chars.length] (fires once per set-mount; re-fires only when a genuinely new set loads, e.g. kind switch to ), props { set: chars.length } instead of { char }. AC2 — consumers audited: gsm computeMetrics() divides lesson_complete by lesson_start COUNT (denominator now lesson-scoped — the bug's impact); Settings→Data export is a console.info stub (pre-existing, untouched); no consumer reads lesson_start props shape (grep). New source-guard test test/gsm-events.test.ts (tts-surfaces pattern): asserts the per-char effect is gone + the mount-scoped one exists + the denominator contract in gsm.ts. AC3 — turbo 9/9 (286 files linted), tsc clean. Browser: 10 grades advance cleanly (Set 1/46, Progress 20/46 · 20% mastery — counters intact, no regression). NOTE for follow-up: roleplay.tsx:447 logs lesson_start per SAVE (up to 3 per session) — same denominator inflation, smaller scale; out of this task's AC scope, worth a future pass. Per user instruction: local commit only, no push.

Implementation notes (committed locally): AC1 — drill-lab.tsx lesson_start effect now keys on [initial.chars.length] (once per set-mount; re-fires only when a new set loads, e.g. kind switch to all), props { set: chars.length } instead of { char }. AC2 — consumers audited: gsm computeMetrics() divides lesson_complete by lesson_start COUNT (denominator now lesson-scoped — the bug impact); Settings→Data export is a console.info stub (pre-existing, untouched); no consumer reads lesson_start props shape (grep). New source-guard test test/gsm-events.test.ts (tts-surfaces pattern): per-char effect gone + mount-scoped effect exists + denominator contract in gsm.ts. AC3 — turbo 9/9, ultracite 286 files, tsc clean. Browser: 10 grades advance cleanly (Set 1/46, Progress 20/46 20% mastery — counters intact). FOLLOW-UP NOTE: roleplay.tsx:447 logs lesson_start per SAVE (up to 3 per session) — same denominator inflation, smaller scale; out of this task's AC scope, future pass. Per user instruction: local commit only, no push.
<!-- SECTION:NOTES:END -->
