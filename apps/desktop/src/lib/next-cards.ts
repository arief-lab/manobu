import { queryOptions } from "@tanstack/react-query";

import { orpc } from "./orpc";

interface NextCard {
  jp: string;
  level: string;
  reading: string;
  vocabId: number;
}

const isTauriAvailable = (): boolean =>
  typeof window !== "undefined" && "__TAURI__" in window;

/*
 * TASK-67: the corpus files load through LEVEL_LOADERS — an explicit
 * Record of five static-import call sites, one per level file.
 *
 * The old `import(`@manobu/japanese/data/${fileLevel}.json`)` could not
 * be analyzed by the bundler: it emitted the bare package specifier
 * verbatim into the production bundle, where no import map exists to
 * resolve it — so the offline fallback threw in the Tauri build and
 * every jlpt/anime offline user silently got the static placeholder
 * cards below. Vite dev masked it (node resolution serves package
 * paths), and only ONE data chunk (the static `n4.json` import in the
 * "work" branch) ever made it into dist/assets.
 *
 * `import.meta.glob` is the other option; rejected because the pattern
 * cannot address a bare package specifier without reaching into
 * node_modules paths. Five literals are explicit and bundler-visible.
 */
type LevelFile = "n1" | "n2" | "n3" | "n4" | "n5";

const LEVEL_LOADERS: Record<LevelFile, () => Promise<{ default: unknown }>> = {
  n1: () => import("@manobu/japanese/data/n1.json"),
  n2: () => import("@manobu/japanese/data/n2.json"),
  n3: () => import("@manobu/japanese/data/n3.json"),
  n4: () => import("@manobu/japanese/data/n4.json"),
  n5: () => import("@manobu/japanese/data/n5.json"),
};

/**
 * Local fallback: load the level corpus from the bundle and return the
 * first 3 entries as NextCards. No fetch, no AI call, never throws —
 * returns a static 3-card set (id = index+1) when the corpus cannot be
 * loaded.
 */
export const loadLocalNextCards = async (
  level: string
): Promise<NextCard[]> => {
  const normalized = level.toLowerCase();
  const allowed = new Set<LevelFile>(["n5", "n4", "n3", "n2", "n1"]);
  const fileLevel: LevelFile = allowed.has(normalized as LevelFile)
    ? (normalized as LevelFile)
    : "n5";
  const fallbackLevel = fileLevel.toUpperCase();
  try {
    const mod = await LEVEL_LOADERS[fileLevel]();
    const data = mod.default as ReadonlyArray<{
      word?: string;
      jp?: string;
      reading?: string;
      kana?: string;
    }>;
    const cards: NextCard[] = [];
    for (let i = 0; i < data.length && cards.length < 3; i += 1) {
      const entry = data[i];
      if (!entry) {
        continue;
      }
      const jp = entry.word ?? entry.jp ?? "";
      const reading = entry.reading ?? entry.kana ?? "";
      if (!jp) {
        continue;
      }
      cards.push({
        jp,
        level: fallbackLevel,
        reading,
        vocabId: i + 1,
      });
    }
    if (cards.length > 0) {
      return cards;
    }
  } catch {
    // fall through to static fallback
  }
  return [
    { jp: "私", level: fallbackLevel, reading: "わたし", vocabId: 1 },
    { jp: "東", level: fallbackLevel, reading: "ひがし", vocabId: 2 },
    { jp: "食べる", level: fallbackLevel, reading: "たべる", vocabId: 3 },
  ];
};

export const nextCardsQueryOptions = (
  level: string,
  goal: "travel" | "jlpt" | "anime" | "work" = "travel"
) =>
  queryOptions({
    gcTime: 1000 * 60 * 5,
    queryFn: async () => {
      // Offline-first: when Tauri is absent, do not make an AI/network call
      // at all — go straight to the local corpus.
      if (!isTauriAvailable()) {
        const { nextCards } = await nextCardsForGoal(level, goal);
        return { nextCards };
      }
      // TASK-71 phase 4: typed oRPC call replaces the hand-rolled
      // fetchJsonWithFallback on /learn/nextCards. Any failure (incl. the
      // typed TOO_MANY_REQUESTS rate limit) falls back to the local corpus
      // exactly like the legacy fetch-failure path did.
      try {
        const data = await orpc.learn.nextCards({
          level: level as "N5" | "N4" | "N3" | "N2" | "N1",
        });
        if (data.nextCards.length > 0) {
          return data;
        }
      } catch {
        // fall through to the local corpus
      }
      const { nextCards } = await nextCardsForGoal(level, goal);
      return { nextCards };
    },
    queryKey: ["nextCards", level, goal] as const,
    retry: 1,
    staleTime: 1000 * 60,
  });

/**
 * `work` goal slice: read the bundled N4 corpus and take the first three
 * entries that carry a word + reading. The corpus shape is loose (word/jp
 * and reading/kana aliases), so each entry is normalized here; an empty or
 * unreadable corpus falls back to the level corpus via loadLocalNextCards.
 */
const workCardsFromN4 = async (
  level: string
): Promise<{ nextCards: NextCard[] }> => {
  const mod = await import("@manobu/japanese/data/n4.json");
  const data = mod.default as ReadonlyArray<{
    jp?: string;
    kana?: string;
    reading?: string;
    word?: string;
  }>;
  const cards: NextCard[] = [];
  for (let i = 0; i < data.length && cards.length < 3; i += 1) {
    const entry = data[i];
    if (!entry) {
      continue;
    }
    const jp = entry.word ?? entry.jp ?? "";
    const reading = entry.reading ?? entry.kana ?? "";
    if (!jp) {
      continue;
    }
    cards.push({
      jp,
      level: level.toUpperCase(),
      reading,
      vocabId: i + 1,
    });
  }
  return {
    nextCards: cards.length > 0 ? cards : await loadLocalNextCards(level),
  };
};

export async function nextCardsForGoal(
  level: string,
  goal: "travel" | "jlpt" | "anime" | "work" = "travel"
): Promise<{ nextCards: NextCard[] }> {
  switch (goal) {
    case "travel": {
      const mod = await import("@manobu/japanese/data/phrases.json");
      const data = mod.default as ReadonlyArray<{
        id: string;
        category: string;
        level: string;
        jp: string;
        en: string;
        reading: string;
        romaji: string;
        themes: readonly string[];
        context: string;
      }>;
      const slice = data.slice(0, 3);
      const cards: NextCard[] = slice.map((p, i) => ({
        jp: p.jp,
        level: level.toUpperCase(),
        reading: p.reading,
        vocabId: i + 1,
      }));
      return { nextCards: cards };
    }
    case "jlpt": {
      const cards = await loadLocalNextCards(level);
      return { nextCards: cards };
    }
    case "anime": {
      return nextCardsForGoal(level, "jlpt");
    }
    case "work": {
      return workCardsFromN4(level);
    }
    default:
      return { nextCards: await loadLocalNextCards(level) };
  }
}
