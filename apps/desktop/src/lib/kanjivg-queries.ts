/**
 * KanjiVG stroke query layer (TASK-23.5.2 — TanStack Router loader
 * convention, Tier 1 per `apps/desktop/src/components/AGENTS.md`).
 *
 * Thin wrapper over `lib/kanjivg.ts` exposing `strokesQueryOptions` +
 * `useKanjiStrokes` so `routes/kanji/$character.tsx` can preload stroke data
 * via `ensureQueryData` alongside the existing kanji lookup.
 */

import { queryOptions, useQuery } from "@tanstack/react-query";

import { lookupStrokes, type StrokeOrderData } from "./kanjivg";

const strokesQueryOptions = (character: string) =>
  queryOptions({
    gcTime: 1000 * 60 * 30,
    networkMode: "offlineFirst" as const,
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<StrokeOrderData | null> => {
      // lookupStrokes doesn't consume the signal today (fetch without
      // abort wiring, matching lib/kanji.ts); threaded for cache
      // cancellation semantics and future signal-aware refactors.
      signal.throwIfAborted();
      const data = await lookupStrokes(character);
      return data;
    },
    queryKey: ["kanji-strokes", character] as const,
    retry: false,
    staleTime: 1000 * 60 * 30,
  });

export function useKanjiStrokes(character: string) {
  return useQuery(strokesQueryOptions(character));
}
