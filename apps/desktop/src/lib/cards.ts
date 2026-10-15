/*
 * The due queue (spec §SCR-01 desk tile).
 *
 * TASK-40 AC7: the row carries the vocab snapshot (jp/reading/level) stored
 * at insert time (migration 0005), so a surface renders real words instead
 * of "vocab {id}".
 *
 * TASK-155: the options are exported because the dashboard tile and the
 * review desk must be ONE query. Two consumers of one key cannot disagree
 * about how many cards are due; two queryKeys could. The grade write lives
 * beside it for the same reason: the write and the read it invalidates are
 * one contract, and splitting them across files is how they drift.
 */
import type {
  GradeInput,
  GradeOutput,
} from "@manobu/api-contract/schemas/cards";
import {
  type QueryClient,
  queryOptions,
  type UseMutationOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { orpc } from "./orpc";

const cardsDueKey = ["cards", "due"] as const;

export const cardsDueQueryOptions = queryOptions({
  gcTime: 1000 * 60 * 5,
  networkMode: "offlineFirst",
  queryFn: async () => {
    // A sidecar that is down or answering 5xx has no queue to show, and the
    // desk renders "nothing due" rather than an error tile. Same degradation
    // the raw `GET /api/cards/due` had; the difference is that a healthy
    // response is now schema-validated instead of `as`-cast.
    try {
      return await orpc.cards.due();
    } catch {
      // A dead sidecar has no queue to describe, so the surfaces say nothing is
      // due rather than invent a size. `deckCount: 0` over a deck the learner
      // does own is the price of that degradation, which the raw route paid the
      // same way before this read was schema-validated.
      return { cards: [], deckCount: 0, dueCount: 0, nextDue: null };
    }
  },
  queryKey: cardsDueKey,
  retry: 1,
  staleTime: 1000 * 30,
});

export function useCardsDue() {
  return useQuery(cardsDueQueryOptions);
}

type GradeCardMutationOptions = UseMutationOptions<
  GradeOutput,
  Error,
  GradeInput,
  unknown
>;

export const gradeCardMutationOptions = (
  queryClient: QueryClient
): GradeCardMutationOptions => ({
  mutationFn: async (input) => await orpc.cards.grade(input),
  networkMode: "offlineFirst",
  onSuccess: async () => {
    // The desk's session IS this list (TASK-155 decision A: no local index),
    // so the write has to bring it back. Without the invalidation the graded
    // card stays at the head and the learner grades it twice.
    await queryClient.invalidateQueries({ queryKey: cardsDueKey });
  },
  // An FSRS grade is not idempotent: re-sending one re-schedules the card a
  // second time from a state the learner never saw. A lost write is retried
  // by the learner pressing a grade again, which is a decision, not a retry.
  retry: 0,
});

export function useGradeCard() {
  const queryClient = useQueryClient();
  return useMutation(gradeCardMutationOptions(queryClient));
}
