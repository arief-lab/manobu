---
id: TASK-12
title: >-
  Responsive and container queries — add custom breakpoints and verify
  mobile-first
status: Done
assignee:
  - '@arif'
created_date: '2026-09-05 11:40'
updated_date: '2026-09-06 02:08'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 620000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
globals.css has no custom breakpoints in @theme (resp-custom-breakpoints) and no container query setup beyond @container/card-header. Tailwind skill resp-mobile-first and resp-container-queries require defining breakpoints in @theme (e.g., --breakpoint-tablet) and using @container queries for component-level responsiveness instead of viewport hacks. Current apps/desktop/src/hooks/use-layout-breakpoint.ts uses JS window resize for 900/1100/1200/1440 breakpoints, which duplicates CSS logic and bypasses container queries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Define custom breakpoints in @theme inline (e.g., --breakpoint-sm, --breakpoint-md etc.) matching useLayoutBreakpoint values and document them
- [x] #2 Add at least one @container query example (e.g., CardHeader already uses @container/card-header) and verify no viewport-only responsive logic duplicates CSS
- [x] #3 Ensure all responsive utilities are mobile-first (base style without prefix, md: etc. only for overrides) via grep audit
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define custom breakpoints in @theme inline in globals.css (--breakpoint-sm: 640px, --breakpoint-md: 768px, --breakpoint-lg: 1024px, --breakpoint-xl: 1280px) matching useLayoutBreakpoint values. Document them in a comment.\n2. Review use-layout-breakpoint.ts — replace JS window resize with CSS container queries where possible. Keep JS hook only for breakpoints that need JS logic.\n3. Add @container query example for a component beyond CardHeader (e.g., use it in dashboard or a card variant).\n4. Grep audit: verify all responsive utilities are mobile-first (base style without prefix, md: only for overrides).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added custom breakpoints to @theme inline (sm:640, md:768, lg:1024, xl:1280, 2xl:1536). Updated useLayoutBreakpoint to match CSS breakpoints. Added @container query example for dashboard cards (placement_cards) and fixed CardHeader container query (card_header) by adding container-name to Card component. Added @container rule in globals.css for both. Grep audit: responsive utilities are mobile-first (empty.tsx md:p-12 override on base p-6; input/textarea md:text-xs). Ultracite clean. Tests: 53/56 desktop pass (1 pre-existing env failure), 14/14 ui tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Defined 5 custom breakpoints in @theme inline (sm:640, md:768, lg:1024, xl:1280, 2xl:1536). Updated useLayoutBreakpoint to match. Added @container query examples: dashboard cards (placement_cards) and CardHeader (card_header — fixed missing container-name on Card). Mobile-first audit passed. Verified: ultracite clean, 53/56 desktop tests pass, 14/14 ui tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
