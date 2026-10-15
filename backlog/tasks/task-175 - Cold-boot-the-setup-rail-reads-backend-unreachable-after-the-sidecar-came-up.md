---
id: TASK-175
title: >-
  Cold boot: the setup rail reads 'backend unreachable' after the sidecar came
  up
status: Done
assignee: []
created_date: '2026-10-14 10:02'
updated_date: '2026-10-14 10:05'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 991000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src-tauri/src/lib.rs emits sidecar:ready when the readiness poll sees HTTP 200, and emits nothing on timeout
- [x] #2 watchSidecarReady invalidates SENSEI_STATUS_QUERY_KEY on the event, is a no-op outside Tauri, and releases a listener that settles after cleanup (test/sidecar-ready.test.ts green)
- [x] #3 sensei.ts keeps retry: false and staleTime 5 min; the offline-laptop decision is unchanged
- [x] #4 A cold boot of the real Tauri window shows the rail online without pressing re-check, with the dev log ordering health check -> POST /rpc/acp/agents/list
- [x] #5 Mutation seam sidecar-ready-announce-ignored is caught; scripts/mutation-gate.ts --check resolves every anchor
- [x] #6 DOX rows for sidecar-ready.ts and the emit land in apps/desktop/AGENTS.md and apps/desktop/src-tauri/AGENTS.md
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in 035fd58. Live proof on the real Tauri window (headless Xvfb :99): app start 09:54:44, sidecar '[ai] listening' 09:54:58 (14s of migrations), and the dev log shows '[sidecar] health check http://127.0.0.1:4317/ is responsive' immediately followed by '--> POST /rpc/acp/agents/list 200 34ms'. The dashboard rail reads 'sensei is here' with no re-check press. Reproduced on two independent cold boots (tauri-dev4.log, tauri-dev5.log). Note: the relaunched instance first mapped its window onto the live Hyprland Wayland session because WAYLAND_DISPLAY is inherited; forcing GDK_BACKEND=x11 (and unsetting WAYLAND_DISPLAY) is what puts it on Xvfb :99 for screenshots.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The shell's readiness poll now announces the bind: src-tauri/src/lib.rs emits sidecar:ready when the health probe answers (nothing on timeout), and the new src/lib/sidecar-ready.ts subscribes in __root and invalidates SENSEI_STATUS_QUERY_KEY, so the setup rail heals itself after the 15s migration window without weakening retry: false. Verified live on the real Tauri window (health-check line immediately followed by POST /rpc/acp/agents/list 200, rail reads 'sensei is here'), by 3 unit tests, by mutation seam sidecar-ready-announce-ignored (caught: 1 fail mutated / 3 pass clean), and by the repo gates: bun run check-types 14/14, desktop suite 556 pass 3 skip 0 fail, mutation-gate --check 217/217 anchors, cargo fmt clean, check:dox clean, fallow boundary violations 0.
<!-- SECTION:FINAL_SUMMARY:END -->
