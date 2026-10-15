---
id: TASK-74.4
title: Decide policy on 食べれる-class potential distractors
status: To Do
assignee: []
created_date: '2026-09-14 05:28'
labels:
  - desktop
  - conjugate
dependencies: []
parent_task_id: TASK-74
priority: low
ordinal: 872000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
wrongRuleVariant() offers 食べれる as the ichidan potential distractor (the textbook ru-kotsu error), but ra-kanken speakers treat 食べれる as standard potential, so a fluent learner can legitimately object that the wrong answer is not wrong. At N5 with a textbook audience it is defensible as-is; the task is to make it a decision rather than an accident. Options: keep (document it), mark the choice as accepted-on-request (grade it correct when picked), or swap the distractor for an unambiguous error (e.g. 食べらる, dropping the る) for ichidan potentials.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A written decision exists in the conjugate DOX row: keep, demote, or gate the ichidan-potential distractor
- [ ] #2 If gated or removed, choiceOptions still returns 4 unique options for every ichidan verb in the deck
- [ ] #3 Choice-engine contract tests reflect the chosen policy
<!-- AC:END -->
