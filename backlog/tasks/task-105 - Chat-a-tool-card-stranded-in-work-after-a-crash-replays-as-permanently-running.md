---
id: TASK-105
title: >-
  Chat: a tool card stranded in work after a crash replays as permanently
  running
status: Done
assignee:
  - '@arif'
created_date: '2026-09-22 05:28'
updated_date: '2026-09-23 10:25'
labels: []
dependencies: []
priority: low
type: bug
ordinal: 392500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/server/src/chat-persistence.ts:75 writes status work for every non-terminal frame, and nothing ever reconciles a row left in that state. Kill the sidecar mid-turn (it dies on Tauri RunEvent::Exit) or crash the agent and the persisted tool row keeps saying running: reopening that conversation replays a card with a spinner that will never resolve, because the turn that would have settled it no longer exists. The damage is permanent rather than transient, so a user who restarts after a crash carries a stuck card in that conversation forever. AionCore runs a startup recovery pass that settles tool rows left in a running state and rewrites the embedded content status, because the frontend renders from the content and would otherwise keep a live spinner off a row that is already finished.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On server boot, rows still in work are moved to a terminal state with a reason the UI can show
- [x] #2 The embedded content payload is rewritten alongside the status, so a replayed card cannot render as running
- [x] #3 A reopened conversation after a crash shows the tool as interrupted, never as an endless spinner
- [x] #4 A turn that is genuinely still live across a reconnect is not touched by the recovery pass
- [x] #5 A test covers boot reconciliation for a stranded work row and the live-turn exemption
- [x] #6 apps/server/AGENTS.md records the recovery pass and its exemption rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Startup recovery pass in apps/server (mirrors the TASK-107 title-backfill and TASK-102 boot-reap precedents in src/index.ts).

1. chat-store.ts: export recoverStrandedWorkRows(activeTurnIds?: Set<string>): Promise<{interrupted, settled}>. Select every row with status='work'. Per row: skip if its turn_id is in activeTurnIds (AC#4 exemption); if frameType='acp_tool_call' and the persisted content's status is pending/in_progress, rewrite content to {status:'failed', rawOutput/raw_output: 'Interrupted: the agent stopped before this tool finished (server restart)'} (dual-case, matches the sanitize contract) and set row status 'error', count interrupted. Every other work row (settled tool content, text/content/start/plan rows) moves to 'finish' untouched content, count settled. One-at-a-time awaited updates (backfill precedent).
2. index.ts: call it before startSidecar, next to the title backfill, never block boot on failure; log counts.
3. Tests (new apps/server/test/chat-recovery.test.ts, chat-history pattern: file::memory: db, appendMessage seeds, real getChatDb): stranded in_progress tool row -> content failed + status error (AC#1/#2); completed tool row -> status finish, content untouched; work text row -> status finish; active-turn tool row exempt (AC#4); toWireFrame replay of the recovered row carries status failed (AC#3); pass is idempotent.
4. apps/server/AGENTS.md records the pass + exemption rule (AC#6). Scope note: parked ask/permission rows are status 'pending', not 'work' (TASK-86 owns those); plan/text rows have no spinner. UI mapping: status-tag renders failed -> destructive 'Failed' pill (packages/ui/src/components/status-tag.tsx:31-50).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: apps/server bun test suite green (103 pass / 1 pre-existing skip / 0 fail), incl. new test/chat-recovery.test.ts (4 tests, 23 assertions): in_progress+pending tool rows -> row status error + content status failed + dual-case Interrupted reason, toWireFrame replay carries status failed; completed-tool and work-text rows settle to finish with content deep-equal unchanged; activeTurnIds exemption leaves the live turn's row at work/in_progress while the dead turn's row is recovered and a pending ask row is untouched; second pass recovers nothing. tsc -p tsconfig.typecheck.json exit 0; ultracite check clean on the three touched files. Live boot drill: seeded one stranded work tool row into file:/tmp/rec-boot-drift.db, booted real src/index.ts (BUN_PORT=4398), log printed '[chat] boot recovery: 1 stranded tool row(s) marked interrupted, 0 work row(s) settled' and the server kept serving despite an unrelated drill-induced migration error (proves the try/catch never blocks boot); read-back after exit showed rowStatus=error, content.status=failed, rawOutput=the Interrupted reason, title preserved. AC#3 rendering chain: replayed content status failed maps to the destructive Failed pill via status-tag toStatusVariant, no spinner state is reachable from a recovered row.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Stranded-work boot recovery: new recoverStrandedWorkRows() in apps/server/src/chat-store.ts runs once before serving (src/index.ts, next to the TASK-107 title backfill, try/catch so it never blocks boot). It sweeps every message row left at status 'work': acp_tool_call rows whose CONTENT status is still live (in_progress/pending) get content rewritten to status failed plus a dual-case 'Interrupted...' reason in rawOutput/raw_output and row status error (the client renders run-state from content, so the rewrite is what kills the spinner); all other work rows settle to finish with content untouched; rows of turns in the activeTurnIds exemption set are skipped; pending ask rows are out of scope (TASK-86). Verified by test/chat-recovery.test.ts (4 tests) + a live boot drill over a file-backed db showing the log line and the recovered row state, full server suite 103 pass / 0 fail, tsc clean, ultracite clean. apps/server/AGENTS.md records the pass, the content-vs-row-status doctrine, and the exemption rule.
<!-- SECTION:FINAL_SUMMARY:END -->
