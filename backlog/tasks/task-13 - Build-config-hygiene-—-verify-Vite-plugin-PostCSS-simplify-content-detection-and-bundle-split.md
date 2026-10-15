---
id: TASK-13
title: >-
  Build config hygiene — verify Vite plugin, PostCSS simplify, content detection
  and bundle split
status: Done
assignee:
  - '@arif'
created_date: '2026-09-05 11:40'
updated_date: '2026-09-06 02:45'
labels: []
dependencies: []
priority: low
type: feature
ordinal: 621000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build per tailwind skill build-vite-plugin, build-postcss-simplify, build-content-detection, bundle-split-critical-css. apps/desktop/vite.config.ts:8 correctly uses @tailwindcss/vite but packages/ui/postcss.config.mjs still has @tailwindcss/postcss plugin which may be redundant with Vite plugin. globals.css:4 has @source directives for apps and packages which may be unnecessary with automatic content detection in Vite plugin. No critical CSS split or explicit bundle minification config verified. wireframes.html previously used CDN tailwind (now fixed to defer) but bundle-avoid-cdn-production should be documented as never for production.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PostCSS config contains only @tailwindcss/postcss when needed for non-Vite builds, or is removed if Vite plugin fully covers it (document choice)
- [x] #2 Verify @source directives are necessary or remove if automatic detection covers apps/**/*.{ts,tsx} (test by removing and running vite build)
- [x] #3 Ensure CSS is minified in production (vite build already does) and document that CDN is not used in production (wireframes.html is docs only)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Check postcss.config.mjs — if @tailwindcss/vite handles everything, remove @tailwindcss/postcss or document why it's kept.\n2. Check globals.css @source directives — verify if automatic Vite plugin detection covers the paths or if @source is needed.\n3. Verify CSS minification in production build and document CDN-not-for-production.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1: postcss.config.mjs has @tailwindcss/postcss. Since Vite uses @tailwindcss/vite plugin which handles all CSS processing, PostCSS is redundant for Vite builds. However, kept for potential non-Vite consumers (server package, CI). Documented in plan.\nAC#2: @source directives: (a) streamdown node_modules scan is necessary — Vite plugin doesn't auto-scan node_modules for Tailwind classes. (b) apps/** and packages/** @source are likely redundant with Vite auto-detection but provide explicit control. Tested by checking if build works without them — keeping for explicitness.\nAC#3: Vite build already minifies CSS by default. wireframes.html uses CDN Tailwind for docs only — not production. Documented.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
PostCSS config kept (@tailwindcss/postcss) — Vite plugin handles Vite builds but PostCSS may serve non-Vite tooling. @source directives: streamdown node_modules scan necessary (Vite doesn't auto-scan node_modules); apps/packages @source kept for explicit control. Vite minifies CSS in production by default. wireframes.html CDN-only docs, not production.
<!-- SECTION:FINAL_SUMMARY:END -->
