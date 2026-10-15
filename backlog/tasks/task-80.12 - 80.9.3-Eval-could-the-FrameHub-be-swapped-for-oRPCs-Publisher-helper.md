---
id: TASK-80.12
title: '80.9.3 Eval: could the FrameHub be swapped for oRPC''s Publisher helper'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-18 05:46'
updated_date: '2026-09-18 12:04'
labels:
  - orpc
  - ai-chat
  - backend
dependencies:
  - TASK-80.10
documentation:
  - 'https://orpc.dev/docs/helpers/publisher'
parent_task_id: TASK-80
priority: low
type: spike
ordinal: 690000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The TASK-80.8 oRPC docs audit noted that orpc.dev/docs/helpers/publisher is the doc's blessed recipe for chat-with-resume (publisher.subscribe({ signal, lastEventId }) + publisher.publish), and that we hand-roll the equivalent in apps/server/src/chat-hub.ts (the FrameHub gate + terminal lane + withEventMeta seq ids + parseEventId resume). The hand-rolled hub is a superset: per-conversation hubs with many concurrent subscribers, the in-memory stream-only terminal lane with last-writer-wins coalescing, and deterministic card ids are all intentional AionUi-parity choices (see packages/chat-session/AGENTS.md + the TASK-80.x audit notes). This task is an EVALUATION, not a rewrite: load orpc.dev/docs/helpers/publisher, map each FrameHub feature onto the helper's surface, and record the verdict (stay hand-rolled / adopt helper for the resume half / hybrid) in the implementation notes. Relevant only AFTER TASK-80.10 (signal handling in the subscribe drain) lands, since the audit flagged that adding signal handling is the step that makes the helper-swap question concrete. Do NOT start the swap without a verdict first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Implementation notes contain a feature-by-feature verdict (FrameHub gate / terminal lane / seq ids / multi-subscriber / resume vs the Publisher helper) with a stay/adopt/hybrid recommendation and rationale
- [x] #2 No code change to chat-hub.ts or chat-persistence.ts unless the verdict is adopt/hybrid AND a follow-up task is created; otherwise the spike closes as notes-only
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Evaluation: FrameHub (apps/server/src/chat-hub.ts) vs oRPC Publisher helper

Source read: chat-hub.ts (FrameHub/ChatContext/pulse/pushTerminalFrame), chat-rpc.ts (chat.subscribe drain + chat.send gate), chat-persistence.ts (sinkFor/persistFrame/drainRows/parseEventId/wireEventId). Docs: orpc.dev/docs/helpers/publisher via MCP.

### What the FrameHub actually is
Not a pub/sub fan-out. It is a **persistence-coupled wake gate**:
- **Gate** (hub.gate + pulse + waitForPulse): the turn's sink persists a row to SQLite, sets hub.closed on a terminal frame, then pulse(hub) resolves the shared gate promise and re-arms it. chat.subscribe's drain (drainFrom) waits one gate at a time and **re-reads the persisted tail** (listFramesAfter) — so 'publishing' is a DB write and 'subscribing' is a DB read on wake. Publisher and subscriber are decoupled through the DB + one shared promise.
- **Terminal lane** (terminalLane + terminalSeq + pushTerminalFrame): in-memory, stream-only lane for acp_terminal_output. One entry per terminal_id, **last-writer-wins** → bounded by concurrent hosted terminals, not output volume. Never persisted (0006 DDL). Frames carry replace: true → client reducer full-replaces the card per snapshot (AionUi cumulative-buffer parity).
- **seq ids = DB row seq**: wireEventId(row)=String(row.seq); drainRows yields each frame with withEventMeta(frame,{id:wireEventId}); parseEventId turns the client's lastEventId back into a seq cursor. In-place row growth (updateMessageByUiId) re-reads the new seq so live subscribers see an update, not a duplicate card.
- **Multi-subscriber**: one hub, many concurrent drains; each owns its own (persisted-seq, lane-seq) cursor → dev chat-history + ask-sensei both get the full stream on one conversation.
- **Resume**: durable + unbounded + restart-surviving — chat.subscribe re-reads the SQLite tail from lastEventId; a full reload days later replays full history (conversations persist in user.db).

### What the Publisher helper offers
publish(name, payload) + subscribe(name, { signal, lastEventId }) → iterator. Adapters: Memory / Redis / Upstash / Bun Redis / Cloudflare Durable. Resume support is **transient TTL only**: resume.enabled (default false) + resume.seconds (default 300 / 5 min); 'expired events cleaned up lazily'. When resume is on the publisher **auto-manages event ids and ignores any supplied id**; custom payloads must forward the auto id via getEventMeta/withEventMeta. Client reconnection via the Retry Plugin (auto) or manual lastEventId.

### Feature-by-feature verdict
| FrameHub feature | Publisher equivalent | Adoptable? |
|---|---|---|
| Wake gate (wait-for-row) | subscribe iterator | yes in principle |
| Terminal lane (stream-only, last-writer-wins, in-memory, bounded by terminal count) | none — pub/sub append + TTL replay; no per-key coalescing, no stream-only/never-persist tier | **no** (would hand-rebuild on top) |
| Deterministic seq = DB row | publisher auto-manages ids + IGNORES supplied ids | **no** (breaks durable resume + in-place row growth across restart) |
| Multi-subscriber on one conversation | subscribe supports many | yes |
| Resume: durable / unbounded / restart-surviving | transient 5-min TTL buffer, lazy cleanup | **no** (regression vs page-reload-days-later) |

### Recommendation: STAY (notes-only, no code change)
Three of the four core features have **no Publisher equivalent**: durable unbounded resume (we read SQLite, not a 5-min buffer), deterministic seq-ids-that-are-the-DB-rows (the publisher's auto-id/ignore-supplied-id directly conflicts with it), and the in-memory last-writer-wins terminal lane. Adopting would keep the DB persistence layer anyway and hand-rebuild the lane on top of a pub/sub we don't need; the transient resume would actually *regress* our reload guarantee. The helper fits a **transient-notification / multi-instance fan-out** use case (Redis/Upstash/Durable backends): the one scenario where it helps is when two sidecar processes must deliver one conversation to each other. Today the architecture is one createChatContext() per sidecar with no multi-instance requirement, and @orpc/publisher is not installed. **Hybrid (speculative, no driver today):** if a cross-instance fan-out or background worker ever needs to publish the same conversation, RedisPublisher/BunRedisPublisher would be the seam carrying the cross-instance wake — the terminal lane + durable seq resume stay ours. That is a follow-up task only if such a requirement lands; not part of this spike. No change to chat-hub.ts / chat-persistence.ts (both confirmed clean).

VALIDATION 2026-09-18: git status shows chat-hub.ts + chat-persistence.ts unmodified (spike closed notes-only, no follow-up task needed since the verdict is STAY). @orpc/publisher is not installed in the repo.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Evaluated the FrameHub (chat-hub.ts) against the oRPC Publisher helper (docs via MCP). STAY: the hub is a persistence-coupled wake gate over SQLite with a stream-only last-writer-wins terminal lane, deterministic seq-ids equal to the DB row seq, and durable unbounded resume; the Publisher's transient 5-min TTL resume + auto-managed ids (which ignore caller-supplied ids) cannot cover that, and it offers no per-key coalescing lane. Only true fit is cross-instance fan-out via Redis/Upstash/Durable backends, which has no driver in the current single-sidecar architecture. No code changed; no follow-up task.
<!-- SECTION:FINAL_SUMMARY:END -->
