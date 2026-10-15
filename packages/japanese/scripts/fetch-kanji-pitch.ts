/**
 * Fetch the kanji + pitch-accent slices of `jkindrix/japanese-language-data`
 * into `data/` (mirroring `fetch-vocab.ts` for the vocabulary corpus).
 *
 * Upstream: https://github.com/jkindrix/japanese-language-data (CC-BY-SA 4.0)
 *
 * - `data/kanji.json`         — 13,108 kanji entries (KANJIDIC2-derived):
 *   character, readings (on/kun), English meanings, stroke count, JLPT
 *   (jlpt_waller + jlpt_old), grade, frequency, radical.
 * - `data/pitch-accent.json`  — pitch-accent entries with per-entry
 *   provenance: 124,008 deduped Kanjium entries + 12,788 Wiktionary
 *   gap-fill (TASK-23.5.3). Every entry carries
 *   `source: "kanjium" | "wiktionary"`.
 *
 * Both embed into the jlpt-mcp binary at compile time (no runtime file
 * access), exactly like the vocab and grammar corpora.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE =
  "https://raw.githubusercontent.com/jkindrix/japanese-language-data/main";

const DATA_DIR = join(import.meta.dir, "..", "data");

interface PitchAccentEntry {
  mora_count: number | null;
  pitch_positions: number[];
  reading: string;
  word: string;
}

interface PitchCorpusFile {
  entries: PitchAccentEntry[];
  metadata: Record<string, unknown>;
}

const KANJIM_URL = `${BASE}/data/enrichment/pitch-accent.json`;
const WIKTIONARY_URL = `${BASE}/data/enrichment/pitch-accent-wiktionary.json`;

const KANJIM_SOURCE = "kanjium" as const;
const WIKTIONARY_SOURCE = "wiktionary" as const;

const fetchJson = async (url: string): Promise<unknown> => {
  console.log(`[fetch:kanji-pitch] downloading ${url}…`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `[fetch:kanji-pitch] ${url} → HTTP ${res.status} ${res.statusText}`
    );
  }
  return res.json() as Promise<unknown>;
};

// --- kanji ------------------------------------------------------------------

const kanjiText = await (async () => {
  const raw = await fetchJson(`${BASE}/data/core/kanji.json`);
  return `${JSON.stringify(raw)}\n`;
})();

// --- pitch accent merge -----------------------------------------------------
//
// Kanjium (124,011 entries, ~2022 coverage) is the authority. The Wiktionary
// supplement (12,788 entries, kaikki.org extraction, post-2022 gap-fill)
// arrives pre-deduped by (word, reading) — upstream removes pairs already in
// Kanjium — so the merge is a pure additive union. We still keep Kanjium
// preferred on conflict in case a future upstream regen reintroduces overlap.

const kanjium = (await fetchJson(KANJIM_URL)) as PitchCorpusFile;
const wiktionary = (await fetchJson(WIKTIONARY_URL)) as PitchCorpusFile;

const pitchKey = (entry: PitchAccentEntry): string =>
  `${entry.word}\u241f${entry.reading}`;

const seen = new Set<string>();
const kanjiumOnly: PitchAccentEntry[] = [];
for (const entry of kanjium.entries) {
  const key = pitchKey(entry);
  if (seen.has(key)) {
    continue;
  }
  seen.add(key);
  kanjiumOnly.push(entry);
}

const wiktionaryOnly: PitchAccentEntry[] = [];
for (const entry of wiktionary.entries) {
  const key = pitchKey(entry);
  if (!seen.has(key)) {
    seen.add(key);
    wiktionaryOnly.push(entry);
  }
}

const taggedKanjium = kanjiumOnly.map((entry) => ({
  ...entry,
  source: KANJIM_SOURCE,
}));
const taggedWiktionary = wiktionaryOnly.map((entry) => ({
  ...entry,
  source: WIKTIONARY_SOURCE,
}));

const pitchEntries = [...taggedKanjium, ...taggedWiktionary];

// Rows dropped: upstream Kanjium self-duplicates (e.g. βカロテン ships 4×)
// and any (word, reading) pair the Wiktionary supplement re-adds.
const kanjiumDropped = kanjium.entries.length - kanjiumOnly.length;
const wiktionaryDropped = wiktionary.entries.length - wiktionaryOnly.length;
const dropped = {
  kanjium_duplicates: kanjiumDropped,
  wiktionary_overlaps: wiktionaryDropped,
};

const metadata = {
  attribution:
    "Pitch accent data from the Kanjium project by mifunetoshiro and contributors and from Japanese Wiktionary via kaikki.org, both released under CC-BY-SA 4.0, aggregated by jkindrix/japanese-language-data.",
  count: pitchEntries.length,
  dropped,
  field_notes: {
    mora_count:
      "Number of morae in the reading, computed by skipping small kana (yōon, sokuon). Null if it could not be computed.",
    pitch_positions:
      "Mora positions where the accent falls. 0 = heiban (flat, no drop). N > 0 = accent falls after the Nth mora.",
    reading: "Kana-only reading used for pitch accent alignment.",
    source:
      'Entry provenance: "kanjium" (authority) or "wiktionary" (gap-fill).',
    word: "Word spelling as it appears in the upstream source. Usually contains kanji; some entries are kana-only.",
  },
  generated: new Date().toISOString().slice(0, 10),
  sources: [
    {
      count: taggedKanjium.length,
      coverage_date: "approximately 2022 (upstream last substantive update)",
      license: "CC-BY-SA 4.0",
      source: KANJIM_SOURCE,
      source_url: "https://github.com/mifunetoshiro/kanjium",
      via: "jkindrix/japanese-language-data",
    },
    {
      count: taggedWiktionary.length,
      coverage_date: "post-2022 Wiktionary gap-fill",
      license: "CC-BY-SA 4.0",
      source: WIKTIONARY_SOURCE,
      source_url: "https://kaikki.org/dictionary/Japanese/index.html",
      via: "jkindrix/japanese-language-data pitch-accent-wiktionary.json",
    },
  ],
};

const pitchJson = `${JSON.stringify({ entries: pitchEntries, metadata })}\n`;

// --- write ------------------------------------------------------------------

mkdirSync(DATA_DIR, { recursive: true });

const kanjiDest = join(DATA_DIR, "kanji.json");
writeFileSync(kanjiDest, kanjiText);
console.log(
  `[fetch:kanji-pitch] wrote ${kanjiDest} (${(Buffer.byteLength(kanjiText) / 1024 / 1024).toFixed(1)} MiB)`
);

const pitchDest = join(DATA_DIR, "pitch-accent.json");
writeFileSync(pitchDest, pitchJson);
console.log(
  `[fetch:kanji-pitch] wrote ${pitchDest} (${(Buffer.byteLength(pitchJson) / 1024 / 1024).toFixed(1)} MiB)`
);
console.log(
  `[fetch:kanji-pitch] pitch entries: ${taggedKanjium.length} kanjium + ${taggedWiktionary.length} wiktionary (${dropped.kanjium_duplicates} kanjium dup rows + ${dropped.wiktionary_overlaps} wiktionary overlap rows dropped)`
);

console.log(
  "[fetch:kanji-pitch] done. Commit data/kanji.json + data/pitch-accent.json."
);
