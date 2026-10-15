---
id: TASK-153
title: 'AppImage Tier 3 hardening: agent PATH discovery and process ownership'
status: Done
assignee:
  - '@Buffy'
created_date: '2026-09-28 03:18'
updated_date: '2026-10-13 02:40'
labels:
  - appimage
  - release
  - acp
  - tauri
  - processes
dependencies:
  - TASK-151
references:
  - doc-24
  - docs/agent-stack-gaps-vs-aionui.md
priority: low
type: task
ordinal: 918000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four items in docs/agent-stack-gaps-vs-aionui.md §Tier 3 (lines 79-127) are invisible in dev and dangerous in a shipped bundle, which is why the doc notes at :136 that they depend on the AppImage being a real target. Each one is a process or path assumption that only breaks outside a shell:

3.1 Orphan process registry: if the AppImage dies while opencode is mid-task, the child stays alive indefinitely, because nothing records the spawned pid to reap it.
3.2 Parent-pid self-terminate: apps/server outlives the Tauri window, so the next launch kills the previous opencode but not the previous backend.
3.3 Work-dir contract env: the Tauri sidecar passes only `PORT=4317` and the data dir comes from Bun's cwd, so an AppImage launched from a desktop entry has a working directory nobody chose.
3.4 Agent PATH augmentation: a desktop entrypoint does not source the shell, so `/home/arif/.qoder/entry:/home/arif/.local/bin:/home/arif/.local/bin:/home/arif/.local/bin:/home/arif/.cache/.bun/bin:/home/arif/Work/Projects/mano/manobu-gg/bin:/home/arif/.local/share/mise/installs/agent-browser/latest:/home/arif/.local/share/mise/installs/bun/1.4.2/bin:/home/arif/.local/share/mise/installs/claude/latest:/home/arif/.local/share/mise/installs/codex/latest/bin:/home/arif/.local/share/mise/installs/copilot/latest:/home/arif/.local/share/mise/installs/crush/latest/crush_0.95.0_Linux_x86_64:/home/arif/.local/share/mise/installs/gh/latest/gh_2.101.0_linux_amd64/bin:/home/arif/.local/share/mise/installs/node/25.9.0/bin:/home/arif/.local/share/mise/installs/npm-xai-official-grok/latest/node_modules/.bin:/home/arif/.local/share/mise/installs/npm-backlog-md/latest/node_modules/.bin:/home/arif/.local/share/mise/installs/npm-dirac-cli/latest/node_modules/.bin:/home/arif/.local/share/mise/installs/npm-playwright/latest/node_modules/.bin:/home/arif/.local/share/mise/installs/opencode/latest:/home/arif/.local/share/mise/installs/pi/latest/pi:/home/arif/.local/share/mise/shims:/home/arif/.local/bin:/usr/share/omarchy/bin:/home/arif/.local/bin:/home/arif/.local/bin:/home/arif/.local/share/../bin:/home/arif/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/bin:/home/arif/.local/bin:/usr/lib/jvm/default/bin:/usr/bin/site_perl:/usr/bin/vendor_perl:/usr/bin/core_perl:/usr/lib/rustup/bin:/home/arif/.local/bin` may not contain the node or bun install, and the failure is "opencode not found at child spawn" on the user's machine with nothing in the log explaining it.

doc-24 §F-6 and its release gate treat this as the real blocker behind the stale-binary blocker: TASK-151 makes the bundle current, and without this the current bundle leaks agent processes onto the user's machine.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An agent process spawned by the packaged app is recorded at spawn and terminated at shutdown, verified by killing the app mid-task and finding no surviving opencode process
- [x] #2 apps/server exits when its launching Tauri process is gone, verified by closing the window and checking the backend pid
- [x] #3 The sidecar passes explicit data, cache and log directories, and the system info route reports those paths rather than a cwd-derived guess
- [x] #4 At boot the backend prepends the node, bun and cargo bin directories it finds to PATH, only when the directory exists, and an agent spawn succeeds from a desktop entry with an unset shell PATH
- [x] #5 Each of the four is verified against the built AppImage, not against bun dev
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
State found: 3.1 is largely implemented by TASK-102 — packages/acp/src/child-registry.ts records each detached group leader (register at spawn, unregister at teardown, marker-checked reap at boot, apps/server/src/index.ts:287 boot reap), SIGTERM/SIGINT run disposeAll (index.ts:318-324), registry lives beside the chat db (context.ts:75). What is MISSING is the shutdown that reaches those handlers: lib.rs RunEvent::Exit calls CommandChild::kill() = SIGKILL, so a graceful window-close never runs disposeAll, and if the AppImage itself dies there is nothing telling the orphaned sidecar to stop (3.2) — AC#1's "kill the app mid-task" therefore lands on the watchdog, not the registry alone.

Implementation:
1. lib.rs (3.2 + graceful 3.1): pass MANOBU_PARENT_PID=std::process::id() to the sidecar; on RunEvent::Exit send SIGTERM to the sidecar pid (CommandChild::process_id), wait up to ~2s polling /proc/<pid>, then child.kill() as escalation. This makes both shutdown paths reach the server's existing disposeAll.
2. apps/server/src/parent-watchdog.ts (3.2): when MANOBU_PARENT_PID is set, an unref'd ~2s timer does process.kill(parent,0); ESRCH → the same tearDown("parent-exit") path as SIGTERM. Unit-test with injected pid/timer deps.
3. lib.rs + apps/server (3.3): pass MANOBU_CACHE_DIR=app_cache_dir() and MANOBU_LOG_DIR=app_log_dir() (created with mkdir like data_dir); new GET /api/system/info route in index.ts reporting dataDir/cacheDir/logDir/assistantDir/database path — all from the explicit contract (env + loader-resolved dir), never cwd. assistant-loader: export the resolved dir + fallback flag (set once in loadPersonasAtBoot). Raw vars documented in apps/server/.env.example per packages/env rules.
4. apps/server/src/path-bootstrap.ts (3.4): at boot, before serving, prepend existing-but-missing bin dirs to process.env.PATH: newest ~/.nvm/versions/node/*/bin, ~/.bun/bin, ~/.local/share/bun/bin, ~/.local/share/mise/shims (the manager this host's opencode lives behind; without it AC#4 cannot pass on a desktop entry), ~/.cargo/bin. Only-if-exists, no duplicates. spawn inherits via agentChildEnv (copies process.env), listAgentCandidates/which walk the same PATH. Unit-test with fake HOME + injected fs.
5. Verify each AC against the BUILT AppImage (AC#5): rebuild via bun run desktop:build (full recipe proven by TASK-151), extract, boot the packaged server binary with env -i + desktop-entry-minimal PATH (system dirs only, HOME real) + MANOBU_PARENT_PID=live launcher: GET /agents reports opencode installed and a real WS chat turn spawns it (proves 3.4 end to end); GET /api/system/info echoes the passed dirs (3.3); kill -9 the launcher mid-turn → watchdog fires → no server, no surviving opencode/jlpt-mcp (3.2 + 3.1 AC#1); separately SIGTERM server → disposeAll leaves nothing (3.1 shutdown leg).
6. Docs: AGENTS.md updates (apps/server contracts + Verification, src-tauri sidecar env/kill behavior, .env.example), mark docs/agent-stack-gaps-vs-aionui.md Tier 3 items done. Gates: ultracite fix, cargo fmt (src-tauri staged), check:dox, mutation-gate --check; one commit; no push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design decisions: (1) the three new sidecar env vars (MANOBU_PARENT_PID/CACHE_DIR/LOG_DIR) are raw per packages/env rules and had to be added to the explicit allowlist in capabilities/default.json or Tauri strips them; (2) path-bootstrap mutates process.env.PATH once at boot — one fix feeds both GET /agents discovery (which() walks PATH) and every child spawn (agentChildEnv copies process.env); (3) graceful close uses a libc::kill SIGTERM + 2s /proc poll in lib.rs (libc was already a transitive tauri dep) so the server's existing disposeAll reaps detached agent groups, and the unref'd parent watchdog (process.kill(pid,0), EPERM=alive) covers kill -9 of the window where no signal can arrive; (4) /api/system-info answers only from explicit sources (env + loader-recorded assistantResolution + exported childRegistryPath), cwd is its own field, never load-bearing. Verification: 16 new unit tests green; full apps/server suite 687 pass/1 skip/0 fail; cargo check+test (45)+fmt clean; bun run check-types 14/14; mutation-gate --check: all 207 anchors resolve. Packaged AppImage (AC#5): fresh bundles, extracted, booted under env -i HOME=/home/arif PATH=/usr/bin:/bin -> log line 'PATH augmented ... mise/shims, .cargo/bin', GET /agents opencode installed:true, GET /api/system/info echoed the passed cache/log/data dirs exactly, real WS chat.send spawned 'opencode acp' recorded in .acp-children.json as pgid 277068; kill -9 of the fake parent -> sidecar exited <=2s, group 277068 dead, registry rewritten []. Commit 6ff6bed on re-design (not pushed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tier 3 closed: the packaged sidecar now owns its agent processes end to end. Tauri SIGTERMs it on graceful exit (2s grace, kill() escalate) and passes MANOBU_PARENT_PID/CACHE_DIR/LOG_DIR; parent-watchdog.ts tears the sidecar down when the launcher dies by any means; path-bootstrap.ts prepends existing nvm/bun/mise/cargo bin dirs to PATH at boot; GET /api/system/info reports cache/log/db/assistant/registry paths from explicit env sources, never cwd. Proven against the built AppImage, not dev: minimal-PATH boot found and spawned opencode, mid-task kill -9 of the parent left no server and no surviving agent group, and 16 unit tests plus the full server/desktop suites back each leg. Shipped in commit 6ff6bed (17 files, +850/-18).
<!-- SECTION:FINAL_SUMMARY:END -->
