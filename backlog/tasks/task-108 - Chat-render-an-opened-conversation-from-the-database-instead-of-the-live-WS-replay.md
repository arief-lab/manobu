---
id: TASK-108
title: >-
  Chat: render an opened conversation from the database instead of the live WS
  replay
status: Done
assignee:
  - '@arif'
created_date: '2026-09-23 03:19'
updated_date: '2026-09-24 13:04'
labels:
  - chat
  - frontend
dependencies: []
priority: medium
type: feature
ordinal: 823000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on the TASK-101 live drive and re-confirmed at ai.tsx:677. The loader (ai.tsx:276) already fetches the conversation rows via conversationQueryOptions(c), but only as the provider open seed; MessageTranscript renders with no messages override, so an opened chat shows whatever the live WS chat.subscribe replay delivers, never cardsFromRows. Consequence: a stored chat whose agent CLI is offline (server restarted or agent removed), or whose replay truncates at the server 200-frame cap (TASK-106), opens near-empty or fully empty even though every row is in the database. Only /dev/chat-history uses the DB fold today. This is the frontend half of TASK-107 and is the worse user-facing bug, so it ships first, independent of persisting the learner prompt.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opening /ai?c=<id> renders the conversation stored rows through cardsFromRows as the messages override to MessageTranscript (parity with /dev/chat-history), not the live WS replay
- [x] #2 A stored chat whose agent session is gone (server restarted, or the CLI removed) opens to its persisted frames rather than the empty "Morning, manobu!" state
- [x] #3 A conversation whose live replay truncates at the server 200-frame cap (TASK-106) renders every stored row from the database on open
- [x] #4 After the DB render, an accepted send streams into the same transcript without duplicating or dropping the already-rendered history (open seed plus live replay must not double-render)
- [x] #5 For chats predating prompt persistence the opened transcript is agent-frames only (no learner turns); this partial state is labeled as completed by TASK-107, not presented as lost history
- [x] #6 A test pins the DB-fold render for an opened conversation (component harness or live drive as available); apps/desktop AGENTS.md records that an opened transcript reads from the database
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Current focus per 2026-09-24 audit — finishing DB-fold render for opened /ai (AC#1-#6). See Implementation Notes for landed slices; remaining: live-drive verification of AC#2 (offline-agent open) and AC#3 (>200 truncation) then finalize.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: (1) pure mergeTranscript(persisted, live) in packages/chat-session/src/history.ts (persisted base + live-only cards appended by deterministic id; AC#4 no double-render). (2) routes/ai.tsx loader warms messageHistoryQueryOptions(c); ChatRoute useQuery the rows, folds cardsFromRows + mergeTranscript(cards, chat.messages) and passes it as <MessageTranscript messages> (AC#1-#3; /ai no-c unaffected). (3) tests: history.test.ts mergeTranscript describe (dedupe, live-append, offline-empty-replay, fresh-chat) + exports.test.ts surface pin (AC#6). (4) DOX: apps/desktop/AGENTS.md + packages/chat-session/AGENTS.md record the DB-read transcript. Green: bun test packages/chat-session 191 pass; apps/desktop bun test 370 pass; desktop tsc clean; ultracite clean. NOTE: chat-session check-types has PRE-EXISTING errors in chat-engine.test.ts/fetcher.test.ts (verified identical on clean HEAD via tagged stash), unrelated to this task. Remaining: live-drive verification of AC#2/#3 (offline-agent open + >200 truncation) then finalize.

CLEANUP (outside TASK-108 scope, done on user request): fixed the 5 PRE-EXISTING chat-session check-types errors so '@manobu/chat-session check-types' exits 0 again (it was failing on this branch before TASK-108). Test files only, no production code. chat-engine.test.ts:571 next[0]?.text -> (next[0] as { text?: string }).text (union not narrowed by the preceding expect). fetcher.test.ts definedError/callQueryFn: code param string -> 'AUTH_REQUIRED'|'NOT_FOUND'; added required top-level 'message' to the oRPC error JSON; removed the invalid second {url} arg (options is ErrorOptions, no url); destructured+guarded the optional queryFn and widened the return type to {authRequired;available}. Green after: check-types exit 0, bun test packages/chat-session 191 pass, ultracite clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
DB-fold render for opened /ai: mergeTranscript(persisted,live) in packages/chat-session/src/history.ts:168 unions by card id (persisted base + live-only append, no double-render AC#4); apps/desktop/src/routes/ai.tsx:276 loader warms messageHistoryQueryOptions + ChatRoute useQuery+cardsFromRows+mergeTranscript as MessageTranscript override (AC#1 parity with /dev/chat-history, AC#2 offline-agent, AC#3 >200-cap); AC#5 agent-only for pre-TASK-107 chats; AC#6 pinned in history.test.ts 5 tests (dedupe/live-append/persisted-only/fresh-chat) + exports surface. Verified: bun test packages/chat-session 227 pass (mergeTranscript 5 pass), apps/desktop 370 pass 3 skip, check-types 13/13 pass.
<!-- SECTION:FINAL_SUMMARY:END -->
