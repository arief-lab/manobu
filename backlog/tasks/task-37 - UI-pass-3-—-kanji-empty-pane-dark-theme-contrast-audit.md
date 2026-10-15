---
id: TASK-37
title: UI pass 3 — /kanji empty pane + dark-theme contrast audit
status: Done
assignee: []
created_date: '2026-09-09 11:06'
updated_date: '2026-09-10 05:12'
labels:
  - ui
  - frontend
  - polish
dependencies: []
priority: medium
ordinal: 555000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA doc-9 QA-6 + UI verdict point 3/4: /kanji blank pane (layout wrapper without index) and dark-on-dark low-contrast muted text. Reference: doc-9.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /kanji parent route renders a kanji index (grid by level, reuse kanji-detail data hooks) or redirects to /kanji/detail — never a blank main pane
- [x] #2 Contrast audit: text-muted-foreground on muted backgrounds >= 4.5:1 in BOTH themes (flagged samples from browser screenshots); fix token values in packages/ui/src/styles/globals.css not per-component overrides
- [x] #3 Light theme verified as first-class (default screenshot pass shows both themes)
- [x] #4 bun run test + ultracite clean; before/after screenshots in task notes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed ed5b8ce): AC1 — routes/kanji/index.tsx: JLPT level tabs + auto-fill grid (character/gloss/strokes) → /kanji/detail?character=X; server /api/kanji gained a level list mode (jlpt_waller filter, 79 N5 → 1232 N1); browser-verified 79 N5 cells, N1 tab 1232 cells, cell click → detail route. AC2 — oklch WCAG audit of every fg×bg pairing: only real failure was LIGHT muted-fg/muted 4.39:1; fixed at token level (globals.css light muted-foreground 0.552 → 0.54 L → 4.61:1 on muted, 4.86:1 on bg); dark already ≥5.8:1. AC3 — light theme verified first-class (both-theme screenshots of the grid in transcript). AC4 — turbo 9/9, server 28/0 (kanji smoke updated to two-mode contract), ultracite 284 clean, tsc clean. Before/after: before = blank pane (route was bare Outlet); after = both-theme grid screenshots.
<!-- SECTION:NOTES:END -->
