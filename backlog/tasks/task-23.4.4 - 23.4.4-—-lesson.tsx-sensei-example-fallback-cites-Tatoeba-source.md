---
id: TASK-23.4.4
title: 23.4.4 — lesson.tsx sensei example fallback cites Tatoeba source
status: Done
assignee:
  - '@buffy'
created_date: '2026-09-08 12:30'
updated_date: '2026-09-08 14:56'
labels:
  - datasets
  - doc2
  - frontend
dependencies: []
parent_task_id: TASK-23.4
ordinal: 568000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Subtask of TASK-23.4 (doc-2 §5.2 UI layer). lesson.tsx sensei fallback chain local→BYOK→cache grounds examples from the sentences corpus (random N5 pick when offline) and cites source Tatoeba #id instead of hallucinated Example: 私は…. Extend offline-fallback tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 assistant/sensei.md instructs Coach to prefer lookup_examples/search_examples/random_example and cite Tatoeba #id; never invent Example sentences
- [x] #2 lesson.tsx SenseiHint offline fallback grounds the example via pickGroundedExample (sentences-head.json N5 slice) citing Tatoeba #id
- [x] #3 offline-fallback.test.ts extended (3 new grounded-example tests); desktop suite 218+ tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Persona (assistant/sensei.md): added the 3 example tools to the tool list + protocol rules 8/9 (never invent examples; cite Tatoeba #id; random_example for drills). UI: apps/desktop/src/lib/grounded-examples.ts picks deterministically (FNV-1a, arithmetic-only to satisfy lint) from a new curated 20-sentence N5 head slice data/sentences/sentences-head.json (3.9 KB — avoids importing the 42 MB corpus into the UI bundle); SenseiHint offline badge renders 例: jp (en) — Tatoeba #id. Tests: 3 new in offline-fallback.test.ts; apps/desktop suite 218 tests pass (216 pass + 2 skip). check-types built clean; ultracite clean on touched files.
<!-- SECTION:NOTES:END -->
