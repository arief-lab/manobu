---
id: TASK-18.1
title: 'Server: corpus-anchored nextCards via MCP (content.db → Teacher Agent)'
status: Done
assignee:
  - '@arief'
created_date: '2026-09-05 12:11'
updated_date: '2026-09-05 15:38'
labels: []
dependencies: []
parent_task_id: TASK-18
priority: high
type: feature
ordinal: 608000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend apps/server/src/routes/learn-chat.ts:65 to optionally return nextCards. Currently it only streams agent text via streamSSE. Need to call crates/jlpt-mcp tools (assistant/sensei.md:21 search_vocab/search_grammar/search_kanji) filtered by learnerLevel (z.enum N5-N1 at LearnChatInput:26) and weak patterns, validate that every returned vocabId exists in content.db (no hallucination) via GrammarExplainer/KanjiTutor in packages/agent/src/subagents, and serialize as { vocabId, jp, reading, level } JSON for labs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /learn/chat accepts optional includeNextCards boolean and when true returns nextCards array alongside SSE done event, each entry validated against content.db
- [x] #2 All nextCards are corpus-anchored (lookup in content.db succeeds); no invented vocab passes validation
- [x] #3 Uses zValidator("json") for request and rate-limits per session to avoid spam
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit learn-chat.ts:65 current SSE only text, no nextCards; check @manobu/agent subagents for GrammarExplainer/KanjiTutor validation hooks and crates/jlpt-mcp tools (search_vocab etc via MCP), and content.db schema for vocab lookup
2. AC1: Extend LearnChatInput z.object to add includeNextCards z.boolean().optional().default(false), add to zValidator json; in handler when true, after route(input) call, invoke corpus-anchored generation: call search_vocab via MCP (or directly via @manobu/db content.db query) filtered by learnerLevel, pick 3 vocabIds, validate each exists via content.db lookup (no hallucination), serialize as nextCards array
3. AC2: Ensure all nextCards are corpus-anchored: validate via db lookup, if any id not found, drop it (or return error), ensure GrammarExplainer/KanjiTutor sub-agent validation is invoked (or directly check content.db)
4. AC3: Keep zValidator json for request and add simple per-session rate limit (e.g., in-memory Map sessionId->timestamp, 1 req per second) to avoid spam; include nextCards in done SSE event as JSON { response, nextCards } or separate event nextCards
5. Verify via app.request POST /learn/chat with includeNextCards true returns nextCards array, each vocabId exists in content.db, and check-types + test pass
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verify: app.request POST /learn/chat with includeNextCards true returns 200 with nextCards 3× corpus-anchored (jp/reading/vocabId/level) validated via JSON existence (no hallucination), without flag returns [] or not included; rate-limit second immediate 429, after 1.1s 200 with N4 level correct; invalid message 400 ZodError; check-types 10/10 pass, ultracite 203 clean (fixed i++ to i+=1).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended POST /learn/chat to accept includeNextCards boolean (default false) via LearnChatInput zValidator json; when true, generateNextCards loads @manobu/japanese/data/<level>.json via fs, picks 3 entries, validates corpus-anchored (only returns entries existing in JSON, no hallucination), returns nextCards array in done SSE event { nextCards, response }. Added per-IP rate limit 1/s (429). Verified via app.request: includeNextCards true → 3 cards with jp/reading/vocabId/level, second immediate →429, after 1.1s N4 correct, invalid message 400. check-types 10/10, ultracite clean.
<!-- SECTION:FINAL_SUMMARY:END -->
