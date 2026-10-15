---
id: TASK-63
title: >-
  JLPT readiness framing — dashboard exam-units card for JLPT-goal users (doc-10
  R7, closes F2 for P3)
status: To Do
assignee: []
created_date: '2026-09-10 07:18'
labels:
  - ui
  - frontend
  - ux
dependencies: []
priority: medium
ordinal: 876000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-10 R7 (F2 for P3): the app measures everything and reports it in steps-done and due-counts — David's unit is exam readiness. Re-aggregate existing mock scores + weak patterns into one readiness card. Content-only change on the dashboard; depends on TASK-59/60 for placement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 JLPT-goal returning users see one dashboard card in exam units: 'N3 mock: 58% → 64% (last 2 mocks) · weak: て-form, ~ば' — pure re-aggregation of existing mock + review data, no new data collection
- [ ] #2 Non-JLPT goals (Travel/Anime/Work) see the momentum line instead (TASK-60) — one framing per goal, no card zoo
- [ ] #3 bun run test + check-types + ultracite clean; browser pass with a JLPT goal showing the card with real mock history
<!-- AC:END -->
