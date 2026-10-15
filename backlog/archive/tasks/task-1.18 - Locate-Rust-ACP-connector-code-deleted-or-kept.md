---
id: TASK-1.18
title: Locate Rust ACP connector code (deleted or kept)
status: To Do
assignee:
  - '@arif'
created_date: '2026-09-05 02:55'
labels: []
dependencies: []
references:
  - 2b6d2677aa4cda5c8c6448ad6d0655cd4584d608
  - 27c531f067e8546ff6b0766a9ac43a08cf451fc9
  - 286f3ea1fb0465b82a54675914f2d64b9417e3d1
parent_task_id: TASK-1
priority: high
type: spike
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User asked where the Rust ACP connector lives. Findings:

**Current state: there is no Rust ACP code in the working tree.** The only Rust crate is `crates/jlpt-mcp` (JLPT stdio MCP server, not ACP).

**Historical state (now removed):**
- `2b6d267` (Jul 31 2026) — `feat(tauri): ship ACP session lifecycle (#12)` — added Rust ACP session lifecycle in `apps/desktop/src-tauri/src/lib.rs` (AgentName gateway, opaque SessionId, AgentSessions map, kill+reap via tokio::select!), Cargo.toml stub_acp_agent binary, `tests/fixtures/stub_acp_agent/src/main.rs` (JSON-RPC responder), `tests/session_lifecycle.rs` (4 cargo tests passing).
- `27c531f` (Jul 31 2026) — `feat(src-tauri): ACP streaming events (#15)` — `send_prompt` command emitting AcpEvent {tokens, tool-calls, permission, done, error} over `tauri::Channel`, tokio LocalSet + spawn_local, fixed stub agent frames to ACP tagged schema, `tests/streaming_events.rs`.
- `286f3ea` (Aug 6 2026) — `refactor(tauri): scope to v1 single-binary; drop ACP test fixtures` — **deleted** `tests/fixtures/stub_acp_agent/`, `tests/session_lifecycle.rs`, `tests/streaming_events.rs`; stripped lib.rs to just v1 builder + log plugin + sidecar boot; followed the plan in `research/japanese-teacher-agent-architecture.md` §10.

**Replacement:** the ACP connector now lives in TypeScript at `packages/acp/` using `@mcpc-tech/acp-ai-provider`. The Rust side only wires `ACP_MCP_SERVERS=jlpt-vocab:stdio:<jlpt-mcp>` env so the TS agent can spawn the JLPT MCP sidecar (see `apps/desktop/src-tauri/src/lib.rs`).

**Acceptance:**
1. Decide whether to revive the Rust ACP code (carry #12 + #15 forward from history) or keep the current TS-only architecture.
2. If revive: cherry-pick `2b6d267` + `27c531f` onto a feature branch, reconcile with the post-`286f3ea` lib.rs shape, re-add tests, and bump `apps/desktop/src-tauri/Cargo.toml` to include the `agent-client-protocol` crate + tokio deps.
3. If keep TS: drop this task once confirmed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Confirm the user'\''s intent: revive the deleted #12 + #15 Rust ACP work, or keep the current TS-only ACP bridge at packages/acp/
- [ ] #2 If revive: identify the cleanest cherry-pick path (2b6d267 + 27c531f onto a feature branch)
- [ ] #3 If revive: reconcile lib.rs against post-286f3ea shape (builder + log + sidecar boot + fsrs + speech commands)
- [ ] #4 Update root AGENTS.md or apps/desktop/src-tauri/AGENTS.md to make the current ACP architecture unambiguous so future askers don'\''t have to dig through history
<!-- AC:END -->
