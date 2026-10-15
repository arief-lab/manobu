---
id: TASK-23.22
title: Doc6 YOLO — per-agent permission dialog with sidebar badge (low)
status: To Do
assignee: []
created_date: '2026-09-06 06:09'
labels:
  - acp
  - doc6
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 885000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-6 §1.1 Multi-Agent YOLO / Full-Auto: AionUi supported agents expose unattended mode one-click bypass per-tool permission (AllowOnce/AllowThread/AllowAlways/Deny) with per-agent sidebar badge; AionUi docs/4.10 Team Mode shows each agent own permission confirmation dialog. Manobu today uses global Tauri allow (capabilities/default.json) not per-agent granular. Want after Team Mode: per-agent dialog gated by Tier A Map<convId,Resource> pool.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add per-agent permission dialog granularity for Team teammates; sidebar badge per pending approval; file sharing Leader pass attachment
- [ ] #2 YOLO toggle respected per agent backend (aionrs vs opencode etc.) not global tauri allow
- [ ] #3 Verification: Team run shows per-agent permission prompts, not single global allow
<!-- AC:END -->
