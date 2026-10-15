---
id: TASK-96
title: >-
  acp: give MCP servers a per-server env map (config surface for sidecar dev
  flags)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-21 15:59'
updated_date: '2026-09-21 16:44'
labels:
  - mcp
  - desktop
  - acp
dependencies: []
references:
  - packages/acp/src/mcp.ts
priority: medium
type: feature
ordinal: 777000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Found while shipping TASK-93. The jlpt-mcp debug gate (JLPT_MCP_DEBUG=1) is only readable from the process environment, and neither declaration path for MCP servers has a per-server env: the ACP_MCP_SERVERS literal is three colon-separated fields (id, transport, target) with no room for env, and mcp-servers.json entries are id/transport/target/enabled only. So a desktop user or developer cannot turn one sidecar's dev-only tools on without exporting the variable for the whole app, which leaks into every agent child process and every other stdio server. It also blocks any future Settings toggle for sidecar behaviour: the catalog file is the intended single source of truth (TASK-22 Tier C) but cannot express per-server environment.

The ACP session/new mcpServers payload has its own stdio server shape; confirm whether the ACP protocol version this repo targets already carries an env list for stdio servers before designing our own encoding.

references: packages/acp/src/mcp.ts (parseMcpServers, isMcpCatalog, the to-ACP mapping), crates/jlpt-mcp/AGENTS.md (TASK-93 debug gate)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An MCP server declared via ACP_MCP_SERVERS or mcp-servers.json can carry named environment values that reach only that server stdio child
- [x] #2 The parser and the catalog validator accept the new field and reject malformed values the way malformed entries are rejected today (warn-skip, never throw), covered by tests
- [x] #3 A live session proves it end to end: enabling the flag for jlpt-vocab only makes its tools/list report 18 tools while another stdio server keeps its own environment
- [x] #4 packages/acp/AGENTS.md documents the syntax, and crates/jlpt-mcp/AGENTS.md points at it as the supported way to enable the debug tools from the app
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Plan (after research; scope grew by one restored leg):

FINDING: the literal is write-only today. Tauri lib.rs renders ACP_MCP_SERVERS (env -> mcp-servers.json -> bundled jlpt-mcp) and apps/server validates it in packages/env, but nothing reads it: apps/server/src/context.ts:184 passes mcpServers: []. The only consumer was the provider-era getAcpModel -> resolveMcpServersFromDisk (packages/acp/src/index.ts:534), deleted in TASK-80.6 (a6fb2ca). parseMcpServers / resolveMcpServers / parseMcpCatalog now have zero production callers, only packages/acp/test/mcp-catalog.test.ts. Consequence: no user-configured MCP server reaches any agent session, and assistant/sensei.md:165 claims the jlpt-vocab tools are attached. So per-server env must be built on top of restoring that leg, otherwise AC#3 cannot pass on a dead path.

STEPS
1. packages/acp/src/mcp.ts: RequestedMcpServer gains env?: Record<string, string>. toMcpServer folds it to a name-sorted EnvVariable[] in the stdio branch (the ACP McpServerStdio already carries env: Array<EnvVariable>, so no new wire encoding). http/sse have no env field on the ACP type: warn-skip the map there, keep the server attached.
2. Literal grammar: optional trailing suffix on each entry, id:transport:target|KEY=VAL;KEY2=VAL2 (pipe reserved; = and ; forbidden inside values, which keeps targets with spaces/colons working). Malformed pair -> warn and drop only that pair, never the server (same never-throw rule).
3. Catalog: McpCatalogServer gains optional env object of string->string; isMcpCatalog validates key shape and string values, parseMcpCatalog keeps the invalid-file-whole-reject behaviour. resolveMcpServers stops stripping anything but enabled.
4. apps/desktop/src-tauri/src/mcp.rs: McpCatalogServer.env as Option<HashMap<String,String>> with serde default + skip_serializing_if, same key validation in validate_catalog/upsert, and resolve_acp_mcp_servers renders the |K=V;K2=V2 suffix so the catalog path survives the Rust -> literal -> TS round-trip. Rust unit tests for round-trip + rejection.
5. apps/server/src/context.ts: mcpServers: parseMcpServers(env.ACP_MCP_SERVERS) — restores the deleted leg. Tauri already folds the catalog into the literal, so no file read on the server side.
6. Tests: extend packages/acp/test/mcp-catalog.test.ts (literal env parse, malformed-pair degradation, toMcpServer EnvVariable ordering + content, http/sse warn-drop, catalog env validation).
7. AC#3 live proof: real agent session with two stdio servers, jlpt-vocab carrying JLPT_MCP_DEBUG=1 -> 18 tools for it, the other server keeps its own env. Needs an installed agent CLI; if the live run is blocked, report that instead of claiming it.
8. DOX: packages/acp/AGENTS.md (grammar + the apps/server consumer), crates/jlpt-mcp/AGENTS.md (replace the export-it-in-the-agents-environment note for the TASK-93 gate with the per-server env syntax), apps/desktop/src-tauri/AGENTS.md (mcp.rs env round-trip), apps/server/AGENTS.md (restored leg).

OUT OF SCOPE: the npx @manobu/jlpt-mcp publish and the file-watching fan-out from TASK-23.14; http/sse env (no such field on the ACP type).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation notes (2026-09-21)

Scope grew by one restored leg, per the plan's FINDING: apps/server/src/context.ts now parses env.ACP_MCP_SERVERS once (parseMcpServers from @manobu/acp/mcp) and passes it as ensureAcp's mcpServers. Without it the literal was write-only since TASK-80.6 (a6fb2ca deleted the provider-era resolveMcpServersFromDisk) and AC#3 was unreachable.

Wire: the ACP McpServerStdio type already carries env: Array<EnvVariable>, so nothing new was encoded. toMcpServer emits a name-sorted EnvVariable[] in the stdio branch; for http/sse (no env on the ACP type) it warn-drops the map and keeps the server attached.

Literal grammar: id:transport:target|KEY=VAL;KEY2=VAL2. Pipe chosen because ':' and ',' are already structural and targets contain both. A malformed pair warn-drops just that pair (never-throw rule). Values reject '|', ';' and control characters, which is what would let one value forge a second entry; implemented as an isIllegalEnvValue predicate in TS and char::is_control in Rust rather than a control-char regex (Biome noControlCharactersInRegex).

Catalog: McpCatalogServer.env?: Record<string,string>; isMcpCatalog validates it; one bad env voids the whole file (same rule as the rest of the catalog). Rust side mirrors the key regex and renders the suffix in resolve_acp_mcp_servers via render_entry, sorted, omitted when empty, so the legacy entry shape is byte-identical for servers without env.

Verification:
- packages/acp: bun test 94 pass; tsc --noEmit clean; ultracite clean.
- apps/server: typecheck clean; boots on a hostile literal with only the designed warnings.
- crates/jlpt-mcp Rust: cargo test --lib mcp:: 6/6 (suffix render, legacy shape, catalog render, key rejection, forged-entry rejection, bad-env catalog voids).
- Session-level pin: new fake-agent dumpMcpServers script field; test/session.test.ts asserts the child's verbatim session/new payload equals [{args:[],command:"/bin/jlpt-mcp",env:[{name:"JLPT_MCP_DEBUG",value:"1"}],name:"jlpt-vocab"}].
- AC#3 live proof against real opencode acp: jlpt child env had JLPT_MCP_DEBUG=1 and no PROBE_MARKER; the second stdio child had PROBE_MARKER=only-mine and no JLPT_MCP_DEBUG (per-child isolation via /proc/<pid>/environ), and the jlpt child's tools/list reported 18 tools (16 + the 2 debug-only).
- bun run smoke:mcp (MANOBU_SMOKE_AGENT=opencode) exit 0: 3/3 turns PASS with real jlpt-mcp child spawns observed, the first since TASK-80.6.

Docs: packages/acp/AGENTS.md (grammar + the consumer leg + the dumpMcpServers pin), crates/jlpt-mcp/AGENTS.md (TASK-93 gate now enabled from the app this way), apps/desktop/src-tauri/AGENTS.md (mcp.rs round-trip), apps/server/AGENTS.md (restored leg, do-not-re-sever note).

Correction to the verification list above: the 6 Rust tests live in apps/desktop/src-tauri (src/mcp.rs), not crates/jlpt-mcp. Confirmed with 'cargo test mcp::' in apps/desktop/src-tauri: 6 passed, 0 failed. Re-confirmed at finalization: bun test packages/acp 94 pass / 0 fail, tsc --noEmit clean for packages/acp and apps/server.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
MCP servers can now carry a per-server env map, and the config leg that delivers it is no longer dead.

What changed:
- packages/acp/src/mcp.ts: RequestedMcpServer.env?: Record<string,string>; the literal accepts a trailing suffix id:transport:target|KEY=VAL;KEY2=VAL2; toMcpServer folds env into the ACP McpServerStdio env list as name-sorted EnvVariable[] (no new wire encoding); http/sse warn-drop the map and keep the server. Malformed pairs warn-drop individually; the catalog validator accepts an env object and voids the file on a bad entry, matching the existing never-throw rule.
- apps/server/src/context.ts: parses env.ACP_MCP_SERVERS once and passes it as ensureAcp's mcpServers, replacing the hardcoded [] that made the literal write-only since TASK-80.6. This is the bug the task's premise hid: no configured MCP server reached any agent session while assistant/sensei.md claims the jlpt-vocab tools are attached.
- apps/desktop/src-tauri/src/mcp.rs: catalog entries carry env (serde default + skip_serializing_if), validated with the same key/value rules, and resolve_acp_mcp_servers renders the suffix so the Tauri -> literal -> TS round-trip keeps it. Entries without env render byte-identical to before.
- Tests: 7 new cases in packages/acp/test/mcp-catalog.test.ts, a new session/new wire assertion in test/session.test.ts backed by a dumpMcpServers field on the fake agent, and 6 Rust tests in src-tauri.
- DOX: packages/acp/AGENTS.md (grammar, the consumer leg, the wire pin), crates/jlpt-mcp/AGENTS.md (TASK-93 debug gate now enabled per-server from the app), apps/desktop/src-tauri/AGENTS.md (round-trip), apps/server/AGENTS.md (restored leg, do-not-re-sever).

Verification: bun test packages/acp 94/94; tsc --noEmit clean for packages/acp and apps/server; cargo test mcp:: in apps/desktop/src-tauri 6/6; ultracite clean. AC#3 proved live against real opencode acp with two stdio servers: /proc/<pid>/environ shows the jlpt child with JLPT_MCP_DEBUG=1 and no PROBE_MARKER, the other child with PROBE_MARKER=only-mine and no JLPT_MCP_DEBUG, and the jlpt child's tools/list at 18 tools (16 + 2 debug-only). bun run smoke:mcp (opencode) exit 0, 3/3 turns PASS with real jlpt-mcp child spawns observed for the first time since TASK-80.6.
<!-- SECTION:FINAL_SUMMARY:END -->
