---
id: TASK-23.18
title: >-
  Doc3 gaps — EJU language fidelity + scaled vs raw + syllabus currency warning
  (low)
status: To Do
assignee: []
created_date: '2026-09-06 06:07'
labels:
  - eju
  - doc3
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 889000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-3 §7 Risks notes not covered by v1-vFinale AC: do not auto-translate JA Japan and the World/Science to EN — store prompt_ja + prompt_en authored separately (JASSO EN phrasing differs by university); never present raw mock 235/400 as JASSO score without scaled note (score/index.html IRT vs discrete Writing 0–50); fetch-syllabus.ts must pin PDF revision date 2025/02/13 + _meta.json syllabus outdated warning for future high-school revisions. Size gz handling same as doc-2. See doc-3 §7.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Language option fidelity: prompt_ja + prompt_en stored separately; no auto-translate
- [ ] #2 Scaled vs raw disclosure: Score reports raw + scaled-approx via equating table if available else raw + avg 2025-2 table mimicking outline_of_results_e_2025-2.pdf both contexts
- [ ] #3 Syllabus currency: fetch-syllabus.ts pins PDF revision date + sha in data/syllabus/_meta.json; app warns syllabus outdated when pinned rev differs
- [ ] #4 Verification: no JASSO EN auto-translated; Score table shows raw and avg% context
<!-- AC:END -->
