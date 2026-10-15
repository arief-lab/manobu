/*
 * GET /kanji?character=<char> — kanji lookup (spec §SCR-09).
 * GET /kanji/stroke?character=<char> — KanjiVG stroke order (TASK-23.5.2).
 * GET /grammar?level=<N5-N1> — grammar list by level.
 *
 * Reads @manobu/japanese/data JSON files server-side so the desktop client
 * doesn't bundle the 8MB kanji dict or 1.5MB grammar corpora.
 * The server has filesystem access to packages/japanese/data.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zValidator } from "@hono/zod-validator";
import type { KanjiListRow } from "@manobu/api-contract";
import { LevelQuerySchema } from "@manobu/api-contract/schemas/jap-data";
import type { Hono } from "hono";
import { createFactory, type Factory } from "hono/factory";
import { z } from "zod";
import { resolveDataDir } from "../data-dir";
import { strokeOrderService } from "../services/jap-data";

const japDataFactory: Factory = createFactory();

// TASK-43: import.meta.dir is /$bunfs inside the compiled sidecar — the
// repo-relative walk only works in `bun run src/index.ts`. resolveDataDir()
// tries MANOBU_DATA_DIR (set by lib.rs to the resource-dir copy), the dev
// walk, cwd, and exe-parent candidates.
const DATA_DIR =
  resolveDataDir() ??
  join(import.meta.dir, "../../../../packages/japanese/data");

// The KanjiVG stroke parser lives in services/jap-data.ts (shared with the
// oRPC handler). This route used to carry a second copy; the two diverged
// and the naive attribute() returned stroke IDs as path data. One parser.

function toJlpt(old: number | null): "N5" | "N4" | "N3" | "N2" | "N1" | null {
  switch (old) {
    case 4:
      return "N5";
    case 3:
      return "N4";
    case 2:
      return "N3";
    case 1:
      return "N2";
    default:
      return null;
  }
}

function getLevelFile(level: string): string {
  const lower = level.toLowerCase();
  if (["n5", "n4", "n3", "n2", "n1"].includes(lower)) {
    return join(DATA_DIR, `${lower}.json`);
  }
  return join(DATA_DIR, "n5.json");
}

function getGrammarFile(level: string): string {
  const lower = level.toLowerCase();
  if (["n5", "n4", "n3", "n2", "n1"].includes(lower)) {
    return join(DATA_DIR, "grammar", `${lower}.json`);
  }
  return join(DATA_DIR, "grammar", "n5.json");
}

export interface KanjiRecord {
  character: string;
  frequency: number | null;
  grade: number | null;
  jlpt_old: number | null;
  jlpt_waller: string | null;
  meanings: { en?: string[] };
  readings: { on?: string[]; kun?: string[] };
  stroke_count: number;
}

const parseKanjiFile = (raw: string): KanjiRecord[] => {
  // Unchecked shape assertion mirrors the grammar/vocab readers below —
  // data/kanji.json is repo-local, and a bad shape throws into the
  // handler's catch (500), same as the previous inline cast did.
  const data = JSON.parse(raw) as { kanji: KanjiRecord[] };
  return data.kanji;
};

// List mode (TASK-37 index grid): kanji.json rows projected for one JLPT
// level; the grid renders character + first gloss, so anything past the
// first English meaning is dropped.
export const kanjiListRows = (
  kanji: readonly KanjiRecord[],
  level: string
): KanjiListRow[] =>
  kanji
    .filter((k) => k.jlpt_waller === level)
    .map((k) => ({
      character: k.character,
      gloss: k.meanings.en?.[0] ?? "",
      jlpt: k.jlpt_waller,
      strokeCount: k.stroke_count,
    }));

// Kanji have no letter case, but romaji-IME input still reaches this route
// (single Latin chars pass the query validator). Matching tries the raw
// character plus its case-foldings so "a" finds an "A"-keyed record.
export const findKanjiEntry = (
  kanji: readonly KanjiRecord[],
  character: string
): KanjiRecord | undefined => {
  const lower = character.toLowerCase();
  const upper = character.toUpperCase();
  return kanji.find(
    (k) =>
      k.character === character ||
      k.character === lower ||
      k.character === upper
  );
};

// Storage record → API DTO: jlpt_waller wins, else the retired numeric
// jlpt_old is mapped through toJlpt; missing reading/meaning arrays render
// as empty lists.
export const toKanjiResponse = (entry: KanjiRecord) => ({
  character: entry.character,
  frequency: entry.frequency,
  grade: entry.grade,
  jlpt: entry.jlpt_waller ?? toJlpt(entry.jlpt_old),
  kun: entry.readings.kun ?? [],
  meaningsEn: entry.meanings.en ?? [],
  on: entry.readings.on ?? [],
  strokeCount: entry.stroke_count,
});

export const createJapDataRoute = (): Hono => {
  const app = japDataFactory.createApp();

  app.get(
    "/kanji",
    zValidator(
      "query",
      z.object({
        character: z.string().min(1).max(1).optional(),
        // TASK-37 AC1: list mode for the /kanji index grid — filter by
        // JLPT level (kanji.json jlpt_waller; 79/166/367/367/1232 chars).
        level: z.enum(["N5", "N4", "N3", "N2", "N1"]).optional(),
      })
    ),
    async (c) => {
      const { character, level } = c.req.valid("query");
      if (!character) {
        if (level) {
          const raw = await readFile(join(DATA_DIR, "kanji.json"), "utf-8");
          const rows = kanjiListRows(parseKanjiFile(raw), level);
          return c.json({ level, rows });
        }
        return c.json({ error: "character or level required" }, 400);
      }
      try {
        const raw = await readFile(join(DATA_DIR, "kanji.json"), "utf-8");
        const entry = findKanjiEntry(parseKanjiFile(raw), character);
        if (!entry) {
          return c.json({ error: "Kanji not found" }, 404);
        }
        return c.json(toKanjiResponse(entry));
      } catch (error) {
        console.error("[kanji] lookup failed:", error);
        return c.json({ error: "Internal error" }, 500);
      }
    }
  );

  app.get(
    "/kanji/stroke",
    zValidator("query", z.object({ character: z.string().min(1).max(1) })),
    async (c) => {
      const { character } = c.req.valid("query");
      // Delegates to the shared service (the oRPC /rpc/jap/kanji/stroke
      // handler uses the same code). The parser used to be duplicated
      // here and in services/jap-data.ts — the copies diverged and the
      // naive one returned stroke IDs as path data. One parser now.
      const result = await strokeOrderService(character);
      if (result === "no-data") {
        return c.json({ error: "No stroke data for character" }, 404);
      }
      if (result === "corrupt") {
        return c.json({ error: "Corrupt stroke data" }, 500);
      }
      return c.json(result);
    }
  );

  app.get("/grammar", zValidator("query", LevelQuerySchema), async (c) => {
    const { level } = c.req.valid("query");
    const fileLevel = level.toLowerCase();

    try {
      const raw = await readFile(getGrammarFile(fileLevel), "utf-8");
      const data = JSON.parse(raw) as Array<{
        id: string;
        pattern: string;
        level: string;
        meaning_en: string;
        meaning_detailed?: string;
        formation?: string;
        formality: string;
        examples?: Array<{ japanese: string; english: string }>;
      }>;

      return c.json({ grammar: data });
    } catch (error) {
      console.error("[grammar] lookup failed:", error);
      return c.json({ error: "Internal error" }, 500);
    }
  });

  // GET /vocab?level=<N5-N1> — vocabulary list by level (word/reading/meaning
  // rows from data/n*.json). The old /grammar route read these files and cast
  // them to the grammar shape; lib/kanji.ts vocabContaining() consumes THIS
  // endpoint (TASK-23.28 — the 404 on the unprefixed URL masked the mixup).
  app.get("/vocab", zValidator("query", LevelQuerySchema), async (c) => {
    const { level } = c.req.valid("query");
    const fileLevel = level.toLowerCase();

    try {
      const raw = await readFile(getLevelFile(fileLevel), "utf-8");
      const data = JSON.parse(raw) as Array<{
        level: string;
        meaning: string;
        partOfSpeech?: string;
        reading: string;
        senses?: string[][];
        word: string;
      }>;

      // `gloss` is the first rendering of the first SENSE GROUP, which is the
      // sense a learner should be taught. It is NOT `meaning.split(";")[0]`:
      // `meaning` is a ";"-joined summary and JMdict glosses contain ";" inside
      // parentheses, so that parse mangles the primary gloss - アウト is
      // "out (of a ball; in tennis, etc.)" and the split yields "out (of a
      // ball". Four entries rendered a wrong headline gloss this way, and the
      // desktop has no structure need beyond this one field.
      return c.json({
        vocab: data.map((entry) => ({
          gloss: entry.senses?.[0]?.[0] ?? "",
          level: entry.level,
          meaning: entry.meaning,
          partOfSpeech: entry.partOfSpeech,
          reading: entry.reading,
          word: entry.word,
        })),
      });
    } catch (error) {
      console.error("[vocab] lookup failed:", error);
      return c.json({ error: "Internal error" }, 500);
    }
  });

  return app;
};

export const __test__ = { getLevelFile };
