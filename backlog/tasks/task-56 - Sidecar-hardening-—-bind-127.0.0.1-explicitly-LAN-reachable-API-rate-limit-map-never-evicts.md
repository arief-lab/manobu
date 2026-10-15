---
id: TASK-56
title: >-
  Sidecar hardening — bind 127.0.0.1 explicitly (LAN-reachable API) + rate-limit
  map never evicts
status: Done
assignee: []
created_date: '2026-09-10 02:59'
updated_date: '2026-09-10 06:29'
labels:
  - bug
  - security
  - sidecar
dependencies: []
priority: low
ordinal: 537000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two hardening findings from the TASK-45 post-fix sweep (2026-09-10), filed together because they share one file: (1) Bun.serve in apps/server/src/index.ts passes only { port } — no hostname — so the sidecar listens on *:4317 (ALL interfaces, confirmed via ss -tlnp). The app itself only connects via 127.0.0.1 (lib.rs health check + webview), and CORS_ORIGIN whitelists tauri://localhost + http://localhost:4317 — but CORS is browser-enforced only; any LAN process can reach the unauthenticated sidecar API (file-backed DATABASE_URL, corpus file reads). Desktop single-user threat model keeps this LOW, but the fix is one line. (2) rateLimitMap in routes/learn-chat.ts is a per-IP Map with no eviction or size cap — unbounded growth keyed by attacker-controllable X-Forwarded-For headers. Trivial for the single-user desktop case, same-file fix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Bun.serve binds hostname 127.0.0.1 explicitly (apps/server/src/index.ts — currently port-only, verified listening on *:4317 via ss -tlnp); verified after change by ss showing 127.0.0.1:4317 (or [::1]) only, and lib.rs health check + desktop flows still green
- [x] #2 If any caller needs non-loopback binding in the future, it must be env-gated (e.g. SIDECAR_HOST) with a comment — the default stays loopback; document the decision in apps/server AGENTS
- [x] #3 rateLimitMap (routes/learn-chat.ts) is bounded: either periodic eviction of stale timestamps or a size cap — verified by a test asserting the map cannot grow unbounded across many unique IPs (or the eviction logic unit-tested)
- [x] #4 bun run test + check-types + ultracite clean (apps/server)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation notes (committed 0386ba0): AC1 — Bun.serve now sets hostname: process.env.SIDECAR_HOST ?? '127.0.0.1'; live ss: 127.0.0.1:4317 ONLY (was *:4317); curl loopback 200, /learn/nextCards serves; LAN 192.168.1.11:4317 → connection refused; lib.rs health check path unaffected (it targets 127.0.0.1). AC2 — SIDECAR_HOST env gate implemented + live-tested (SIDECAR_HOST=0.0.0.0 BUN_PORT=4444 binds 0.0.0.0:4444); decision documented in apps/server AGENTS 'Binding + limits'. AC3 — rateLimitMap bounded: 60s lazy sweep (1/16 sampling) + 10k hard cap (oldest-inserted dropped); unit tests in learn-chat.test.ts (eviction, cap-drop, 10.5k flood stays <= cap). AC4 — turbo 9/9, server 31/0, tsc + ultracite clean.
<!-- SECTION:NOTES:END -->
