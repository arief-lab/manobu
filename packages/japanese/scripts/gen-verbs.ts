/**
 * Generate the N5 verb drill deck (SCR-06 conjugate redesign).
 *
 * Slices n5.json down to verbs the conjugation engine can actually
 * classify+conjugate: partOfSpeech contains "verb", reading is pure
 * hiragana, classify(reading) resolves, and all five forms (て/た/
 * ません/ない/たい) produce non-empty strings. A small denylist drops
 * the known traps where the ichidan/godan heuristic lies (帰る is a
 * godan verb that ends え+る).
 *
 * Output `data/verbs-n5.json`: { w: word, r: reading, m: first English
 * meaning } — one per line, file order (roughly frequency).
 *
 * Run from this package: `bun run gen:verbs`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dir, "..", "data");
const IN_PATH = join(DATA_DIR, "n5.json");
const OUT_PATH = join(DATA_DIR, "verbs-n5.json");

interface VocabEntry {
  meaning: string;
  partOfSpeech?: string;
  reading: string;
  word: string;
}

interface DeckEntry {
  m: string;
  r: string;
  w: string;
}

// The denylist covers the classify() heuristic's known lies (kept in
// sync with apps/desktop/src/lib/conjugate.ts): 帰る is godan but ends
// え+る, so the ichidan regex claims it.
const DENY: Record<string, true> = { 帰る: true };
const ICHIDAN_RE = /[えけげねへべぺめれ]る$/;
const GODAN_TAIL_RE = /[うくぐすつぬぶぷむる]$/;

const isClassifiable = (reading: string): boolean =>
  ICHIDAN_RE.test(reading) || GODAN_TAIL_RE.test(reading);

const ALL_KANA_RE = /^[぀-ゟ゠-ヿ]+$/;

const vocab = JSON.parse(readFileSync(IN_PATH, "utf8")) as VocabEntry[];

const seen = new Set<string>();
const deck: DeckEntry[] = [];
/* "verb" as a standalone POS token (or "transitive/intransitive verb") —
 * a bare substring match would also claim "adverb". */
const isVerb = (partOfSpeech: string): boolean =>
  partOfSpeech
    .split(",")
    .some(
      (t) =>
        t.trim() === "verb" ||
        (t.trim().endsWith("verb") && t.trim() !== "adverb")
    );

for (const e of vocab) {
  if (!isVerb(e.partOfSpeech ?? "")) {
    continue;
  }
  if (DENY[e.word]) {
    continue;
  }
  const reading = e.reading.trim();
  if (!ALL_KANA_RE.test(reading) || reading.length < 2) {
    continue;
  }
  if (!isClassifiable(reading)) {
    continue;
  }
  // Dedupe by READING, not word: the UI ladder keys on the kana reading,
  // and homophones (いる×2, きる×2) would collide. First word wins.
  if (seen.has(reading)) {
    continue;
  }
  seen.add(reading);
  deck.push({
    m: e.meaning.split(";")[0]?.trim() ?? "",
    r: reading,
    w: e.word,
  });
}

writeFileSync(OUT_PATH, `${JSON.stringify(deck, null, 1)}\n`, "utf8");
console.log(`verbs-n5.json: ${deck.length} entries`);
