---
id: TASK-80.8
title: >-
  80.8 oRPC v2 remediation: WS link filter, safe() errors, duplicate link +
  dead-export cleanup, dead files contract field
status: Done
assignee:
  - '@arif'
created_date: '2026-09-17 16:21'
updated_date: '2026-09-18 05:26'
labels:
  - ai-chat
  - orpc
  - backend
dependencies:
  - TASK-80.5
references:
  - 'https://orpc.dev/docs/rpc/handler'
  - 'https://orpc.dev/docs/client/error-handling'
parent_task_id: TASK-80
priority: medium
type: feature
ordinal: 162500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-80.x oRPC audit (2026-09-17, post-80.5 slice 1) found the 80.2-80.5 wiring mostly oRPC-v2 compliant (contract-first oc builders, typed errors, AsyncIteratorObject streaming, withEventMeta/lastEventId resume, real-socket tests) but with concrete deviations to fix before the 80.6 cutover. Scope: server link exposure + WS client typing (apps/server/src/server-runtime.ts, packages/chat-session/src/orpc.ts), client error handling (packages/chat-session/src/fetcher.tsx), dead code (orpc.ts chatWsClient export, api-contract chat.ts files field + PromptFileSchema), and the pre-oRPC residual transport (apps/desktop/src/lib/cron-dispatch.ts). Evidence: full audit report attached in the notes of the created task; each AC names the exact file:line.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 WsRPCHandler mounts the full router on /ws; restrict it to the live-turn chat procedures via the handler filter option so persisted-state writes (cards.create/grade, learn.nextCards, acp.*) are NOT reachable over any WS connection. apps/server/src/server-runtime.ts:37
- [x] #2 chatWsClient stops being typed as the full ContractClient: derive a narrow chat client type (Pick over chat.* procedures) so the WS link cannot be used for non-chat procedures. packages/chat-session/src/orpc.ts:71
- [x] #3 Delete the dead eager export 'export const chatWsClient = getChatWsClient()' (zero importers; all consumers already call getChatWsClient()). packages/chat-session/src/orpc.ts:71
- [x] #4 fetcher.tsx model/agent/persona queryFns stop swallowing ALL errors into empty catalogs: use orpc 'safe'/isDefinedError so a typed NOT_FOUND from acp.agents.models (contract index.ts:80) is distinguishable from a network failure (only the network-failure path falls back to the empty catalog). packages/chat-session/src/fetcher.tsx:19,37,58
- [x] #5 The PromptFileSchema files field on chat.send (api-contract/src/chat.ts) is dropped by runTurn (chat-rpc.ts:140-148 maps messages to text-only blocks): either wire files through controller.prompt as ACP file/resource blocks OR delete the dead field from the contract + the chat.send input schema. No dead contract fields remain.
- [x] #6 cron-dispatch.ts posts raw fetch(serverUrl()/ai) (line 40) but the /ai Hono route no longer exists on the server (80.2 retired streamText; grep confirms zero /ai matches in apps/server/src): migrate the dispatch to the oRPC fetch-link chat.send procedure (or the WS link) and remove the raw-fetch transport. apps/desktop/src/lib/cron-dispatch.ts:33-55
- [x] #7 Single implementer: chat-rpc.ts createChatHandlers no longer calls implement(contract) itself (currently chat-rpc.ts:72 + rpc.ts:46 both do); rpc.ts owns the one implement(contract).$context builder and hands it (or its handler factory) to createChatHandlers, preserving the ChatDeps DI seam for tests. apps/server/src/rpc.ts:46, apps/server/src/chat-rpc.ts:71-75
- [x] #8 setConfigOption stops mapping ALL controller.configOptions failures to NOT_FOUND (chat-rpc.ts:429): declare a distinct typed error code in the api-contract chat contract for 'config switch failed' and throw it for switch failures; NOT_FOUND stays reserved for no-session/no-live-handle cases. packages/api-contract/src/chat.ts:215-235, apps/server/src/chat-rpc.ts:408-435
- [x] #9 The duplicate fetch RPCLink config is consolidated: apps/desktop/src/lib/orpc.ts (lines 16-23, byte-identical link to packages/chat-session/src/orpc.ts:19-28) is replaced by one shared link factory (desktop re-exports chat-session's client or both import a common factory) so the sidecar URL lives in one place. The three desktop callers (sensei.ts:18, next-cards.ts:3, kanji.ts:20) keep working with identical behavior.
- [x] #10 Vestigial '"ai"' catalog dependency removed from apps/server/package.json:26 (grep confirms zero from "ai" imports in apps/server/src; 80.2 retired streamText).
- [x] #11 Undelivered test claims backfilled: an e2e test exercises chat.listConfirmations (recovery payload rebuild, chat-rpc.ts:345-360) and the 80.2 AC#5 'procedure logic via in-process call/createRouterClient' has at least one real in-process test for a chat handler (grep of apps/server/test finds zero call(/createRouterClient use today).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. api-contract (AC#5, AC#8): delete the dead files field - remove PromptFileSchema + files from PromptMessageSchema (runTurn drops it; AionUi prompt-file injection stays an unported feature). Add CONFIG_SWITCH_FAILED to chatErrors + setConfigOption .errors; keep NOT_FOUND for no-session/no-live-handle. 2. Server handlers (AC#7, AC#8): single implementer - rpc.ts owns the one implement(contract).$$context builder and hands it to createChatHandlers(deps, os); chat-rpc stops calling implement. setConfigOption's controller.configOptions catch throws CONFIG_SWITCH_FAILED (data = message). 3. WsRPCHandler filter (AC#1): server-runtime.ts mounts new WsRPCHandler(router, { filter }) allowing only the live-turn chat procedures (send, subscribe, confirm, answerAsk, cancel, killTerminal, listConfirmations); cards/learn/acp/chat-persisted procedures reject over WS. 4. Desktop links (AC#6, AC#9): cron-dispatch.ts dispatchOne migrates from raw fetch(serverUrl()/ai) to the oRPC fetch link orpc.chat.send (stable cron-${job.id} conversation when the job carries none; ack = success, error = false). lib/orpc.ts becomes a one-line re-export of @manobu/chat-session/orpc (add the ./orpc subpath to chat-session's package.json) so the sidecar URL lives in one place; the 3 desktop callers keep identical behavior. 5. chat-session orpc.ts (AC#2, AC#3): narrow the WS client to Pick<ContractClient, 'chat'> so the link cannot reach non-chat procedures; delete the dead eager chatWsClient export (zero importers - re-verify with grep before deleting). 6. fetcher.tsx (AC#4): model/agent/persona queryFns switch to safe() + isDefinedError - a typed error is a server-answered state: resolve (no retry, warn-logged) so a NOT_FOUND model catalog caches; an undefined (network) error is re-thrown so TanStack retry:2 applies and the empty fallback happens ONLY on the network path. slashCommands queryFn stays NOT_FOUND-tolerant as designed. 7. apps/server package.json (AC#10): drop the vestigial 'ai' dependency (grep confirms zero imports). 8. Tests (AC#11): chat-e2e gains a listConfirmations recovery-payload case (fake agent parks permission + ask; ws.chat.listConfirmations returns both); new in-process test file uses call()/createRouterClient from @orpc/server against createRpcHandlers's router with the fake controller (chat.slashCommands NOT_FOUND on a fresh conversation + one success path). Verify each slice: tsc per package, affected bun test files, then full: 3x check-types + 3x bun test + ultracite 0 + fallow audit (pre-push).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT EVIDENCE (2026-09-17, three read-only scout audits of the 80.2->80.5 oRPC surface against skill://orpc + skill://orpc-contract, @orpc@2.0.0-beta.35):
ARCHITECTURE VERIFIED: one oc contract (packages/api-contract) -> implement(contract) -> one router -> TWO handlers on the same router: fetch RPCHandler at /rpc (index.ts:167) + WsRPCHandler at /ws (server-runtime.ts:37). Streaming = oRPC-native AsyncIteratorObject(ChatFrameSchema) + withEventMeta(seq) + lastEventId resume (chat-persistence.ts, use-chat-engine.ts:103-111). No parallel hand-rolled WS protocol. Contract-first: zero server-only procedures; every proc has .input/.output/.errors.
CONFIRMED COMPLIANT: typed errors.NOT_FOUND/CONVERSATION_BUSY with data; $context<ChatContext> + per-link context injection; getEventMeta/lastEventId; TanStack manual integration; 80.3 zero AI-SDK residue; harness boots production startSidecar with real oRPC links.
FINDINGS (all wired into ACs): (1 MED) WsRPCHandler serves the FULL router on /ws - cards.create/grade FSRS writes reachable over any WS (loopback-mitigated); plan 80.2 step 3 'filter if desired' was never executed. (2 MED) fetcher.tsx:19/37/58 bare-catch swallows typed NOT_FOUND from acp.agents.models; safe/isDefinedError unused repo-wide. (3 MED) cron-dispatch.ts:40 raw-fetches /ai which no longer exists server-side (pre-oRPC residue, HIGH risk). (4 MED) chat.slashCommands 404s before a session exists (gated on ensureAcp's storedSessionId, context.ts:164) - the 80.5 data feed MUST tolerate the typed NOT_FOUND on a fresh conversation. (5) dead files contract field: chat.send PromptFileSchema dropped by runTurn (chat-rpc.ts:140-148). (6) double implement(contract) (rpc.ts:46 + chat-rpc.ts:72). (7) setConfigOption maps all failures to NOT_FOUND (chat-rpc.ts:429). (8) duplicate fetch-link config desktop vs chat-session. (9) dead eager chatWsClient export (orpc.ts:71, zero importers). (10) vestigial 'ai' dep in server package.json. (11) 80.2 AC#5 in-process call/createRouterClient tests + listConfirmations e2e never delivered.
REFUTED: 'WS client opens socket at import' - WsRPCLink is lazy without connectOnInit and all consumers use getChatWsClient().
AIONUI PARITY: 80.1/80.2/80.3/80.4/80.4.1/80.7 ported (native ACP engine, session/load resume, terminal hosting, ask_user MCP, IResponseMessage envelope, cards, atomic seq). Invented (not AionUi): lastEventId staleness gate shouldApplyOverlay (slash.ts:147), terminal-lane last-writer-wins coalescing (chat-hub.ts:20-35), deterministic card ids (deliberate improvement). NOT yet ported: prompt-file injection at send edge (this task's files-field AC), skills as a slash source (no owning task - 80.5 type SlashCommandSource='skill' is a placeholder), multi-conversation history UI + desktop cutover (80.6 To Do).

VALIDATION 2026-09-18: server chat-e2e 10/10 pass (8 pre-existing + new AC#11 e2e listConfirmations-over-/ws + new in-process createRouterClient slashCommands NOT_FOUND/live test). ultracite check = 0 errors (the AC#9 orpc.ts re-export is a documented noBarrelFile biome-ignore; the new poll loop carries one documented noAwaitInLoops biome-ignore). tsc clean: apps/server (typecheck), packages/chat-session, packages/api-contract, apps/desktop. chat-session suite 103/103. DOX updated in apps/server, packages/chat-session, apps/desktop AGENTS.md (WS LIVE_TURN filter + single implementer + CONFIG_SWITCH_FAILED; the ./orpc export map + safe()/isDefinedError fetcher contract; the orpc.ts/cron-dispatch.ts lib entries).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
oRPC v2 remediation of the 80.2->80.5 chat surface, all 11 ACs. AC#1: /ws WsRPCHandler now filters to LIVE_TURN_PROCEDURES (the 7 live-turn chat procs), so no WS connection reaches the persisted-state surface. AC#2+3: the WS client is a narrow Pick<ContractClient,'chat'> (ChatWsClient); the dead eager chatWsClient export is gone, callers use getChatWsClient(). AC#4: fetcher.tsx agent/persona/model queryFns use safe()+isDefinedError - a typed NOT_FOUND resolves the empty catalog, only a network error rethrows for retry. AC#5: the dead PromptFileSchema/files field is off the chat.send input (AionUi prompt-file injection is an unported feature, noted in the contract). AC#6: cron-dispatch.ts drops the retired POST /ai raw-fetch transport and dispatches via the oRPC fetch-link chat.send. AC#7: rpc.ts owns the single implement(contract) and hands its chat builder to createChatHandlers (the DI ChatDeps seam is preserved; a lazy standalone builder keeps the no-implementer default). AC#8: setConfigOption throws typed CONFIG_SWITCH_FAILED for agent-rejected switches, NOT_FOUND stays for no-session/no-live-handle. AC#9: apps/desktop lib/orpc.ts is a documented single-symbol re-export of @manobu/chat-session/orpc's client - the sidecar URL lives in one place. AC#10: the vestigial ai catalog dep is off apps/server. AC#11: a real e2e exercises chat.listConfirmations over /ws (recovery payload rebuild + clear on settle), and an in-process createRouterClient test covers chat.slashCommands (typed NOT_FOUND on a fresh conversation, live commands once a session exists) - the first in-process handler tests in the repo. Verified: chat-e2e 10/10, chat-session 103/103, ultracite 0 errors, tsc clean across server/chat-session/api-contract/desktop. DOX updated in the three AGENTS.md files.
<!-- SECTION:FINAL_SUMMARY:END -->
