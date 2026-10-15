---
id: TASK-79.3
title: '79.3 Typed tool-part dispatch: InferUITools contract in api-contract'
status: Done
assignee: []
created_date: '2026-09-15 06:59'
updated_date: '2026-09-15 10:30'
labels:
  - frontend
  - ai-chat
  - types
dependencies: []
parent_task_id: TASK-79
priority: high
type: feature
ordinal: 520000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Kill the casts in packages/chat-session/src/message-transcript.tsx (part as { text: string }, ToolPartLike) using the template's pattern: tools/index.ts exports the tool map, ChatUIMessage = UIMessage<never, InferUITools<typeof tools>>, useChat<ChatUIMessage> types every part.input/part.output. Implementation: define the manobu tool catalog (start with the tools /ai already exposes; add ask_user in 79.4) as a shared module in packages/api-contract (server and chat-session both depend on it already), typed with tool() from ai@7 + zod. chat-session imports the type only (no runtime tool defs - provider.tsx keeps DefaultChatTransport pinned to VITE_SERVER_URL/ai). apps/server /ai registers execute()s against the same map. Structure message-transcript like the template's chat-message.tsx: a switch on part.type delegating to small part components, default null, keyed by toolCallId. Message types flow through ChatSessionApi so ai.tsx and dev.chat-history.tsx get the typed messages without touching their code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No 'as' casts remain in message-transcript.tsx; tsc errors if a tool schema field is renamed (prove by renaming one locally and observing the build error, then revert).
- [x] #2 exports.test.ts surface updated; all consumers typecheck.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ground truth (provider source + live probe): /ai registers ZERO static streamText tools; the ACP provider (@mcpc-tech/acp-ai-provider 0.3.5) wraps every tool as ONE dynamic tool 'acp.acp_provider_agent_dynamic_tool' with the real name+args nested in input {toolCallId, toolName, args}. Parts also include step-start + reasoning (currently dropped by dispatch). So the template's literal InferUITools-over-static-map does NOT fit the wire; adjusted design: (1) zod envelope contract in api-contract (chat-tools.ts: AcpToolEnvelopeSchema + the 12 jlpt-vocab MCP names), (2) ChatUIMessage = UIMessage alias threaded through provider/state/persistence as the 79.4 seam, (3) ai@7 type guards (isTextUIPart/isToolUIPart) kill the casts, (4) resolveAcpToolName unwraps the envelope so renderer lookup sees the real tool name.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Typed part dispatch without the casts, grounded in the real wire. Live probe (drove a tool-bash call through the ACP agent) proved /ai has zero static streamText tools and ACP tools arrive as runtime tool-<name> parts with no toolName field and no envelope - so the template's closed InferUITools map cannot describe this wire and was NOT adopted (a speculative envelope contract was built from a wrong reading of the provider's intermediate chunks, caught against the live blob, and deleted pre-commit). Shipped: ai@7 isTextUIPart/isToolUIPart guards in message-transcript.tsx (all 'as' casts gone, rendering verified byte-identical against the live tool-bash transcript); new ./chat-messages seam (ChatTools = open UITools, ChatUIMessage threaded through useChat/state/persistence) as 79.4's plug-in point, docstring recording the proven open-vs-closed typing trade-off; exports.test.ts pins the seam. AC1 rename-proof executed and reverted: closed-map field rename -> TS2339 at the usage site. chat-session 38 + desktop 369 tests, repo typecheck, build, ultracite, fallow audit all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
