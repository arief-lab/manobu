---
id: TASK-103
title: 'Chat: surface the context/token usage frame the pipeline already produces'
status: Done
assignee:
  - '@arif'
created_date: '2026-09-22 05:27'
updated_date: '2026-09-23 08:42'
labels: []
dependencies: []
priority: low
type: feature
ordinal: 786000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The context-usage number is carried the whole way and dropped at the last step. The engine emits it (packages/acp/src/session.ts:495, normalised at packages/acp/src/translator/context.ts:66), the server persists it (apps/server/src/chat-persistence.ts:238) and the wire schema defines it (packages/api-contract/src/schemas/chat-frames.ts:212), but packages/chat-session/src/chat-engine/transform.ts:76 lists acp_context_usage in TRANSIENT_FRAME_TYPES, so it folds to no card and no component consumes it. The learner therefore has no idea how full the agent context is: a long conversation quietly degrades and eventually fails, and nothing on screen explains why the answer got worse or stopped. AionUi renders a dedicated context-usage indicator with warning and danger tiers, and AionCore keeps the value durable behind a per-conversation usage endpoint precisely so a reaped runtime does not blank the indicator.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The chat surface shows how much of the agent context window the current conversation has used
- [x] #2 The indicator has warning and danger states before the window is exhausted, not only after
- [x] #3 The value survives a reload and an agent-session restart rather than coming only from a live frame
- [x] #4 The reading is the agents own reported figure; the UI never divides by a guessed window size to invent a percentage
- [x] #5 A test covers the fold from persisted frame to rendered value
- [x] #6 packages/chat-session/AGENTS.md records why acp_context_usage left the transient set
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research finding: the pipeline is complete end-to-end (engine emits acp_context_usage at packages/acp/src/translator/context.ts:66, server persists it at apps/server/src/chat-persistence.ts, wire shape { used, size, cost? } at packages/api-contract/src/schemas/chat-frames.ts:209). The ONLY gap is client-side: transform.ts lists acp_context_usage in TRANSIENT_FRAME_TYPES so it folds to no card, and nothing renders it. Plan is entirely client-side, no server/contract/engine change.

1. chat-engine/types.ts: add TMessageContextUsage card (used:number, size:number, cost?:{amount,currency}|null, type:"acp_context_usage") + isContextUsageCard guard; add to TMessage union.
2. chat-engine/folds/simple.ts: foldContextUsage — singleton id `usage:{conversation_id}`, upsertCard replace so latest frame/row wins per conversation.
3. chat-engine/transform.ts: remove acp_context_usage from TRANSIENT_FRAME_TYPES; add foldContextUsage to CARD_FOLDS; update the header doc comment.
4. chat-engine/usage.ts (new): latestContextUsage(cards) -> {cost,size,used}|null (greatest created_at); contextUsageView(card) -> percent = size>0 ? round(used/size*100) : null + tier (normal <70, warning 70-89, danger >=90, unknown when percent null). AC#4: only agent-reported size, never a guessed window. Export from chat-engine/index.ts.
5. message-transcript.tsx: filter acp_context_usage cards out of the bubble map (it renders in the header, not the transcript).
6. routes/ai.tsx: derive usage from the merged transcript, render a compact context chip in the header with warning/danger color states (AC#1/#2).
7. Tests (chat-session, no DOM): transform fold of an acp_context_usage frame -> one usage card; persisted row via cardsFromRows -> usage card -> latestContextUsage -> contextUsageView percent/tier (AC#3/#5). Add to chat-engine.test.ts.
8. DOX: packages/chat-session/AGENTS.md records why acp_context_usage left the transient set (AC#6).

Verify: bun run -F @manobu/chat-session check-types; bun test packages/chat-session; bun run -F desktop check-types; bun x ultracite check on touched files.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented client-side only (research confirmed the whole server/engine/contract path already delivers acp_context_usage; the sole gap was transform.ts folding it to no card).

Changed:
- chat-engine/types.ts: TMessageContextUsage card + isContextUsageCard guard; added to TMessage union.
- chat-engine/folds/simple.ts: foldContextUsage (singleton id usage:{conversation_id}, upsertCard replace).
- chat-engine/transform.ts: moved acp_context_usage out of TRANSIENT_FRAME_TYPES into CARD_FOLDS; header doc updated.
- chat-engine/usage.ts (new): latestContextUsage + contextUsageView (percent clamped, tier normal/warning 70-89/danger >=90/unknown; AC#4 no guessed size). Exported from chat-engine/index.ts.
- message-transcript.tsx: filter acp_context_usage out of the bubble map.
- apps/desktop/src/routes/ai.tsx: ContextUsageChip in the header derived from the merged transcript (survives reload/restart via cardsFromRows); added ./chat-engine subpath export to package.json for the import.
- Tests: chat-session/context-usage.test.ts (live fold, singleton, persisted-row path, thresholds, zero-size). Updated the transient-frames test + regenerated golden snapshots (usage now a card).
- DOX: packages/chat-session/AGENTS.md records why acp_context_usage left the transient set.

Verify: chat-session check-types 0; bun test packages/chat-session 198 pass; desktop check-types 0; desktop tests 392 pass; ultracite check clean on all touched files. Not yet live-driven in the browser.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Surfaced the context-window reading the pipeline already produces. The only gap was client-side: transform.ts folded acp_context_usage to no card. Made it a durable per-conversation card (singleton id usage:{conversation_id}) so cardsFromRows re-folds the persisted row on reload / agent restart, and rendered a header chip on /ai.

Changed: chat-engine types.ts (TMessageContextUsage + guard + union), folds/simple.ts (foldContextUsage), transform.ts (moved out of TRANSIENT_FRAME_TYPES into CARD_FOLDS), new usage.ts (latestContextUsage + contextUsageView: percent clamped, tier normal/warning>=70/danger>=90/unknown when size<=0; AC#4 never divides by a guessed window), index.ts exports, message-transcript.tsx (filter usage out of bubbles), apps/desktop routes/ai.tsx (ContextUsageChip in the header from the merged transcript), package.json (./chat-engine subpath export), AGENTS.md (AC#6). Tests: context-usage.test.ts (live fold + singleton replace, persisted-row -> card -> selector -> percent/tier, thresholds, zero-size); updated the transient-frames test and regenerated golden snapshots.

Verified: bun test packages/chat-session 198 pass; chat-session + desktop check-types exit 0; desktop tests 392 pass; ultracite clean on all touched files. Live drive (sidecar + Vite + headless Chromium, no agent running so the value came ONLY from the persisted DB row): /ai?c=<id> rendered data-testid=context-usage with data-tier=danger data-percent=95 (text "context 95%") and a distinct data-tier=warning data-percent=75 (amber) conversation; screenshots confirmed the chip in the header with the "You" bubble from the DB. Seeded rows and temp scripts removed; dev servers stopped.
<!-- SECTION:FINAL_SUMMARY:END -->
