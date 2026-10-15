# @manobu/agent

## Purpose

- Teacher Agent orchestrator for manobu (spec §TASK-1.16). Routes a learner's message to one of four sub-agents and composes a typed response. Provider registry (Google/OpenAI/Anthropic/Ollama) is an interface for v1; real adapters ship in Phase 2.

## Ownership

- Project contributors.

## Local Contracts

- Exposes
  - `@manobu/agent` — `route(ctx)` returns `AgentResponse` discriminated by `agent: "conversation" | "grammar" | "kanji" | "vocab"`.
  - `@manobu/agent/subagents` — the four sub-agent functions.
  - `ProviderRegistry` — interface; `createProviderRegistry()` factory; v1 ships an empty registry.
  - `systemPromptFor(agent, skills)` — looks up the skill body for a given sub-agent from a `Skill[]` (loaded via `@manobu/skills`).
- Sub-agents (each in `src/subagents/index.ts`)
  - `conversationCoachGrammarCheck(message)` — surface checks (end punctuation, double spaces). Stub.
  - `grammarExplainerLookupPattern(query)` — substring match over `@manobu/japanese/data/grammar/n*.json`.
  - `kanjiTutorDecompose(input)` — extracts first CJK ideograph + looks up `@manobu/japanese/data/kanji.json`.
  - `vocabSrsDueCards(vocabIds)` — the `good` day from `@manobu/srs` `previewIntervals({difficulty:5, stability:10}, 0.9, 0)`, i.e. an illustrative card's next gap, not a real schedule (no card is read or written). TASK-166 deleted the demo branch that used to answer 12 here regardless of the math, so this number now moves with the engine: 13.
- Intent classifier: keyword regex (kanji if CJK in input, grammar if hiragana/grammar-keywords, vocab if srs-keywords, otherwise conversation).
- Depends on
  - `@manobu/japanese` (data JSON; loaded lazily).
  - `@manobu/srs` (FSRS math).
  - `@manobu/skills` (markdown system prompts).
  - ~~`zod`~~ — dropped 2026-09-15 (zero imports; typed shapes are plain interfaces).

## Work Guidance

- Sub-agents must return typed `AgentResponse` shapes — no `any`. The orchestrator pattern depends on exhaustive `switch` in callers.
- The Kanji lookup inlines the data shape from `@manobu/japanese/data/kanji.json` because `packages/japanese` is data-only in TS — the heavy lifting happens in the Rust MCP server `crates/jlpt-mcp`. Keep the inlined shape narrow.
- Future: when a real LLM provider lands, replace the stub `conversationCoachGrammarCheck` body with a `streamText` call. The return shape stays the same.

## Verification

- `bun --filter @manobu/agent test` (8 cases — all 4 sub-agents + route classifier + intent).
- `bun --filter @manobu/agent check-types`.

## Child DOX Index

- `src/subagents/index.ts` — ConversationCoach + GrammarExplainer + KanjiTutor + VocabSRS implementations.