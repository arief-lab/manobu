---
id: TASK-65
title: >-
  Practice memory — 'your growth' before/after view from revlog + roleplay
  history (doc-10 R8, closes F7; sequence LAST)
status: To Do
assignee: []
created_date: '2026-09-10 07:19'
labels:
  - ui
  - frontend
  - ux
dependencies: []
priority: low
ordinal: 875000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-10 R8 (F7, P4): roleplay/AI practice accumulates nothing visible — after 30 sessions the app shows 'saved 3/3'. Reflect growth back as identity: first-vs-latest per pattern, before/after list. The only doc-10 item needing new aggregation — sequence after TASK-59/60/61/62/63.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A 'your growth' surface (home: new route or dashboard section — implementer's choice documented in DOX) listing per-pattern first-attempt vs latest-attempt scores: 'politeness 1/3 → 3/3 in 12 sessions'
- [ ] #2 Aggregation reads EXISTING data only (revlog, roleplay logs, mock history) — no new tracking, no new schema
- [ ] #3 Empty state honest: 'Your growth story starts after a few sessions' + one CTA into practice
- [ ] #4 bun run test + check-types + ultracite clean; browser pass with seeded history showing before/after rows
<!-- AC:END -->
