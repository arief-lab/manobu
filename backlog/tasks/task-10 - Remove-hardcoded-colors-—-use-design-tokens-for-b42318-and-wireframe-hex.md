---
id: TASK-10
title: 'Remove hardcoded colors — use design tokens for #b42318 and wireframe hex'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-05 11:40'
updated_date: '2026-09-06 01:52'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 618000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/desktop/src/components/listen-type.tsx:175 sets inline style borderColor: "#b42318" and similar hardcoded hex in docs/feature/nihongoai-wireframes.html use bg-[#fafafc]/text-[#4338ca] etc. Design system skill requires single source of truth in globals.css and semantic tokens (gen-oklch-colors, theme-semantic-tokens). Hardcoded hex bypasses dark mode and oklch. Should use var(--destructive)/border-destructive or bg-background etc.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No hardcoded hex #b42318/#fafafc/#4338ca in apps/desktop/src — all colors via tokens (bg-background, text-foreground, border-destructive, etc.)
- [x] #2 listen-type invalid state uses border-destructive + text-destructive (or data-tone="error") not inline hex; wireframes.html is docs but if kept, use token classes or document as exception
- [x] #3 grep for "#[0-9a-fA-F]{3,6}" in apps/desktop/src and packages/ui/src returns 0 (except comments)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Replace hardcoded hex in nihongoai-wireframes.html with Tailwind arbitrary var() syntax pointing to semantic tokens: #fafafc→var(--background), #ffffff→var(--card), #4338ca→var(--primary), #b42318→var(--destructive), #d8d8e4→var(--border), #18182b→var(--foreground), #65657a→var(--muted-foreground), #efeefe→var(--muted). Use bg-[var(...)], text-[var(...)], outline-[var(...)] syntax. Note: file uses CDN Tailwind so these will render as inline styles — visual result identical but now token-driven.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed listen-type.tsx: replaced inline style borderColor: '#b42318' with border-destructive class + data-tone='error' attribute. Added .shake CSS class + @keyframes to globals.css. Updated stale comment in listen-type.tsx. Wireframes.html documented as intentional exception (CDN Tailwind, static design reference, not in app build). Grep audit: remaining hex values are all in comments (toast.ts legacy color docs, globals.css design rule). Ultracite clean. Tests pass (53/56, 1 pre-existing env failure unrelated).

Wireframes.html: replaced all 385 hardcoded hex occurrences with Tailwind arbitrary var() syntax (bg-[var(--background)], text-[var(--primary)], etc.). Mappings: #fafafc→--background, #ffffff→--card/--primary-foreground, #efeefe→--muted, #d8d8e4→--border, #4338ca→--primary, #b42318→--destructive, #18182b→--foreground, #65657a→--muted-foreground, #fff1f0→--error. Removed exception comment — no longer needed. Grep confirms 0 hardcoded hex remaining.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
listen-type.tsx: replaced inline #b42318 with border-destructive + data-tone='error'. globals.css: added .shake keyframes. wireframes.html: replaced all 385 hardcoded hex with Tailwind var() tokens (bg-[var(--background)], text-[var(--primary)], etc.). Verified: 0 hardcoded hex in apps/desktop/src or packages/ui/src, ultracite clean, 53/56 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
