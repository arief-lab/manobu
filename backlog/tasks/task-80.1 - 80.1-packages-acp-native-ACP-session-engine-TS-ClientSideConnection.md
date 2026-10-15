---
id: TASK-80.1
title: '80.1 packages/acp: native ACP session engine (TS ClientSideConnection)'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-15 16:27'
updated_date: '2026-09-16 04:52'
labels:
  - ai-chat
  - backend
dependencies: []
references:
  - >-
    https://github.com/iOfficeAI/AionCore/tree/main/crates/aionui-ai-agent/src/protocol
  - >-
    https://github.com/iOfficeAI/AionCore/blob/main/crates/aionui-session/src/backend/acp_conn.rs
  - >-
    https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/common/types/platform/acpTypes.ts
parent_task_id: TASK-80
ordinal: 655000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build AcpSession (new module replacing index.ts model layer) using @agentclientprotocol/sdk ClientSideConnection over child-process stdio, keeping registry.ts/launch-policy.ts/mcp.ts as the spawn/config layer. Mirror aioncore semantics: initialize (caps terminal:true, fs:false), session/new with mcpServers from mcp.ts resolve (this is where jlpt-mcp is served), session/load resume with replay-suppression guard, session/prompt with stopReason-to-terminal-event mapping + usage extraction, session/cancel notification, session/set_mode + session/set_config_option; inbound: session/update translation to a typed AcpStreamEvent union exactly matching the AionUi frame vocabulary (text/thinking/plan/acp_tool_call with dual-case rawOutput sanitize/acp_permission/available_commands/usage/config_option/agent_status), session/request_permission parked as a pending Confirmation keyed by tool_call_id until confirm(), terminal/create|output|wait_for_exit|kill|release backed by Bun.spawn process + cumulative output buffer, per-child health (process liveness + stream-failure marking, replaces watchAcpModelHealth). @agentclientprotocol/sdk: pin ^0.21.1 (already in the lockfile); if a needed verb is missing there, try 1.4.0; if neither has it, hand-roll the raw JSON-RPC frame for that verb (aioncore's SDK-free acp_conn.rs proves the wire is simple) and never fork the SDK.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bun test in packages/acp green with a scripted fake ACP agent (node stdio stub) covering: handshake, prompt then streamed updates then result, cancel mid-prompt, permission park + confirm resolves the prompt, tool_call_update merge incl >64KiB base64 image sanitize (result_omitted/result_bytes/image synth), replay suppression during session/load, terminal create/kill, health eviction on child death
- [x] #2 SessionController exports exactly: ensureSession(spec, opts), prompt(session, {content, files}, sink), cancel(sessionId, turnId), confirm(callId, optionId), answerAsk(requestId, payload), killTerminal(id), configOptions, dispose
- [x] #3 No ai / @ai-sdk / @mcpc-tech imports anywhere in the new module; existing registry/launch-policy/mcp/conversation-guard tests untouched and green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pin @agentclientprotocol/sdk ^0.21.1 in packages/acp (stable closeSession/setSessionConfigOption/setSessionMode; listSessions/resumeSession promoted; all AcpStreamEvent source verbs present, no 1.4.0 needed, no hand-rolled frames; provider's 0.14.1 stays isolated until 80.6 deletion).
2. New src/session.ts: SessionController with AC#2 surface exactly - ensureSession(spec, opts) (spawn via applyLaunchPolicy CommandSpec + Bun.stdio + ndJsonStream ClientSideConnection; initialize {protocolVersion:1, clientCapabilities terminal:true fs:false + clientInfo}, mcp.ts negotiate + toMcpServer, session/new or session/load with replay-suppression guard during load, post-open model/mode apply), prompt(session, {content, files}, sink) (ContentBlock mapping gated on promptCapabilities; one turn at a time, AIONUI_CONVERSATION_BUSY on overlap; stopReason-to-turn_end mapping + terminal usage extraction), cancel(sessionId, turnId) (session/cancel notification, turn-guarded, auto-answers parked permissions cancelled), confirm(callId, optionId) (real offered-optionId echo with kind fallback allow_always>allow_once / reject_once>reject_always, else cancelled), answerAsk(requestId, payload) (resolve parked host-MCP ask), configOptions(handle, patch?) (get + setSessionConfigOption, setSessionMode fallback for mode), killTerminal(id), dispose().
3. Inbound Client callbacks: sessionUpdate -> typed AcpStreamEvent union (text/thinking/plan/acp_tool_call with dual-case rawOutput sanitize + 64KiB base64 image strip/acp_permission/ask/available_commands/usage/config_option/mode_update/agent_status/terminal_output/turn_end/error); requestPermission parks Confirmation keyed by tool_call_id; terminal/create|output|wait_for_exit|kill|release backed by Bun.spawn + cumulative poll-output buffer; unhandled reverse RPCs methodNotFound by SDK.
4. New src/host-mcp.ts: hand-rolled MCP streamable-HTTP server (127.0.0.1 ephemeral port, bearer token) hosting ask_user; blocking tools/call emits ask event on the active turn sink, resolves via answerAsk, decline = deny text result, configurable host timeout; stdio bridge child (process.execPath -e inline forwarder) for agents without mcpCapabilities.http.
5. Per-child health: process liveness (exit/ESRCH) + stream-failure marking replacing watchAcpModelHealth; status changes surface via agent_status events + onHealthChange opt.
6. package.json exports ./session (./host-mcp); index.ts provider-era layer untouched (80.2 rewires consumers, 80.6 deletes).
7. test/fake-agent.ts scripted env-driven ACP agent + test/session.test.ts: handshake, prompt-stream-result, cancel mid-prompt, permission park+confirm, tool_call_update merge + 64KiB sanitize + dual-case, replay suppression on load, terminal create/kill, health eviction on child death, ask park+answer round trip; run full packages/acp suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as split modules (review feedback: no god-file): session.ts (SessionController, AC#2 surface exactly), session-types.ts (AcpSessionHandle + option/result shapes), session-normalize.ts (pure wire folds), session-terminals.ts (TerminalRegistry), session-translator.ts (session/update -> AcpStreamEvent, string-keyed A1 doctrine), acp-events.ts (frame union + dual-case/64KiB sanitize shared with 80.3). SDK pinned ^0.21.1 (stable closeSession/set_config_option/set_session_mode; provider's 0.14.1 stays isolated until 80.6). Host MCP ask_user server deferred to 80.2 (advisory: it is owned and e2e-tested there); parkAsk()/answerAsk() parking + cancel force-reject live in 80.1 per AC#2. Validation: bun test packages/acp = 65 pass / 0 fail (12 new engine tests via real-spawn fake ACP agent covering handshake, prompt stream+usage, cancel mid-prompt, permission park+confirm echo, tool sanitize + dual-case unit, load replay suppression, terminal create/kill, ask park/answer/decline/cancel, child-death health eviction, config-option normalization); bun run check-types green repo-wide (13 workspaces); biome clean on all new files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Native ACP session engine in packages/acp: SessionController speaks NDJSON JSON-RPC over child stdio via @agentclientprotocol/sdk ClientSideConnection (zero AI SDK in the new modules). initialize caps terminal:true/fs:false; session/new attaches negotiated MCP servers; session/load resumes under replay suppression; prompt terminal = stopReason response with usage extraction; cancel = bare notification + parked-permission force-cancel; request_permission parks by toolCallId with aioncore REAL-optionId echo; terminal/* hosted with cumulative snapshot frames; asks park via parkAsk and resolve via answerAsk (host MCP ask_user server lands in 80.2). Verified: 12 real-spawn fake-agent tests + registry/launch-policy/mcp suites green (65 pass), repo-wide typecheck + biome clean.
<!-- SECTION:FINAL_SUMMARY:END -->
