---
id: TASK-64
title: >-
  Romaji confidence bridge — one-tap 'Try without romaji?' after 10 correct
  typed answers (doc-10 R4)
status: To Do
assignee: []
created_date: '2026-09-10 07:18'
labels:
  - ui
  - frontend
  - ux
dependencies: []
priority: low
ordinal: 877000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-10 R4: the romaji learn-flag exists in Settings but the transition moment is unhandled — Sakura (P2) never discovers it, so the beginner's typing fear persists. Surface the offer at the moment of demonstrated competence (10 correct answers). Small: one counter + one dismissible offer component in listen-type.tsx (drill-lab.tsx TypeFallback optional second site).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After 10 cumulative correct typed answers on Listen & Type (or Drill TypeFallback), a one-time dismissible offer appears: 'Try without romaji?' — accept toggles the romaji learn-flag in context; decline stores the dismissal (never re-asks)
- [ ] #2 Offer appears exactly once per learner (localStorage flag); ask-first respected — never force, never block typing
- [ ] #3 bun run test + check-types + ultracite clean
<!-- AC:END -->
