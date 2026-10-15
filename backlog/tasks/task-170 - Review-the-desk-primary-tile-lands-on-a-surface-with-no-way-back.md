---
id: TASK-170
title: 'Review: the desk primary tile lands on a surface with no way back'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-29 06:41'
updated_date: '2026-09-29 07:10'
labels:
  - desktop
  - review
  - ux
dependencies: []
references:
  - >-
    backlog/docs/qa/doc-25 -
    QA-pass-2026-09-29-desktop-surfaces-exam-flow-discoverability.md
priority: medium
type: bug
ordinal: 935000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA pass doc-25 (finding D4). The dashboard Due tile links to /review, a learner-facing surface, but /review is absent from CHROME_FREE_PATHS (apps/desktop/src/shared/chrome-free.ts), so it renders the shared Header whose only element is a bare "AI Chat" link (apps/desktop/src/shared/header.tsx:11). That link sits where a page title belongs, reads as the page name, and navigates away to /ai rather than back to the desk. A learner has no labelled return to the dashboard except browser back or the floating sensei widget. Every other practice surface (lesson, drill, reader, roleplay, conjugate, kanji, settings) carries a "← desk" pill.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /review carries a "← desk" return like every other practice surface.
- [x] #2 The "AI Chat" link no longer reads as a page title on /review.
- [x] #3 The shared Header keeps working for any remaining non-desk consumer, or is retired if /review was its last learner-facing user (verify consumers first).
- [x] #4 A browser pass confirms a learner can reach /review from the desk and return to it.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Make /review chrome-free so the shared Header (bare 'AI Chat' link) no longer renders; add a '← desk' pill (Link to /dashboard, data-testid review-bar-desk) mirroring drill.tsx:378-388. ReviewQueue.Header already provides the page <h1>, so no second title. Header kept for /jlpt-mock + dev (AC#3). Pin: chrome-free.test.ts /review===true; browser pass for pill + round trip (AC#1/#4).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified in-browser (vite preview :3010 + playwright-core): desk tile href=/review, click lands /review?batch=20, review-bar-desk pill present ('← desk'), AI Chat header link count=0, page <h1> from ReviewQueue.Header, pill click returns /dashboard. Screenshots /tmp/qa/170-*.png. Gates: desktop 543 pass/0 fail, check-types 14/14, ultracite clean, check:dox complete, fallow boundary 0, mutation seam review-desk-chrome-free caught. Header kept (still serves /jlpt-mock + dev).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
/review now carries its own '← desk' return like every practice surface. Added /review to CHROME_FREE_PATHS so the shared Header (bare 'AI Chat' link that read as a title) no longer renders there; review.tsx gained a Link pill (data-testid review-bar-desk) to /dashboard above the existing ReviewQueue.Header <h1>. Header.tsx kept for /jlpt-mock + dev (AC#3). Pinned by chrome-free.test.ts (/review===true) + mutation seam review-desk-chrome-free; browser pass confirmed the round trip.
<!-- SECTION:FINAL_SUMMARY:END -->
