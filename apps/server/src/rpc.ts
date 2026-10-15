/*
 * oRPC contract implementation (TASK-71 phase 3) — `implement(contract)`
 * handlers delegating to the same service functions the legacy Hono routes
 * use. Mounted by RPCHandler at /rpc in index.ts; legacy routes stay until
 * the desktop cutover (phase 4), so every procedure here must behave
 * identically to its legacy twin.
 *
 * Per the orpc-contract skill's monorepo recipe: the contract VALUE is
 * imported from @manobu/api-contract (implement walks it at runtime), while
 * this module lives in the server app because handlers need the server's
 * real dependencies (db, ACP pool, persona table).
 */

import { listAgentCandidates } from "@manobu/acp";
import type { AcpConfigOption } from "@manobu/acp/acp-events";
import { listAgents } from "@manobu/acp/registry";
import { contract } from "@manobu/api-contract";
import type { UserDatabase } from "@manobu/db/item-store";
import { cards } from "@manobu/db/schema/user";
import { COMMON_ERROR_STATUS_MAP, implement } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { ChatContext } from "./chat-hub";
import { type ChatDeps, createChatHandlers } from "./chat-rpc";
import { controller, DEFAULT_PERSONA_ID, ensureAcp, personas } from "./context";
import { createExamHandlers } from "./exam-rpc";
import { isoDay, selectDueQueue } from "./services/due-queue";
import { gradeCardById } from "./services/grading";
import {
  listGrammarService,
  listKanjiByLevelService,
  listVocabService,
  lookupKanjiService,
  strokeOrderService,
} from "./services/jap-data";
import { generateNextCards } from "./services/next-cards";
import { getUserDb as defaultUserDb } from "./user-db";

// TASK-53 DI seam parity: legacy createCardsRoute(getUserDbOverride) lets
// tests inject an isolated db. The RPC router carries the same seam.
export type GetUserDb = () => Promise<UserDatabase>;

/**
 * Fetch-/rpc error-status map (TASK-80.11): oRPC's default
 * `COMMON_ERROR_STATUS_MAP` + the chat surface's custom codes, so a
 * second tap on a running conversation and a rejected agent config
 * switch read as 409 / 400 at the wire instead of the 500 default.
 * `@orpc/server/fetch` and the test harness share this one map.
 */
export const chatErrorStatusMap = {
  ...COMMON_ERROR_STATUS_MAP,
  AUTH_REQUIRED: 401,
  CONFIG_SWITCH_FAILED: 400,
  CONFLICT: 409,
  CONVERSATION_BUSY: 409,
  INVALID_REQUEST: 400,
  NOT_READY: 409,
} satisfies Record<string, number>;

// Lazy, and shared with chat-store and routes/cards - see user-db.ts for why a
// module-scope handle made the process's database an import-order accident.
const defaultGetUserDb: GetUserDb = defaultUserDb;

export function createRpcHandlers(
  deps: ChatDeps = {},
  getUserDb: GetUserDb = defaultGetUserDb
) {
  const os = implement(contract).$context<ChatContext>();
  // ── cards ───────────────────────────────────────────────────────

  const createCards = os.cards.create.handler(async ({ input }) => {
    const db = await getUserDb();
    const now = isoDay(new Date());
    const results = await Promise.all(
      input.cards.map(async (card) => {
        const existing = await db
          .select()
          .from(cards)
          .where(
            and(eq(cards.level, card.level), eq(cards.vocabId, card.vocabId))
          )
          .then((rows) => rows[0]);
        if (existing) {
          return null;
        }
        const inserted = await db
          .insert(cards)
          .values({
            due: now,
            jp: card.jp,
            level: card.level,
            reading: card.reading,
            vocabId: card.vocabId,
          })
          .returning({ id: cards.id });
        return inserted[0]?.id ?? null;
      })
    );
    return { inserted: results.filter((id): id is number => id !== null) };
  });

  const dueCards = os.cards.due.handler(async () => {
    const db = await getUserDb();
    // TASK-164: the due queue, not a card browser - only rows whose day has
    // arrived. TASK-165: the read also carries the queue's real size, the
    // deck's, and the next scheduled day. See services/due-queue.ts.
    return await selectDueQueue(db);
  });

  // TASK-53: grading pipeline lives in services/grading.ts — FSRS
  // transition, revlog append, and lookup as separate steps.
  // TASK-166: the retention the learner set travels in the request, so the
  // day written here is the day the desk's buttons previewed.
  const gradeCard = os.cards.grade.handler(async ({ input, errors }) => {
    const db = await getUserDb();
    const card = await gradeCardById(
      db,
      input.cardId,
      input.grade,
      input.desiredRetention
    );
    if (!card) {
      throw errors.NOT_FOUND({ data: { message: "card not found" } });
    }
    return { card };
  });

  // ── jap ─────────────────────────────────────────────────────────

  const kanjiFind = os.jap.kanji.find.handler(async ({ input, errors }) => {
    const entry = await lookupKanjiService(input.character);
    if (!entry) {
      throw errors.NOT_FOUND({ data: { message: "Kanji not found" } });
    }
    return entry;
  });

  const kanjiList = os.jap.kanji.list.handler(async ({ input }) => {
    const rows = await listKanjiByLevelService(input.level);
    return { level: input.level, rows };
  });

  const kanjiStroke = os.jap.kanji.stroke.handler(async ({ input, errors }) => {
    const result = await strokeOrderService(input.character);
    if (result === "no-data") {
      throw errors.NOT_FOUND({
        data: { message: "No stroke data for character" },
      });
    }
    if (result === "corrupt") {
      throw errors.NOT_FOUND({ data: { message: "Corrupt stroke data" } });
    }
    return result;
  });

  const grammarList = os.jap.grammar.list.handler(async ({ input }) => {
    const grammar = await listGrammarService(input.level);
    return { grammar };
  });

  const vocabList = os.jap.vocab.list.handler(async ({ input }) => {
    const vocab = await listVocabService(input.level);
    return { vocab };
  });

  // ── acp ─────────────────────────────────────────────────────────

  const agentsList = os.acp.agents.list.handler(() => {
    // Mirrors GET /agents — registry agents + $PATH install check.
    const installed = new Set(listAgentCandidates().map((c) => c.name));
    return {
      agents: listAgents().map((spec) => ({
        command: spec.command,
        displayName: spec.displayName,
        id: spec.id,
        installed: installed.has(spec.command),
      })),
    };
  });

  const assistantsList = os.acp.assistants.list.handler(() => {
    // Mirrors GET /assistants — the boot-loaded persona table (context.ts).
    return {
      assistants: [...personas.values()].map((persona) => ({
        description: persona.description ?? null,
        id: persona.slug,
        name: persona.name,
      })),
      default: DEFAULT_PERSONA_ID,
    };
  });

  const agentModels = os.acp.agents.models.handler(
    async ({ input, errors }) => {
      // The native engine exposes models as a config option (the modern
      // ACP path) — `configOptions` is the catalog, `model` selects one.
      try {
        const handle = await ensureAcp(input.id);
        const options = await controller.configOptions(handle);
        return configOptionsToCatalog(options);
      } catch (error) {
        // TASK-102 AC#4: an installed-but-signed-out agent fails the open
        // with a typed auth rejection. This synchronous path is where the
        // picker learns "signed out" (a distinct 401, not a 404), because
        // there is no cheap anonymous probe of a CLI's auth state.
        if ((error as { code?: string }).code === "AUTH_REQUIRED") {
          throw errors.AUTH_REQUIRED({
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
        // The legacy route answers 404 with an empty catalog instead of a
        // 500 — callers treat a dead agent as "switchable: no", not failure.
        throw errors.NOT_FOUND({
          data: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  );

  // ── learn ───────────────────────────────────────────────────────

  const nextCards = os.learn.nextCards.handler(async ({ input }) => {
    // Mirrors GET /learn/nextCards — corpus-anchored generation
    // (services/next-cards.ts), shared with the legacy route.
    return { nextCards: await generateNextCards(input.level, 3) };
  });
  return os.router({
    ...createChatHandlers(deps, os.chat),
    acp: {
      agents: { list: agentsList, models: agentModels },
      assistants: { list: assistantsList },
    },
    cards: { create: createCards, due: dueCards, grade: gradeCard },
    exam: createExamHandlers(os.exam, getUserDb),
    jap: {
      grammar: { list: grammarList },
      kanji: { find: kanjiFind, list: kanjiList, stroke: kanjiStroke },
      vocab: { list: vocabList },
    },
    learn: { nextCards },
  });
}

/** Config options → the `ModelCatalog` the picker consumes. Reaching here
 * means the session opened, so the agent is signed in: `authRequired:false`.
 * A signed-out agent never returns a catalog — it throws AUTH_REQUIRED above. */
function configOptionsToCatalog(options: AcpConfigOption[]): {
  authRequired: boolean;
  available: string[];
  current: string | null;
  supportsSwitching: boolean;
} {
  const models = options.find((option) => option.id === "model");
  if (models?.type !== "select") {
    return {
      authRequired: false,
      available: [],
      current: null,
      supportsSwitching: false,
    };
  }
  return {
    authRequired: false,
    available: models.options.map((option) => option.value),
    current: models.currentValue as string,
    supportsSwitching: true,
  };
}
