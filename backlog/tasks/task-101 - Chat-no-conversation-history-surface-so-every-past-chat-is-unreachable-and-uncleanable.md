---
id: TASK-101
title: >-
  Chat: no conversation history surface, so every past chat is unreachable and
  uncleanable
status: Done
assignee:
  - '@arif'
created_date: '2026-09-22 05:06'
updated_date: '2026-09-22 17:52'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 788000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The server persists every conversation and message row in user.db, but nothing can ever list, open, rename or delete one, and the client stores a single conversation id. Pressing New Chat (packages/chat-session/src/provider.tsx:319 mints a fresh crypto.randomUUID and clears the persisted blob) orphans every earlier turn permanently: the rows stay in user.db, unreachable, with no way back for the learner and no way to clean them up. The persistence layer is half-built: apps/server/src/chat-store.ts has ensureConversation and listMessages but no list/rename/delete, and its final line (:358) is the doc comment "/** Delete a conversation and cascade its messages. */" with no function after it. The contract already declares the reads that would power a history UI (packages/api-contract/src/chat.ts:152 createConversation, :186 listMessages) and no client calls either one. AionUi has the full surface (list, rename modal, row menu, delete, fork, full-text search over messages) behind a grouped history sidebar. For a language-learning chat the learner revisiting an earlier explanation is the point, so this is a missing capability, not a polish item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The chat UI lists the learner past conversations and opening one replays that conversation persisted transcript
- [x] #2 Transcript replay reads from the database, not from the localStorage blob, so a conversation survives another device profile clearing its blob
- [x] #3 A conversation can be renamed and deleted, and deleting removes its message rows rather than hiding the row
- [x] #4 New Chat leaves the previous conversation reachable instead of orphaning it
- [x] #5 The history list is bounded (paginated or capped with an order) rather than loading every row a user may accumulate
- [x] #6 The already-declared contract procedures gain real callers, or dead contract surface is removed rather than left unreferenced
- [x] #7 Tests cover list, rename, cascade delete, and opening a conversation the client has never seen
- [x] #8 apps/server/AGENTS.md and packages/chat-session/AGENTS.md record the history contract and correct the single-shared-conversation framing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
MEASURED STARTING POINT (read in this session, not inferred):
- PREMISE CORRECTION 1: transcript replay is ALREADY database-backed. chat.subscribe (apps/server/src/chat-rpc.ts:197) does one connect-time history read - `const history = await listMessages(conversationId, { limit: 200 })` (chat-rpc.ts:217) - and yields every row as a `replace: true` frame before the live drain. The localStorage blob only pre-paints initialMessages. So AC#2 is met by the transport the moment the client can point at an existing id; the work is identity + listing, not replacing a blob replay with a DB read.
- PREMISE CORRECTION 2: `chat.createConversation` (packages/api-contract/src/chat.ts:152) and `chat.listMessages` (:186) are NOT dead contract surface on the server side - both are implemented (chat-rpc.ts:475, :491). What is missing is any client caller: grep shows neither is called from apps/desktop or packages/chat-session, and listMessages' only callers are apps/server tests.
- No list/rename/delete exists anywhere: chat-store.ts exports ensureConversation (:68), getUserAcpSessionId (:103), setUserAcpSessionId (:115), appendMessage (:156), listMessages (:207, keyset, limit clamped 1-200), listFramesAfter (:250), updateMessageByUiId (:273), settlePending (:305). Its last line (:358) is the orphaned `/** Delete a conversation and cascade its messages. */` with no function after it.
- Cascade is real: messages.conversationId is an FK with onDelete: "cascade" (packages/db/src/schema/user.ts:88-90, mirrored in migrations/0006_chat_conversations.sql:34) and the chat store's connection has foreign_keys ON (createUserDb -> applyPragmas, packages/db/src/index.ts:80-86, pragma at :47). It will be pinned by a test rather than trusted.
- Identity scoping is a non-issue: single-user local app, loopback-only server, conversations keyed by a client-generated UUID, no owner column, no procedure reads an identity.
- Two data gaps the list will expose: (a) chat.send never passes a title (chat-rpc.ts:354-357 -> ensureConversation writes title: null), so every row is untitled; (b) conversations.updatedAt is bumped only by setUserAcpSessionId, so it cannot order a history list by recency as it stands.
- Client identity: one conversationId in state (packages/chat-session/src/provider.tsx:91-93), seeded from the single blob key manobu:chat:v1 (persistence.ts:9, PersistedChat in types.ts:27-47), and New Chat mints a fresh UUID (provider.tsx:327-335). The persist effect (provider.tsx:154-174) always writes that one key, so opening an old conversation would clobber the current one unless the seed path is explicit.
- UI facts: no sidebar/AppShell exists (deleted; apps/desktop/src/routes/__root.tsx:36-39). packages/ui has dropdown-menu, empty, card, picker, tooltip, sonner but NO dialog/sheet/alert-dialog. Route search params are the house pattern (validateSearch in 10+ routes, e.g. routes/reader.tsx:21). Every new route must be added to apps/desktop/test/route-loaders.test.ts:31-58.

PLAN (recommended shape; the two product decisions are flagged for approval):
1. packages/api-contract/src/chat.ts: add `listConversations` (input {cursor?, limit?} -> {conversations: [{agent, assistant, id, messageCount?, title, updatedAt}], nextCursor}, ordered updatedAt DESC, keyset on (updatedAt, id), limit clamped like listMessages), `renameConversation` ({id, title} -> void/row), `deleteConversation` ({id} -> void). Declare .errors({NOT_FOUND}) on rename/delete. Decision A (step 6) covers what happens to createConversation.
2. apps/server/src/chat-store.ts: implement the three reads/writes with drizzle against the existing schema, no migration needed (updatedAt + title columns already exist). Give ensureConversation a seedTitle so the first user message names the conversation (truncate to ~60 chars, collapse whitespace) and bump updatedAt on every turn so the list orders by recency. Replace the orphaned :358 doc comment with the function it documents.
3. apps/server/src/chat-rpc.ts: wire the three handlers next to createConversation (:475) / listMessages (:491). deleteConversation must refuse (or be safe) while a turn is in flight: check context.turns and throw CONVERSATION_BUSY rather than deleting rows under a live sink.
4. packages/chat-session: give the provider a way to open an EXISTING conversation - a conversationId seed (prop or a `openConversation(id)` action) that (a) sets state.conversationId, (b) skips the blob's initialMessages so the DB replay paints the transcript, (c) does not let the persist effect overwrite the previous conversation's draft. Keep the blob as the last-opened conversation's identity + draft; a draft follows its own conversation.
5. apps/desktop: history surface + `/ai?c=<id>` (validateSearch, same pattern as routes/reader.tsx:21) that seeds the provider. Rename inline in the row (no new dialog primitive), delete with a confirm step in the row menu, empty state from packages/ui/empty. Decision A also picks where the list lives.
6. AC#6: give `chat.listMessages` a real client caller by pointing the existing /dev/chat-history route (routes/dev.chat-history.tsx, which today renders the localStorage blob under a name that promises server history) at the DB instead, and delete `chat.createConversation` from the contract if the user approves (nothing needs it: ensureConversation-on-send is the only writer and the client mints ids). Alternative: keep it and have New Chat call it.
7. Tests: apps/server - a real-WS + file::memory libsql test (test/harness.ts:109 pattern, like test/replay-window.test.ts) covering list ordering + pagination clamp, rename, cascade delete asserting the message ROWS are gone (not just the conversation), delete-during-a-turn, and opening a conversation the client has never seen (subscribe to a foreign id replays its transcript). packages/chat-session - the seed/open path and the no-clobber rule as pure/SSR tests (no DOM env: use-chat-engine.test.tsx:4-7).
8. Verify: bun test apps/server + packages/chat-session, tsc for api-contract/server/chat-session/desktop, ultracite on touched dirs, then drive it live (restart the dev run, create two conversations, New Chat, open the older one from history, rename, delete, reload).
9. DOX: apps/server/AGENTS.md + packages/chat-session/AGENTS.md record the history contract and drop the single-shared-conversation framing (AC#8); apps/desktop/AGENTS.md gets the new route and the ?c= seed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PRODUCT DECISIONS (user, this session): (1) the history list is a dedicated /chat/history route, not a header popover (there is no AppShell left to host one) - opening a conversation navigates to /ai?c=<id>. (2) AC#6 resolves by DELETING chat.createConversation from the contract (ensureConversation on send is the only writer; the client mints ids) and giving chat.listMessages a real caller by repointing /dev/chat-history from the localStorage blob at the database.

VERIFIED (live drive, headless chromium over the dev sidecar :4317 + vite :3001, fresh browser profile = empty localStorage): /chat/history lists the real 30 stored conversations (title or 'Untitled chat', recency, message count, agent label); Open navigates to /ai?c=<id> and the transcript renders from the DB with no blob present; a foreign id opened straight by URL replays too; unknown id fails as a route error ('Failed to open the chat: Not Found') instead of a blank chat; inline rename survived a full reload; two-step delete removed the row and SQL confirms 0 message rows left for that conversation (cascade), while the user's own 30 conversations / 169 messages are untouched; New Chat (/ai with no c) leaves the previous conversation listed. Bounded list proven by seeding 30 filler conversations: page 1 capped at exactly 50 rows, 'Load older chats' appended the remaining 10 with no repeated conversation, the control then disappeared; fillers deleted afterwards (local.db back to its original counts).

AUTOMATED: apps/server bun test 93 pass / 1 skip / 0 fail (test/chat-history.test.ts adds 10: two timestamp shapes ordered through the recency expression, keyset walk total + non-repeating, rename does not move a row, cascade delete counts the message rows, mid-turn CONVERSATION_BUSY refusal then acceptance, hub dropped on delete); packages/chat-session 180 pass (history.test.ts 7 for the row fold + storedStampToEpochMs, provider-open.test.tsx 4 through the real Provider, mergeOpenConversation in provider-initial.test.ts, exports.test.ts pins the ./history subpath); apps/desktop 392 pass / 3 skip; bunx tsc clean for apps/server, apps/desktop, api-contract, chat-session; bun x ultracite check exit 0 across 421 files (the two remaining noAwaitInLoops sites in the keyset walk are one biome-ignore with the sequential-cursor reason; the independent seed inserts went to Promise.all).

DECISIONS: (1) the opened conversation's identity resolves in the /ai ROUTE LOADER (conversationQueryOptions + loaderDeps on ?c=), not in an effect, so an unknown id fails before mount and the stored agent/persona are known before the Provider seeds (the ACP session belongs to the CLI that made the chat). (2) mergeOpenConversation drops the blob's transcript, draft and model when opening a past chat: the transcript comes from the DB replay and a draft belongs to the conversation it was typed in. (3) cardsFromRows is a deliberate client-side mirror of the server's toWireFrame (rows validated through ChatFrameSchema, so drift fails safe by skipping); documented in packages/chat-session/AGENTS.md rather than shared across tiers. (4) rename/delete invalidate the list key instead of patching rows: the server is the source. (5) packages/ui ships no dialog primitive, so rename is an inline form and delete is a two-step armed button. (6) The desktop's history mutations ride @/lib/orpc (the single-symbol re-export of the package's fetch client) so there is still one link. DOX: apps/server/AGENTS.md (TASK-101 history-surface bullet: store contract, recency normalisation, CONVERSATION_BUSY refusal, createConversation deleted, test pointer), packages/chat-session/AGENTS.md (persistence model corrected: the blob is the CURRENT conversation's resume handle, not the history; new ./history subpath + conversation-history contract; provider open prop; MessageTranscript messages override; verification), packages/api-contract/AGENTS.md (contract facts), apps/desktop/AGENTS.md (/ai?c= bullet, chat-history desk bullet, dev.chat-history repoint, chrome-free set now twelve), apps/desktop/src/features/AGENTS.md (directory map + Tier 1 row), apps/desktop/src/AGENTS.md (chrome-free family list), __root.tsx route comment.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Chat history is a real surface now. Server: chat-store.ts gained getConversation, listConversations (keyset on recency+id, limit+1 probe, clamped), renameConversation (no recency bump) and deleteConversation (cascade, returns the message-row count), plus a recency expression that normalises the two timestamp shapes the columns actually hold; chat-rpc.ts wires the four handlers, refuses a delete mid-turn with CONVERSATION_BUSY, disposes the ACP session and drops the frame hub, and deriveTitle seeds a conversation's title from its first prompt. Contract: the four procedures added, chat.createConversation deleted, MessageRowSchema now carries the frame type. Client: new @manobu/chat-session/history subpath (three queryOptions builders, the cardsFromRows DB-row fold, storedStampToEpochMs), the Provider takes an open seed (mergeOpenConversation: stored agent/persona win, blob transcript/draft/model dropped) and exposes meta.conversationId. Desktop: /chat/history (chrome-free, keyset-paged desk with inline rename and two-step delete) and /ai?c=<id> resolving the opened conversation in the route loader; /dev/chat-history repointed from the localStorage blob at the database. Verified by bun test (server 93 pass/1 skip, chat-session 180, desktop 392/3 skip), tsc clean in four projects, ultracite exit 0, and a headless-chromium drive of the running app against the dev sidecar: list, open-and-replay with an empty localStorage, foreign id, unknown id as a route error, rename surviving a reload, delete cascading to 0 message rows, New Chat leaving the previous chat listed, and a 60-conversation paging run capped at 50 with a working older-pages control.
<!-- SECTION:FINAL_SUMMARY:END -->
