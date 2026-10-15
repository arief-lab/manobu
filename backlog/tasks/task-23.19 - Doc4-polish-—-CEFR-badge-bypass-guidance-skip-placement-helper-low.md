---
id: TASK-23.19
title: Doc4 polish — CEFR badge + bypass guidance + skip-placement helper (low)
status: To Do
assignee: []
created_date: '2026-09-06 06:07'
labels:
  - jlpt
  - doc4
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 890000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-4 §4 gaps + §6 How to answer should I bypass? Short answer (70%+ on lower mock JapaneseExplorer 70%, popular skip N5/N4→N3 first career-value, cost 2×/year 6-month, N5 ~49%→N3 ~36% pass) belongs in Placement helper + GoalSwitchDialog + jlpt-mock filter description — not as nudge coercion. Also CEFR mapping N5 80→A1 … N1 142→C1 from comprendreport_2025 §3 and fee ~$240 sequential vs skip saving. See doc-4 §§4-6.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CEFR badge rendering: N5 80→A1, N4 90→A2, N3 95-103→A2/104→B1, N2 90-111→B1/112→B2, N1 100-141→B2/142→C1 on pass
- [ ] #2 Bypass guidance copy short answer in Placement helper + GoalSwitchDialog footer + filter description: 70% rule, most useful skip, 6-month wait cost, keep lower material study even when skipping
- [ ] #3 Placement: surface Skip placement helper nihongoai-copy-deck place.note under progress {n}/8; placement keep heuristic 5→8 probe optional
- [ ] #4 Verification: not claim N1 holders never took N5 inside placement nudge (explainer card only); fee saving note only in explainer
<!-- AC:END -->
