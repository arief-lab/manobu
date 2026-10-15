---
id: TASK-107
title: >-
  Chat: persist the learner's prompt so opened transcripts are complete and
  titles have a durable source
status: Done
assignee:
  - '@arif'
created_date: '2026-09-23 03:14'
updated_date: '2026-09-23 07:23'
labels:
  - chat
  - backend
dependencies:
  - TASK-108
priority: medium
type: feature
ordinal: 822000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on the TASK-101 live drive. The messages table persists only agent-emitted frames (chat-persistence sinkFor); the learner prompt is never written, so a stored conversation holds no user turns. Consequences: (1) an opened chat has no learner turns to show even once it renders from the database; (2) conversations created before TASK-101 have a NULL title and no stored prompt to backfill from, so the history desk shows Untitled chat for all of them and deriveTitle only names chats from TASK-101 forward, from the send-time request body. Persisting the prompt closes the transcript-completeness half and gives titles a durable source. The rendering half (an opened transcript reading stored rows through cardsFromRows instead of the live WS replay) is split into TASK-108, which ships first; this task depends on it. Related: TASK-84 (chat.subscribe restart stream-close decision), TASK-106/85 (200-frame replay cap), TASK-105 (stranded tool card).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The learner prompt is persisted as a message row for every turn, and chat.listMessages returns the user turns interleaved with agent frames in turn order
- [x] #2 Opening /ai?c=<id> shows the persisted learner turns alongside agent frames once TASK-108 makes the opened transcript read from the database, so the transcript is complete rather than agent-frames-only
- [x] #3 A conversation title can be derived from its first persisted prompt, and a backfill names existing rows that have one
- [x] #4 Rows with no recoverable prompt (created before prompt persistence) stay Untitled chat and remain renameable in the desk; the limitation is documented and no title is fabricated
- [x] #5 Server tests pin the persisted user frame and its replay order; the open-from-database render itself is covered by TASK-108
- [x] #6 DOX updated: apps/server and packages/chat-session AGENTS.md record the persisted user-frame contract; the apps/desktop database-render contract is recorded by TASK-108
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
GAP (verified in source): apps/server/src/chat-persistence.ts sinkFor persists only AcpStreamEvent (agent) frames; the learner prompt (chat-rpc.ts send input.messages) is never written. The client is already built for user turns: ChatFrameSchema has a `user_created` frame (packages/api-contract/src/schemas/chat-frames.ts:290), foldUserCreated keys the card `user:{msg_id}` (packages/chat-session/src/chat-engine/folds/simple.ts:70), cardsFromRows/mergeTranscript fold it on open (TASK-108), and history-desk.tsx:38 falls back to "Untitled chat" and is renameable. So TASK-107 is server-side only.

PLAN
1. AC#1 emit+persist the prompt (apps/server/src/chat-persistence.ts + chat-rpc.ts send):
   - New helper emitUserTurn(ctx, conversationId, turnId, msgId, text): build a user_created WireFrame (data {text}, replace true, msg_id=turn msgId, turn_id) -> publishFrame on the live ring (matches use-chat-engine.ts:332 "server's frame arrives live"), then await appendMessage({frameType "user_created", content {text}, msgId, turnId, status "finish"}). Await the write BEFORE runTurn starts so the user row's seq/id precede every agent frame of the turn (listMessages order = insertion id order).
   - Call it in the send handler (chat-rpc.ts ~409) after resetHub + sink creation, before runTurn. Skip an empty/whitespace prompt (nothing to show).
2. AC#3 title durable source + backfill:
   - Keep deriveTitle(input.messages[0].content) as the ensureConversation seed (that text IS the first persisted prompt now).
   - Add backfillConversationTitles() to chat-store.ts: for conversations with a NULL title, read their earliest user_created row, deriveTitle its text, set the title. Idempotent; conversations with no user row stay NULL (AC#4).
   - Invoke once at server boot next to applyContentMigrations (non-blocking).
3. AC#4: no fabrication (backfill only names rows that have a prompt); document the pre-persistence limitation in apps/server/AGENTS.md. Client "Untitled chat" + rename already satisfies the desk half.
4. AC#5 server tests (apps/server/test/chat-e2e.test.ts or a new chat-user-turn.test.ts): after a scripted send, assert listMessages returns the user_created row first then agent frames in turn order; assert the ack path emits user_created on the live ring.
5. AC#6 DOX: apps/server/AGENTS.md + packages/chat-session/AGENTS.md record the persisted user-frame contract.

VERIFY: bun run -F @manobu/server check-types; bun test apps/server/test/chat-*.test.ts; bun x ultracite check on touched files.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Server layer complete + verified. chat.send now persists/emits the learner prompt as a user_created frame via emitUserTurn (chat-persistence.ts), awaited before runTurn so the row precedes agent frames (turn-order transcript). deriveTitle moved to chat-store; backfillConversationTitles() runs once at boot to name null-title chats from their first prompt, skipping those with no user row (AC#4, no fabrication). Verification: apps/server 'bun run test' 99 pass / 1 skip / 0 fail (incl. new 'learner prompt persistence' + 'title backfill' tests); check-types clean; ultracite clean on the 6 touched files. AC#2 (opened /ai shows learner turns) is the desktop DB-render behavior: server now emits the data and TASK-108's cardsFromRows/mergeTranscript already fold user_created, but it is left UNCHECKED pending a live browser drive, not code presence.

AC#2 live drive (2026-09-23): booted the sidecar (:4317) + Vite (:3001), sent a real turn over the WS /ws link (agent agy) to persist a user_created row, rebooted to confirm the row survives on disk (local.db id 198). Proved DB-source isolation: read rows over the FETCH /rpc link (messageHistoryQueryOptions path, not the WS link) and folded through cardsFromRows -> a user: card {text:'TASK107-AC2-Kansai-dialect drill', position:'right'} appears; on open mergeOpenConversation clears the WS live cards, so the bubble is definitionally from the persisted row. Rendered /ai?c=<id> in headless Chromium: screenshot shows a right-aligned 'You' bubble with the prompt + header 'Continuing a saved conversation.' AC#2 verified by behavior, not code presence.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Persisted the learner prompt server-side (AC#1/#3/#4/#5): emitUserTurn stores + live-publishes a user_created frame ahead of each turn's agent frames; listMessages returns the transcript interleaved; titles derive from the first persisted prompt with a boot backfill, no-prompt chats stay Untitled/renameable (no fabrication). AC#2 verified by live drive: opening /ai?c=<id> in headless Chromium renders the persisted learner turn as a 'You' bubble sourced from the DB (cardsFromRows over the fetch /rpc link; WS live cards cleared on open). DOX updated in apps/server + packages/chat-session (AC#6).
<!-- SECTION:FINAL_SUMMARY:END -->
