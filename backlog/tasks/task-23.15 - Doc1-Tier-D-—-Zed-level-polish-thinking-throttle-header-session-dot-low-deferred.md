---
id: TASK-23.15
title: >-
  Doc1 Tier D — Zed-level polish: thinking throttle + header session dot (low,
  deferred)
status: To Do
assignee: []
created_date: '2026-09-06 06:07'
labels:
  - polish
  - doc1
  - doc6
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 886000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doc-1 §5.2.4 Tier D and doc-6 §2 D notes: AionUi useAcpMessage.ts:120-189 thought throttling 50ms + MeasureTextOverrun guard, plus session state machine connecting→connected→authenticated→session_active→disconnected header dot (Zed + AionUi both surface it, manobu only has isPending). Keep standard cron (5-field * * * * * + IANA tz) invariants. This polish prevents React thrash on long Sensei marker-graph streams and gives busy visibility before Team Mode. Defer until Team parallel lands. See doc-1 §5.2.4 and doc-6 §2 P2 F.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Port thinking throttle 50ms + MeasureTextOverrun from useAcpMessage.ts:120-189 if Sensei streams long marker-graph explanations; no React render saturation
- [ ] #2 Surface acpStatus session state machine as subtle header dot (connecting/connected/authenticated/session_active/disconnected) alongside existing /ai model picker
- [ ] #3 Verification: long stream benchmark no thrash; dot reflects session_active vs disconnected correctly
<!-- AC:END -->
