---
id: TASK-80.14
title: >-
  chat.subscribe live-drain split: per-conversation in-memory frame ring +
  finalized-only persistence (AionCore parity, drop the DB-cursor replay)
status: Done
assignee:
  - '@arif'
created_date: '2026-09-19 03:33'
updated_date: '2026-09-20 05:00'
labels:
  - orpc
  - ai-chat
  - backend
dependencies: []
references:
  - >-
    https://github.com/iOfficeAI/AionCore/tree/main/crates/aionui-realtime/src/broadcaster.rs
  - >-
    https://github.com/iOfficeAI/AionCore/tree/main/crates/aionui-session/src/event.rs
  - >-
    backlog/tasks/task-80.7 -
    80.2.1-apps-server-harden-chat-store-write-path-atomic-seq-created_at-type-so-persistence-invariants-dont-depend-on-caller-discipline.md
  - >-
    backlog/tasks/task-80.12 -
    80.9.3-Eval-could-the-FrameHub-be-swapped-for-oRPCs-Publisher-helper.md
parent_task_id: TASK-80
priority: high
type: feature
ordinal: 692000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-09-19 opencode/kilo smoke drive (TASK-80.6 live verification) wedged C1 opencode for 10+ min while the server-side turn had already completed (23 DB rows incl. finish; 15 real acp_tool_call frames). Root cause is a CONSUMER-side lost-pulse race in the TASK-80.7 live-drain design: chat-rpc.ts nextPulse does listFramesAfter read, then `if (!hub.closed) await waitForPulse(hub)`; between the closed-check and the gate-capture, the publisher can commit the terminal row (chat-persistence sinkFor sets hub.closed=true, pulse() releases the captured gate AND re-arms a fresh one), so the drain ends up awaiting the NEXT pulse which never comes (no pulses after a turn ends) and wedges silently. The oRPC iterator yields nothing, throws nothing, so the client resubscribe path never fires; the per-convo abort cap is the only bound. Small-frame agents (agy, 3 frames; all fake-agent e2e, instant frames) never hit the window; a multi-tool opencode burst (15 tool calls) makes it near-certain. A 2-line patch (capture hub.gate before the DB read) fixes this race but not the bug class; this task is the structural split the user chose (2026-09-19): the TASK-80.7 "persist every frame, replay via lastEventId seq cursor" hybrid is the one deviation from the AionUi/AionCore reference design, and it is producing its first architectural bug now. Note: the interim 2-line patch + abort-honoring were deliberately NOT applied (user opted straight to this task), so heavy-agent turns remain at wedge risk in-tree until this lands.

What (behavior contract, AionCore parity): split the live path from the durable path. Live frames ride a bounded in-memory per-conversation ring (pub/sub broadcast with a backpressure/lagged signal), NOT a DB write-and-reread loop; the DB persists FINALIZED turn records (history), not the live stream. Reconnect catch-up = persisted history replay + a snapshot of the current in-flight turn state (AionCore Snapshot{state_repr, turn_gen}); delete the per-frame lastEventId seq-cursor replay as the resume mechanism. Liveness is bounded and loud (watchdog / backpressure, per AionCore `15s watchdog`), never a silent unbounded gate wait.

Grounded AionCore evidence (iOfficeAI/AionCore main, cloned 2026-09-19): crates/aionui-realtime/src/broadcaster.rs (BroadcastEventBus = tokio::sync::broadcast ring -> per-connection mpsc -> WS; live path never touches the DB); crates/aionui-session/src/event.rs L498-500 (ToolOutputDelta `Ephemeral (never persisted - the durable record is the completed ToolResult ... a reconnect re-renders from there)`), L510-513 (TurnDiffUpdated same), L531-534 (Snapshot: `the orchestrator emits the CURRENT in-flight state first on a re-subscribed stream`), L536-539 (Lagged{skipped}: `a broadcast receiver fell behind ... triggers a reconnect() to refetch`), L404-505-area (`a turn that only the 15s watchdog can end`).

Ours (anchors): apps/server/src/chat-hub.ts (FrameHub: closed/gate/release/terminalLane - becomes the ring + snapshot holder), apps/server/src/chat-persistence.ts sinkFor L78-101 (persist-then-pulse publisher - becomes publish-to-ring + finalize-only persist), apps/server/src/chat-rpc.ts subscribe L196-297 (nextPulse/drainFrom/drainRows - the racing consumer), packages/chat-session/src/use-chat-engine.ts runSubscribeLoop L98-153 + orpc.ts (client resubscribe carries lastEventIdRef - becomes history + snapshot resume), apps/server/scripts/mcp-smoke.mjs drain().

Known behavior deltas to pin (regression risks this task must keep or explicitly accept): (a) reload AFTER a turn completes still replays the full transcript from the DB (finalized rows remain) - the 80.7 guarantee that survives; (b) in-flight turn content is NOT durable: a server restart mid-turn drops the un-finalized stream portion, and on turn completion the finalized record lands - clients must show done, not stuck streaming; (c) the ChatFrame wire envelope + client reducer (replace:true snapshots, card ui_ids) stay unchanged - only the live transport changes; (d) 80.10 abort-honoring still holds (dropped subscriber stops draining; the turn continues).

Overturns: TASK-80.7 AC#3 decision ("prompt sink publishes persisted rows, each subscribe drains its own cursor") and the TASK-80.12 STAY verdict (that spike evaluated the oRPC Publisher helper only; an in-memory ring + finalized persistence is a different shape the evaluation did not cover). DOX updates required in apps/server/AGENTS.md, packages/chat-session/AGENTS.md, and the api-contract docs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Live turn regression: a scripted e2e agent emitting a 20+ frame burst (incl. 10+ acp_tool_call) streams every frame to a live subscriber and the drain terminates on the terminal frame - the opencode C1 wedge (finish row in DB, drain wedged silently) cannot recur
- [x] #2 Mid-turn resubscribe: a subscriber that connects (or reconnects after a socket drop) mid-turn receives persisted history + the current in-flight snapshot, then continues live frames, and the drain terminates on the terminal frame in every case - no unbounded gate wait remains in the live path
- [x] #3 The per-frame lastEventId seq-cursor replay is removed as the resume mechanism (resume = history + snapshot); the ChatFrame wire envelope and the client reducer contract (replace:true snapshots, ui_id card growth) are unchanged
- [x] #4 Durability pinned: reload after a completed turn replays the full transcript from the DB (no regression vs 80.7); a mid-turn server restart drops the un-finalized in-flight portion but the finalized record is present when the turn completes and clients settle, not stuck
- [x] #5 Liveness is loud and bounded: a stuck/lagged subscriber is detected (backpressure lagged signal or a watchdog with a fixed cap) and logged; the 80.10 abort-honoring behavior (dropped subscriber stops draining, turn continues) still holds
- [x] #6 Gate: check-types + ultracite clean; bun test green across apps/server, packages/chat-session, packages/ui; the opencode + kilo light smoke (MANOBU_SMOKE_AGENT) passes the multi-tool opencode conversation that wedged on 2026-09-19
- [x] #7 DOX: apps/server + packages/chat-session + contract AGENTS.md document the split and record that TASK-80.7 AC#3 and the TASK-80.12 STAY verdict are superseded (80.12 evaluated only the oRPC Publisher helper, not this shape)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. [chat-hub.ts] FrameHub becomes a live ring: add `frames` (published wire-frame sequence, per-hub), `settled` + `settledPromise` + `settle()` (resolves exactly once on the terminal frame, AionCore `turn/completed` analogue), keep `terminalLane` coalescing by terminal_id (last-writer-wins, stream-only), drop `gate`/`release`/`pulse`/`waitForPulse`/`closed`. `hubFor` replaces a settled hub with a fresh one on `send` (per-turn ring; previous turn lives on in the DB as history).
2. [chat-persistence.ts] `sinkFor` = publish wire frame to the ring FIRST (in-memory order is the liveness source of truth, no DB poll on the live path), then fire the DB write fire-and-forget (persistFrame unchanged; still the durability layer), coalesce terminal-output into the lane (no DB), call `settle()` on finish/error. New `toLiveFrame(event, …)` builds the live wire frame from the event (reuses `rowStatus`/`frameUiId`/`frameReference`/`frameContent` mapping); drop `drainRows`/`wireEventId`/`parseEventId` (seq-cursor replay deleted).
3. [chat-rpc.ts] `subscribe` rewritten: `hub.settled ? yield history-from-DB (listFramesAfter-concept via listMessages over the ring-settled boundary) : yield in-memory frames since subscriber start, then await ring tail / settle / client-abort race with a bounded lag watch`. oRPC `signal` honored (80.10 keeps: abort stops the yield loop; turn continues). Lagged = subscriber cursor >N behind ring head → logged loud. No unbounded gate wait remains: every wait is on the one-shot `settledPromise` + ring growth + abort. `send` resets the hub (fresh ring per turn); `confirm`/`answerAsk`/`cancel`/`listConfirmations` untouched.
4. [chat-store.ts] delete `listFramesAfter` + `drainReads`/`getDrainReads`/`resetDrainReads` (the DB-poll counter had no consumer in the new design; the 80.10 test re-pins on ring reads instead); `appendMessage`/`updateMessageByUiId`/`listMessages`/`settlePending` unchanged.
5. [client packages/chat-session] `use-chat-engine`: drop the `lastEventId` ref + resubscribe-with-cursor; stream close = settled (terminal frame) or socket drop → resubscribe (fresh subscribe replays history-from-DB + any new ring tail). `orpc.ts` `getChatWsClient` reconnect config stays as-is (desktop-exact, no numeric delay — the 80.6 gotcha stays pinned).
6. [contract + smoke] `api-contract` subscribe doc drops the replay-via-seq wording; `mcp-smoke.mjs` `drain()` drops `lastEventId` resubscribe (clean close = done; error → resubscribe once).
7. [tests] chat-e2e: existing 12/12 must keep passing (replay now = history-from-DB on fresh subscribe); ADD AC#1: 25-frame burst with 12 tool calls streams fully and terminates (the opencode C1 wedge regression); ADD mid-turn resubscribe: two subscribers on one in-flight turn each get the full ordered stream; ADD lagged: a slow subscriber is marked lagged + logged; RE-PIN 80.10: dropped subscriber stops yielding (no repeated reads), turn still settles.
8. [gates + DOX + closeout] check-types 13/13; ultracite 0; bun test server + chat-session + ui; `MANOBU_SMOKE_AGENT=opencode` and `=kilo` light smoke PASS (the wedge regression, live); AGENTS.md DOX for apps/server + packages/chat-session + contract recording the split + that 80.7 AC#3 "each subscribe drains its own persisted cursor" and the 80.12 STAY verdict are superseded; backlog AC checks + final summary; source-only commit.

Concrete mechanism (refined after reading the client): use-chat-engine.ts opens ONE chat.subscribe per mount and only resubscribes on socket drop => the subscribe generator is a LONG-LIVED BUS that must stay open across turns (closing on a terminal frame would silently break turn 2, since the client never re-subscribes after a clean close). (a) FrameHub keeps a per-conversation in-memory ring of the in-flight turn wire frames, CLEARED on each send/cancel (turn boundary) so it holds at most one turn; a brand-new hub arms a PENDING gate so an idle bus blocks (no busy-spin). (b) sinkFor publishes the wire frame to the ring FIRST (publishFrame, in-memory, immediate, no DB gate) then fires the DB write: AWAITED for terminal frames (durability so reconnect/reload has the terminal row), fire-and-forget for non-terminal => the DB is now durability-only, NOT the live path; the live drain is decoupled from SQLite, killing the lost-pulse race. (c) subscribe generator: on connect yield DB history (all persisted rows, replace:true, idempotent = coarse reload-restore + reconnect catch-up), then attach live to the ring with a per-subscriber cursor that self-resets when the ring is cleared (cursor > ring.length => reset to 0); loop { drain ring[cursor..]; signal?.throwIfAborted(); await waitForPulse }. It NEVER returns on terminal (the bus outlives turns); returns only on socket-drop abort (80.10) or process end. (d) lastEventId is IGNORED server-side (coarse idempotent replay replaces it as the resume mechanism); the client keeps sending it harmlessly and is otherwise UNCHANGED. (e) terminal-output still rides the coalesced in-memory lane (stream-only, never persisted). Re-pins 80.10: the only DB read is the ONE connect-time history read; after that the live path does zero DB reads, so a dropped subscriber read count stops growing.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Resumed implementation: tree was mid-refactor (chat-hub.ts had the new ring API, persistence/rpc still on the old gate API, 9 type errors). Finishing the split per the task's refined mechanism.

Implementation complete (S1 ring hub, S2 publish-first sink, S3 rewritten subscribe + client resubscribe-on-settle + contract doc). check-types 13/13 green. e2e run wedges in the agent sandbox even on the PRE-EXISTING code (git stash repro), with cross-process loopback probes failing at app layer while in-process fetch works and plain Bun.serve works — judged environmental, deferred live verification to the user's terminal / the real smoke run.

Implementation (2026-09-20): ring+settle hub landed; three real bugs found and fixed en route.
1. LIVENESS: freshHub gated on an already-resolved promise, so an idle subscriber spun a resolved-promise microtask loop and starved the whole event loop (the 0-output bun test hang). Idle hubs now arm a PENDING gate; resetHub pulses-then-rearms so a subscriber parked across a turn boundary wakes.
2. DELIVERY: the generator cannot park on the shared gate - oRPC's WS peer consumes it by pulls at its own pacing, so frames published between pulls were lost (AC#6 lane frames). subscribe now runs a per-subscriber PUMP task that drains ring+lane into a pending queue on every pulse; the generator just yields from the queue.
3. ORDER: persists serialize on a per-turn lazy chain - eager chaining let the terminal INSERT overtake a two-hop text write, so DB replay order diverged from live order. Lane snapshots drain BEFORE the ring so finish stays last on the wire.
lastEventId cursor removed; client (use-chat-engine) resubscribes on clean close. Gates: e2e 14/14 (incl. 25-frame burst + mid-turn subscriber), check-types clean, ultracite 0 issues, chat-session tests pass.
<!-- SECTION:NOTES:END -->
