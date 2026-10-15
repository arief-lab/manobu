/**
 * Generate the kanji N5 drill deck (SCR-03 redesign).
 *
 * kanji.json is 8.7 MB / 13,108 entries — far too big to bundle into the
 * desktop SPA. This script slices it down to the deck the drill actually
 * offers: jlpt_waller === "N5" (79 chars), sorted by frequency (the order a
 * learner meets them), with only the fields a drill card renders.
 *
 * Output: `data/kanji-n5.json` — one entry per char:
 *   { c: character, m: [first two English meanings], on: [onyomi], ku:
 *   [kunyomi], s: stroke_count, f: frequency }
 *
 * Stroke paths are NOT here: the drill fetches them per char from the
 * server (lib/kanjivg.ts → /api/kanji/stroke), same as kanji-detail.
 *
 * Run from this package: `bun run gen:kanji-n5`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dir, "..", "data");
const IN_PATH = join(DATA_DIR, "kanji.json");
const OUT_PATH = join(DATA_DIR, "kanji-n5.json");

interface KanjiRecord {
  character: string;
  frequency?: number | null;
  jlpt_waller?: string | null;
  meanings?: { en?: string[] } | null;
  readings?: { on?: string[]; kun?: string[] } | null;
  stroke_count: number;
}

interface DeckEntry {
  c: string;
  f: number;
  ku: string[];
  m: string[];
  on: string[];
  s: number;
}

const corpus = JSON.parse(readFileSync(IN_PATH, "utf8")) as {
  kanji: KanjiRecord[];
};

const deck: DeckEntry[] = corpus.kanji
  .filter((k) => k.jlpt_waller === "N5")
  .map((k) => ({
    c: k.character,
    f: k.frequency ?? Number.MAX_SAFE_INTEGER,
    ku: (k.readings?.kun ?? []).slice(0, 4),
    m: (k.meanings?.en ?? []).slice(0, 2),
    on: (k.readings?.on ?? []).slice(0, 4),
    s: k.stroke_count,
  }))
  .sort((a, b) => a.f - b.f || a.c.localeCompare(b.c, "ja"));

writeFileSync(OUT_PATH, `${JSON.stringify(deck, null, 1)}\n`, "utf8");
console.log(`kanji-n5.json: ${deck.length} entries`);
