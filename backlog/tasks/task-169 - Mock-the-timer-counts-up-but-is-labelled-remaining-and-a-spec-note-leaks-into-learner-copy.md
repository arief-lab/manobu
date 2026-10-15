---
id: TASK-169
title: >-
  Mock: the timer counts up but is labelled "remaining", and a spec note leaks
  into learner copy
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 06:41'
updated_date: '2026-09-29 06:55'
labels:
  - desktop
  - mock
  - ux
dependencies: []
references:
  - >-
    backlog/docs/qa/doc-25 -
    QA-pass-2026-09-29-desktop-surfaces-exam-flow-discoverability.md
priority: low
type: bug
ordinal: 934000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA pass doc-25 (findings D1, D3). /jlpt-mock is internal-only per TASK-158 but stays maintained, so its copy still ships. Two defects: (a) the timer feeds elapsedSeconds (apps/desktop/src/features/mock/jlpt-mock.tsx:118) into a string that reads "remaining" (packages/ui/src/lib/copy.ts:294), so a learner sees "00:02 remaining" ticking UP, which reads as a countdown about to expire; (b) a design annotation "40% opacity until choice" is rendered as user-visible helper text (packages/ui/src/lib/copy.ts:276). Neither is caught by the R-02 copy guard, which only checks em dashes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The mock timer label matches what it measures: either it shows elapsed time under an elapsed label, or it counts down from a real per-question budget and the "remaining" wording is accurate.
- [x] #2 No user-visible string on /jlpt-mock contains an implementation note; the helper reads as guidance to the learner.
- [x] #3 A test pins the timer label to the value fed into it, by calling the component, not by reading source text (TASK-134).
- [x] #4 Changed strings pass packages/ui/test/copy-snapshot.test.ts with no em dash (R-02).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. packages/ui/src/lib/copy.ts:294 mock.timer "⏱ {mm}:{ss} remaining" -> "⏱ {mm}:{ss} elapsed" (the value fed is elapsedSeconds, jlpt-mock.tsx:118/834/842-847; no per-question budget exists, so relabel, do not invent a countdown on an internal-only surface per TASK-158).
2. packages/ui/src/lib/copy.ts:276 mock.helper drop the leaked spec note: "Choose an answer to continue · 40% opacity until choice" -> "Choose an answer to continue".
3. apps/desktop/src/features/mock/jlpt-mock.tsx header comments (:6, :7, :17) updated to match the new strings so the contract stays honest.
4. Test (component call, not source-text): render <JlptMock><JlptMock.Timer/></JlptMock> via renderToStaticMarkup (pattern: apps/desktop/test/kana-checkpoint-result.test.tsx) and assert it shows formatTimer(0) under an "elapsed" label and never "remaining"; plus a copy-deck assertion pinning t("mock.timer", {mm,ss}) to the elapsed template.
5. Add a mutation seam so the label cannot silently revert to "remaining" (this is the lying-label class the gate exists for).
6. Gates: bun test (apps/desktop + packages/ui incl copy-snapshot), check-types, ultracite check, mutation-gate --check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED. copy.ts:294 mock.timer -> "⏱ {mm}:{ss} elapsed" (relabel, not a countdown: elapsedSeconds at jlpt-mock.tsx:834/842-847 has no per-question budget, and TASK-158 keeps this surface internal-only). copy.ts:276 mock.helper -> "Choose an answer to continue" (dropped the "· 40% opacity until choice" spec note). jlpt-mock.tsx:17 header comment aligned. New apps/desktop/test/mock-timer.test.tsx renders <JlptMock><JlptMock.Timer/></JlptMock> via renderToStaticMarkup and pins the value+label (AC#3, not a source-text read). New mutation seam mock-timer-label-elapsed rewrites the label back to "remaining" and is CAUGHT. Gates: apps/desktop bun test 542 pass/3 skip/0 fail; packages/ui 172 pass; copy-snapshot 15 pass (R-02, AC#4); check-types 14/14; ultracite clean; mutation-gate --check 63 anchors resolve; check:dox complete.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the two /jlpt-mock copy defects from doc-25 (D1, D3). The mock clock counts up, so the timer label now reads "elapsed" instead of the misleading "remaining"; the learner helper dropped the leaked "40% opacity until choice" design note. Verified by a component-render test (mock-timer.test.tsx) plus a new mutation seam that fails if the label reverts, on top of the existing R-02 copy guard. No wire or behavior change; surface stays internal-only per TASK-158.
<!-- SECTION:FINAL_SUMMARY:END -->
