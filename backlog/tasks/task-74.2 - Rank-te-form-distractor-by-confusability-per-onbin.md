---
id: TASK-74.2
title: Rank te-form distractor by confusability per onbin
status: To Do
assignee: []
created_date: '2026-09-14 05:28'
labels:
  - desktop
  - conjugate
dependencies: []
parent_task_id: TASK-74
priority: low
ordinal: 870000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
wrongTeEnding() in apps/desktop/src/lib/conjugate.ts returns the first te-ending in a fixed candidate list that differs from the verb's own, so 飲む (んで) gets 飲って (aって-verb confusion) rather than the closer 飲で (nasal/voicing slip). Every option is still a plausible learner error, so nothing is wrong, but the teaching value is highest when the distractor is the error learners of THAT onbin class actually make. Needs a per-row table (か-class: い vs っ ranked; む-class: ん/ぶ; て/で-class; ぐ-class; す-class; ぬ-class; ぶ-class; う-class) instead of first-different.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each godan onbin gets its documented most-confusable wrong te-ending
- [ ] #2 Choices stay unique and never equal the answer for all 111 deck verbs x 6 forms
- [ ] #3 Existing choice-engine contract tests still pass; a new table-driven test covers every onbin class
<!-- AC:END -->
