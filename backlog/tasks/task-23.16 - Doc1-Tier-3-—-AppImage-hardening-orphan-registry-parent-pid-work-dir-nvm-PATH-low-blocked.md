---
id: TASK-23.16
title: >-
  Doc1 Tier 3 — AppImage hardening: orphan registry + parent-pid + work-dir +
  nvm PATH (low, blocked)
status: Done
assignee: []
created_date: '2026-09-06 06:07'
updated_date: '2026-10-13 02:47'
labels:
  - hardening
  - doc1
dependencies: []
parent_task_id: TASK-23
priority: low
type: feature
ordinal: 887000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Original agent-stack-gaps Tier 3.1-3.4 still open: orphan process registry <dataDir>/runtime/agent-process-registry.json SIGTERM+SIGKILL after 1s (Tier 3.1 ~150 lines), parent-pid --parent-pid <tauri-pid> self-terminate via os.kill(parentPid,0) (Tier 3.2 ~20 lines), work-dir contract MANOBU_DATA_DIR etc. via buildSpawnEnv (Tier 3.3 ~15 lines), nvm PATH augmentation ~/.nvm/versions/node/*/bin + bun/cargo bin prepend (Tier 3.4 ~30 lines). Blocked until AppImage is real shipped target. Doc-1 §5.2 already notes Out of scope Rust/Axum/JWT; this hardens localhost:4317 Tauri only. See docs/agent-stack-gaps-vs-aionui.md Tier 3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Orphan registry written at spawn, read at shutdown, SIGTERM then SIGKILL after 1s grace
- [x] #2 Parent-pid flag passed to apps/server; on parent exit cleanup + die
- [x] #3 Explicit MANOBU_DATA_DIR/CACHE_DIR/LOG_DIR env replaces Bun cwd reliance; /api/system/info reports correct paths
- [x] #4 nvm/node-manager PATH walk prepends ~/.nvm/*/bin + bun/cargo bins if dirs exist
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Superseded by the TASK-151/152/153 line, verified against the built AppImage (TASK-153 AC#5). Mapping to the original Tier 3 shapes: #1 landed as packages/acp/src/child-registry.ts (TASK-102: record at spawn, boot reap with /proc cmdline marker re-check) plus the TASK-153 shutdown leg (Tauri SIGTERM with 2s grace then child.kill() escalate; the server's disposeAll group-kills agent trees); #2 as MANOBU_PARENT_PID env (not a --parent-pid flag) polled by apps/server/src/parent-watchdog.ts; #3 as MANOBU_CACHE_DIR/MANOBU_LOG_DIR passed by the shell + GET /api/system/info (explicit sources, never cwd; MANOBU_DATA_DIR already existed); #4 as apps/server/src/path-bootstrap.ts (nvm newest + bun + mise shims + cargo, only-if-exists). Packaged proof: kill -9 of the parent mid-task left no server and no surviving agent group; env -i minimal-PATH boot found and spawned opencode.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tier 3 hardening closed via TASK-153 (commit 6ff6bed): the packaged app records and reaps agent processes across both shutdown paths, the sidecar dies with its launcher, paths are explicit and reported by /api/system/info, and agent bin dirs are discovered without a shell PATH. All four ACs verified against the built AppImage, not dev.
<!-- SECTION:FINAL_SUMMARY:END -->
