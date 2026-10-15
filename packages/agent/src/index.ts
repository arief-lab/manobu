/*
 * Teacher Agent orchestrator (spec §TASK-1.16).
 *
 * Routes a learner's message to the right sub-agent based on intent, then
 * composes the response. v1 picks by simple keyword heuristics — a future
 * iteration can swap in a learned classifier without changing the
 * sub-agent API surface.
 *
 * Sub-agents (each in `src/subagents/`):
 *   - ConversationCoach  — grammar_check
 *   - GrammarExplainer    — lookup_pattern
 *   - KanjiTutor          — decompose
 *   - VocabSRS            — due_cards
 *
 * Provider registry (Google / OpenAI / Anthropic / Ollama) is an interface
 * only for v1 — actual adapters land in TASK-1.16 Phase 2.
 */

import type { Skill } from "@manobu/skills";
import {
  conversationCoachGrammarCheck,
  grammarExplainerLookupPattern,
  kanjiTutorDecompose,
  vocabSrsDueCards,
} from "./subagents";

export {
  conversationCoachGrammarCheck,
  grammarExplainerLookupPattern,
  kanjiTutorDecompose,
  vocabSrsDueCards,
} from "./subagents";

export type SubAgentId = "conversation" | "grammar" | "kanji" | "vocab";

export interface AgentContext {
  learnerLevel: "N5" | "N4" | "N3" | "N2" | "N1";
  message: string;
  vocabIds?: readonly number[];
}

export type AgentResponse =
  | { agent: "conversation"; corrections: readonly ConversationCorrection[] }
  | { agent: "grammar"; pattern: GrammarPatternResult | null }
  | { agent: "kanji"; decomposition: KanjiDecomposition | null }
  | { agent: "vocab"; cards: readonly VocabDueCard[] };

export interface ConversationCorrection {
  corrected: string;
  original: string;
  reason: string;
}

export interface GrammarPatternResult {
  id: string;
  level: "N5" | "N4" | "N3" | "N2" | "N1";
  meaning_en: string;
  pattern: string;
}

export interface KanjiDecomposition {
  character: string;
  kun: readonly string[];
  meanings_en: readonly string[];
  on: readonly string[];
  strokes: number;
}

export interface VocabDueCard {
  intervalDays: number;
  vocabId: number;
}

export interface ProviderRegistry {
  get: (
    id: "google" | "openai" | "anthropic" | "ollama"
  ) => Provider | undefined;
  list: () => readonly Provider[];
  register: (p: Provider) => void;
}

export interface Provider {
  id: "google" | "openai" | "anthropic" | "ollama";
  models: readonly string[];
}

const KANJI_HINT = /(kanji|stroke|読み|漢字)/;
const CJK = /[㐀-鿿豈-﫿]/;
const HIRAGANA = /[ぁ-ゖ]/;
const GRAMMAR_HINT =
  /(grammar|te-form|polite|copula|conditional|grammar point)/;
const VOCAB_HINT = /(review|srs|due|interval|fsrs)/;

const createProviderRegistry = (): ProviderRegistry => {
  const byId = new Map<string, Provider>();
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    register: (p) => {
      byId.set(p.id, p);
    },
  };
};

export { createProviderRegistry };

const classify = (message: string): SubAgentId => {
  const lower = message.toLowerCase();
  if (KANJI_HINT.test(lower) || CJK.test(message)) {
    return "kanji";
  }
  if (GRAMMAR_HINT.test(lower) || HIRAGANA.test(message)) {
    return "grammar";
  }
  if (VOCAB_HINT.test(lower)) {
    return "vocab";
  }
  return "conversation";
};

export const route = async (ctx: AgentContext): Promise<AgentResponse> => {
  const agent = classify(ctx.message);
  if (agent === "conversation") {
    const corrections = await conversationCoachGrammarCheck(ctx.message);
    return { agent: "conversation", corrections };
  }
  if (agent === "grammar") {
    const pattern = await grammarExplainerLookupPattern(ctx.message);
    return { agent: "grammar", pattern };
  }
  if (agent === "kanji") {
    const decomposition = await kanjiTutorDecompose(ctx.message);
    return { agent: "kanji", decomposition };
  }
  const cards = await vocabSrsDueCards(ctx.vocabIds ?? []);
  return { agent: "vocab", cards };
};

const SKILL_NAME: Record<SubAgentId, string> = {
  conversation: "ConversationCoach",
  grammar: "GrammarExplainer",
  kanji: "KanjiTutor",
  vocab: "VocabSRS",
};

export const systemPromptFor = (
  agent: SubAgentId,
  skills: readonly Skill[]
): string => {
  const name = SKILL_NAME[agent];
  return findSkillLocal(skills, name)?.body ?? `${name} (no skill loaded)`;
};

const findSkillLocal = (skills: readonly Skill[], name: string): Skill | null =>
  skills.find((s) => s.frontmatter.name === name) ?? null;

export { __test__ as __subagentTest__ } from "./subagents";

export const __test__ = { classify, createProviderRegistry };
