---
id: TASK-72.1
title: Seed choice shuffle for reproducible option order
status: To Do
assignee: []
created_date: '2026-09-14 03:46'
labels:
  - desktop
  - conjugate
dependencies: []
parent_task_id: TASK-72
priority: low
ordinal: 506000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
choiceOptions() in apps/desktop/src/lib/conjugate.ts shuffles with Math.random, so a verb+form renders in a different option order on every reload. Harmless today (UI memoizes per [verb, form]; tests pass deterministic: true), but it blocks any future analytics keyed on pick position and makes bug reports ("I kept seeing the answer top-left") unreproducible. Seed the shuffle from a stable hash of reading+form instead.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Same verb+form yields the same option order across reloads and sessions
- [ ] #2 Order still varies across verbs/forms (answer not positionally predictable deck-wide)
- [ ] #3 A contract test pins determinism: two choiceOptions calls for one verb+form return identical arrays
<!-- AC:END -->
