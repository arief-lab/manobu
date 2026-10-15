---
id: TASK-84
title: >-
  Decide settle-on-restart semantics for chat.subscribe after server restart
  (hub memory loss)
status: To Do
assignee: []
created_date: '2026-09-21 05:10'
labels:
  - backend
  - chat
  - investigation
dependencies: []
ordinal: 869000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
EDGE FOUND while building the replay-window test (apps/server/test/replay-window.test.ts, 0e9410a): chat.subscribe's stream-close depends on hub.terminal, which is IN-MEMORY and dies with the process. Shape: (a) subscribe BEFORE any restart, settled conversation -> replay then stream CLOSES (hub was settled by the turn's closeHub); (b) subscribe AFTER a server restart (or first-ever subscribe in a fresh process), same rows in DB -> replay then stream STAYS OPEN, because hubFor mints a fresh hub with terminal:false and the settle-close branch (hub.terminal && sawTerminal) never fires. Impact TODAY: none user-facing - the desktop client treats an open stream as live mode and benefits (subscription stays warm for the next send; no forced resubscribe). Victims are one-shot replay consumers (scripts, batch tools, tests) which would HANG on a post-restart conversation; the smoke driver and the replay-window test work around it by explicitly closeHub-ing. DECISION NEEDED - pick one and pin it in DOX + tests: (1) ACCEPT the asymmetry: document that close-on-settle only applies in-process; one-shot consumers must settle the hub themselves or use a timeout. Cheapest, zero behavior risk. (2) MAKE POST-RESTART CONSISTENT: in chat.subscribe, after the history read, if sawTerminal && !context.turns.has(conversationId) then closeHub(hub) before draining - stream closes for settled conversations regardless of process lifetime. Cost: the desktop client must handle stream-close after replay by resubscribing on the next send (verify use-chat-engine's subscribe lifecycle + the TASK-80.14 pump invariants before adopting; the drain semantics are load-bearing per apps/server AGENTS.md). (3) TIMEOUT-BASED: keep open but auto-close after N ms of no live activity post-replay - hybrid, more moving parts, least explicit. Do NOT refactor the pump/drain while deciding (TASK-80.14: load-bearing). Acceptance: chosen option implemented or documented in apps/server AGENTS.md + chat-hub.ts header; replay-window.test.ts updated to model the chosen shape; no regression in chat-e2e (14 tests).
<!-- SECTION:DESCRIPTION:END -->
