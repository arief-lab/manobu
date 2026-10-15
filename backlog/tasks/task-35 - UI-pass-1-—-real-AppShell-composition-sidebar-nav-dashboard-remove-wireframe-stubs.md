---
id: TASK-35
title: >-
  UI pass 1 — real AppShell composition: sidebar nav + dashboard, remove
  wireframe stubs
status: Done
assignee: []
created_date: '2026-09-09 11:05'
updated_date: '2026-09-10 03:41'
labels:
  - ui
  - frontend
dependencies: []
priority: high
ordinal: 556000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA doc-9 QA-7 + UI verdict: AppShell (components/app-shell.tsx) is a layout testbed committed as production — literal 'Card A/B/C', debug sidebar numbers, 'AI Pane (width >=1200)' text. Design system (packages/ui tokens) is done; composition layer is missing. Reference: doc-9.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sidebar shows real navigation (route links grouped: Learn / Practice / Review + level selector) — no debug numbers (app-shell.tsx:31-34 removed)
- [x] #2 Dashboard route (index.tsx) shows real content: streak, due-count, next-card CTA, recent activity — Card A/B/C placeholders gone
- [x] #3 AI Pane placeholder text replaced with either the live chat rail (reuse conversation components) or removed with layout reclaimed
- [x] #4 TanStack Router devtools gated behind import.meta.env.DEV && explicit ?devtools=1 (not always-on in dev preview)
- [x] #5 bun run test passes; bunx ultracite check clean; every route re-screenshotted in a browser pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 0dc2ede): AC1 sidebar grouped nav (Learn/Practice/Review) over real routes + useLocation active state + icon-only collapse + level-selector (lib/learner-level.ts localStorage store, settings.ts pattern). AC2 dashboard already real (SCR-01 compound) — Card A/B/C removed from app-shell. AC3 AI pane = live chat rail (ask-sensei/rail.tsx lazy-loaded, own ChatSessionProvider); launcher hidden on /learn, kept elsewhere. Provider contract documented: MessageTranscript needs external MessageScroller.Provider. AC4 router + query devtools both gated behind DEV && ?devtools=1. AC5 browser pass: shell/rail/selector verified on /learn + /learn/drill (screenshots), dashboard real content confirmed, non-learn routes chrome-free, devtools flag round-trip, level round-trip N5→N2→N5. Suites 9/9, ultracite 282 files clean, tsc clean.
<!-- SECTION:NOTES:END -->
