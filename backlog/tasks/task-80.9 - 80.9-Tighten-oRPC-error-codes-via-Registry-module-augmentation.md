---
id: TASK-80.9
title: 80.9 Tighten oRPC error codes via Registry module augmentation
status: Done
assignee:
  - '@arif'
created_date: '2026-09-18 05:41'
updated_date: '2026-09-18 06:37'
labels:
  - orpc
  - ai-chat
  - backend
dependencies:
  - TASK-80.8
documentation:
  - 'https://orpc.dev/docs/error-handling'
parent_task_id: TASK-80
priority: low
type: chore
ordinal: 687000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-80.8's oRPC docs gap audit noted the optional 'ORPC Error Codes' tightening: oRPC allows any string code by default. Module-augmenting the @orpc/server (or @orpc/client) Registry with our code set makes stray 'throw new ORPCError("WHATEVER")' calls lose compile-time support. Our codes: NOT_FOUND, CONVERSATION_BUSY, CONFIG_SWITCH_FAILED (chat), NOT_FOUND (cards/jap/learn/acp) plus any others in packages/api-contract. The audit (2026-09-18) also cataloged two genuine gaps this task does NOT cover: the /ws subscribe drain ignores the client abort signal (see sibling task on signal handling), and our custom codes lack errorStatusMap entries on the fetch RPCHandler.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Registry augmentation (declare module ORPCErrorCode) exists where our procedure codes are defined, listing NOT_FOUND, CONVERSATION_BUSY, CONFIG_SWITCH_FAILED plus the rest of the contract code set, with (string & {}) fallback kept
- [x] #2 A stray throw with an unlisted code is a type error in server packages; tsc clean across apps/server and packages/chat-session
- [x] #3 bun x ultracite check stays 0
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Augment the oRPC Registry in packages/api-contract/src/orpc-error-codes.d.ts: declare module '@orpc/client' with Registry.ORPCErrorCode = our 4 contract codes (NOT_FOUND, CONVERSATION_BUSY, CONFIG_SWITCH_FAILED, TOO_MANY_REQUESTS) + (string & {}) fallback; one home, next to the code owners. 2. Verify the consumer chain picks it up: api-contract, apps/server, packages/chat-session check-types all clean (the stray-code guard is global; a new code lands at its .errors() call site anyway). 3. Throwaway tsc proof that the augmentation took effect: with it, ORPCErrorCode rejects a stray literal ("WHATEVER") while accepting a listed one; without it, both pass. 4. ultracite check 0.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VALIDATION 2026-09-18: (1) augmentation in packages/api-contract/src/orpc-error-codes.ts, side-effect-imported from src/index.ts so it propagates to every consumer's typecheck program (a loose .d.ts would NOT reach consumers since the package ships source via exports . -> ./src/index.ts). Target module: @orpc/contract - in 2.0.0-beta.35 the global Registry is DECLARED in @orpc/shared but @orpc/contract re-exports the same symbol and is the only @orpc/* resolvable from api-contract; @orpc/server was not resolvable there (TS2307). No (string & {}) fallback per AC#2. (2) activation proof: throwaway probe in apps/server/test threw new ORPCError('NOT_FOUND', ...) (compiled) and new ORPCError('WHATEVER') (TS2345: not assignable to the 4-code union) - then probe deleted. (3) tsc clean: apps/server (typecheck), packages/api-contract, packages/chat-session, apps/desktop; ultracite check 0 errors (359 files).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Narrowed oRPC's ORPCErrorCode via a global Registry module augmentation living in packages/api-contract/src/orpc-error-codes.ts (the code owners), side-effect-imported from the contract index so it reaches every consumer's program. Target module is @orpc/contract (the re-exported @orpc/shared Registry symbol; @orpc/server is not resolvable from api-contract). Set: NOT_FOUND, CONVERSATION_BUSY, CONFIG_SWITCH_FAILED, TOO_MANY_REQUESTS, no (string & {}) fallback. Verified with a throwaway probe in apps/server (stray literal rejected TS2345, listed code compiles) plus tsc clean across server/api-contract/chat-session/desktop and ultracite 0.
<!-- SECTION:FINAL_SUMMARY:END -->
