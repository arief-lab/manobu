---
id: TASK-23.11
title: EJU v3 — Japanese + Japan and the World liberal-arts track (doc-3 v3)
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
ordinal: 894000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The other half: Academic Japanese + EJU-unique Japan and the World chart-reading. Japanese reuses Reader/ListenType, adds Writing rubric self-grade checklist 0/10…50 discrete + SenseiTip [This is wrong] aria-live polite (no LLM 0–50). Japan and the World MaterialPanel graph/choropleth/timeline + term overlay 重要用語リスト EN/ZH/KO. Review weak → next-cards. See doc-3 §6 v3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Japanese: reading ×20 explanatory/editorial/practical+chart, listening ×15 0.8×/1× + Pitch fallback, listening-reading ×10, writing prompts ×10; 400字 textarea + discrete 0/10/20/25/30/35/40/45/50 checklist + [This is wrong] flag; audio script via @manobu/speech
- [ ] #2 Japan and the World I/II/III chart/table items ×40 incl new Modern regions + Post-Cold War; MaterialPanel graph/choropleth/timeline + term overlay
- [ ] #3 Review: weak syllabus patterns → buildWeakPatternQueue → next-cards.ts/queue.ts feeding Lesson Review; weakPattern per 2026 restructured headings
- [ ] #4 Verification: materialSvg? + sourceSyllabus per item; [This is wrong] toggles without throw
<!-- AC:END -->
