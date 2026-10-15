---
id: TASK-82
title: >-
  Persist conversationId so /ai resumes conversations across reloads - stop
  forking a new conversation per provider mount
status: Done
assignee: []
created_date: '2026-09-20 19:06'
updated_date: '2026-09-21 04:05'
labels:
  - frontend
  - chat-session
dependencies: []
ordinal: 703000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PROBLEM (live smoke, 2026-09-21): packages/chat-session/src/provider.tsx mints conversationId via useState(() => crypto.randomUUID()) - one fresh id PER MOUNT. PersistedChat (types.ts) stores messages/input/agent/persona but NOT the id, so any reload/remount orphans the server-side conversation (rows live in local.db conversations/messages but no UI path reconnects). Symptom chain: reload -> new id -> empty transcript -> starter chips render -> first action LOOKS like 'chip created a new conversation'. Chips are innocent: SuggestionChip -> actions.send -> engineSend is the identical path as composer submit; the fork happens at mount.

FIX SHAPE: (1) add conversationId?: string to PersistedChat + persistChat payload; (2) provider seeds useState from persisted id, else crypto.randomUUID; (3) keep reset() (New Chat) minting a FRESH id and clearing the persisted one - reset semantics must stay explicit; (4) rely on the engine's connect-time history replay (chat.subscribe coarse replay, TASK-80.14) to restore the transcript - replay is idempotent and foldText upsert is deterministic, so no client-side dedupe needed. Verify the subscribe replay covers >200-message conversations (listMessages limit: 200 in chat-rpc subscribe) - either raise the limit or document the window.

ALTERNATIVE considered: URL-scoped id like /learn/conversation/$sessionId - more explicit but changes routing; blob persistence is the smaller change consistent with TASK-66 draft persistence.

ACCEPTANCE: reload /ai mid- or post-conversation -> same conversationId, transcript restored from server replay, no duplicate cards; New Chat button still starts a genuinely fresh conversation; /learn/conversation/$sessionId and AskSenseiWidget unaffected (multi-mount contract per provider JSDoc).
<!-- SECTION:DESCRIPTION:END -->
