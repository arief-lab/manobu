---
id: TASK-48
title: >-
  Dev-hygiene sweep 3 — orphaned sidecar port squat, persona sync no-prune,
  swallowed sync failures
status: Done
assignee: []
created_date: '2026-09-09 15:13'
updated_date: '2026-09-09 15:50'
labels:
  - bug
  - tooling
dependencies: []
priority: medium
ordinal: 544000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three follow-ups from TASK-47's own E2E, same tooling-lies species as TASK-46/47. (1) PORT SQUAT: reproduced — after an unclean dev shutdown the old sidecar survives and the next boot's sidecar dies with 'Failed to start server. Is port 4317 in use?'; health check then burns 30s before 'timeout — /ai calls will fail'; /api/cards/* dead the whole boot with no hint why. (2) NO-PRUNE: cp -f copies but never deletes — a persona removed from repo-root assistant/ keeps loading in dev forever from the stale staging copy. (3) SWALLOWED: the sync's 'cp 2>/dev/null || true' hides real copy failures — a silent fallback of exactly the kind this task family kills.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sidecar boot survives an orphaned predecessor: before Bun.serve binds 4317, detect EADDRINUSE and fail fast with a clear stderr line (or retry-briefly-then-fail); tauri lib.rs health-wait logs which PID holds the port when the health check fails, so the next boot is diagnosable instead of a 30s silent timeout
- [x] #2 Stale dev processes cannot squat the port across boots: either the app kills the previous sidecar on setup (pidfile in tauri app-data or pkill by exact binary path) or the sidecar exits nonzero on EADDRINUSE so the failure is loud and immediate — verified by an E2E: start dev, kill -9 the app+dev script only, boot again, sidecar healthy within 10s
- [x] #3 Persona sync prunes: removing an .md from repo-root assistant/ removes it from target/debug/assistant on next sync (rsync --delete or explicit find -delete of non-manifest files); verified by adding a dummy .md, syncing, removing it, syncing, gone
- [x] #4 Persona sync failures are loud: cp/rsync errors are NOT swallowed (no 2>/dev/null || true); on failure the script echoes the error and exits nonzero so beforeDevCommand fails visibly instead of booting with missing personas
- [x] #5 bun run test + check-types + ultracite clean (apps/server, apps/desktop)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed a9349f3): AC1 — index.ts binds inside bindServer() with module-level EADDRINUSE_RE; on 'in use' logs the named hint (ss -tlnp | grep PORT) and exits 1 (verified: squatter exits 1 with hint). AC2 — sidecar-dev.sh kills orphaned sidecars before building; KEY discovery: tauri dev spawns the externalBin COPY as target/debug/server (binaries/server-<triple> is the pre-copy artifact) so pgrep is anchored to BOTH paths, TERM→KILL; E2E: boot → kill -9 app+dev → orphan confirmed alive → script kills it → manual sidecar healthy, no 30s timeout, no EADDRINUSE death. AC3 — prune loop deletes staging .md absent from repo root (add dummy → synced, remove → gone). AC4 — cp no longer swallowed (no 2>/dev/null || true); read-only staging E2E: 'cp: cannot remove ... Permission denied', exit 1 → beforeDevCommand fails visibly. AC5 — server 22/0, desktop 234/0, ultracite + tsc clean (after two lint-driven restructures: var-in-try → function scope; inner regex → EADDRINUSE_RE module const; squat E2E re-verified after each). Full boot E2E green. BONUS FIND (out of scope, needs own task if vaporetto FTS ships): with SQLITE_VAPORETTO_EXT default-loaded, applyContentMigrations on a FRESH db via bun direct-run blocks >60s inside vaporetto DDL — synchronous hang (abort timer never fires); unicode61 path <0.1s. Production boots run unicode61 today (sidecar env has no ext) so boots unaffected. Also lib.rs wait_for_http now logs port-holder PID (ss -tlnp) or 'nothing listening — died before binding' on failed health wait (compiles clean).
<!-- SECTION:NOTES:END -->
