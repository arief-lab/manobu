import type {
  AgentOption,
  ModelCatalog,
  PersonaOption,
} from "@manobu/api-contract";
import { isDefinedError, safe } from "@orpc/client";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { orpc } from "./orpc";
import { acpCommandsToItems, type SlashCommandItem } from "./slash";

const EMPTY_MODEL_CATALOG: ModelCatalog = {
  authRequired: false,
  available: [],
  current: null,
  supportsSwitching: false,
};

/** TASK-102 AC#5: an installed-but-signed-out agent, told apart from one that
 * simply has no models, so the picker can prompt a sign-in. */
const AUTH_REQUIRED_MODEL_CATALOG: ModelCatalog = {
  authRequired: true,
  available: [],
  current: null,
  supportsSwitching: false,
};

const STALE_TIME = 1000 * 60;

export const agentCatalogQueryOptions = queryOptions({
  gcTime: 1000 * 60 * 5,
  queryFn: async (): Promise<{ agents: AgentOption[] }> => {
    const [error, data] = await safe(orpc.acp.agents.list());
    if (data) {
      return { agents: data.agents };
    }
    if (isDefinedError(error)) {
      // A typed server answer is a settled state, not transient: fall
      // back without churning the retry budget (TASK-80.8 AC#4).
      return { agents: [] };
    }
    // Network failure: re-throw so TanStack retries (retry: 2).
    throw error;
  },
  queryKey: ["agents"] as const,
  retry: 2,
  staleTime: STALE_TIME,
});

export const personaCatalogQueryOptions = queryOptions({
  gcTime: 1000 * 60 * 5,
  queryFn: async (): Promise<{
    assistants: PersonaOption[];
    default: string | undefined;
  }> => {
    const [error, data] = await safe(orpc.acp.assistants.list());
    if (data) {
      return { assistants: data.assistants, default: data.default };
    }
    if (isDefinedError(error)) {
      return { assistants: [], default: undefined };
    }
    throw error;
  },
  queryKey: ["assistants"] as const,
  retry: 2,
  staleTime: STALE_TIME,
});

export const modelCatalogQueryOptions = (agentId: string | undefined) =>
  queryOptions({
    enabled: Boolean(agentId),
    gcTime: 1000 * 60 * 5,
    queryFn: async ({
      queryKey,
    }: {
      queryKey: readonly unknown[];
    }): Promise<ModelCatalog> => {
      const [, id] = queryKey as readonly [string, string, string];
      const [error, data] = await safe(orpc.acp.agents.models({ id }));
      if (data) {
        return data;
      }
      if (isDefinedError(error)) {
        // AUTH_REQUIRED (TASK-102 AC#5): installed but signed out, a distinct
        // picker state. Any other defined error (e.g. NOT_FOUND) is a
        // legitimate empty catalog, not transient (TASK-80.8 AC#4).
        if (error.code === "AUTH_REQUIRED") {
          return AUTH_REQUIRED_MODEL_CATALOG;
        }
        return EMPTY_MODEL_CATALOG;
      }
      throw error;
    },
    queryKey: ["agents", agentId ?? "", "models"] as const,
    retry: 2,
    staleTime: STALE_TIME,
  });

/**
 * Fetches the ACP agent catalog via TanStack Query from `GET /agents`.
 * Cached with staleTime 60s, gcTime 5m, hierarchical key ["agents"].
 * Signal support ensures cancellation on unmount or key change.
 */
export function useAgentCatalog(): { available: AgentOption[] } {
  const { data } = useQuery(agentCatalogQueryOptions);
  return { available: data?.agents ?? [] };
}

/**
 * Fetches the persona catalog via TanStack Query from `GET /assistants`.
 * Returns `{ available, defaultPersonaId }` with key ["assistants"].
 */
export function usePersonaCatalog(): {
  available: PersonaOption[];
  defaultPersonaId: string | undefined;
} {
  const { data } = useQuery(personaCatalogQueryOptions);
  return {
    available: data?.assistants ?? [],
    defaultPersonaId: data?.default,
  };
}

/**
 * Fetches the model's catalog for one agent via TanStack Query.
 * Key ["agents", agentId, "models"], enabled only when agentId is set.
 * Returns empty catalog while loading or when disabled.
 */
export function useModelCatalog(agentId: string | undefined): ModelCatalog {
  const { data } = useQuery(modelCatalogQueryOptions(agentId));
  if (!agentId) {
    return EMPTY_MODEL_CATALOG;
  }
  return data ?? EMPTY_MODEL_CATALOG;
}

// ── Composer slash commands (TASK-80.5 AC#1 data feed) ───────────────

/**
 * The query key for one conversation's authoritative slash snapshot
 * (shared with the provider's agent-switch invalidation, TASK-80.5).
 */
export function slashCommandsQueryKey(
  conversationId: string
): readonly [string, string, string] {
  return ["chat", "slash", conversationId];
}

/**
 * The authoritative snapshot of the composer's slash commands
 * (TASK-80.5 AC#1): fetch-link `chat.slashCommands` per conversation.
 *
 * `known` is the gate (TASK-157): a session id exists only after the first
 * `chat.send`, so for a conversation the server has never heard of this
 * request CANNOT succeed, and asking anyway put a 404 in every fresh chat's
 * network log. Once the conversation is known, NOT_FOUND is still a legal
 * answer (the session may be mid-creation), so the bare-catch degrade to
 * `[]` stays and the live `available_commands` frames populate the menu in
 * the meantime. `retry: 0`: NOT_FOUND is not transient. gcTime 5m (the LRU;
 * TanStack dedupes in-flight).
 */
export const slashCommandsQueryOptions = (
  conversationId: string,
  known: boolean
) =>
  queryOptions({
    enabled: known,
    gcTime: 1000 * 60 * 5,
    queryFn: async (): Promise<SlashCommandItem[]> => {
      try {
        const data = await orpc.chat.slashCommands({ conversationId });
        return acpCommandsToItems(data.commands);
      } catch {
        return [];
      }
    },
    queryKey: slashCommandsQueryKey(conversationId),
    retry: 0,
    staleTime: STALE_TIME,
  });

/**
 * The composer's authoritative slash snapshot for one conversation
 * (TASK-80.5 AC#1): `commands` is the fetch snapshot; `version` (TanStack
 * `dataUpdatedAt`) gates the live overlay - a WS push applies only when
 * it is newer (the provider's `shouldApplyOverlay`). `known` is the
 * TASK-157 gate: no snapshot is fetched for a conversation the server
 * has not confirmed.
 */
// Stable so the provider's memo dependencies do not churn while the
// query has no settled data.
const EMPTY_SLASH_COMMANDS: SlashCommandItem[] = [];

export function useSlashCommands(
  conversationId: string,
  known: boolean
): {
  commands: SlashCommandItem[];
  version: number;
} {
  const { data, dataUpdatedAt } = useQuery(
    slashCommandsQueryOptions(conversationId, known)
  );
  return { commands: data ?? EMPTY_SLASH_COMMANDS, version: dataUpdatedAt };
}
