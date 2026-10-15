---
id: TASK-85
title: >-
  Pager for /ai transcript history - replay window (200 rows) is a hard cap,
  older turns unreachable from /ai
status: To Do
assignee: []
created_date: '2026-09-21 05:15'
labels:
  - frontend
  - backend
  - chat
dependencies: []
priority: low
ordinal: 868000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TRIGGER (create when met, start then): conversations routinely exceed the 200-row replay window (~20 turns at ~10 rows/turn from tool-call fan-out), OR /ai users report missing older history after reload. Not before - today the window edge is safe and documented. CONTEXT: chat.subscribe replays persisted history with listMessages(conversationId, { limit: 200 }) - listMessages's hard cap (Math.min clamps to 200 in chat-store.ts). Rows older than the window stay in local.db but /ai cannot reach them; chat-history viewer is the documented deep-traversal path (apps/server AGENTS.md, chat-rpc.ts subscribe comment from TASK-82). DO NOT simply raise the limit: a reload would re-flood the client with thousands of replace:true frames at once - a burst competing with the live pump and re-rendering the whole transcript on every reconnect. DESIGN SHAPE: fetch-by-cursor pager. listMessages already supports a before cursor (row id lt) - expose it (or a new procedure) to the client; /ai prepends pages on scroll-to-top; the replay keeps its 200-row tail as the fast path. TWO DE-RISKS already true: (1) the client fold's upsert is deterministic and id-keyed, so prepending older pages cannot duplicate or corrupt cards - the pager only needs correct ordering, no dedupe; (2) no pump/drain changes needed - pagination rides the existing fetch /rpc surface, not the WS stream. CAVEAT TO DECIDE IN-SCOPE: the localStorage blob (PersistedChat.messages, TASK-58/66/82) persists the ENTIRE card list on every change with NO cap - a pager solves server-side delivery but the blob still grows unbounded and eventually hits storage limits. Decide: trim the blob to newest N cards, or stop persisting messages entirely once conversationId (TASK-82) + server replay make blob-carried messages redundant for /ai (learn/* surfaces may still depend on blob messages - verify before cutting). ACCEPTANCE: /ai can traverse history older than the replay window; reload still restores the newest-window transcript with 0 duplicate cards (folding contract intact); blob cap policy decided and implemented; chat-e2e + chat-session suites stay green; fallow audit 0 findings.
<!-- SECTION:DESCRIPTION:END -->
