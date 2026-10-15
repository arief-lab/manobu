/*
 * POST /learn/chat · Teacher Agent orchestrator SSE endpoint (spec §TASK-1.16).
 *
 * Accepts `{ message, learnerLevel, vocabIds?, includeNextCards? }` and routes through the
 * `@manobu/agent` orchestrator. Emits a stream of SSE events:
 *   event: agent     data: {"agent":"grammar"}
 *   event: token     data: {"delta":"..."}
 *   event: done      data: {"response":{...}, "nextCards": [...]}
 *
 * v1 doesn't call a real LLM provider (provider registry is empty). The
 * response body is the typed `AgentResponse` from the sub-agent, rendered
 * as readable text via a small formatter per agent. When includeNextCards
 * is true, nextCards are corpus-anchored from content.db via search_vocab
 * filtered by learnerLevel.
 */

import { zValidator } from "@hono/zod-validator";
import {
  type AgentResponse,
  createProviderRegistry,
  type ProviderRegistry,
  route,
} from "@manobu/agent";
import { LevelQuerySchema } from "@manobu/api-contract/schemas/jap-data";
import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { generateNextCards } from "../services/next-cards";

const LearnChatInput = z.object({
  includeNextCards: z.boolean().optional().default(false),
  learnerLevel: z.enum(["N5", "N4", "N3", "N2", "N1"]),
  message: z.string().min(1).max(2000),
  vocabIds: z.array(z.number().int().nonnegative()).max(50).optional(),
});

// TASK-56: bounded rate-limit map. Keys are client IPs · attacker-
// controllable via X-Forwarded-For · so the map must never grow without
// bound: entries expire after RATE_WINDOW_MS since their last request
// (swept on a lazy interval) and the map hard-caps at RATE_MAX_KEYS
// (oldest-inserted entries dropped; Map iteration is insertion order).
const rateLimitMap = new Map<string, number>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_KEYS = 10_000;

const sweepRateLimitMap = (now: number): void => {
  for (const [key, ts] of rateLimitMap) {
    if (now - ts > RATE_WINDOW_MS) {
      rateLimitMap.delete(key);
    } else {
      // insertion-ordered: newest last, so the first fresh entry ends
      // the sweep · everything after is fresher.
      break;
    }
  }
};

// The agent reply is rendered by one formatter per block shape. They are
// direct named exports (not just __test__ members): the __test__ namespace
// import is invisible to fallow's static coverage estimation, so everything
// reached only through it is scored at worst-case CRAP regardless of tests.
export const formatConversationResponse = (
  r: Extract<AgentResponse, { agent: "conversation" }>
): string => {
  if (r.corrections.length === 0) {
    return "Looks good · no surface corrections.";
  }
  return r.corrections
    .map((c) => `Correction: "${c.original}" → "${c.corrected}" (${c.reason})`)
    .join("\n");
};

export const formatGrammarResponse = (
  r: Extract<AgentResponse, { agent: "grammar" }>
): string =>
  r.pattern
    ? `${r.pattern.pattern} (${r.pattern.level}) · ${r.pattern.meaning_en}`
    : "No grammar pattern matched your query.";

export const formatKanjiResponse = (
  r: Extract<AgentResponse, { agent: "kanji" }>
): string => {
  if (!r.decomposition) {
    return "No kanji found in your input.";
  }
  const d = r.decomposition;
  const joinList = (items: readonly string[]): string =>
    items.join(", ") || "–";
  return `${d.character} · strokes ${d.strokes} · on: ${joinList(d.on)} · kun: ${joinList(d.kun)} · meanings: ${joinList(d.meanings_en)}`;
};

export const formatVocabResponse = (
  r: Extract<AgentResponse, { agent: "vocab" }>
): string => {
  if (r.cards.length === 0) {
    return "No vocab cards due right now.";
  }
  return r.cards
    .map((c) => `vocab ${c.vocabId} · next review in ${c.intervalDays}d`)
    .join("\n");
};

const formatResponse = (r: AgentResponse): string => {
  switch (r.agent) {
    case "conversation":
      return formatConversationResponse(r);
    case "grammar":
      return formatGrammarResponse(r);
    case "kanji":
      return formatKanjiResponse(r);
    case "vocab":
      return formatVocabResponse(r);
    default: {
      // Exhaustiveness guard (packages/agent AGENTS.md: callers switch
      // exhaustively on the discriminated union). A new agent kind that
      // skips its formatter fails typecheck here, not at runtime.
      const unhandled: never = r;
      throw new Error(`unhandled agent response: ${String(unhandled)}`);
    }
  }
};

export const createLearnChatRoute = () => {
  const app = createFactory().createApp();
  // TASK-45: paths are relative to the /learn mount in index.ts · the old
  // /learn/*-prefixed paths double-mounted at /learn/learn/* and 404'd.
  app.post("/chat", zValidator("json", LearnChatInput), async (c) => {
    const input = c.req.valid("json");
    // Simple per-IP rate limit: 1 req/sec
    const ip =
      c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "global";
    const now = Date.now();
    if (now % 16 === 0) {
      // ~1/16 of requests pay the sweep · bounded work, no timer leak.
      sweepRateLimitMap(now);
    }
    const last = rateLimitMap.get(ip) ?? 0;
    if (now - last < 1000) {
      return c.json({ message: "Too Many Requests" }, 429);
    }
    while (rateLimitMap.size >= RATE_MAX_KEYS) {
      // oldest-inserted first (Map iteration order) · drop until under cap
      const oldest = rateLimitMap.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      rateLimitMap.delete(oldest);
    }
    rateLimitMap.set(ip, now);
    return await streamLearnChat(c, input, createProviderRegistry());
  });
  app.get("/nextCards", zValidator("query", LevelQuerySchema), async (c) => {
    const { level } = c.req.valid("query");
    const nextCards = await generateNextCards(level, 3);
    return c.json({ nextCards });
  });
  return app;
};

const streamLearnChat = async (
  c: Context,
  input: z.infer<typeof LearnChatInput>,
  _providers: ProviderRegistry
): Promise<Response> => {
  const response = await route(input);
  const nextCards = input.includeNextCards
    ? await generateNextCards(input.learnerLevel, 3)
    : [];
  return streamSSE(c, async (s) => {
    await s.writeSSE({
      data: JSON.stringify({ agent: response.agent }),
      event: "agent",
    });
    const text = formatResponse(response);
    for (const chunk of chunkText(text, 24)) {
      // biome-ignore lint/performance/noAwaitInLoops: SSE write order must be preserved · concurrent writes would interleave token events.
      await s.writeSSE({
        data: JSON.stringify({ delta: chunk }),
        event: "token",
      });
    }
    await s.writeSSE({
      data: JSON.stringify({ nextCards, response }),
      event: "done",
    });
  });
};

const chunkText = (text: string, size: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
};

export const __test__ = {
  chunkText,
  formatResponse,
  generateNextCards,
  rateLimitMap,
  RATE_MAX_KEYS,
  sweepRateLimitMap,
};
