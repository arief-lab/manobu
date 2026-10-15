---
id: TASK-80.11
title: >-
  80.9.2 Add errorStatusMap entries for the custom chat error codes on the fetch
  /rpc handler
status: Done
assignee:
  - '@arif'
created_date: '2026-09-18 05:44'
updated_date: '2026-09-18 11:41'
labels:
  - orpc
  - ai-chat
  - backend
dependencies:
  - TASK-80.8
documentation:
  - 'https://orpc.dev/docs/rpc/handler'
parent_task_id: TASK-80
priority: low
type: enhancement
ordinal: 689000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-80.8's oRPC docs gap audit (2026-09-18, vs orpc.dev/docs/rpc/handler 'Custom Error Response') found the second genuine gap: the default COMMON_ERROR_STATUS_MAP maps NOT_FOUND->404 but has NO entry for our custom codes CONVERSATION_BUSY and CONFIG_SWITCH_FAILED (declared in packages/api-contract chatErrors). On the fetch /rpc link (apps/server's unfiltered RPCHandler), both codes fall through to DEFAULT_ERROR_STATUS (500). oRPC clients decode errors in-band so this is harmless today (Tauri talks loopback to the sidecar, no gateway reads the status), but a CDN/gateway, a res.ok check, or a plain fetch caller would read 'the agent rejected the model switch' as a server error. Fix per the doc: pass one errorStatusMap to the fetch RPCHandler (extend COMMON_ERROR_STATUS_MAP, do not replace it) with CONVERSATION_BUSY -> 409 CONFLICT and CONFIG_SWITCH_FAILED -> 400 BAD_REQUEST (the agent rejected a legal switch: a client-input failure, not a server failure). The /ws WsRPCHandler stays as-is (HTTP status semantics do not apply to the WS link; its filter already drops persisted-state procs).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The fetch RPCHandler (apps/server, wherever the /rpc handler is constructed) passes an errorStatusMap that spreads COMMON_ERROR_STATUS_MAP and adds CONVERSATION_BUSY: 409 and CONFIG_SWITCH_FAILED: 400
- [x] #2 A failing chat.send (busy) over /rpc yields a 409 response status and a failing chat.setConfigOption (agent-rejected switch) yields 400; verify with a direct fetch or an existing test seam; NOT_FOUND still 404
- [x] #3 The /ws handler is untouched; chat-e2e + ultracite + tsc stay clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. index.ts: pass an errorStatusMap option to the production fetch RPCHandler (new RPCHandler(createRpcHandlers(), { errorStatusMap })) spreading COMMON_ERROR_STATUS_MAP + CONVERSATION_BUSY:409 + CONFIG_SWITCH_FAILED:400 (NOT_FOUND 404 already in COMMON map, left as-is). 2. e2e (chat-e2e.test.ts in-process router-client block + a direct fetch against the running test server's /rpc): assert busy chat.send -> 409, agent-rejected setConfigOption -> 400, NOT_FOUND -> 404 unchanged; extend the fake controller configOptions to expose a reject path so a switch can fail. 3. Confirm the /ws handler is untouched; chat-e2e + tsc + ultracite stay clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VALIDATION 2026-09-18: chatErrorStatusMap in src/rpc.ts (COMMON_ERROR_STATUS_MAP + CONVERSATION_BUSY:409 + CONFIG_SWITCH_FAILED:400) wired into both fetch RPCHandler sites (src/index.ts + test/harness.ts); new FakeAgent.rejectConfigOption seam; e2e case '80.11: /rpc maps the chat error codes to 409 / 400 / 404 over HTTP' asserts raw-fetch statuses (404 slashCommands no-session; 409 second send on parked turn; 400 rejected setConfigOption + body cross-check CONFIG_SWITCH_FAILED). chat-e2e 12/12, tsc typecheck clean, chat-session 103/103, ultracite 0 fixes. /ws untouched (server-runtime.ts unmodified).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
FETCH /rpc RPCHandler now passes chatErrorStatusMap (src/rpc.ts export spread over COMMON_ERROR_STATUS_MAP with CONVERSATION_BUSY:409 and CONFIG_SWITCH_FAILED:400) at both construction sites (src/index.ts + test/harness.ts); FakeAgent.rejectConfigOption seam + a direct-fetch e2e case prove 409/400/404 over real HTTP; /ws unchanged. Verified: chat-e2e 12 pass, tsc clean, chat-session 103 pass, ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
