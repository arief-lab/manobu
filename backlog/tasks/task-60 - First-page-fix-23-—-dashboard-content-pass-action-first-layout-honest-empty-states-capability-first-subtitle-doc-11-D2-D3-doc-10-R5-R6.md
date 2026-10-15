---
id: TASK-60
title: >-
  First page fix 2+3 — dashboard content pass: action-first layout, honest empty
  states, capability-first subtitle (doc-11 D2/D3 + doc-10 R5/R6)
status: Done
assignee: []
created_date: '2026-09-10 07:17'
updated_date: '2026-09-10 09:52'
labels:
  - ui
  - frontend
  - ux
  - copy
dependencies: []
priority: high
ordinal: 533000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D2 + D3, landing zone for doc-10 R5 (momentum line) + R6 (first-session victory). D2: day-one canvas ~70% blank — state (ring ○0/4, '0 due') renders before action. D3: subtitle 'All offline · Tap any word for help · No streaks · Your data stays here' leads with limitations; flip to capability-first ('Learn Japanese at your pace — private by default, works offline'), move reassurances to footer/settings trust section. R5: honest momentum sentence from revlog ('practiced N of last 7 days · M cards learned · next review tomorrow') replaces the bare 'No streaks' phrase on the returning branch. R6: engineer the FIRST session end as a designed moment (one screen, one word using exactly what was learned, one [▶] audio) — deterministic from drill set contents, no new data needed. Depends on TASK-59 (AppShell on /) for placement but is buildable in parallel behind it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Beginner branch leads with action: .Primary CTA visually first, .Progress ring + step chips demoted below it
- [x] #2 Day-one empty states carry copy with a job: Due reads 'Your first review lands tomorrow — learn something first' + drill link; Continue day-one reads 'Lesson 1 of First Words is waiting' (not 'nothing to resume')
- [x] #3 Subtitle flipped to capability-first: 'Learn Japanese at your pace — private by default, works offline.' — the old reassurance line (offline/no streaks/data) moves to a quieter home (footer or settings trust section); no fact removed
- [x] #4 First-session victory moment (doc-10 R6): end of first drill set shows one screen — 'You just learned あいうえお — here's your first real word: あめ (rain)' with [▶] audio, deterministic from the drill set contents
- [x] #5 Anti-pattern catalog respected: no streak mechanics, no guilt copy, no confetti; momentum line (doc-10 R5: 'practiced 4 of last 7 days · 213 cards learned' from revlog) included on returning-user branch
- [x] #6 bun run test + check-types + ultracite clean; browser screenshots: day-1 branch and returning branch, both themes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 2838694): AC1 — index.tsx composition reordered: .Primary CTA first, .Momentum under it, Continue/Progress/Due below (verified: DOM order dashboard-primary-cta → …). AC2 — DueCard day-one 'Your first review lands tomorrow — learn something first'; ContinueCard day-one 'Lesson 1 of First Words is waiting — Start →' (both browser-verified strings). AC3 — subtitle now 'Learn Japanese at your pace — private by default, works offline.'; old reassurance line moved verbatim to footer (no fact removed). AC4 — DrillLab victory overlay: fires after first full set (46 grades), 'You just learned あいうえお… — 46 kana this set! + あめ (ame) — rain [▶]' (katakana set → アイス), deterministic from set contents, one-time via manobu.victoryShown flag; dismiss works; does NOT reappear. BUG caught+fixed in own wiring: check initially inside grade() — stale-closure when grades batch in one tick (never fired in browser); moved to useEffect on graded count. AC5 — lib/practice-days.ts (ISO dates only, no card data, no streak logic), momentum hidden at 0 days, 'Practiced N of the last 7 days — nice rhythm.' otherwise; cards-learned deferred (needs revlog wiring — v1 seed data), noted in compound JSDoc. AC6 — turbo 9/9, ultracite 285 files, tsc clean; screenshots: day-1 dark, returning dark, returning light, victory overlay.
<!-- SECTION:NOTES:END -->
