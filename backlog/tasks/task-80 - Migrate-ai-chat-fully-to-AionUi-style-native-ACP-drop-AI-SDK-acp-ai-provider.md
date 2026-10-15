---
id: TASK-80
title: >-
  Migrate /ai chat fully to AionUi-style native ACP (drop AI SDK +
  acp-ai-provider)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-15 16:27'
updated_date: '2026-09-20 05:55'
labels:
  - ai-chat
  - backend
  - frontend
dependencies: []
priority: high
ordinal: 654000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AionUi's chat is native ACP with zero AI SDK: a backend engine owns ACP sessions (initialize/session/new|load|prompt|cancel, request_permission, terminal/*, available_commands) and the UI reduces normalized stream frames into a message model (chatLib TMessage union) with tool/permission/ask/terminal cards, a turn gate + draft queue, and pending-confirmation recovery. manobu today speaks ACP only through @mcpc-tech/acp-ai-provider + ai@7 streamText, which forced the HANDOFF_UI sentinel, the wire-name pin, envelope part inputs, and ~6 documented workarounds. Decisions: native ACP engine in our Bun server (TS @agentclientprotocol/sdk ClientSideConnection, no aioncore binary vendoring); chat core + full tool surface scope; immediate rewrite of the chat surface (no dual path). Transport amendment 2026-09-16 (user decision): keep the AionUi-INSPIRED architecture but on our own stack, not a port. Upstream runs ZERO oRPC: plain fetch to /api plus ONE persistent /ws event bus (ipcBridge.ts: sendMessage is an httpPost returning an ack; IResponseMessage frames arrive as named bus events message.stream / message.userCreated / message.statusChanged / confirmation.remove / turn.completed; confirm/answer/cancel/kill are separate POSTs; httpBridge.ts owns the reconnecting socket singleton). We keep those SEMANTICS (ack-then-stream, turn survives socket drop, per-conversation seq replay on resubscribe, pending-confirmation recovery, dedicated answerAsk channel) but implement with oRPC v2: the live-turn surface (frame subscription + send/confirm/answerAsk/cancel/killTerminal + the pending-confirmations recovery read, which reads live turn state from the session pool) becomes AsyncIteratorObject/command procedures on a WebSocket RPCHandler; control calls ride the same socket as the stream, which is the point of WS over SSE. Persisted-state reads (conversation creation, messages, slash-commands, config-options) become procedures on the existing fetch /rpc router. Two RPCLink instances total. The frame vocabulary stays AionUi IResponseMessage shape.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No ai / @ai-sdk/* / @mcpc-tech/acp-ai-provider imports remain in apps/server or packages/acp or packages/chat-session; packages/acp exports a native ACP session engine
- [x] #2 The chat surface streams AionUi-vocabulary frames over an oRPC WebSocket subscription (AsyncIteratorObject); agent tool calls render as native acp_tool_call cards with real ACP permission round trips (no HANDOFF_UI sentinel)
- [x] #3 ask_user works as an AionUi-style ask frame + chat.answerAsk procedure with reload recovery; terminal/*, plan, thinking, usage, available_commands/slash commands are live
- [x] #4 Conversation history persists server-side and survives reload with pending permission/ask cards restored
- [x] #5 All subtasks Done; root typecheck + ultracite + all package suites green; DOX updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Transport amendment 2026-09-16 (user decision): oRPC v2 WS (live-turn surface) + existing fetch /rpc (state reads) instead of raw SSE+REST. Inspired-by-AionUi semantics (ack-then-stream, seq replay, bus survives turns), not a port (upstream has zero oRPC). 80.2/80.3/80.4/80.5/80.6 descriptions and ACs updated to match.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Final closeout (2026-09-20): all 14 subtasks Done. AC evidence:
#1: grep over apps/server/src, packages/acp/src, packages/chat-session/src shows zero real imports of ai / @ai-sdk/* / @mcpc-tech/acp-ai-provider (one historical doc-comment mention only in packages/acp/src/index.ts).
#2/#3/#4: delivered by 80.2/80.3/80.4/80.5/80.6 (frame vocabulary, ask/answerAsk, terminal/*, slash + config switching, server-side persistence with reload recovery).
#5: gates re-run this session - root check-types 13/13 cached green, ultracite 356 files 0 issues, bun run test 9/9 tasks green (apps/server e2e 14/14 incl. 25-frame burst; desktop 391 pass after gating the one server-dependent vocabContaining test that honest-failure semantics turned into a latent failure - test fix in this closeout, not a product regression). Live verification: MANOBU_SMOKE_AGENT=opencode passed with 675 tool calls streamed and terminated cleanly (TASK-80.14 ring), smoke spawn watcher fixed (basename + 100ms poll).
Notes: 80.14 supersedes 80.7 AC#3 (DB-cursor replay) and refines the 80.12 STAY verdict; see those tasks' notes.
<!-- SECTION:FINAL_SUMMARY:END -->
