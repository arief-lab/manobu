---
id: TASK-109
title: >-
  Chat: an ask/permission card stranded in pending after a crash replays as
  still awaiting the learner
status: Done
assignee:
  - '@arif'
created_date: '2026-09-23 10:53'
updated_date: '2026-09-23 11:08'
labels: []
dependencies: []
priority: low
type: bug
ordinal: 824000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-105's recovery pass deliberately excludes these rows: rowStatus (apps/server/src/chat-persistence.ts:65-76) stamps `acp_permission` and `ask` frames as status `pending`, not `work`, so recoverStrandedWorkRows never sees them. Their only settle path is the engine park rejecting: AskToolServer.onExpire -> settlePending(..., "error") (apps/server/src/context.ts:91-92, chat-store.ts:697), which fires on expiry, cancel and dead child, but NOT when the whole sidecar process dies (Tauri RunEvent::Exit / crash). toWireFrame replays the row status for ask rows (chat-persistence.ts:446-448), so reopening such a conversation renders a live card inviting a tap whose answer can never reach a park that no longer exists. Follow the TASK-105 pattern: a boot pass that settles pending ask/permission rows to a terminal, explainable state (reason must be em-dash-free per R-02), plus a test at the store boundary. Decide whether the recovered card should read as expired (matching the onExpire outcome) or interrupted; the TASK-92 requestId hashing means a re-call after recovery attaches fresh, so recovery must not fake an answer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On server boot, ask/permission rows still pending are settled to a terminal state the replayed card cannot render as awaiting the learner
- [x] #2 The settled card carries a reason the UI can show (no em dash, R-02), and recovery never fabricates a learner answer
- [x] #3 A reopened conversation after a crash shows the stranded card as expired/interrupted, never as tappable
- [x] #4 apps/server/AGENTS.md records the ask/permission recovery pass and how it relates to TASK-105's work-row pass and TASK-86's settle paths
- [x] #5 The pass runs before serving (no live park can exist at that moment); a park created afterwards settles normally through settlePending, and rows already terminal are never re-settled or content-patched
- [x] #6 A test covers boot reconciliation of a pending ask row AND a pending permission row (status terminal, content untouched), the replayed frames' status carry, and idempotency
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Boot recovery for pending parked cards, extending the TASK-105 pattern. Research facts (all from source): rowStatus stamps ask/acp_permission rows 'pending' (apps/server/src/chat-persistence.ts:65-76); the only settle path onExpire->settlePending (context.ts:91-92) dies with the process; toWireFrame replays row status only for frameType 'ask' (chat-persistence.ts:447) so ask rows ALREADY render settled via acp-ask-part.tsx resolutionFrom (status error -> expired compact card), but acp_permission rows replay statusless and the part (acp-permission-part.tsx:30) renders tappable unless a separate acp_permission_resolved row settled the card. Permission card honors option.disabled -> Button disabled (packages/ui/src/components/acp-permission-states.tsx:76) so no packages/ui change is needed.

1. chat-store.ts: recoverStrandedPendingCards(): select id+frameType where status='pending' AND frameType IN ('ask','acp_permission'); per row UPDATE status='error' ONLY, content untouched (must not fabricate an answer; dual-cased reason string not needed: the terminal renders themselves are the explanation - ask 'expired' pill, permission expired title). Counts {asks, permissions}. No exemption param: parks are in-process, none can be live at boot (unlike TASK-105's seam).
2. index.ts: second boot pass right after the TASK-105 one, before serving, try/catch, log counts.
3. chat-persistence.ts toWireFrame: carry StoredStatus for acp_permission rows too (same enum guard). Keep the ask-only comment updated; chat-wire-status.test.ts non-ask case stays valid (it uses a text frame) but gains a permission positive case.
4. packages/chat-session folds/permission.ts refresh branch: status: frame.status ?? existing.status (parity with ask fold line 41).
5. acp-permission-part.tsx: expired render when part.settled === undefined && part.status === 'error' -> title 'Permission request expired' (no em dash, R-02) + options mapped disabled:true.
6. Tests: extend apps/server/test/chat-recovery.test.ts (pending ask + pending permission -> error, content byte-stable, replay toWireFrame carries status, idempotency, already-terminal rows untouched, a later settlePending still works with contentPatch); packages/chat-session: fold refresh status case in chat-engine.test.ts + part expired-render case (tsx test pattern exists).
7. Docs: apps/server/AGENTS.md (new boot pass + relation to TASK-105/TASK-86 + toWireFrame extension), packages/chat-session/AGENTS.md (permission replay status).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: apps/server bun test 107 pass / 1 pre-existing skip / 0 fail incl. 3 new stranded-park tests in test/chat-recovery.test.ts (pending ask+permission -> status error with content deep-equal to the seed, no answers field; toWireFrame carries status error for both families; second pass {asks:0,permissions:0}; already-finish rows from a real settlePending keep their answers summary; post-pass parks still settle normally). chat-wire-status gains the acp_permission carry case (4 tests pass). packages/chat-session bun test 220 pass / 0 fail incl. fold-carries-status-through-refresh and SSR render 'Permission request expired' + disabled, 'Permission requested' gone. tsc clean both packages; ultracite check clean on all 9 touched files. Live boot drill (file-backed db like TASK-105's): seeded one pending ask + one pending permission row, booted real src/index.ts on :4397, log printed '[chat] boot recovery: 1 stranded ask card(s) and 1 permission card(s) expired', read-back after exit: both rows status=error, wire status=error, no answers fabricated; boot also survived the drill's expected migration-collision error via the try/catch. AC#3 note: verified through the fold + SSR card-switch render tests and the replayed-frame carry, not a crashed Tauri run.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Boot recovery for parked cards stranded in pending: recoverStrandedPendingCards() (apps/server/src/chat-store.ts) expires pending ask/acp_permission rows to status error at boot (right after the TASK-105 pass, before serving, try/catch), mirroring the in-process onExpire outcome without ever patching content (no fabricated answers). toWireFrame now replays the lifecycle status for acp_permission rows too (chat-persistence.ts); on the client the permission fold carries status through refresh and AcpPermissionPart renders the replayed error as a disabled 'Permission request expired' card (settled still outranks; pending stays interactive for reload-during-live-park). The ask half needed no client change: TASK-86's expired pill already keys off the replayed status. Verified with 3 new store tests + 1 wire-carry test (apps/server 107/0), fold + SSR render tests (chat-session 220/0), tsc + ultracite clean, and a live boot drill over a file-backed db showing the log line and both rows expired. Docs: apps/server/AGENTS.md (new pass, TASK-105/86 relations, fixed two stale ask-only-replay clauses), packages/chat-session/AGENTS.md (permission replay state).
<!-- SECTION:FINAL_SUMMARY:END -->
