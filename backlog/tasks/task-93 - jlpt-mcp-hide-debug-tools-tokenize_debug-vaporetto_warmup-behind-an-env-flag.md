---
id: TASK-93
title: >-
  jlpt-mcp: hide debug tools (vaporetto_split, vaporetto_warmup) behind an env
  flag
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 12:45'
updated_date: '2026-09-21 15:55'
labels:
  - mcp
  - rust
dependencies: []
priority: low
type: chore
ordinal: 371500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

crates/jlpt-mcp serves 20 tools on every session of every agent, but two of them are developer-only: the tokenize-debug tool and the vaporetto warmup tool. They are pure prompt tax (descriptions + names in every tools/list) and a miscall risk, and the warmup tool is redundant in production since boot self-warm (TASK-24.1) already loads the predictor in the background.

Scope: gate registration of the debug tools on an env var (e.g. JLPT_MCP_DEBUG=1) so default builds expose only the corpus tools. Keep the tools themselves (parity/debug workflows use them); keep stderr diagnostics unchanged.

references: crates/jlpt-mcp/src/main.rs (tool_router registration), crates/jlpt-mcp/AGENTS.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tools/list omits vaporetto_split and vaporetto_warmup by default and includes them when JLPT_MCP_DEBUG=1; tools/call on a hidden tool reports tool-not-found
- [x] #2 tests/parity.rs passes on the default and --features vaporetto builds, with the two debug-tool tests opting in via the flag
- [x] #3 crates/jlpt-mcp/AGENTS.md documents the flag, its value semantics, and which tools it gates
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
rmcp 3.1 ToolRouter has a first-class disabled set (disable_route) that hides a tool from list_all()/get() and rejects call() with tool-not-found, and #[tool_handler(router = <expr>)] accepts any router expression. Steps: (1) src/main.rs: DEBUG_TOOLS const + debug_tools_enabled() (OnceLock over std::env:: var == "1"); (2) JlptServer::visible_tool_router() builds Self::tool_router() and disable_route()s debug names unless enabled; (3) point #[tool_handler] at that fn so list_tools/get_tool/call_tool honour it; (4) tests/parity.rs: spawn_with_env so the two debug-tool tests opt in, plus a gating test comparing tools/list with and without the flag; (5) crates/jlpt-mcp/AGENTS.md documents the flag.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mechanism: rmcp 3.1 ToolRouter::disable_route reached through #[tool_handler(router = Self::visible_tool_router())]; the flag is resolved once per process (OnceLock) and matches only the exact value 1. tools/call on a hidden name answers -32602 tool not found (verified live). tests/parity.rs gained McpClient::frame (returns the raw response frame so a test can assert an error) + spawn_with_env, and the two debug-tool tests now opt in with JLPT_MCP_DEBUG=1. Default tool surface dropped from 18 to 16, so the crate went 0.4.0 to 0.5.0 (Cargo.toml plus the #[tool_handler] literal, which cargo does not interpolate).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hidden jlpt-mcp's two developer-only tools (vaporetto_split, vaporetto_warmup) behind JLPT_MCP_DEBUG=1: JlptServer::visible_tool_router() disables them on the per-request router and #[tool_handler] now points at it, so tools/list, get_tool and call_tool all agree. Verified by the new parity test debug_tools_are_gated_by_the_env_flag plus a live stdio smoke (16 tools by default, 18 with the flag, tool-not-found on a hidden call), and cargo test --release green on both the default and --features vaporetto paths (23 unit + 5 parity each). crates/jlpt-mcp/AGENTS.md documents the flag, its exact-value semantics, the spawn-env caveat, the mechanism and the 0.5.0 bump; the tool name in the task title was corrected from tokenize_debug to vaporetto_split.
<!-- SECTION:FINAL_SUMMARY:END -->
