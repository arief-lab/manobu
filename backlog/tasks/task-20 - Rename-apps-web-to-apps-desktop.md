---
id: TASK-20
title: Rename apps/web to apps/desktop
status: Done
assignee:
  - '@arief'
created_date: '2026-09-06 01:24'
updated_date: '2026-09-06 01:33'
labels: []
dependencies: []
priority: medium
type: chore
ordinal: 604000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The apps/web directory contains the React SPA that runs in Tauri's WebView (desktop app), not a browser web app. Rename to apps/desktop for clarity. Update all references: package.json workspaces, turbo.json tasks, tsconfig paths, AGENTS.md docs, import aliases, scripts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/web renamed to apps/desktop
- [x] #2 package.json workspaces updated to reflect new path
- [x] #3 turbo.json tasks updated (web → desktop)
- [x] #4 All AGENTS.md docs updated with new path
- [x] #5 Import aliases and tsconfig paths updated
- [x] #6 bun run check-types passes
- [x] #7 bun test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rename apps/web directory to apps/desktop. 2. Update package.json workspaces. 3. Update turbo.json task names (web → desktop). 4. Update all AGENTS.md docs. 5. Update tsconfig paths and import aliases. 6. Update Tauri config if needed. 7. Verify build and tests pass.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Renamed apps/web to apps/desktop for clarity. Updated all references: package.json workspaces, apps/desktop/package.json name field, turbo filters, README.md, all AGENTS.md docs, sidecar-dev.sh script, source comments. Verified: bun run check-types passes (10/10), bun test passes (247 pass, 2 skip, 0 fail).
<!-- SECTION:FINAL_SUMMARY:END -->
