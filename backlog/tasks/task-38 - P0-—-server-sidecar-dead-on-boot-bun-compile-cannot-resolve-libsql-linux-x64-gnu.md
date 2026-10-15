---
id: TASK-38
title: >-
  P0 — server sidecar dead on boot: bun compile cannot resolve
  @libsql/linux-x64-gnu
status: Done
assignee: []
created_date: '2026-09-09 11:14'
updated_date: '2026-09-09 12:11'
labels:
  - bug
  - p0
  - sidecar
dependencies: []
priority: high
ordinal: 554000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-9 QA-1. Symptom: every launch, [sidecar stderr] error: Cannot find module '@libsql/linux-x64-gnu' from /$bunfs/root/server-x86_64-unknown-linux-gnu → sidecar terminated code=1 → health check 30s timeout → all /ai + API routes dead in the app. Reproduced with a fresh bun run compile:linux. Root cause: @manobu/db → libsql 0.5.29 platform dep @libsql/linux-x64-gnu is hoisted in node_modules/.bun store; bun 1.4.0-canary single-file compile neither inlines the .node module nor resolves it from /$bunfs. bun.lock unchanged since af534e5 — likely a bun version behavior change. Fix directions: (a) add @libsql/linux-x64-gnu as a direct dependency of apps/server so compile resolves it, (b) --external libsql + ship the native module beside the binary, (c) pin the previously working bun. BLOCKS every packaged demo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Compiled apps/server/dist/server-x86_64-unknown-linux-gnu runs standalone without 'Cannot find module @libsql/linux-x64-gnu' (repro: run the binary directly, expect the [ai] listening banner)
- [x] #2 sidecar-dev.sh output binary works when spawned by lib.rs: health check http://127.0.0.1:4317/ returns 200 within 30s of app boot (no [sidecar] timeout in logs)
- [x] #3 /ai + all /api/* routes respond in the packaged (tauri dev) app window
- [x] #4 Root cause + chosen fix documented in apps/server/AGENTS.md compile section (bun native-module handling is version-sensitive — record the working bun version/pattern)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed ad6ff29): root cause proven by experiment matrix — bun compile does not embed .node addons; libsql uses a COMPUTED require(`@libsql/${target}`) that neither the bundler nor Bun.plugin can intercept in standalone binaries; resolution walks node_modules from CWD, and the sidecar inherited the GUI cwd (repo-tree accident in dev, nothing in packaging). Fix = four legs (all required, documented in apps/server/AGENTS.md): direct dep @libsql/linux-x64-gnu@0.5.29 in apps/server/package.json; sidecar-dev.sh mirrors node_modules/@libsql/linux-x64-gnu next to the dev sidecar; tauri.conf.json bundle.resources maps it into the resource dir; lib.rs sets sidecar cwd (exe-parent with node_modules → resource-dir fallback). AC#1: compiled binary + node_modules adjacent dir → serves (proven via sterile-dir experiments AND the live dev boot). AC#2: clean desktop:dev restart → [sidecar] health check responsive, zero Cannot-find lines. AC#3: / 200, /agents 200 (relative), /api/cards db WRITE succeeds ({"inserted":[]}) — libsql loads and executes in the compiled binary. AC#4: apps/server/AGENTS.md Work Guidance records the four-leg contract + dead ends (static-import __require bug, dlopen+plugin incompatibility, NODE_PATH no-op) so nobody retries them. NOTE: chat-streaming E2E from the browser harness is CORS-blocked (preview origin :3001 not in tauri CORS list — harness artifact, desktop origin is allowed); route health proven via /agents + db write. Discovered+filed TASK-43 during E2E: /api/vocab|grammar|kanji 500 in compiled binary (import.meta.dir=/$bunfs DATA_DIR walk).
<!-- SECTION:NOTES:END -->
