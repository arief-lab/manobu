---
id: TASK-71.1
title: >-
  Router cleanup: fold manual lazy files into autoCodeSplitting, kanji detail to
  path param
status: Done
assignee: []
created_date: '2026-09-15 05:51'
updated_date: '2026-09-15 06:46'
labels: []
dependencies: []
parent_task_id: TASK-71
priority: medium
ordinal: 521000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to the router audit (TASK-77/78): vite.config.ts sets tanstackRouter autoCodeSplitting:true, yet two routes keep hand-written .lazy.tsx wrappers (jlpt-mock, kanji/detail) — the docs treat manual lazy files and auto code splitting as alternatives; mixing them leaves two mental models for which routes are lazy. Also kanji/detail.tsx is a child of the /kanji layout but declares its own full-page header, duplicating chrome; the docs' canonical shape for a resource page is a path param (/kanji/$character), which also lets the layout own the back-link header once. Discovered during the 2026-09-15 router best-practices review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No .lazy.tsx files remain under src/routes; jlpt-mock and kanji detail components still lazy-load (dist/assets shows split chunks; routeTree.gen.ts has no manual .lazy() entries)
- [x] #2 /kanji/detail becomes /kanji/$character (path param); ?level= stays search; old /kanji/detail deep links redirect via a detail.tsx beforeLoad stub (the repo learn/* redirect pattern); token-text.tsx + kanji/index.tsx links updated
- [x] #3 per-page headers stay as-is (grid back link goes to /desk, detail back link goes to the level grid: different targets, not duplicated chrome)
- [x] #4 route-loaders.test.ts LAZY_WRAPPERS guard + kanji.test.ts copy guard updated; desktop tests + check-types + vite build pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified: route-loaders.test.ts lazyFiles() walk finds 0 .lazy.tsx; dist/assets shows jlpt-mock-*.js + _character-*.js split chunks; routeTree.gen.ts has 0 .lazy() entries. Browser (headless, vite dev): /kanji/detail?character=食&level=N4 redirects to /kanji/食?level=N4 and renders 食; grid cell link -> /kanji/悪?level=N4; back link -> /kanji?level=N4; /jlpt-mock renders. Desktop suite 369 pass/0 fail; tsc clean; vite build clean; ultracite clean; fallow dead-code+health 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Folded both manual .lazy.tsx wrappers into their static route files (autoCodeSplitting owns chunking now; the guard test inverts to banning manual lazy files) and moved the kanji detail page from /kanji/detail?character=X to the docs-canonical /kanji/$character path param, keeping a beforeLoad redirect stub for old deep links and ?level= as search for the back-link. Verified via headless browser walkthrough, 369-test desktop suite, build chunk inspection, and fallow/ultracite gates.
<!-- SECTION:FINAL_SUMMARY:END -->
