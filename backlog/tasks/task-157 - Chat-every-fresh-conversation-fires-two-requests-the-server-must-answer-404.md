---
id: TASK-157
title: 'Chat: every fresh conversation fires two requests the server must answer 404'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 08:27'
updated_date: '2026-09-28 11:06'
labels:
  - chat
  - desktop
dependencies: []
priority: medium
type: bug
ordinal: 922000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
QA walk 2026-09-28: opening /ai with no conversation selected produced two 404s before the learner typed anything. Both handlers exist and are registered; the 404s are the procedures own declared NOT_FOUND (packages/api-contract/src/chat.ts:349 and :369), thrown at apps/server/src/chat-rpc.ts:715 for listMessages and apps/server/src/chat-rpc.ts:727 for slashCommands.

Two separate gates are missing:
- `slashCommandsQueryOptions` (packages/chat-session/src/fetcher.tsx:158) has no `enabled` field at all, and the Provider calls it unconditionally with the id it minted (packages/chat-session/src/provider.tsx:118). A session id exists only after the first chat.send, so this request can never succeed on a fresh conversation.
- `messageHistoryQueryOptions` (packages/chat-session/src/history.ts:78) gates on `conversationId.length > 0`, which is true for a client-minted UUID: provider.tsx:109-110 falls through to `resolveConversationId`, which returns `crypto.randomUUID()` (packages/chat-session/src/provider-initial.ts:36). The server has never heard of that id. The route search param is optional (apps/desktop/src/routes/ai.tsx:65 `c: z.string().min(1).optional().catch(undefined)`), so undefined is available at the call site.

The comment at packages/chat-session/src/fetcher.tsx:152-156 documents the *degradation* of NOT_FOUND to `[]` with `retry: 0`. It does not say the request must go out, and nothing pins it. House convention for a required param already exists in this codebase: `enabled: Boolean(agentId)` at fetcher.tsx:71 and `enabled: submitted && examId.length > 0` at apps/desktop/src/lib/exam-queries.ts:63.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A fresh /ai with no conversation produces zero listMessages and zero slashCommands network requests, verified in the browser network log
- [x] #2 Both queries gate on a conversation the server actually knows, not on a string length that a client-minted UUID satisfies
- [x] #3 The gate follows the existing convention (enabled in queryOptions) rather than a new mechanism
- [x] #4 The degrade-to-empty path stays intact for a conversation that exists but has no rows or no session yet
- [x] #5 The two server 404s remain the declared behavior for a genuinely unknown conversation, so this task removes the calls, not the error contract
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

Both reads ask the server about a conversation id the client invented. The server's own predicate for "I know this conversation" is a stored ACP session id or stored rows (apps/server/src/chat-rpc.ts:714, :726), and neither exists until the first chat.send. The minted UUID (packages/chat-session/src/provider-initial.ts:36, reached from provider.tsx:109) satisfies neither, so both calls are answered NOT_FOUND before the learner types a word.

## The signal (AC#2)

`conversationKnown`, derived in the Provider from evidence the server holds this conversation:
- open?.conversationId === conversationId: the route loader awaited chat.getConversation for that id before mounting (apps/desktop/src/routes/ai.tsx:217, apps/desktop/src/routes/exam/$examId.tsx:51), OR
- the engine card list is non-empty: every card came from the server (connect-time replay of stored rows, a live frame) or from the persisted transcript of a conversation that already had a turn.

A minted id with no turn satisfies neither, so both reads stay disabled. "It was in the blob" is NOT a signal and is not used: persistChat (provider.tsx:191) writes the minted id on mount, so a never-used id is indistinguishable by shape.

## Changes

1. packages/chat-session/src/provider.tsx: compute conversationKnown, feed useSlashCommands(conversationId, conversationKnown), expose it on meta.
2. packages/chat-session/src/chat-session-contract.ts: add `conversationKnown: boolean` to ChatSessionMeta.
3. packages/chat-session/src/fetcher.tsx: slashCommandsQueryOptions(conversationId, known) gains `enabled: known`; useSlashCommands takes the same flag. Comment records that the request must not go out for an unknown conversation.
4. packages/chat-session/src/history.ts: messageHistoryQueryOptions becomes an object arg { before, conversationId, known } (repo rule: object args; a required param after an optional one is a trap), `enabled: known` replaces `conversationId.length > 0`.
5. Call sites: features/chat/chat-column.tsx:231, routes/ai.tsx:223 and :565, routes/exam/$examId.tsx:54, routes/dev.chat-history.tsx:36. The two loader-warmed reads pass known: true (the loader confirmed the row).
6. Tests: `enabled` pins for both factories (unknown -> false, known -> true) and the Provider derivation (minted id -> false, open seed -> true, one card -> true).
7. Mutation gate: two seams reverting each gate to the old always-true test; the new assertions must catch them.

## Left alone

- The server NOT_FOUND contract (AC#5) and both client degrade-to-empty paths (AC#4).
- One honest 404 window remains: the snapshot fetch that fires when the FIRST card lands can beat setUserAcpSessionId (apps/server/src/context.ts:368, inside runTurn after the ack). That is the "no session yet" case the bare catch already covers, and the live available_commands overlay carries the menu.
- useOlderHistory.loadOlder direct listMessages call: it only runs when the client already holds rows.
- Agent/persona switch keeps the same conversationId (provider.tsx:228, :312): out of scope.

## Verify

- bun test packages/chat-session and apps/desktop
- bun scripts/mutation-gate.ts --check plus the two new seams by id
- bun x ultracite check on touched files; bun run check:dox
- AC#1 in a real browser: fresh /ai on a clean profile, network log shows zero listMessages and zero slashCommands calls; send one message, confirm both calls then go out and answer.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned. The signal is `resolveConversationKnown` (packages/chat-session/src/provider-initial.ts), and it accepts only the server's own two claims: the route loader confirmed the id (`open`), or the engine holds a card (replay / live frame / persisted transcript). Deliberately rejected signals: the id's length or UUID shape, and the blob (persistChat writes the minted id on mount, so a never-used id is indistinguishable).

`messageHistoryQueryOptions` became an object arg { before, conversationId, known } because a required param after an optional one is a trap, and `messageHistoryQueryKey` was extracted so the paper-landing invalidation in routes/ai.tsx does not have to answer a gate it is not gating.

Hook order in provider.tsx moved: `useSlashCommands` now sits below `useChatEngine` because the gate reads `messages`. `authoritativeVersionRef` seeds at 0; frames can only arrive from a subscription that starts after these effects, so the version-gating semantics are unchanged.

Left intact by design: the server NOT_FOUND contract, both client degrade-to-empty paths, and the honest first-send race (the snapshot fetch can beat setUserAcpSessionId).

Validation: chat-session 263 pass / 0 fail; apps/desktop 493 pass / 3 skip / 0 fail; `bun run check-types` 14/14; `bun scripts/mutation-gate.ts --check` all 34 anchors resolve; the 3 new seams (chat-history-reads-unconfirmed-conversation, chat-slash-snapshot-reads-unconfirmed-conversation, chat-conversation-known-everything) all CAUGHT; `bun x ultracite check` clean on the 14 touched files; `bun run check:dox` complete.

Browser evidence (Vite :3001 + sidecar :4317, driven with playwright/chromium):
- AC#1: fresh /ai on a cleared profile minted 7352d420-... and fired 0 listMessages and 0 slashCommands (only the two catalog reads). Screenshot shows the empty state, no spinner.
- AC#2 positive path: /ai?c=e7414045-... (a stored conversation with an acp_session_id) fired both reads and both returned HTTP 200; the transcript replayed the stored turns.
- First-send race: sending on a fresh conversation produced 0 reads before the send and 2 after, listMessages 200 / slashCommands 404 in the session-creation window, exactly the documented case.
- AC#4: typing "/" in a session-backed conversation renders the real command menu (/ai-copywriter, /antislop, /cloudflare, ...), so the gate does not starve the menu.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A fresh /ai no longer asks the server about a conversation id the client invented. The Provider derives `conversationKnown` from the server's own evidence (a loader-confirmed `open`, or a card that arrived from replay / a live frame / a persisted transcript) and passes it to both gated reads, which now carry `enabled` in their queryOptions: `slashCommandsQueryOptions(conversationId, known)` and `messageHistoryQueryOptions({ conversationId, known, before })`. The server's NOT_FOUND contract and both client degrade-to-empty paths are unchanged; this removed calls, not errors.

Verified in a real browser: fresh /ai fires 0 listMessages and 0 slashCommands (was 2 x 404); a stored conversation fires both and gets 200, with the transcript replayed and the "/" menu populated. Pinned by provider-initial.test.ts, fetcher.test.ts and history.test.ts, and made load-bearing by 3 mutation-gate seams (all CAUGHT). chat-session 263/0, desktop 493/0, check-types 14/14, ultracite clean, check:dox complete.
<!-- SECTION:FINAL_SUMMARY:END -->
