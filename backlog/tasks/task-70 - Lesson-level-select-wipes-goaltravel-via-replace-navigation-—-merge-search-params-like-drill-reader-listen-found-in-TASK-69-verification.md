---
id: TASK-70
title: >-
  Lesson level select wipes ?goal=travel via replace-navigation — merge search
  params like drill/reader/listen (found in TASK-69 verification)
status: Done
assignee: []
created_date: '2026-09-10 10:54'
updated_date: '2026-09-10 11:04'
labels:
  - bug
  - frontend
  - ux
dependencies: []
priority: medium
ordinal: 528000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-69 verification (2026-09-10), live-repro: opened /learn/lesson?level=N5&goal=jlpt, selected N1 in the level <select> → URL became ?level=N1&goal=travel and the practice chips switched to TRAVEL phrases (こんにちは/ありがとうございます) instead of N1 corpus. Root cause: lesson.lazy.tsx:16 navigate({ search: { level } }) REPLACES the search object; goal falls back to its .default('travel'). The goal drives content selection in nextCardsForGoal (travel → phrases.json, jlpt/anime → level corpus), so touching the level control silently changes the learner's goal — user-visible wrong content, same defect family as the level hardcode TASK-69 just fixed (this one was masked by it: before TASK-69 the chips ignored level entirely, so the goal clobber was less visible). Repo-wide audit of navigate({ search: ... }) replace-vs-merge: drill/reader/listen already merge (prev); settings/review/jlpt-mock/kanji replace but are single-param routes (nothing to clobber); lesson is the only multi-param offender. One-line fix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 lesson.lazy.tsx onChangeLevel uses navigate({ search: (prev) => ({ ...prev, level }) }) — the merge pattern already used by drill.tsx/reader.tsx/listen.tsx
- [x] #2 Browser-verified: open /learn/lesson?level=N5&goal=jlpt, change level to N1 → URL keeps goal=jlpt and practice chips show N1 corpus entries (嗚呼-class), not travel phrases
- [x] #3 bun run test + check-types + ultracite clean (apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed locally): AC1 — lesson.lazy.tsx onChangeLevel now navigate({ search: (prev) => ({ ...prev, level: e.target.value as typeof prev.level }) }) — the drill/reader/listen merge pattern (typed prev annotation dropped: the router's SearchSchema literal types don't widen to string, inference from useNavigate is exact). AC2 — browser-verified: /learn/lesson?level=N5&goal=jlpt → select N1 → URL ?level=N1&goal=jlpt (goal KEPT), practice chips show 嗚呼/相 (N1 corpus entries, not travel phrases); screenshot captured. AC3 — turbo 9/9, tsc clean, ultracite clean. DOX: apps/desktop AGENTS lesson row notes the merge contract. Per user instruction: local commit only, no push.
<!-- SECTION:NOTES:END -->
