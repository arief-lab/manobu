---
id: TASK-78
title: >-
  Router audit follow-through: delete onboarding, promote /listen, retire /learn
  layout + AppShell, kanji loader-warm
status: Done
assignee: []
created_date: '2026-09-14 19:30'
updated_date: '2026-09-14 19:32'
labels:
  - frontend
  - desktop
dependencies: []
priority: medium
ordinal: 522000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SCR-02 onboarding + its copy keys deleted; walkthrough gate repinned to setup.tsx
- [x] #2 /listen is a chrome-free desk (own ← bar + chart toggle); learn/listen flipped to stub; ?chart=1 deep links work as string OR number
- [x] #3 /learn layout, AppShell, rail, LevelSelector, use-layout-breakpoint deleted; widget hide narrowed to the conversation route
- [x] #4 kanji/index loader-warm with deliberate .catch keeping the in-page error state
- [x] #5 route-loaders guard updated (+kanji/index); 391 tests, tsc + ultracite + build clean, fallow new-only 0 introduced
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All four shipped in fff01a6. Onboarding deleted (route+feature+copy keys; walkthrough gate repinned to setup.tsx goals). /listen chrome-free with own <- desk bar + header chart toggle; learn/listen flipped to stub forwarding ?chart; browse tile + CHROME_FREE_PATHS updated; /learn layout + AppShell + rail + LevelSelector + use-layout-breakpoint deleted (learn/* survivors are stubs + conversation, now flat-rooted); widget hide narrowed to /learn/conversation. kanji/index loader-warm with deliberate .catch preserving the in-page KanjiError; guard list +kanji/index. Bonus: ?chart=1 hand-typed deep links never matched (number vs string) on listen+drill — both validateSearch accept either shape now. Evidence: 391/391 tests, tsc + ultracite + vite build clean, fallow new-only 0 introduced, 22-route browser sweep green.
<!-- SECTION:FINAL_SUMMARY:END -->
