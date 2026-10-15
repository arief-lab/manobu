/*
 * Sensei status (first-run rail) — the async probe + a PURE state
 * derivation, per the approved design: react-query owns effects
 * (probe/cache/refetch), `deriveSensei` owns the transitions. Mirrors
 * dashboard.tsx's `__test__ = { computeBranch }` pattern.
 *
 * Detection truth source: `acp.agents.list` — the sidecar already
 * greps $PATH for every registry CLI (opencode → claude → gemini →
 * codex → copilot → kilo → agy) and reports `installed` per agent.
 * No new server surface needed; web-dev without the sidecar falls to
 * `offline`, which the rail renders as "sensei stays asleep — the app
 * still works" (drills NEVER blocked by AI, SCR-02 contract).
 */

import type { AgentOption, AgentsOutput } from "@manobu/api-contract";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";

export type SenseiState =
  | { kind: "cli-missing" }
  | { kind: "detecting" }
  | {
      agent: string;
      agentId: string;
      installed: readonly AgentOption[];
      kind: "local-found";
    }
  | { kind: "offline" };

export const SENSEI_STATUS_QUERY_KEY = ["sensei", "status"] as const;

const senseiStatusOptions = queryOptions({
  queryFn: async (): Promise<AgentsOutput> => await orpc.acp.agents.list(),
  // A dead sidecar is an EXPECTED first-run state (offline laptop),
  // not a transient failure — don't retry-spam, don't refetch on focus.
  queryKey: SENSEI_STATUS_QUERY_KEY,
  refetchOnWindowFocus: false,
  retry: false,
  staleTime: 5 * 60 * 1000,
});

/** Pure branch picker — the whole "machine". Transitions are data.
 * `preferredId` is the user's chosen CLI (chat-session persisted
 * agent); a stale/unknown id falls back to registry order. */
const deriveSensei = (input: {
  error: boolean;
  data: AgentsOutput | undefined;
  pending: boolean;
  preferredId?: string;
}): SenseiState => {
  if (input.pending) {
    return { kind: "detecting" };
  }
  if (input.error || !input.data) {
    return { kind: "offline" };
  }
  const installed = input.data.agents.filter((agent) => agent.installed);
  const chosen =
    installed.find((agent) => agent.id === input.preferredId) ?? installed[0];
  if (!chosen) {
    return { kind: "cli-missing" };
  }
  return {
    agent: chosen.displayName,
    agentId: chosen.id,
    installed,
    kind: "local-found",
  };
};

/** The rail + settings consumer hook. */
export const useSenseiStatus = (
  preferredId?: string
): {
  state: SenseiState;
  refetch: () => void;
} => {
  const { data, isError, isPending, refetch } = useQuery(senseiStatusOptions);
  const state = deriveSensei({
    data,
    error: isError,
    pending: isPending,
    preferredId,
  });
  return {
    refetch: () => {
      refetch().catch(() => undefined);
    },
    state,
  };
};

export const __test__ = { deriveSensei };
