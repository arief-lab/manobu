---
id: TASK-80.7
title: >-
  80.2.1 apps/server: harden chat-store write path (atomic seq + created_at
  type) so persistence invariants don't depend on caller discipline
status: Done
assignee:
  - '@arif'
created_date: '2026-09-16 16:23'
updated_date: '2026-09-16 19:00'
labels:
  - ai-chat
  - backend
dependencies:
  - TASK-80.2
references:
  - apps/server/src/chat-store.ts
  - apps/server/src/chat-rpc.ts
modified_files:
  - apps/server/src/chat-store.ts
  - apps/server/src/chat-rpc.ts
parent_task_id: TASK-80
ordinal: 685000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-80.2's persistence layer still has two invariants that hold only by CONSUMER DISCIPLINE, not by the write path: (1) per-conversation monotonic seq is computed as two separate statements (MAX(seq)+1 read, then INSERT) in appendMessage, so two concurrent writers on one conversation can both read MAX=0 and land at seq=1 — a real hazard the moment 80.6 mounts two live conversations on one socket or an in-place text update races the next turn's turn_start; (2) messages.created_at is a text column with a datetime('now') default but the ChatFrame wire contract wants z.number(), so toWireFrame coerces new Date(row.createdAt).getTime() with a || undefined band-aid that yields NaN→null on the wire. (The earlier AC#2 'delete the generator's re-read band-aid' target was RETIRED by commit f3f6bd5, which replaced it with the cursor-threaded drainRows + hub.closed re-read — that mechanism is now the load-bearing correct design and AC#2/AC#4 already pass on it; 80.7 no longer owns it.) This task makes the WRITE PATH self-enforcing so the desktop cutover can build on it. Scope is intentionally tight: atomic seq, correct created_at type, and splitting createChatHandlers so the hub plumbing / persistence bridge / procedure handlers live in separate modules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 appendMessage computes seq atomically inside the INSERT (single statement, e.g. seq = (SELECT COALESCE(MAX(seq),0)+1) ... WHERE conversation_id = $1), so two concurrent writers on one conversation never land on the same seq; a new concurrency test proves it
- [x] #2 created_at is consistent end-to-end: either the messages.created_at column becomes integer epoch-ms (matching the ChatFrame z.number() contract, no coercion in toWireFrame) or toWireFrame stops the || undefined band-aid and the wire frame carries the column's actual type; ChatFrameSchema validation passes for all frame types without coercion
- [x] #3 createChatHandlers is split so the hub plumbing (FrameHub/pulse/waitForPulse), the persistence bridge (persistFrame/sinkFor/toWireFrame), and the 9 procedure handlers live in separate modules; bun x fallow audit reports no new complexity-threshold findings in apps/server/src
- [x] #4 cd apps/server && bun test green (the 5 chat-e2e + full suite) and bunx tsc --noEmit -p tsconfig.typecheck.json 0 errors; no from 'ai' import introduced
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope update 2026-09-16 (commit f3f6bd5): the original AC#2 'delete the generator's re-read band-aid' target was RETIRED by f3f6bd5, which replaced it with the cursor-threaded drainRows + hub.closed re-read — that is now the load-bearing correct mechanism and the 5 chat-e2e tests already pass on it. 80.7 no longer owns that; it owns the 4 remaining ACs: #1 atomic seq INSERT (the read-then-write MAX(seq)+1 race in appendMessage), #2 created_at type (drop the || undefined band-aid in toWireFrame), #3 createChatHandlers module split, #4 verification.

AC#1 (atomic seq INSERT) is DONE: appendMessage now computes seq inside the INSERT via a per-conversation subquery (SELECT COALESCE(MAX(seq),0)+1 ... WHERE conversation_id = ). A dedicated concurrency test (chat-e2e.test.ts, 'chat-store concurrency' describe) races 32 concurrent writers on one conversation and asserts the 1..N permutation with no dupes; it passed the race check (all 32 rows landed on seq=1) before the fix and is green after. runTurn's fire-and-forget .catch in chat-rpc.ts was also upgraded from console.warn to console.error with the conversation id in the message so a failed turn is actually loggable, not swallowed. Remaining 80.7 ACs: #2 created_at type (toWireFrame || undefined band-aid), #3 module split, #4 verification.

All 4 ACs complete: AC#1 atomic seq INSERT (commit 503f50f), AC#2 created_at epoch-ms via utcTextToEpochMs + AC#3 module split (chat-hub.ts / chat-persistence.ts / chat-rpc.ts) in commit 2a0d4ed. Verified: apps/server 59 pass/0 fail, tsc 0 errors, ultracite 0 errors. The 5 chat-e2e tests + the dedicated 32-writer concurrency test all pass.
<!-- SECTION:NOTES:END -->
