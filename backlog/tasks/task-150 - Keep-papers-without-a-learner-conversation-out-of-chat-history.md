---
id: TASK-150
title: Keep papers without a learner conversation out of chat history
status: Done
assignee:
  - '@arif'
created_date: '2026-09-28 03:17'
updated_date: '2026-09-28 05:15'
labels:
  - chat
  - exam
  - storage
dependencies: []
references:
  - doc-24
priority: medium
type: bug
ordinal: 915000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A paper built without a learner conversation still writes a conversation row, because the exam path needs a value for the column: `conversation_id: receipt.conversationId ?? `exam:${receipt.examId}`` at apps/server/src/services/exam-service.ts:1709, and the same fallback at :2667. `listConversations` (apps/server/src/chat-store.ts:261) has no filter, so those pseudo-conversations are listed as chat history. The browser QA pass found four `exam:` rows in /chat/history, one titled "N1 paper", and selecting one opens `/ai?c=exam:...`, which is an empty chat: the paper itself is fine at `/exam/<examId>`, but the history list offered something that leads nowhere.

Two shapes fix this and the task has to pick one deliberately: stop writing the fallback (the column becomes nullable and the paper keeps no conversation identity), or keep writing it and exclude learner-less rows from the history query. The existing rows need the same treatment as future ones, not a manual delete. doc-24 F-4 is the finding this task closes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /chat/history never lists a conversation that has no learner messages behind it
- [x] #2 The fallback either stops being persisted or is excluded by the query, and the task records which and why
- [x] #3 A test proves that assembling a paper with no conversationId produces no history entry
- [x] #4 Opening and answering the paper from /exam/<examId> still works, so nothing depended on the pseudo-conversation
- [x] #5 The four existing exam: rows in the development database are handled by the same mechanism that handles future ones
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Chosen shape (AC#2): keep writing the fallback, EXCLUDE learner-less conversations from the history query.

Why not "stop persisting it": the synthetic id is load-bearing, not decorative. `exams.conversation_id` (packages/db/src/schema/user.ts:149) and `messages.conversation_id` (:92) are both NOT NULL FKs to `conversations.id`, and packages/db/src/index.ts:64 turns `PRAGMA foreign_keys = ON` on for every connection, so the paper row and the exam row cannot be written unless a conversations row exists. Dropping the fallback would mean a two-table nullable-FK migration plus deciding whether a stand-alone paper still gets a persisted `paper:` frame, and the four existing rows would then need a separate data migration (AC#5 wants ONE mechanism for old and new). Filtering the read costs no migration, needs no backfill, and expresses AC#1 as written.

1. chat-store.ts `listConversations`: add an EXISTS on a `user_created` message row for the same conversation, spelled with literal aliased identifiers (the `countMessages` comment records that drizzle renders column refs bare inside a subquery). `getConversation` stays unfiltered so open/rename/delete of any id still work.
2. Fixtures: `insertAt` and the `hist-rpc-01` surface test list conversations that have no learner row; give them a `user_created` frame, and make the page-clamp test count listable conversations. Assertions stay identical.
3. New tests: (a) a learner-less conversation with frames is not listed while a prompted one is (store level, AC#1); (b) `exam.request` with no conversationId + assemble -> the `exam:<id>` row exists and the paper is answerable end to end, but /chat/history does not list it (AC#3, AC#4, AC#5).
4. Mutation seam on the new predicate in scripts/mutation-gate.ts; verify with `--check` and a run of the new test.
5. Full branch verification: server + desktop + chat-session suites, `bun run check-types`, ultracite, `fallow dead-code --boundary-violations`, mutation seam caught; DOX pass on apps/server/AGENTS.md, and report which doc-24 F-4 option was taken.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#5 proved against the development database (apps/server/.env DATABASE_URL=file:../../local.db) with the shipped predicate, read-only: 4 exam: anchors exist ('N5 paper' x3, 'N1 paper' x1); 3 of them have no user_created row and are now excluded from the list; the 4th (exam:exam-1dd80feb-515f-4ce9-a3f0-fb7628a505b2) stays listed because the browser QA pass TYPED INTO it (two user_created frames carrying 'hello', plus a live turn's start/finish frames) - by AC#1's own definition that row is no longer a paper anchor but a conversation the learner spoke in, and it is the paper's own chat. No migration, no backfill, no manual delete: one predicate covers old and new rows.

Plan text correction: the PRAGMA foreign_keys = ON line is packages/db/src/index.ts:66 (the plan said :64).

Test-infrastructure break found while proving AC#3: the combined-run failure was not the filter. chat-store's getChatDb() cached the HANDLE (schemaReady), so the first spec file to touch it pinned chat persistence to that file's database; that file's harness afterAll then unlinked the path and every later spec wrote the deleted inode while a fresh connection to the same path (a write transaction opens its own) saw an empty database beside it -> 'no such table: messages' inside exam.start's emitPaperFrame, only in combined runs. Two fixes, both in the test contract: harness.ts isolatedDbUrl() now registers the unlink in the CALLING file's afterAll (was one process-wide afterAll over a shared path set, so the first file to finish deleted databases of files that had not run), and getChatDb() resolves through the user-db provider and memoises the 0006 DDL per handle (WeakMap). With both, apps/server/test/chat-history.test.ts's cross-plane case passes in every order tried (alone, before/after exam-pipeline, with chat-e2e + chat-recovery, with chat-older-paging + drill-bridge) and the whole server suite is green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
doc-24 F-4 closed on the READ side (option (b)): chat-store.ts gained one EXISTS predicate, hasLearnerTurn (a conversation with no user_created frame is not a chat), and listConversations applies it in a single .where() alongside the keyset cursor. The exam:<examId> anchor stays written - exams.conversation_id (packages/db/src/schema/user.ts:149) and messages.conversation_id (:92) are NOT NULL FKs under PRAGMA foreign_keys = ON (packages/db/src/index.ts:66) - so no migration, no backfill, and the four existing rows are covered by the same query (3 hidden, 1 legitimately kept because the QA pass typed into it). getConversation stays unfiltered: open/rename/delete address ids. Proved by apps/server/test/chat-history.test.ts (store-level filter test + a cross-plane /rpc case: exam.request with no conversationId -> assemble -> the anchor is absent from chat.listConversations while exam.start/answer/submit reach status 'submitted'), pinned by the new history-lists-conversations-without-a-learner mutation seam. Getting that case order-independent exposed a real test-infrastructure bug: harness.ts unlinked EVERY registered database in one process-wide afterAll (including files that had not run) and chat-store cached the handle itself, so a later spec wrote a deleted inode while a write transaction's own connection saw an empty database beside it; both are fixed (per-file afterAll in isolatedDbUrl, per-handle schema memo via WeakMap in getChatDb). Verification: apps/server bun test 231 pass / 1 pre-existing skip / 0 fail; bun run test (turbo, 10 tasks) green including desktop and chat-session; bun run check-types 14/14; bun x ultracite check clean on the changed files; bun run check:dox complete; fallow dead-code --boundary-violations 0 issues; fallow audit --base main flags none of the changed files; scripts/mutation-gate.ts --check resolves all 29 anchors and the new seam is caught. DOX: apps/server/AGENTS.md carries the TASK-150 filter note and the per-spec database contract.
<!-- SECTION:FINAL_SUMMARY:END -->
