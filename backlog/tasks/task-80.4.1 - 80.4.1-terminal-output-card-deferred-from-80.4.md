---
id: TASK-80.4.1
title: 80.4.1 terminal output card (deferred from 80.4)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-17 01:43'
updated_date: '2026-09-17 13:32'
labels:
  - ai-chat
  - frontend
dependencies: []
parent_task_id: TASK-80.4
ordinal: 686000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port the AionUi TerminalOutputCard (packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpTerminalOutput.tsx) to @manobu/ui + chat-session parts: running -> exit-status tag, cumulative output scroll region, kill button calling chat.killTerminal. Requires a TMessageTerminal card type in chat-engine.ts (add the type + a transformFrame case that folds acp_terminal_output into a card; stream-only, never persisted per the 0006 DDL which skips it) + the terminal card component + SSR test pinning the running->exit transition and kill-button state. Split from TASK-80.4 which ships the 4 non-terminal cards (AcpToolCall/Permission/Ask + grouping).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SSR test pinning the terminal card state table: running -> exit-status tag transition, cumulative output scroll region, kill button (calling chat.killTerminal) with loading/error states
- [x] #2 TMessageTerminal card type added to chat-engine.ts + transformFrame folds acp_terminal_output into a card (stream-only, never persisted per the 0006 DDL)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Plan (2026-09-17, after delivery-path audit + user chose the live-lane option):
1. chat-hub.ts: FrameHub gains an in-memory terminal lane: Map<terminalId, {frame, seq}> + terminalSeq counter + pushTerminalFrame(hub, frame, terminalId) helper (bounded by concurrent terminals; cumulative snapshots, last-writer-wins per id).
2. chat-persistence.ts sinkFor: the acp_terminal_output early-return now pushes the wire frame onto the owning hub's lane + pulse (no DB write, per the 0006 stream-only decision; frames after hub.closed are dropped by the existing guard).
3. chat-rpc.ts subscribe: the recursive drainFrom also drains the hub lane each step - a sync drainLane(lane, cursor) generator yields entries with seq > cursor; per-subscriber lane cursor rides the recursion; the closed step drains lane + persisted tail before returning.
4. chat-session chat-engine.ts: TMessageTerminal card type (id = term:{msg_id}:{terminal_id}, cumulative full-replace fold, status work/finish/error from exit_status/signaled) + isTerminalCard guard + transformFrame case; move acp_terminal_output out of the transient-frames test into a dedicated fold test.
5. packages/ui: AcpTerminalCard (sumi theme, no dark:/em-dash) pinning: running state (data-state=running, output scroll region, truncated indicator), exited state (data-state=exited + exit-code/signal badge), kill button (data-state=killing while in flight, kill-error retry on rejection) with aria-labels; SSR block in acp-cards.test.tsx.
6. chat-session parts/acp-terminal-part.tsx: map TMessageTerminal -> structural card data, wire onKill to chat.killTerminal over the WS link; message-transcript dispatches isTerminalCard -> AcpTerminalPart; exports.test.ts updated for the new export.
7. e2e (apps/server): scripted fake-agent acp_terminal_output frames (2 running snapshots + exit) assert the subscriber receives them live and the last frame carries exit_status; killTerminal RPC still returns {killed}.
8. Verify: biome lint 0 on all touched files, tsc in apps/server + packages/chat-session + packages/ui, bun test in all three, ultracite check 0. DOX: refresh packages/chat-session + packages/ui AGENTS.md card-set + dispatch order; apps/server chat-hub lane note.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation 2026-09-17 (delivery-path audit first): acp_terminal_output frames were dropped server-side today (sinkFor early-return), so a card would never receive frames. User chose the live-lane option:
- chat-hub.ts: FrameHub gains terminalLane (Map<terminalId, {frame, seq}> last-writer-wins, bounded by concurrent terminals) + terminalSeq + pushTerminalFrame(hub, frame, terminalId).
- chat-persistence.ts sinkFor: acp_terminal_output now pushes a wire frame onto the lane + pulse (no DB row, per the 0006 stream-only decision); toTerminalWireFrame maps the event (status stays 'work' — the client derives running/exited from data.exit_status).
- chat-rpc.ts subscribe: sync drainLane(cursor) generator + drainFrom(fromCursor, laneCursor) merges the lane into the recursive drain (DB rows, then lane entries; the closed step drains both before returning).
- chat-engine.ts: TMessageTerminal (id = term:{msg_id}:{terminal_id}, cumulative full-replace fold via foldTerminal) + isTerminalCard + deriveStatus streaming on live terminal frames; transient-frames test moved terminal out into a dedicated 3-case fold test.
- packages/ui: AcpTerminalCard (running -> exited data-state, cumulative output region, truncated indicator, kill button with killing/kill-error states, aria-labels; no dark:/em-dash) + 8 SSR test cases in acp-cards.test.tsx.
- chat-session: acp-terminal-part.tsx maps TMessageTerminal -> structural card data, onKill wired to chat.killTerminal; message-transcript dispatches isTerminalCard -> AcpTerminalPart.
- e2e AC#6 (chat-e2e.test.ts + harness FakeAgent.terminal script): the live subscriber receives terminal snapshots off the lane, the last snapshot carries exit_status {exit_code:0, signaled:false}, killTerminal round-trips the id, and the resubscribe replay carries NO terminal rows (stream-only). Coalescing note: the lane is last-writer-wins per terminal, so two same-terminal snapshots within one drain window collapse to the final cumulative snapshot — the test asserts >=1 + the deterministic exit_status property.
Verification: biome lint 0 on all 11 touched files, tsc green (apps/server + packages/chat-session + packages/ui + apps/desktop), bun test server 60/0 + chat-session 80/0 + ui 132/0, ultracite check 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Terminal output card + live delivery lane (delivery-path audit first: acp_terminal_output was dropped server-side, so a card alone would be dead code). Server: FrameHub in-memory terminal lane (last-writer-wins per terminal_id) + sinkFor publishes terminal frames onto the lane + the subscribe recursive drainFrom merges the lane with the DB cursor. Engine: TMessageTerminal (id term:{msg_id}:{terminal_id}, cumulative full-replace fold) + isTerminalCard + deriveStatus streaming. UI: AcpTerminalCard (running -> exit badge, cumulative output region, truncated indicator, kill button with killing/kill-error, aria-labels) + 8 SSR pins. chat-session: acp-terminal-part (onKill -> chat.killTerminal) + transcript dispatch. e2e AC#6 proves the lane delivers snapshots live, the exit_status arrives, kill round-trips, and the replay stays terminal-free (stream-only). Verified: biome lint 0 (11 files), tsc green all 4 packages, server 60 / chat-session 80 / ui 132 tests all pass, ultracite check 0.
<!-- SECTION:FINAL_SUMMARY:END -->
