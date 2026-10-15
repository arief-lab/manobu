---
id: TASK-106
title: 'Chat: transcripts truncate at 200 frames with no way back to older turns'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-22 05:28'
updated_date: '2026-09-23 12:24'
labels: []
dependencies:
  - TASK-101
priority: low
type: feature
ordinal: 785000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The read path is built and never crossed. chat.subscribe takes one connect-time history window hard-clamped to 200 rows (apps/server/src/chat-rpc.ts:217 via the clamp at apps/server/src/chat-store.ts:212), and the keyset cursor that would walk further back exists end to end on the server side: chat-store.ts:207 accepts before, the contract declares it (packages/api-contract/src/chat.ts:186) and the handler passes it through (chat-rpc.ts:491), but no client ever sends it. Older turns sit in user.db unreachable, so a long-running study conversation silently loses its beginning. The dev.chat-history route mounts the same provider and hits the same window, so it is not a deep-traversal path either. Distinct from the uncapped localStorage blob: that is about write size, this is about turns the learner cannot get back to.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The chat surface can page back past the initial 200-frame window to reach older turns
- [x] #2 Paging uses the existing before cursor rather than a client-side offset
- [x] #3 Repeated paging reaches the first turn of a conversation with no gaps and no duplicated rows
- [x] #4 The live stream and the paged history cannot interleave out of order while paging
- [x] #5 A test covers paging a transcript longer than the replay window
- [x] #6 packages/chat-session/AGENTS.md records how the older-history path relates to the connect-time replay
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Page the learner back past the connect-time 200-row window using the server's existing keyset (before = row id, chat-store.listMessages, lt(id) desc-limit-reverse; contract chat.ts listMessages). Research facts: /ai gets page 1 via messageHistoryQueryOptions (ai.tsx ~595) and renders mergeTranscript(cardsFromRows(rows), chat.messages) (~599); subscribe's connect-time replay clamps at 200 (chat-rpc.ts:233); rows are ascending-within-page with strictly-lt ids, so a before-chain is gap- and dup-free; card dedupe already lives in mergeTranscript.

1. packages/chat-session/src/history.ts:
   a. cardsFromRows carries the lifecycle status for acp_permission rows too (line 136 is ask-only; TASK-109 extended the wire carry but this DB-fold path was missed, so expired parks still render tappable in /ai and dev.chat-history).
   b. Pure primitives: OLDER_PAGE_SIZE=200 (server max clamp), oldestRowId(rows), fetchOlderPage(conversationId, before) via orpc.chat.listMessages (NOT_FOUND -> []), flattenOlderPages(olderPages, pageOne) (olderPages newest-page-first as fetched; output strictly ascending by id).
   c. useOlderHistory(conversationId, pageOne): React state of fetched pages + hasMore + loading; cursor = oldest id of flattenOlderPages; loadOlder() no-ops while loading/exhausted; a full page keeps hasMore, a short page ends paging; resets when conversationId changes. Export from the package (history module is a deep path, ai.tsx imports @manobu/chat-session/history).
2. apps/desktop/src/routes/ai.tsx: transcript = mergeTranscript(cardsFromRows(older.rows), chat.messages); a 'Load older messages' button above <MessageTranscript> when hasMore, disabled while loading, hidden when exhausted.
3. Ordering invariant (AC#4): rows persisted after connect have ids ABOVE page 1, never matched by any older page (strict lt); live cards arrive through mergeTranscript which appends live-only after the persisted fold, so prepending older pages cannot interleave.
4. Tests: apps/server chat-history.test.ts (or a new chat-paging.test.ts) walks a 205-row conversation through the store keyset to the first turn (no gaps/dups, ascending) AND through the real /rpc surface (bootChatServer harness): page 1 + before-page == same rows. chat-session history.test.ts: permission status carry through cardsFromRows; oldestRowId/flatten primitives; mergeTranscript(older+page1, live) order.
5. Docs: packages/chat-session/AGENTS.md records the older-history path vs connect-time replay (AC#6); apps/server note only if anything contract-side changed (it does not).
6. Scope note: dev.chat-history keeps its single window (route is a dev viewer); live-turn subscription untouched.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: packages/chat-session/src/history.ts gained OLDER_PAGE_SIZE/oldestRowId/flattenOlderPages/useOlderHistory (keyset walk via chat.listMessages before-cursor, short page ends paging, NOT_FOUND = nothing older, conv-keyed lazy reset); ai.tsx renders a 'Load older messages' outline button above <MessageTranscript> (disabled while loading, hidden when exhausted) and folds mergeTranscript(cardsFromRows(older.rows), chat.messages). Folded-in fix (disclosed, plan step 1a): cardsFromRows now carries lifecycle status for acp_permission rows too (TASK-109 parity with toWireFrame). Tests: apps/server/test/chat-older-paging.test.ts 3 pass/802 assertions (260-row store walk to first turn no gaps/dups; same walk over the real /rpc surface; rows persisted after the opening page never appear in older pages); chat-session history.test.ts 18 pass/26 assertions (permission status carry, non-parked families stay statusless, oldestRowId cursor, flatten walks 260 rows back, multiple pages oldest-first, older+window fold AHEAD of live-only cards, OLDER_PAGE_SIZE pinned to the server cap). Full suites: server 110 pass/1 skip/0 fail; chat-session 227 pass/0 fail. tsc clean (server typecheck, chat-session noEmit); apps/desktop check-types (vite build + tsc) clean; ultracite check clean on all touched files.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-22 05:29
---
Ordered after TASK-101: both need the chat client to call chat.listMessages for the first time (history list and paging back share that one seam), so doing them together avoids building the same client read path twice.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Older turns are reachable: the /ai transcript can page back past the newest-200 window to the first turn through the server's existing keyset (before = oldest held row id), gap- and dup-free by the strict-lt chain, and incapable of interleaving with the live stream because rows persisted after opening sit above the window's ids. History.ts exposes OLDER_PAGE_SIZE, oldestRowId, flattenOlderPages and useOlderHistory; apps/desktop/src/routes/ai.tsx adds the 'Load older messages' button and folds the walked transcript. Proven by test/chat-older-paging.test.ts (store + /rpc surface on a 260-row conversation) and the chat-session paging-primitive tests; both AGENTS.md files record the path's relation to the connect-time replay (AC#6).
<!-- SECTION:FINAL_SUMMARY:END -->
