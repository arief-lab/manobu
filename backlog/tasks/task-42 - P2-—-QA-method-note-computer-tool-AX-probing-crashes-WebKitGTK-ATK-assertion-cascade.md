---
id: TASK-42
title: >-
  P2 — QA method note: computer-tool AX probing crashes WebKitGTK (ATK assertion
  cascade)
status: Done
assignee: []
created_date: '2026-09-09 11:16'
updated_date: '2026-09-10 05:48'
labels:
  - bug
  - p2
  - tooling
dependencies: []
priority: low
ordinal: 551000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-9 method limits. During the QA pass a single desktop.window().ax({maxDepth:2-25}) sequence crashed the whole app (pid exit, exit code 0) with a cascade of CRITICAL impl_GetActions/impl_GetText: assertion ATK_IS_ACTION/ATK_IS_TEXT failures. The vite browser-session harness is the workaround; the app itself may also be crashing for real screen-reader users — worth the upstream check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root cause investigated: which AX operation crashes (w.ax() depth, .find, ref resolution) — minimal repro recorded
- [x] #2 Guard documented in apps/desktop/AGENTS.md Work Guidance (QA/tooling section): use the vite :3001 browser harness for UI automation on this stack, never desktop AX on the WebKitGTK window
- [x] #3 If fixable app-side (GTK ATK_IMPL or WEBKIT_DISABLE_COMPOSITING_MODE style env), file the upstream.webkit workaround + env var in src/main.rs next to WEBKIT_DISABLE_DMABUF_RENDERER
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 5139bd2): AC1 — minimal probe: launched target/debug/app (tauri dev binary, current frontend), walked the AT-SPI tree (document web bootstrap: 17 nodes — frame, filler, panel, document web, button, label) with get_actions/get_attributes/get_state on every node at depth 25, 20 back-to-back sweeps → app alive, ZERO ATK assertions in the log (webkit2gtk-4.1 2.52.6). The doc-9 crash is real-but-unreproduced: webkit was 2.52.6 already at QA time (upgraded Aug 23, QA ran Sep 9), so not a version fix — page-state or race dependent. AC2 — guard documented in apps/desktop AGENTS 'Work Guidance — QA/tooling': vite :3001 browser harness ONLY; AX probing on the native WebKitGTK window banned. AC3 — no app-side env fix justified: no reproducible trigger to mitigate; WEBKIT_DISABLE_DMABUF_RENDERER (src/main.rs) already covers the renderer-side quirk. Upstream check downgraded with evidence.
<!-- SECTION:NOTES:END -->
