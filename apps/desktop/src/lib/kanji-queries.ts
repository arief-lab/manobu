/**
 * Kanji query layer (TASK-25.2 — TanStack Router loader convention).
 *
 * Thin wrapper over `lib/kanji.ts` that exposes `kanjiQueryOptions` +
 * `useKanji` so `routes/kanji-detail.tsx` can `loader` →
 * `queryClient.ensureQueryData(kanjiQueryOptions(character))` instead of
 * hand-rolling the fetch inside the component.
 *
 * `lib/kanji.ts` stays unchanged (it carries the test-only `__test__` export
 * that `kanji.test.ts` consumes, plus the raw `lookupKanji` function used
 * elsewhere). This module is the new query surface.
 */

import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  type KanjiEntry,
  lookupKanji,
  type VocabRow,
  vocabContaining,
} from "./kanji";
import { orpc } from "./orpc";

export const kanjiQueryOptions = (character: string) =>
  queryOptions({
    gcTime: 1000 * 60 * 5,
    networkMode: "offlineFirst" as const,
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<{
      entry: KanjiEntry | null;
      vocab: readonly VocabRow[];
    }> => {
      // Server-side lookupKanji uses fetch() but ignores the signal. For
      // best-effort cache cancellation we still pass it through. Honest
      // failures (2026-09-14): a genuine corpus miss is entry=null + empty
      // vocab; an unreachable server REJECTS here (lib/kanji.ts propagates
      // anything but the declared NOT_FOUND), so the route's errorComponent
      // says "Failed to load kanji" instead of pretending the character
      // doesn't exist.
      const [entry, vocab] = await Promise.all([
        lookupKanji(character),
        vocabContaining(character),
      ]);
      // Touch the signal so the linter + future signal-aware refactors see
      // it threaded; harmless no-op for now.
      signal.throwIfAborted();
      return { entry, vocab };
    },
    queryKey: ["kanji", character] as const,
    retry: 1,
    staleTime: 1000 * 60 * 5,
  });

export interface KanjiListRow {
  character: string;
  gloss: string;
  jlpt: string | null;
  strokeCount: number;
}

/**
 * TASK-37 AC1: list mode for the /kanji index grid — all kanji of one
 * JLPT level from the server (same file as the detail lookup, filtered
 * server-side; 79 N5 → 1232 N1 rows).
 *
 * Failures REJECT (they used to be swallowed into `{rows: []}`, which made
 * an unreachable server — wrong port, CORS-blocked origin, sidecar down —
 * render as "No kanji listed for N5 yet", a lie the learner cannot act on).
 * The grid owns the error state + retry.
 */
export const kanjiListQueryOptions = (
  level: "N5" | "N4" | "N3" | "N2" | "N1"
) =>
  queryOptions({
    gcTime: 1000 * 60 * 30,
    networkMode: "offlineFirst" as const,
    // TASK-71 phase 4: typed oRPC call replaces GET /api/kanji?level=.
    queryFn: () => orpc.jap.kanji.list({ level }),
    queryKey: ["kanji", "list", level] as const,
    retry: 1,
    staleTime: 1000 * 60 * 30,
  });

/**
 * Client-side filter over the loaded rows (TASK-75): English gloss or the
 * character itself, case-insensitive; empty query passes everything. The
 * whole level is already in the kanjiListQueryOptions cache, so search
 * costs no server round-trip per keystroke.
 */
export const filterRows = (
  rows: readonly KanjiListRow[],
  query: string
): readonly KanjiListRow[] => {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return rows;
  }
  return rows.filter(
    (r) => r.character.includes(q) || (r.gloss ?? "").toLowerCase().includes(q)
  );
};

export function useKanji(character: string) {
  return useQuery(kanjiQueryOptions(character));
}
