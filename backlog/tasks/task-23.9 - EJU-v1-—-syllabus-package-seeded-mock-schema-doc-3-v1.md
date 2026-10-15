---
id: TASK-23.9
title: EJU v1 — syllabus package + seeded mock + schema (doc-3 v1)
status: To Do
assignee: []
created_date: '2026-09-06 06:04'
updated_date: '2026-09-06 06:05'
labels:
  - eju
  - doc3
dependencies:
  - TASK-23.1
parent_task_id: TASK-23
priority: high
type: feature
ordinal: 892000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Proves data package contract and ships one runnable mock clone (jlpt-mock) without 500 authored Qs. packages/eju data/syllabus/*.json derived from 2026 PDFs (topic trees source JASSO 2026_syllabus_* 2026_syllabus 2026 1st) with _meta.json revision 2025/02/13, schema eju_questions + eju_questions_fts vaporetto + revlog WAL, MCP 3 tools lookup_eju_syllabus/search_eju_syllabus/list_eju_by_subject (or crates/eju-mcp eju:stdio:<bin>), route eju-mock.tsx validateSearch{subject, sciencePick2 length2, mathCourse C1|C2} Zod.refine exclusive. See backlog/docs/research/doc-3 §6 v1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packages/eju data/syllabus/*.json 2026-accurate per topic + _meta.json revision 2025/02/13; AGENTS.md, package.json exports ./data/*, src/types.ts EjuSubject/Course, scripts/fetch-syllabus.ts pin; LICENSE.md provenance
- [ ] #2 DB eju_syllabus view + eju_questions + eju_questions_fts CREATE VIRTUAL TABLE tokenize='vaporetto tags 名詞…' + revlog→cards WAL; test fts5-perf <100ms
- [ ] #3 MCP lookup_eju_syllabus/search_eju_syllabus/list_eju_by_subject (or crates/eju-mcp sidecar) + manager route eju-mock.tsx + .lazy.tsx Timer pausable, Choices fieldset, Next opacity-40, Score weak→Plan scaffold, SubmitFail Retry
- [ ] #4 Verification: syllabus JSON source per topic; ≥10 JP + ≥10 Science + ≥10 Math C1 seeded; cargo test + check-types green; Science vs Japan and the World mutual exclusion enforced
<!-- AC:END -->
