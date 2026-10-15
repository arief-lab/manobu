---
id: TASK-18
title: >-
  AI-populated lab queues — hybrid template + corpus-aware generation (labs ↔
  Teacher Agent ↔ FSRS)
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 12:10'
updated_date: '2026-09-06 00:48'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 611000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Labs are static scaffolds with dummy data (apps/desktop/src/routes/review.tsx:6 SEED[3], apps/desktop/src/components/lesson.tsx:352 pickCards([10,11]), apps/desktop/src/routes/lesson.tsx:7) isolated from chat. Chat at apps/server/src/routes/learn-chat.ts:65 and apps/server/src/index.ts:153 is SSE but does not enqueue cards or derive weak patterns for lib/mock.ts:11 or lib/queue.ts:26. Gap is missing bridge: labs should keep deterministic shells (conjugate transform, roleplay goal+scoring, listen hear→type, jlpt sequential) but have next card populated by AI calling corpus via MCP (assistant/sensei.md:21 search_vocab/search_grammar/search_kanji via crates/jlpt-mcp), filtered by learnerLevel (z.enum N5-N1) and revlog leeches (lapses>4), then persisted via packages/db/src/schema/user.ts:9 cards/revlog and fsrs.rs:56 preview, with offline fallback to packages/japanese/data/n*.json when not in Tauri.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Extend POST /learn/chat to optionally return nextCards: Array<{ vocabId, jp, reading, level }> sourced from content.db via search_vocab(weakPattern) filtered by learnerLevel, and have at least one lab (conjugate or lesson) consume it via TanStack Query (TASK-2) to build its queue
- [x] #2 Queue remains interleaved 1 leech + 2 new via lib/queue.ts:26 pickCards, but data source is AI-populated not hardcoded [10,11]; leech selection uses revlog lapses>4 and weak patterns from lib/mock.ts:11 deriveWeakPatterns
- [x] #3 All generated cards are corpus-anchored (must exist in content.db vocab/kanji/grammar); no hallucinated vocab, validated by GrammarExplainer/KanjiTutor sub-agents in packages/agent/src/subagents
- [x] #4 Persist generated cards to user.db cards/revlog via createUserDb and preview intervals via fsrs_preview; review queue shows them and FSRS scheduling works
- [x] #5 Offline fallback: when __TAURI__ is false or MCP unavailable, queue falls back to local packages/japanese/data and lib/numbers.ts static sets, no AI call required — verify by disconnecting network and loading lesson
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Epic plan: 18.1 Server corpus-anchored nextCards via MCP, 18.2 Client lab queues consume via TanStack Query, 18.3 Persistence FSRS write-through to user.db, 18.4 Offline fallback local corpus, 18.5 QA weak-pattern quiz wiring. Complete subtasks one by one; this epic Done when all 5 subtasks Done and labs consume AI nextCards end-to-end.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AI-populated lab queues implemented end-to-end. Server POST /learn/chat now returns corpus-anchored nextCards via MCP (TASK-18.1), client consumes via TanStack Query useNextCards hook (TASK-18.2), FSRS write-through persists to user.db cards/revlog (TASK-18.3), offline fallback to local corpus when MCP/TAURI unavailable (TASK-18.4), and QA tests verify weak-pattern quiz wiring + anchored generation (TASK-18.5). Verified: check-types 10/10, ai-queue.test.ts 5/5 pass, offline-fallback.test.ts 4/4 pass, walkthrough-copies.test.ts 10/10 pass (incl. te-form weak pattern test).
<!-- SECTION:FINAL_SUMMARY:END -->
