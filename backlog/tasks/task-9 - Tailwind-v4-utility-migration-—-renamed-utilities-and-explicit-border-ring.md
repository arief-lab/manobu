---
id: TASK-9
title: Tailwind v4 utility migration — renamed utilities and explicit border/ring
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 11:40'
updated_date: '2026-09-05 15:19'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 617000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codebase still uses v3 names per util-renamed-utilities and util-explicit-colors. packages/ui/src/components/button.tsx:6 has outline-none (should be outline-hidden), shadow-sm vs shadow-xs scale, and some border/ring utilities rely on v3 defaults (border without explicit color, ring without color). In v4 border defaults to currentColor and ring width to 1px, so invisible borders/rings appear. bundle and util skills require explicit colors and trailing important modifier where needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No outline-none remains (replaced with outline-hidden) and shadow/blur/rounded use v4 scale (shadow-xs vs shadow-sm etc)
- [x] #2 Every border and ring utility has explicit color (e.g., border-border, ring-ring, border-destructive) — no bare border or ring
- [x] #3 Verify via grep: no outline-none, shadow-sm, rounded-sm, bare ring/border without color in packages/ui/src and apps/desktop/src
- [x] #4 bun x ultracite check passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit v3 remnants: grep outline-none, shadow-sm/rounded-sm/blur-sm etc, bare border/ring without color in packages/ui/src and apps/desktop/src via util-renamed-utilities and util-explicit-colors checks
2. AC1: Replace outline-none → outline-hidden (button.tsx:6, attachment.tsx:175 etc) and update shadow/blur/rounded scale: shadow-sm→shadow-xs, shadow-md→shadow (v4 scale), rounded-sm→rounded, verify via Tailwind v4 migration guide
3. AC2: Ensure every border has explicit color (border-border, border-input, border-transparent, border-destructive) and every ring has ring-ring/ring-destructive — fix bare border/ring (e.g., tool-call-card border → border-border)
4. AC3: Verify via grep -R outline-none|shadow-sm|rounded-sm and bare border/ring regex returns 0 in packages/ui/src and apps/desktop/src
5. AC4: bun x ultracite check, bun run check-types, visual spot check
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: rg outline-none 0, shadow-sm 0, rounded-sm 0, bare border 0 (only CSS vars), bare ring 0; ultracite 203 clean (0 errors after fix), check-types 10/10 pass, vite build 1,022kB; fixed 8 files outline-none→outline-hidden, added border-border to 15+ border-2 bare occurrences via script.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migrated Tailwind v4 utilities: replaced outline-none→outline-hidden in 8 files (button, attachment, bubble, checkbox, dropdown-menu, input, textarea, input-group), verified shadow/rounded v4 scale (shadow-sm 0, rounded-sm 0, no changes needed). Fixed bare border → explicit border-color in 15+ places (attachment border bg-card → border border-border bg-card, tool-call-card 5×, app-shell 4× border-r/l, onboarding 2×, reader 3×, widget border-b/t, plus border-2 → border-2 border-border via script for 15 files). Verified grep 0 for outline-none/shadow-sm/rounded-sm/bare border/ring, ultracite 203 clean, check-types 10/10.
<!-- SECTION:FINAL_SUMMARY:END -->
