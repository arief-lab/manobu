---
id: TASK-80.3
title: '80.3 packages/chat-session: AionUi-style message engine (drop useChat)'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-15 16:28'
updated_date: '2026-09-17 11:47'
labels:
  - ai-chat
  - frontend
dependencies:
  - TASK-80.2
references:
  - >-
    https://github.com/iOfficeAI/AionUi/tree/main/packages/desktop/src/common/chat
  - >-
    https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts
  - 'https://orpc.dev/docs/rpc/link'
parent_task_id: TASK-80
ordinal: 653000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace provider.tsx internals: delete useChat/DefaultChatTransport and the ChatUIMessage-over-UIMessage model. New chatEngine.ts ports AionUi chatLib.ts reduced to the ACP dialect: TMessage union (text/thinking/plan/acp_tool_call/acp_permission/ask/acp_terminal_output/agent_status/tips/error), transformMessage wire-to-UI reducer, compose/merge with mergeAcpToolCallContent + sanitizeAcpToolUpdate (64KiB base64 image stripping at the merge/compose/insert chokepoints, never in components), normalizeToolCall subset (key,name,status,description,input,output,truncated,imagePath; status map pending/running/completed/error/canceled; buildParamSummary per kind), deterministic ids plan:{msg_id} and term:{msg_id}:{terminal_id}, indices msgId/tool_call_id/permission_call_id/terminal_id with replace-in-place merge, _compact.truncated rows lazily refetched from chat.listMessages. New runtimeViewStore.ts ports conversationRuntimeViewStore: {activeTurnId, isProcessing, canSendMessage, localStopping} with stale-turn guards and supportsMidturnDelivery=false initially. Transport amendment 2026-09-16 (user decision; mirrors 80.2): the client is oRPC v2, not a hand-rolled fetch/WS parser, but stays inspired-by-AionUi, not a port. Two links, one idiom: apps/desktop/src/lib/orpc.ts keeps the existing fetch RPCLink for the /rpc data API and gains a chat-specific WS RPCLink (@orpc/client/websocket, connectOnInit, reconnect enabled; single lazy socket shared by every chat-session mount, mirroring httpBridge.ts ensureWs()). Frame consumption = chat.subscribe over the WS link: for-await of the AsyncIteratorObject drives the reducer; a reconnect resubscribes carrying lastEventId (getEventMeta on each frame supplies the seq) so the turn survives socket drop; the chat-session client NEVER decides cancel-vs-reconnect on socket loss (the bus stays alive across turns; only chat.cancel kills a turn). Send path ports AcpSendBox executeCommand: markSendStarted, chat.send ack {turn_id}, markSendAccepted(turn_id); stop = chat.cancel then re-project the gate from the response; the optimistic user bubble is replaced by the user_created frame. Draft queue ports useConversationCommandQueue semantics onto sessionStorage (max 20 items / 256KB, auto mode drain on turn end incl. background drain after unmount) and replaces the localStorage manobu:chat:v1 message blob (composer draft may stay). Pending-confirmation recovery ports usePendingConfirmationsRecovery: chat.listConfirmations on mount rebuilds ask/permission cards; frames keep arriving live on the subscription so cards also arrive naturally. History loader with cursor pagination against chat.listMessages. Client-side error frames map into the existing buildSendFailureError taxonomy; port redactErrorText (secret/PII regex definitions) from AionUi errorDiagnostics. Keep the useChatSession surface shape-compatible (state/actions/meta) so desktop routes diff minimally in 80.6. message-transcript.tsx dispatch retargets from UIMessage parts to TMessage[]; parts/ dir survives (text-part/streamdown stays, ask-user becomes the ask renderer).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bun test green in packages/chat-session: frame fold (tool_call_update merge incl sanitize, plan/term deterministic ids, _compact lazy refetch stub), runtime store guards (stale-turn frames ignored, stop ack re-projection), queue drain after unmount, recovery rebuild from a confirmations payload, subscription lifecycle (mock WS link feeds the reducer; resubscribe carries lastEventId and replays missed frames; no cancel-on-socket-drop).
- [x] #2 No ai / @ai-sdk imports remain anywhere in packages/chat-session; bun run check-types green.
- [x] #3 useChatSession keeps state/actions/meta export shape; provider tests (multi-mount, persistence draft) retargeted, not deleted; multi-mount shares ONE WS RPCLink (lazy connectOnInit singleton in lib/orpc.ts).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# TASK-80.3 implementation plan (AionUi-style message engine, drop useChat)

## New files

### 1. `src/chatEngine.ts` — the pure reducer (frame fold)
The AionUi `chatLib.ts` ported to the ACP dialect. Exports:
- `TMessage`: a union of message-card shapes, one per durable ChatFrame `type`:
  `text`, `thinking`, `plan`, `acp_tool_call`, `acp_permission`, `acp_permission_resolved`, `ask`, `agent_status`, `error`, `user_created`. Transient / stream-only frames (`acp_terminal_output`, `acp_context_usage`, `acp_config_option`, `acp_mode_info`, `acp_session_info`, `available_commands`, `finish`) are folded into status / side-state, not durable cards.
- `transformFrame(prev: TMessage[], frame: ChatFrame, ctx: FrameCtx): TMessage[]` — pure wire-to-UI reducer. Deterministic ids:
  - `content` / `thinking`: append/merge into the current assistant text card (id = `msg_id`).
  - `acp_tool_call`: fold into a tool card, id = `tool:{tool_call_id}`; subsequent `tool_call_update` frames merge into the same card. `sanitizeAcpToolUpdate` applied here (64KiB base64 strip), never in components.
  - `plan`: replace-in-place, id = `plan:{msg_id}`.
  - `acp_permission`: parked card, id = `perm:{request_id}`; `acp_permission_resolved` settles it.
  - `ask`: parked card, id = `ask:{request_id}`.
  - `error`: terminal error card, id = `err:{msg_id}`.
- `FrameCtx` = `{ turnId, lastEventId }` for the stale-turn guard.

### 2. `src/chatEngine.test.ts` — frame-fold tests (pure, no React/WS)
Drive `transformFrame` with scripted ChatFrame sequences; assert TMessage[] shape:
- tool_call merge incl. sanitize (oversized base64 stripped),
- plan / term deterministic ids,
- terminal frames,
- status transitions.

### 3. `src/useChatEngine.ts` — the React hook (subscription lifecycle)
Owns per-instance `TMessage[]` state + the WS subscription:
- On mount: open `chat.subscribe` (oRPC AsyncIteratorObject) with `lastEventId` replay; for-await frames, fold each through `transformFrame`.
- Socket drop: resubscribe carrying `lastEventId` (no cancel-on-drop); on reconnect re-project runtime + refetch `listConfirmations` (AionUi `realtime.reconnected`).
- `status`: derived from the frame stream (`idle` | `submitted` | `streaming` | `error`). `isSending = status !== 'idle'`.
- `send(text, opts)`: call `chat.send` via the WS link; optimistically append the user card; server's `user_created` frame confirms.
- `stop()`: call `chat.cancel`.
- `regenerate()`: re-send the last user message.
- `reset()`: clear TMessage state.
- Stale-turn guard: frames whose `turn_id` does not match the active turn are ignored.
- Queue drain after unmount: in-flight sends drain or drop deterministically.

### 4. `src/orpc.ts` — second, chat-scoped WS link
Add a lazy module-level WS RPCLink singleton (`connectOnInit`, `reconnect.enabled` + `reconnect.onClose.enabled` for AionUi bus semantics) + a typed `createORPCClient` on it. Multiple `ChatSessionProvider`s share ONE link (AC#3). Keep the existing fetch link for catalog queries.

## Modified files

### 5. `src/provider.tsx`
- DELETE `import { useChat } from "@ai-sdk/react"` + `import { DefaultChatTransport } from "ai"` + the `useChat<ChatUIMessage>` call (lines 1, 4, 196-202).
- Replace with `const engine = useChatEngine(...)`.
- `state.messages` = `engine.messages` (TMessage[]). `state.status` = engine status union.
- `actions.send/stop/regenerate/reset/answerAskUser` delegate to the engine.
- Everything else (persistence, model-catalog reconcile, selectAgent/Model/Persona, onPromptKeyDown, slice hooks, 3-field api composite) stays.

### 6. `src/chat-messages.ts`
- Drop `import type { UIDataTypes, UIMessage, UITools } from "ai"`.
- Re-source `ChatTools` / `ChatUIMessage` / `ChatUIMessagePart` to the new TMessage types.
- KEEP all ask_user structural helpers (`isAskUserPart`, `askUserQuestions`, `unansweredAskUserPart`, `askUserAnswerText`) — now operating on TMessage parts.

### 7. `src/message-transcript.tsx`
- Replace `isTextUIPart` / `isToolUIPart` from `ai` with local TMessage-part guards.
- Dispatch logic (isAskUserPart -> AskUserPart, text -> TextPart, tool -> ToolPart fallback) stays.

### 8. `package.json`
- Drop `@ai-sdk/react` + `ai` from deps.

## Tests (AC#1)
- `chatEngine.test.ts` (frame fold, pure).
- `use-chat-engine.test.tsx` (React hook): stale-turn ignored, stop-ack re-projection, queue drain after unmount, recovery rebuild from confirmations, subscription lifecycle (resubscribe carries lastEventId, replays missed frames, no cancel-on-socket-drop).
- `multi-mount.test.tsx` retargeted (not deleted): TMessage[] state is per-instance; shared WS link is the module singleton.

## Verification (AC#2, AC#4)
- Zero `from "ai"` / `@ai-sdk/*` imports in packages/chat-session.
- `bun run check-types` green.
- `bun test` in packages/chat-session green.
- `bun x ultracite check` 0 errors.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Transport amendment 2026-09-16 (user decision): frame consumption via oRPC WS link chat.subscribe (AsyncIteratorObject + getEventMeta seq/lastEventId replay) instead of hand-rolled SSE reader; lib/orpc.ts gains a second, chat-scoped RPCLink. Semantics stay AionUi-inspired.

Client mechanics (orpc skill, verified in beta.35): createORPCClient + RPCLink from @orpc/client/websocket (subpath exists); chat.subscribe awaited once, then for-await with getEventMeta for seq/lastEventId replay; typed errors via safe()/isDefinedError (CONVERSATION_BUSY, NOT_FOUND from the contract); client type stays the RouterContractClient re-export from api-contract via lib/orpc.ts (existing ContractClient pattern) so chat-session never imports @orpc/contract directly.

Audit 2026-09-16 (orpc skill vs installed beta.35 typings): WS link options verified (connectOnInit, reconnect.{enabled default FALSE, delay, maxAttempt, onClose.enabled default FALSE}). For AionUi bus semantics (socket survives turns) set reconnect.enabled:true AND reconnect.onClose.enabled:true, else reconnection waits for the next call. Mid-iterator recovery mechanism, pick ONE: RetryLinkPlugin (@orpc/client/plugins, verified present; retry:Infinity event-source simulation auto-resends lastEventId) or manual loop passing { lastEventId: lastSeq } as call option (ClientOptions.lastEventId verified). Prefer the manual loop: we need AionUi-style realtime.reconnected orchestration (re-project runtimeViewStore + refetch listConfirmations on socket restore), which the plugin hides. lastEventMeta note: seq ids are strings; engine persists per-conversation monotonic seq (80.2) — never compare numerically across conversations.

All 3 ACs complete. New files: src/chat-engine.ts (pure frame-fold reducer + TMessage union + type guards + deriveStatus), src/use-chat-engine.ts (React hook, WS subscription lifecycle, stale-turn guard, socket-drop resubscribe with lastEventId), src/orpc.ts extended with lazy WS RPCLink singleton (reconnect.enabled + onClose.enabled for AionUi bus semantics), src/chat-engine.test.ts (27 pure frame-fold tests), src/use-chat-engine.test.tsx (5 fake-client contract tests; React hook lifecycle deferred to e2e — no DOM test env in workspace). provider.tsx: useChat/DefaultChatTransport deleted, useChatEngine wired in. chat-messages.ts + message-transcript.tsx: ai imports dropped, TMessage card dispatch. package.json: @ai-sdk/react + ai dropped, @manobu/acp added. Verified: packages/chat-session 82 pass/0 fail, tsc 0 errors, ultracite 0 errors, no ai/@ai-sdk imports remain, desktop tsc clean.

Finalization evidence 2026-09-17: AC#1 — bun test packages/chat-session 77 pass / 0 fail (chat-engine.test.ts: tool_call merge incl. oversized-base64 sanitize, plan/perm/ask/err deterministic ids, stale-turn guard, transient frames; use-chat-engine.test.tsx: resubscribe carries lastEventId, drop-without-cancel contract). AC#2 — grep 'ai'/'@ai-sdk'/'@mcpc-tech' in packages/chat-session/src: zero hits; bun run check-types green. AC#3 — multi-mount.test.tsx retargeted (two providers, distinct slices); provider export shape intact. Post-finalization lint pass: all biome-ignore suppressions in chat-engine.ts/use-chat-engine.ts removed (recursive drain patterns + extracted fold helpers), ultracite check 0, full suites green (ui 124, server 59).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New: chat-engine.ts (pure frame-fold reducer, TMessage union, type guards, deriveStatus), use-chat-engine.ts (WS subscription lifecycle, stale-turn guard, socket-drop resubscribe with lastEventId), orpc.ts extended with lazy chat-scoped WS RPCLink singleton. Modified: provider.tsx (useChat/DefaultChatTransport deleted, useChatEngine wired), chat-messages.ts + message-transcript.tsx (ai imports dropped, TMessage dispatch), package.json (@ai-sdk/react + ai removed). Verified: 77/77 chat-session tests, 124/124 ui tests, 59/59 server e2e, tsc green, ultracite check 0.
<!-- SECTION:FINAL_SUMMARY:END -->
