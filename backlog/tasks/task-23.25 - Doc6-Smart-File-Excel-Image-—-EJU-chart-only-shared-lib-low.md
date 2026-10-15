---
id: TASK-23.25
title: Doc6 Smart File/Excel/Image — EJU-chart-only shared lib (low)
status: To Do
assignee: []
created_date: '2026-09-06 06:10'
labels:
  - skills
  - doc6
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 883000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-6 §1.3 Smart File Mgmt Auto Organize batch rename + Excel Data Processing Smart Chart + AI Image Gen Gemini image gen mermaid. Manobu Excel Analysis → Smart Chart code lives in Excel Creator xlsx skill not in lesson/numbers pipeline. Smallest benefit per learner — language lab rarely outputs .xlsx; if EJU charts (doc-3 Japan and the World graph/choropleth) generate sheets, use xlsx as shared lib, not new server.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Share lib for Smart File/Excel/Image only for EJU chart path; not general file ops .wtf channel weight is FSRS desired_retention 0.90
- [ ] #2 Generates workbook sheets via xlsx shared lib when Team middleware needs charts
- [ ] #3 Verification: EJU chart mock generates sheet via shared lib without leaving Tauri pane
<!-- AC:END -->
