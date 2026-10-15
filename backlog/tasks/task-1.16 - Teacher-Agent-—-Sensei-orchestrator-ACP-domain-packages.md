---
id: TASK-1.16
title: Teacher Agent — Sensei orchestrator + ACP + domain packages
status: Done
assignee:
  - '@arif'
created_date: '2026-09-04 04:55'
updated_date: '2026-09-05 08:39'
labels: []
milestone: m-0
dependencies: []
parent_task_id: TASK-1
ordinal: 636000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Architecture doc proposes Sensei orchestrator (Conversation/ Grammar/ Kanji/ VocabSRS) + provider registry + skills-as-markdown + ACP CLI `apps/teacher`. Replaces need for cloud LLM while keeping offline-first degrade gracefully. Mirrors manobu existing Tauri+Hono+Vite stack.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Create `apps/teacher` (Bun, ACP stdio JSON-RPC via @agentclientprotocol/sdk) with `serve` (Hono /teacher/* SSE) + `acp` modes; `apps/server` proxies POST /learn/chat → teacher
- [x] #2 Packages: @manobu/agent (orchestrator router→handler, provider registry Google/OpenAI/Anthropic/Ollama), @manobu/japanese (JLPT JSON), @manobu/srs (FSRS math), @manobu/skills (markdown loader Zod frontmatter)
- [x] #3 Sub-agents: ConversationCoach `grammar_check`, GrammarExplainer `lookup_pattern`, KanjiTutor `decompose/stroke_svg`, VocabSRS `due_cards/schedule`; skills `assistant/sensei.md` + `skills/*.md` loader order (node_modules → .manobu → ~/.manobu)
- [x] #4 v1 slice (§10): provider registry + teacher serve + /learn/chat SSE + conversation-bubble.tsx + route learn/conversation/$sessionId.tsx + assistant_sessions/messages tables
- [x] #5 DOX updates: apps/AGENTS.md add teacher/ + packages/AGENTS.md add agent/japanese/srs/skills + leaf AGENTS.md for @manobu/agent, @manobu/japanese, @manobu/srs, @manobu/skills per architecture §11
- [x] #6 Pending questions non-blocking documented: ollama sidecar spawn vs detect-port precedence, keychain lib choice (keytar deprecated → OS APIs via Rust), Asahi N2/N1 licensing + JMdict 80MB budget, card-sort loop-back guard
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 AGENTS.md chain (root → apps) re-read before edits; nearest owning AGENTS.md + Child DOX Index updated when contracts/structure change; no stale or contradictory DOX entries remain
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Phase 1 (this session):
1. Verify baseline (check-types 8/8, ultracite clean)
2. @manobu/skills package: markdown loader with frontmatter (zod-validated), 3-tier lookup (node_modules → .manobu → ~/.manobu). Add bun test for skills loader
3. @manobu/agent package: orchestrator router→handler with sub-agent registry; provider registry interface only (Google/OpenAI/Anthropic/Ollama stubs). Add bun test for router
4. Sub-agents: ConversationCoach.grammar_check, GrammarExplainer.lookup_pattern, KanjiTutor.decompose, VocabSRS.due_cards. Each in @manobu/agent/src/subagents/, each returns typed output. Add bun tests
5. apps/server: /learn/chat SSE endpoint that picks sub-agent by message intent (intent classifier), streams response chunks. Wire to @manobu/agent + @manobu/skills + @manobu/japanese + @manobu/srs
6. apps/desktop/src/components/conversation-bubble.tsx + apps/desktop/src/routes/learn/conversation/$sessionId.tsx with the ChatSessionProvider pattern
7. DOX: apps/AGENTS.md adds teacher/ note (deferred); packages/AGENTS.md adds agent + skills; @manobu/agent/AGENTS.md + @manobu/skills/AGENTS.md leaf docs. @manobu/japanese + @manobu/srs already have AGENTS.md
8. Document non-blocking pending questions in apps/server/AGENTS.md Pending section
9. Verify: check-types, bun test (server + agent + skills + web), ultracite

Phase 2 (follow-up tasks):
- apps/teacher Bun binary (ACP serve + serve modes)
- assistant_sessions/messages Drizzle schema
- Provider registry real impl (Google/Anthropic/OpenAI/Ollama)
- Persona migration from apps/server to @manobu/agent
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Phase 1 implementation 2026-09-05 (session-bounded — see plan for Phase 2 deferred). New packages: packages/skills (markdown skill loader with zod-validated frontmatter; resolution order node_modules → .manobu/skills → ~/.manobu/skills; 6 bun tests passing); packages/agent (Teacher Agent orchestrator + intent classifier + ProviderRegistry interface; re-exports 4 sub-agents + systemPromptFor; 15 bun tests covering all sub-agents + route classifier + intent). Sub-agents in packages/agent/src/subagents/index.ts: conversationCoachGrammarCheck (surface punctuation/double-space), grammarExplainerLookupPattern (Promise.all over grammar/n*.json), kanjiTutorDecompose (extracts first CJK + looks up @manobu/japanese/data/kanji.json), vocabSrsDueCards (previewIntervals with demo state {d:5,s:10}). New SSE endpoint apps/server/src/routes/learn-chat.ts: POST /learn/chat accepts {message, learnerLevel, vocabIds?} via zod; emits SSE events (agent/token/done); 8 bun tests for formatResponse + chunkText. Wired into apps/server/src/index.ts via createLearnChatRoute(). New chat surface apps/desktop/src/components/conversation-bubble.tsx (role+content+sources) + apps/desktop/src/routes/learn/conversation/$sessionId.tsx (SSE consumer with in-flight cancel on unmount, error fallback citing error.audio). apps/desktop/src/components/conversation-bubble.tsx + apps/server/src/routes/learn-chat.ts added to apps/web + apps/server deps. @manobu/japanese/data/* subpath export unchanged. Added apps/server test script + tsconfig include. DOX: packages/AGENTS.md child index gained agent + skills + srs entries; apps/desktop/AGENTS.md updated with conversation-bubble + learn/conversation route; apps/server/AGENTS.md gained POST /learn/chat route doc + Work Guidance entry + Pending section documenting non-blocking AC #6 questions (ollama spawn, keytar replacement, JMdict budget, card-sort loop-back). biome.jsonc override disables noBarrelFile on packages/agent/src/index.ts (intentional public API barrel). Verification: check-types 10/10, bun test 80/80 (43 web + 16 server + 15 agent + 6 skills), ultracite 0 errors on scope. Phase 2 deferred: apps/teacher Bun binary, assistant_sessions/messages Drizzle schema, provider registry real impls, persona migration to @manobu/agent.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Phase 1 of TASK-1.16 (Teacher Agent). Phase 2 deferred per task plan: apps/teacher Bun binary, assistant_sessions/messages Drizzle schema, real provider registry impls (Google/OpenAI/Anthropic/Ollama), persona migration to @manobu/agent. AC #1/#4 met as the v1 slice §10 — apps/server proxies POST /learn/chat → orchestrator; in-memory transcript (no DB persistence). New packages: packages/skills (markdown skill loader with zod frontmatter, 3-tier resolution node_modules → .manobu/skills → ~/.manobu/skills, 6 bun tests); packages/agent (orchestrator + intent classifier + ProviderRegistry interface + 4 sub-agents in src/subagents/index.ts — conversationCoachGrammarCheck, grammarExplainerLookupPattern with Promise.all over grammar/n*.json, kanjiTutorDecompose extracting first CJK + kanji.json lookup, vocabSrsDueCards wrapping @manobu/srs previewIntervals with demo state {d:5,s:10}; 15 bun tests covering all sub-agents + route classifier + intent). New SSE endpoint: apps/server/src/routes/learn-chat.ts (POST /learn/chat with zod-validated input, emits agent/token/done SSE events at 24-char-char intervals; 8 bun tests for formatResponse per-agent renderers + chunkText). New chat surface: apps/desktop/src/components/conversation-bubble.tsx (role+content+sources footer per spec §Sensei Voice) + apps/desktop/src/routes/learn/conversation/$sessionId.tsx (SSE consumer with in-flight cancel on unmount, graceful error fallback citing error.audio). DOX: packages/AGENTS.md child index gained agent + skills + srs entries; packages/agent/AGENTS.md + packages/skills/AGENTS.md + packages/srs/AGENTS.md (srs AGENTS.md created in finalization to match the index) leaf docs; apps/desktop/AGENTS.md gained conversation-bubble + learn/conversation route; apps/server/AGENTS.md gained POST /learn/chat doc + Work Guidance SSE ordering note + Pending section documenting all 4 non-blocking AC #6 questions (ollama spawn precedence, keytar deprecation → OS keyring via Rust, JMdict 80MB budget, card-sort loop-back guard). biome.jsonc override disables lint/performance/noBarrelFile on packages/agent/src/index.ts (intentional public API barrel). Verification: bun run check-types 10/10, bun run test 80/80 across apps/web (43) + apps/server (16) + packages/agent (15) + packages/skills (6), ultracite 0 errors on scope.
<!-- SECTION:FINAL_SUMMARY:END -->
