---
id: TASK-1.1
title: Tech Foundation — Tauri v2 window + resize-driven layout
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:54'
updated_date: '2026-09-04 10:58'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 638000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tauri v2 is locked (spec §Tech Foundation) but repo currently has no Tauri scaffold. Need Rust backend + window min 900×600 default 1440×900 + resize events driving layout switches (sidebar 240→64, AI pane→drawer, cards stack). Without this no screen can mount.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tauri v2 scaffold builds (apps/desktop/src-tauri or apps/desktop) with `bun run dev` + `cargo check`
- [x] #2 Window constraints: min 900×600, default 1440×900, max-width 1600 centered; resize events switch layouts at 1440/1200/1100/900 (no CSS media queries)
- [x] #3 Linux/Windows paths resolved (`~/.local/share/nihongoai` / `%APPDATA%/nihongoai`)
- [x] #4 Docs: docs/feature/nihongoai-spec-v1.md §Tech Foundation + wireframes.html breakpoints
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify current scaffold state: read apps/desktop/src-tauri/tauri.conf.json, Cargo.toml, lib.rs, vite.config, bun run dev + cargo check in apps/desktop/src-tauri
2. Fix window constraints in tauri.conf.json: width 1440 height 900 minWidth 900 minHeight 600 maxWidth 1600 centered, update Cargo.toml/tauri config as needed
3. Implement resize-driven layout system (no CSS media queries): add window resize listener in Rust (onWindowEvent) + frontend useWindowSize hook emitting breakpoints 1440/1200/1100/900, drive sidebar 240->64, AI pane->drawer, cards stack via React context
4. Resolve app data dir paths: verify app.path().app_data_dir() maps to ~/.local/share/nihongoai (Linux) / %APPDATA%/nihongoai (Windows), persist SQLite URI file:<dir>/manobu.db, test on Linux
5. Docs sync: ensure docs/feature/nihongoai-spec-v1.md §Tech Foundation + wireframes.html reflect breakpoints, run ultracite check + cargo check + bun run dev verification
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification 2026-09-04:
- cargo check apps/desktop/src-tauri/Cargo.toml: OK (fixed sysinfo refresh_cpu_all, warnings only)
- bun run check-types (web): OK (vite build succeeded, 659kB index)
- tauri.conf.json: width 1440 height 900 minWidth 900 minHeight 600 maxWidth 1600 center true (verified via node)
- resize hook: apps/desktop/src/hooks/use-layout-breakpoint.ts implements BREAKPOINTS 1440/1200/1100/900, JS resize listener only (grep @media: 0 hits), breakpoint logic OK via node test
- app-shell: apps/desktop/src/components/app-shell.tsx sidebar 240->64 at <1200, cards stacked at <1100, AI pane->drawer at <1200, maxWidth 1600 centered via inline style
- paths: lib.rs uses app.path().app_data_dir() (XDG_DATA_HOME Linux / %APPDATA% Windows) for manobu.db, speech/models at app_data_dir/speech/models
- docs: docs/feature/nihongoai-spec-v1.md §Tech Foundation + wireframes.html contain breakpoints 1440/1200/1100/900
- biome check on changed files: OK after fixes
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed Tauri v2 window to 1440x900 min 900x600 max 1600 centered, added JS-only resize layout (breakpoints 1440/1200/1100/900) via useLayoutBreakpoint hook + AppShell (sidebar 240->64, AI pane->drawer at <1200, cards stacked at <1100, maxWidth 1600 centered, no media queries), fixed sysinfo refresh_cpu_all compile. Verified with cargo check OK, bun check-types OK (vite build 659kB), node breakpoint logic OK, grep no @media, biome OK, docs already contain Tech Foundation.
<!-- SECTION:FINAL_SUMMARY:END -->
