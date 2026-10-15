---
id: TASK-22
title: 'Adopt AionUi patterns - cron, ACP session pool + queue, MCP catalog'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-06 04:06'
updated_date: '2026-09-06 13:58'
labels:
  - cron
  - acp
  - mcp
  - aionui
dependencies: []
priority: high
type: feature
ordinal: 597000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to doc-1 AionUi deep dive (backlog/docs/research/doc-1). AionUi Cowork subsystems directly map to manobu gaps already captured in docs/agent-stack-gaps-vs-aionui.md and docs/agent-switching-like-aionui.md.

Adopt in priority order: Tier A close ACP last mile (per-conversation session pool LRU ~3 in apps/server + classifyConversationBusyError + useConversationCommandQueue auto-drain + buildSendFailureError taxonomy), Tier B minimal cron scheduler in Tauri (ICronJob cronExpr|interval|oneTime + tz repair + keepAwake, three default jobs: morning review nudge continue, weekly JLPT mock newConversation, nightly weak-pattern rebuild), Tier C MCP catalog (app_data_dir/config/mcp-servers.json fan-out + http/streamable capability + ACP Registry publish for jlpt-mcp), Tier D polish (thinking throttle, session_active dot).

Keep Hono+Bun compile (no Rust/Axum/JWT), single backend owns sub-processes, capability negotiation before session, queue before concurrency, standard 5-field cron + IANA tz as durable shape.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tier A: apps/server session pool keyed by conversation/agent replaces let acp singleton; switching agent = close_session + new getAcpModel; busy/queue guard covers overlapping prompt + cron tick
- [x] #2 Tier B: cron scheduler persisted to app_data_dir/cron/jobs.json with CreateTaskDialog presets (Hourly/Daily/Weekly/Weekdays + advanced raw cron) + TaskDetailPage (Run Now, pause/resume, history batch delete, queue-protection toggle) + keep-awake banner
- [x] #3 Tier C: MCP not single env literal — catalog file watched by packages/acp and src-tauri/lib.rs; jlpt-mcp publishable as npx @manobu/jlpt-mcp + ACP Registry healthCheck
- [x] #4 No regression: existing GET /agents/:id/models, header agent/persona/model pickers, jlpt-mcp parity.rs golden, and docs/test-plan.md still pass; docs updated to point at doc-1
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Tier A (close ACP last mile): A1 pool is DONE (agent-keyed LRU 3 + isHealthy eviction in apps/server/src/index.ts — verify only); A2 add packages/acp conversationGuard.ts — classifyConversationBusyError + SessionCommandQueue (enqueue, drain on idle, never throws) + buildSendFailureError taxonomy {reconnect_agent|wait|fix_path|retry} with unit tests; wire queue into apps/server POST /ai (per-agent serialize) + map failures to taxonomy. Tier B (cron): src-tauri/src/cron.rs — ICronJob {id, name, prompt, agent, model, cronExpr|intervalMinutes|oneTimeAt, tz, executionMode continue|new, enabled, keepAwake, queueProtection} persisted app_data_dir/cron/jobs.json; repair_tz on load; ticker thread evaluates next-run from now() in tz (5-field cron via cron crate or manual parser); commands cron_list/create/update/remove/run_now/history; three default jobs seeded disabled (morning review nudge 8:00 continue, weekly JLPT mock Mon 09:00 newConversation, nightly weak-pattern rebuild every 360m); TS wrappers packages/acp or apps/desktop/src/lib/cron.ts + Settings ScheduledTasks section (CreateTaskDialog presets Hourly/Daily/Weekly/Weekdays + advanced raw cron, Run Now, pause/resume, history batch delete, queue-protection toggle, keep-awake banner). Tier C (MCP catalog): app_data_dir/config/mcp-servers.json {servers:[RequestedMcpServer+enabled]} read by packages/acp mcp.ts (loadMcpCatalog: file overrides env literal) + src-tauri lib.rs injects fallback; http/streamable transport passthrough in negotiation (http already plumbed — verify + test); ACP Registry publish shim: crates/jlpt-mcp ACP_REGISTRY.md manifest + npx @manobu/jlpt-mcp bin shim package. Tier D (polish): session_active dot in /ai header (pool health → dot), thinking throttle stays deferred (only if streaming thrash observed). No regression: GET /agents/:id/models, header pickers, jlpt-mcp parity golden, docs/test-plan.md; docs point at doc-1. Order: A2 → B (Rust+UI) → C → D → verify + DOX (packages/acp, apps/server, apps/desktop, src-tauri, packages index) + backlog.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC evidence — AC1 (Tier A): A1 per-agent session pool was already landed (agent-keyed LRU 3 + isHealthy eviction in apps/server/src/index.ts); verified + extended with A2/A3: packages/acp conversation-guard.ts (classifyConversationBusyError, SessionCommandQueue serialize-per-session with maxPending=4 backpressure throwing structured busy errors, buildSendFailureError taxonomy user_agent_disconnected→reconnect_agent / conversation_busy→wait / path_unavailable→fix_path / unknown_upstream→retry); wired into POST /ai — overlapping prompts queue per agent, overflow → HTTP 429 with taxonomy JSON, failures → 502. 10 unit tests in packages/acp/test/conversation-guard.test.ts cover taxonomy, busy classify, FIFO drain, failure propagation, backpressure. AC2 (Tier B): src-tauri/src/cron.rs — CronState persisted app_data_dir/cron/jobs.json, CronJob {cronExpr|intervalMinutes|oneTimeAt, tz, executionMode continue|new, enabled, keepAwake, queueProtection}, 5-field cron normalized to cron-crate 7-field, tz repair on load (/etc/localtime probe), 30s ticker with missed-trigger semantics, one-time auto-disable, queue-protection skip; 8 commands (cron_list/upsert/remove/history/clear_history/run_now/due_jobs/report_result); 3 default jobs seeded disabled; 10 Rust tests. Settings ScheduledTasks section: presets Hourly/Daily/Weekly/Weekdays + advanced raw cron, Run Now, Pause/Resume, per-job history + batch delete, queue-protection toggle, keep-awake banner. AC3 (Tier C): mcp-servers.json catalog {version:1, servers:[{id,transport,target,enabled}]} parsed by packages/acp mcp.ts (parseMcpCatalog/resolveMcpServers — corrupt file never throws), getAcpModel reads it via resolveMcpServersFromDisk (env literal wins as override); http/sse negotiation passthrough tested; npx shim packages/jlpt-mcp (bin/jlpt-mcp.js resolves MANOBU_JLPT_MCP_BIN → src-tauri/binaries → crates target, verified against built release binary) + manobu.acpRegistry manifest metadata. AC4 (no regression): jlpt-mcp parity golden passes (cargo test parity --release 1/1), GET /agents/:id/models + header pickers untouched, server smoke suite 18 pass, docs/test-plan.md untouched; docs updated to reference doc-1 in 5 AGENTS.md files. Verification: cargo 39 pass, desktop 142 pass/0 fail, acp 36 pass, server 18 pass, check-types baseline only (pre-existing 7 in apps/server proven via git stash), Ultracite clean on all 11 touched files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-22 AionUi adoption across all four tiers. Tier A: conversation guard (busy classification, per-session command queue with backpressure, send-failure taxonomy) wired into POST /ai — overlapping prompts queue per agent, failures return structured {code, resolution} instead of raw 500s. Tier B: full cron scheduler in the Tauri shell (jobs.json store, tz repair, missed-trigger ticker, queue protection, one-time auto-disable) + Settings ScheduledTasks UI (presets/raw cron, Run Now, pause/resume, history batch delete, keep-awake banner) with 3 default jobs seeded disabled. Tier C: MCP catalog file-over-env with http/sse negotiation passthrough + publishable @manobu/jlpt-mcp npx shim with ACP Registry metadata. Tier D: session_active dot in the /ai header. Verified: 39 Rust + 196 TS tests passing (142 desktop / 36 acp / 18 server), parity golden intact, Ultracite clean; DOX updated in 5 AGENTS.md files.
<!-- SECTION:FINAL_SUMMARY:END -->
