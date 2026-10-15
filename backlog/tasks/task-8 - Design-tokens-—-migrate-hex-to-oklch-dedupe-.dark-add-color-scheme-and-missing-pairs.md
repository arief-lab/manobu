---
id: TASK-8
title: >-
  Design tokens — migrate hex to oklch, dedupe .dark, add color-scheme and
  missing pairs
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 11:40'
updated_date: '2026-09-05 15:11'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 616000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
globals.css at packages/ui/src/styles/globals.css:15 uses hex #fafafc/#4338ca/#b42318 while Tailwind v4 skill gen-oklch-colors requires oklch for wider gamut and perceptual uniformity. File has duplicate .dark blocks (62-89 hex and 91-123 oklch) where second overwrites first, and second dark lacks --success/--warning/--error plus their foregrounds (first dark has them). No color-scheme declaration for native dark mode per theme-color-scheme. @theme inline bridges exist but duplicate tokens cause bloat (gen-avoid-theme-bloat). Wireframes.html also hardcodes #fafafc etc but that is docs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All design tokens in :root and .dark are oklch() (no hex) with foreground pair for every background token
- [x] #2 Single .dark block (no duplicate) defining all tokens including --success/--warning/--error and their -foreground
- [x] #3 Add color-scheme: light dark to :root and .dark for native dark mode
- [x] #4 Verify @theme inline maps every semantic token and bun x ultracite check passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit globals.css: :root hex #fafafc etc, .dark duplicate (hex block 62-89 and oklch 91-123), missing success/warning/error in second dark, no color-scheme, @theme inline mapping check
2. AC1: Convert all :root tokens from hex to oklch() using Tailwind v4 gen-oklch-colors (preserve perceptual values: bg #fafafc→oklch(0.985 0.005 106), accent #4338ca→oklch(0.48 0.22 270), error #b42318→oklch(0.55 0.19 25) etc); ensure every background has foreground pair (add --success-foreground etc if missing)
3. AC2: Dedupe .dark to single block merging both: keep oklch values from second block plus add --success/--warning/--error and --success-foreground etc from first block (hex→oklch); remove duplicate .dark 62-89
4. AC3: Add color-scheme: light to :root and color-scheme: dark to .dark and color-scheme: light dark to @theme inline or html selector per skill theme-color-scheme; verify native dark mode
5. AC4: Verify @theme inline maps every semantic token (check --color-success etc present, add missing --color-error-foreground etc), run bun x ultracite check, bun run check-types, visual spot check
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: bun x ultracite check 218 files clean (0 errors after fix), bun run check-types 10/10 pass ( Vite build 2.47s, index 1,022kB), grep hex 0 in :root/.dark (only comment #b42318), single .dark block verified (grep .dark 1 CSS block + custom-variant), color-scheme light/dark present, @theme inline now maps --color-success/--color-success-foreground/--color-warning/--color-warning-foreground/--color-error/--color-error-foreground.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migrated design tokens to oklch: :root hex #fafafc/#4338ca/#b42318 etc → oklch() (light palette oklch 0.985/0.21 etc, accent 0.55 0.22 263, destructive 0.577 0.245 27), added missing foreground pairs --success-foreground/--warning-foreground/--error-foreground. Deduped .dark to single block (removed hex 62-89, kept oklch 0.145 etc, merged success/warning/error + foregrounds). Added color-scheme: light to :root and color-scheme: dark to .dark. Expanded @theme inline to map --color-success/--color-success-foreground/--color-warning/--color-warning-foreground/--color-error/--color-error-foreground. Verified ultracite 218 clean, check-types 10/10, no hex in tokens.
<!-- SECTION:FINAL_SUMMARY:END -->
