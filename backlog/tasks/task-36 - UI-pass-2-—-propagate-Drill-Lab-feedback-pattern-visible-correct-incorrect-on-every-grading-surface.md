---
id: TASK-36
title: >-
  UI pass 2 — propagate Drill-Lab feedback pattern: visible correct/incorrect on
  every grading surface
status: Done
assignee: []
created_date: '2026-09-09 11:05'
updated_date: '2026-09-10 04:39'
labels:
  - ui
  - frontend
  - ux
dependencies: []
priority: high
ordinal: 557000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA doc-9 QA-5/QA-4 + UI verdict 'feedback sparsity is the biggest UX sin': silent success in a learning app is a product defect. Drill Lab already has the right pattern (correct-answer flash) — extract and propagate it. Reference: doc-9.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Conjugate lab: correct answer shows immediate ✓ + green state (match drill-lab.tsx flash pattern); wrong shows ✗ + correct answer reveal
- [x] #2 Listen & Type: grade result banner (✓/✗ + match %) after Next; match 0% when input === target is impossible
- [x] #3 JLPT mock: per-question answer highlight (selected vs correct) before advancing; submit failure shows the actual error text (pairs with TASK doc-9 QA-3)
- [x] #4 Review/Roleplay surfaces audited for the same silent-grading defect and fixed
- [x] #5 No regression: bun run test passes; drill-lab existing tests untouched
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 8828684): AC1 — Conjugate input green/red border via answerClass + tell panel reveals pattern; REAL BUG found: Conjugate.Next called recordAttempt("correct") unconditionally (click-through banked FSRS credit) — now grades current input via verifyDetailed, wrong → tell + no advance. AC2 — listen-reveal shows target + Levenshtein match % (new similarityPercent in lib/deinflect.ts, two-row buffer). AC3 — mock choiceClass highlights correct row green / wrong pick red on answer; submitError threaded through both catch paths, shown in fail banner (mock-submit-error testid). AC4 audit — Review: added ReviewQueue.LastGraded confirm (✓ Good · たべる) wired into review.tsx; Roleplay: exempt (live rp-live scores, not discrete grading). AC5 — drill-lab untouched, suites 9/9, ultracite 283 files clean, tsc clean. Browser-verified all four surfaces (screenshots in transcript).
<!-- SECTION:NOTES:END -->
