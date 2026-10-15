---
id: TASK-59
title: >-
  First page fix 1 — mount AppShell on / (dashboard landing gets sidebar nav +
  AI pane; closes doc-11 D1)
status: Done
assignee: []
created_date: '2026-09-10 07:16'
updated_date: '2026-09-10 07:42'
labels:
  - ui
  - frontend
  - ux
dependencies: []
priority: high
ordinal: 534000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D1: the landing page cannot navigate to the app. / renders only the global Header (links: Home + AI Chat) — the AppShell sidebar (TASK-35 grouped nav) is scoped to /learn/* per TASK-29, so a first-session user cannot reach Lesson/Drill/Review/Kanji/Roleplay by clicking from the page they land on. 'The island you land on has no boats.' Fix: mount the AppShell on / (same layout wrapper learn.tsx uses), keeping onboarding/settings chrome-free. This is the prerequisite for doc-10 R1 (session spine) and the landing zone for R5/R6. Supersedes nothing else in doc-10; pairs with the Fix 2+3 content pass task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 / renders the AppShell (sidebar groups + AI pane) — landing page can navigate to Lesson/Drill/Listen/Reader/Conjugate/Roleplay/Review/Kanji by clicking
- [x] #2 /onboarding and /settings remain chrome-free (TASK-29 contract preserved and documented in apps/desktop AGENTS + components AGENTS)
- [x] #3 No duplicate chrome: the global Header nav is reconciled with the sidebar (either removed on / or kept consistent — decision recorded)
- [x] #4 bun run test + check-types + ultracite clean; browser pass screenshot of / with sidebar + AI pane
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 60963e9): AC1 — index.tsx wraps HomeComponent in AppShell; browser-verified: / renders sidebar (8 nav links: Lesson/Reader/Listen/Roleplay/Drill/Conjugate/Review queue/Kanji) + AI pane; clicking Lesson navigates to /learn/lesson (screenshot). AC2 — /settings + /onboarding verified chrome-free (no app-shell node), / has shell (TASK-29 contract preserved). AC3 — decision recorded: global Header's 'Home' link removed (sidebar logo owns Home); 'AI Chat' link stays for chrome-free routes; comment in header.tsx documents the reconciliation. AC4 — turbo 9/9, ultracite 284 files clean, tsc clean. DOX: apps/desktop AGENTS TASK-29 scope note + components AGENTS app-shell/header entries.
<!-- SECTION:NOTES:END -->
