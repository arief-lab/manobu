---
id: TASK-23.10
title: EJU v2 — Mathematics + Science pick-2 (doc-3 v2 STEM track)
status: To Do
assignee: []
created_date: '2026-09-06 06:04'
updated_date: '2026-09-06 06:05'
labels:
  - eju
  - doc3
dependencies:
  - TASK-23.9
parent_task_id: TASK-23
priority: high
type: feature
ordinal: 893000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Unblocks STEM faculties. Math C1 Math I/A + C2 I/A/II/B/III/C with vectors, complex plane, sequences, logs/trig, calculus, probability distributions (2026 Expected value Math A + Prob distributions 13. for C2). Science pick-2 Physics/Thermo/Waves/E&M/Atoms full 2026, Chemistry Ksp/Enthalpy, Biology Ecosystems IX2(3). TopicPath for weakPattern. See doc-3 §6 v2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Mathematics C1 + C2 corpora ≥80 items (40 C1 + 40 C2 incl 20 C2-only Prob distributions + Expected value on both), Eju.Math fill-in numeric input @tanstack/react-form z.coerce.number, C1↔C2 toggle filters incompliants
- [ ] #2 Science pick-2 ≥60 items spanning each 2026 block incl new Ksp Chem II2(3) + Enthalpy II3(1) + Ecosystems Bio IX2(3); each with topicPath weak extraction; JP/EN toggle respected
- [ ] #3 FTS5 溶解度積/等差数列 HITs via vaporetto_and_query + bm25; depends on P0 sqlite-vaporetto
- [ ] #4 Verification: validateSearch choose exactly 2 of Physics/Chemistry/Biology rejects pick-1 not graded
<!-- AC:END -->
