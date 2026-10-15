/*
 * Kanji lookup (spec §SCR-09).
 *
 * Reads kanji/vocab data from the sidecar over the typed oRPC client
 * (`lib/orpc.ts`) instead of bundling @manobu/japanese/data JSON files. The
 * server reads the JSON files from disk and returns only what's requested.
 * This keeps the web bundle slim — no 8MB kanji chunk, no 1.5MB grammar chunks.
 *
 *   - `lookupKanji(character)` — async; `jap.kanji.find`
 *   - `vocabContaining(character, levels?)` — async; `jap.vocab.list` per level
 *
 * Stroke-order SVG paths come from `jap.kanji.stroke` via lib/kanjivg.ts
 * (KanjiVG ingestion, TASK-23.5.2).
 *
 * ## Server boundary
 *
 * One link decides the origin: `@manobu/chat-session/orpc` reads
 * VITE_SERVER_URL from @manobu/env/web. In Tauri desktop this points to the
 * sidecar (:4317); in web dev it's same-origin behind the vite /rpc proxy.
 */
import { orpc } from "./orpc";

export interface KanjiEntry {
  character: string;
  frequency: number | null;
  grade: number | null;
  jlpt: "N5" | "N4" | "N3" | "N2" | "N1" | null;
  kun: readonly string[];
  meaningsEn: readonly string[];
  on: readonly string[];
  strokeCount: number;
}

export interface VocabRow {
  /** First rendering of the first sense group (may be "" for rows without one). */
  gloss: string;
  level: "N5" | "N4" | "N3" | "N2" | "N1";
  reading: string;
  word: string;
}

/**
 * A server-declared NOT_FOUND (the character isn't in the corpus) is a real
 * answer; anything else (ConnectionRefused, a blocked origin, a 5xx) is the
 * service being unreachable and must NOT be rendered as "not found" or an
 * empty grid. Empirically: defined errors carry the declared code, transport
 * failures carry the fetch cause's code.
 */
const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "NOT_FOUND";

async function fetchKanji(character: string): Promise<KanjiEntry | null> {
  try {
    // TASK-71 phase 4: typed oRPC call replaces GET /api/kanji?character=.
    const entry = await orpc.jap.kanji.find({ character });
    // The contract's jlpt is `string | null`; the consumer type narrows to
    // the JLPT union. Narrow via the level list to stay honest at runtime.
    const jlpt = (["N5", "N4", "N3", "N2", "N1"] as const).find(
      (l) => l === entry.jlpt
    );
    return {
      character: entry.character,
      frequency: entry.frequency,
      grade: entry.grade,
      jlpt: jlpt ?? null,
      kun: entry.kun,
      meaningsEn: entry.meaningsEn,
      on: entry.on,
      strokeCount: entry.strokeCount,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export const lookupKanji = fetchKanji;

export const vocabContaining = async (
  character: string,
  levels: readonly VocabRow["level"][] = ["N5", "N4", "N3", "N2", "N1"]
): Promise<readonly VocabRow[]> => {
  // Fetch vocab from all requested levels and filter client-side.
  // For v1, fetch all 5 levels (each is ~100KB uncompressed on server).
  const requested: readonly VocabRow["level"][] =
    levels.length > 0 ? levels : ["N5", "N4", "N3", "N2", "N1"];
  const failures: unknown[] = [];
  const fetchPromises = requested.map(async (lvl) => {
    try {
      const data = await orpc.jap.vocab.list({ level: lvl });
      return {
        entries: data.vocab.map((v) => ({
          // The headline gloss is the first rendering of the first sense group,
          // which the server projects as `gloss`. Splitting `meaning" on ";"
          // instead mangles any gloss containing ";" inside parentheses.
          gloss: v.gloss ?? "",
          level: lvl,
          reading: v.reading,
          word: v.word,
        })),
        level: lvl,
      };
    } catch (error) {
      failures.push(error);
      return null;
    }
  });
  const results = await Promise.all(fetchPromises);
  // Every requested level failed = the service is unreachable, not "no
  // words contain this kanji". Surface it so the UI can say so honestly.
  // A partial failure still degrades to the levels that answered.
  if (results.length > 0 && results.every((r) => r === null)) {
    throw failures[0] instanceof Error
      ? failures[0]
      : new Error("vocab fetch failed for every requested level");
  }
  const vocabByLevel: Partial<Record<VocabRow["level"], VocabRow[]>> = {};
  for (const result of results) {
    if (result) {
      vocabByLevel[result.level] = result.entries;
    }
  }

  const out: VocabRow[] = [];
  for (const lvl of requested) {
    const pool = vocabByLevel[lvl] ?? [];
    for (const v of pool) {
      if (v.word.includes(character)) {
        out.push(v);
      }
    }
  }
  return out;
};

export const __test__ = {
  // Local test data for kanji tests without server.
  // These are used by kanji.test.ts which can't rely on VITE_SERVER_URL.
  testLookupKanji: (character: string): KanjiEntry | null => {
    // Minimal test data for 食 (the character used in tests)
    if (character === "食") {
      return {
        character: "食",
        frequency: 100,
        grade: 2,
        jlpt: "N5",
        kun: ["た.べる", "く.う", "く.らう", "は.む"],
        meaningsEn: ["eat", "food"],
        on: ["ショク"],
        strokeCount: 9,
      };
    }
    return null;
  },
};
