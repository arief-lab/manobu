---
id: TASK-23.12
title: EJU Finale — 12000 vocab + 6 full mocks + hardening (doc-3 Finale)
status: To Do
assignee: []
created_date: '2026-09-06 06:04'
updated_date: '2026-09-06 06:05'
labels:
  - eju
  - doc3
dependencies:
  - TASK-23.10
  - TASK-23.11
parent_task_id: TASK-23
priority: medium
type: feature
ordinal: 895000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close loop: own data/vocab/eju-12000.json frequency-ranked from JMdict 10-year + syllabus terms (authored not OCR coach-pub), audio Piper Kokoro + weekly goals, ≥6 full mock sessions ~200Q gz ~40KB covering every 1–3 subjects/session combo exclusive, Teacher prefers search_eju_questions + search_examples cited, hardening LICENSE SPDX + _meta.json outdated warning, sidecar opt-level z ~5MB. See doc-3 §6 Finale + §7 Risks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 data/vocab/eju-12000.json frequency-ranked JMdict 10y + syllabus terms + audio weekly 週単位 goals FSRS batchNext(20) offlineFirst
- [ ] #2 ≥6 full mock sessions ~200Q gz ~40KB covering every 1–3 subjects/session Science vs Japan and the World exclusion; Score raw+scaled avg benchmark table
- [ ] #3 Teacher AI cites JASSO topic + Tatoeba #id; MCP full set lookup_eju_question, search_eju_questions, random_eju_question, grade_eju_writing checklist; ACP_MCP_SERVERS eju:stdio:<bin>
- [ ] #4 Hardening: LICENSE SOURCE_PDF_sha SPDX per file citation-only vs CC BY-SA derived, _meta outdated warning, Audio not JASSO CD, opt-level z lto strip ~5MB, cargo test + parity + check-types green; doc-1 §5.2.5 ordering doc-2 P0→EJU respected
<!-- AC:END -->
