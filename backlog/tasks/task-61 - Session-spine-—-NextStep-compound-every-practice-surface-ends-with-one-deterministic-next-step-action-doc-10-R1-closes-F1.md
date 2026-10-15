---
id: TASK-61
title: >-
  Session spine — NextStep compound: every practice surface ends with one
  deterministic 'next step' action (doc-10 R1, closes F1)
status: To Do
assignee: []
created_date: '2026-09-10 07:17'
labels:
  - ui
  - frontend
  - ux
dependencies: []
priority: high
ordinal: 878000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-10 R1 (F1): surfaces are islands — drill set ends, review batch empties, mock scores, roleplay line-block completes, and every one of them dead-ends with no proposal for what to do next (P1's 3-second 'what do I tap now?' pause is the quit-risk moment). Build a small deterministic router + NextStep compound fed by EXISTING state (weak-pattern queue, FSRS due count, lesson position, reader stories) and mount it at the four completion states above. Depends on TASK-59 (AppShell on /) for the dashboard to also show it, but the four completion-state mounts are independent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 NextStep compound component exists (SCR-surface home: components/, Tier 2) rendering one primary action + one line of rationale
- [ ] #2 Deterministic router order: weak pattern due → that drill; else FSRS due cards → review; else lesson next step; else reader story; else momentum line (no card)
- [ ] #3 Wired into the completion states of: /learn/drill (set end), /review (batch empty state), /jlpt-mock (scored), /learn/roleplay (line-block end) — each currently dead-ends silently
- [ ] #4 No gamification: no confetti, no streak language, no urgency copy — the card is a corridor, not a reward
- [ ] #5 bun run test + check-types + ultracite clean; browser pass: complete a drill set and see the card route correctly into due review
<!-- AC:END -->
