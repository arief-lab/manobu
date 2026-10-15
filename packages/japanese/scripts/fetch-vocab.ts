/**
 * Regenerate `data/n1.json` … `data/n5.json` — the JLPT corpus joined with
 * English meanings from JMdict.
 *
 * Two upstreams:
 *   1. The word lists: `Bluskyo/JLPT_Vocabulary` (MIT; original data from
 *      the tanos.co.uk JLPT word lists, CC-BY Jonathan Waller). Shape:
 *      `Record<word, { reading, level }[]>` where `level` is 1–5 (1 = N1).
 *   2. English glosses + parts of speech: JMdict via
 *      `scriptin/jmdict-simplified` (CC BY-SA 4.0 — see `data/LICENSE.md`).
 *      Shape: `{ words: [{ kanji[], kana[], sense[] }] }`.
 *
 * Matching: exact surface form (kanji or kana) first, then the reading.
 * Glosses from every matching JMdict entry are merged (deduped, capped);
 * POS codes are bucketed into coarse labels.
 *
 * The JMdict download (~11MB tgz → ~113MB json) is cached at
 * `.cache/jmdict-eng.json` (gitignored). Delete the cache or pass `--force`
 * to re-download (releases update weekly).
 *
 * Run from this package: `bun run fetch:vocab [--force]`.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JlptLevel, VocabEntry } from "../src/types";

// --- Upstreams (pinned) -----------------------------------------------------

const JLPT_SOURCE_URL =
  "https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/main/data/vocab/results/JLPT_vocab_ALL.json";

/** JMdict JSON via scriptin/jmdict-simplified, pinned to a specific release. */
const JMDICT_TAG = "3.6.2+20260803141815";
/** Version part of the tag — also the filename inside the release tarball. */
const [JMDICT_VERSION] = JMDICT_TAG.split("+");
const JMDICT_URL =
  "https://github.com/scriptin/jmdict-simplified/releases/download/" +
  `${encodeURIComponent(JMDICT_TAG)}/jmdict-eng-${encodeURIComponent(JMDICT_TAG)}.json.tgz`;

const CACHE_DIR = new URL("../.cache/", import.meta.url);
// Version-keyed so bumping JMDICT_TAG invalidates the cache automatically.
const JMDICT_CACHE = new URL(`jmdict-eng-${JMDICT_VERSION}.json`, CACHE_DIR);

const LEVEL_FROM_NUMBER: Record<number, JlptLevel> = {
  1: "N1",
  2: "N2",
  3: "N3",
  4: "N4",
  5: "N5",
};

const LEVELS: readonly JlptLevel[] = ["N1", "N2", "N3", "N4", "N5"];

// --- JMdict shapes ----------------------------------------------------------

interface JmdictSense {
  gloss: Array<{ lang: string | null; text: string }>;
  partOfSpeech: string[];
}

interface JmdictEntry {
  id: string;
  kana: Array<{ text: string }>;
  kanji: Array<{ text: string }>;
  sense: JmdictSense[];
}

interface JmdictFile {
  tags: Record<string, string>;
  words: JmdictEntry[];
}

// --- Coarse POS buckets -----------------------------------------------------

/** Bucket JMdict POS codes into a coarse label; falls back to the raw code. */
function coarsePos(code: string): string {
  // Exact codes first — including transitivity, a first-class teaching
  // concept (開く/開ける), so it stays visible instead of collapsing into
  // plain "verb".
  const exact: Record<string, string> = {
    adv: "adverb",
    aux: "auxiliary",
    conj: "conjunction",
    cop: "copula",
    ctr: "counter",
    exp: "expression",
    int: "interjection",
    num: "numeral",
    pn: "pronoun",
    prt: "particle",
    unc: "unclassified",
    vi: "intransitive verb",
    vt: "transitive verb",
  };
  const match = exact[code];
  if (match) {
    return match;
  }
  // Prefix families — JMdict splits each into many variants
  // (adj-i/adj-na/adj-no…, v1/v5/vs…, n-t/n-pref…, aux-v…).
  if (code.startsWith("adj")) {
    return "adjective";
  }
  if (code.startsWith("aux")) {
    return "auxiliary";
  }
  if (code.startsWith("adv")) {
    return "adverb";
  }
  if (code.startsWith("v")) {
    return "verb";
  }
  if (code.startsWith("n")) {
    return "noun";
  }
  return code;
}

// --- Helpers ----------------------------------------------------------------

async function fetchJson(url: string, label: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${label} fetch failed: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

async function downloadJmdict(): Promise<JmdictFile> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const force = process.argv.includes("--force");

  if (!force) {
    try {
      const cached = JSON.parse(
        readFileSync(JMDICT_CACHE, "utf8")
      ) as JmdictFile;
      console.log(
        `[jmdict] using cached ${JMDICT_CACHE.pathname} (${cached.words.length} words)`
      );
      return cached;
    } catch {
      // cache miss or corrupt — download below
    }
  }

  console.log(`[jmdict] downloading ${JMDICT_URL} …`);
  const tgz = await fetch(JMDICT_URL);
  if (!tgz.ok) {
    throw new Error(`jmdict download failed: ${tgz.status} ${tgz.statusText}`);
  }
  const data = new Uint8Array(await tgz.arrayBuffer());
  // Minimal gzip + tar reader: bun has no stdlib tar, so shell out to tar(1).
  const tgzPath = join(tmpdir(), `jmdict-${Date.now()}.tgz`);
  const outDir = join(tmpdir(), `jmdict-${Date.now()}`);
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(tgzPath, data);
    // Extract only the member we need.
    execFileSync("tar", [
      "xzf",
      tgzPath,
      "-C",
      outDir,
      `jmdict-eng-${JMDICT_VERSION}.json`,
    ]);
    const jsonPath = join(outDir, `jmdict-eng-${JMDICT_VERSION}.json`);
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as JmdictFile;
    writeFileSync(JMDICT_CACHE, JSON.stringify(parsed));
    console.log(
      `[jmdict] cached ${parsed.words.length} words → ${JMDICT_CACHE.pathname}`
    );
    return parsed;
  } finally {
    rmSync(tgzPath, { force: true });
    rmSync(outDir, { force: true, recursive: true });
  }
} // --- Join -------------------------------------------------------------------

/** Index JMdict entries by every surface form (kanji + kana). */
function buildSurfaceIndex(jmdictData: JmdictFile): Map<string, JmdictEntry[]> {
  const index = new Map<string, JmdictEntry[]>();
  for (const entry of jmdictData.words) {
    for (const { text } of [...entry.kanji, ...entry.kana]) {
      const bucket = index.get(text);
      if (bucket) {
        bucket.push(entry);
      } else {
        index.set(text, [entry]);
      }
    }
  }
  return index;
}

/** English glosses on one JMdict sense (untyped lang counts as English). */
const englishGlosses = (sense: JmdictSense): string[] =>
  sense.gloss
    .filter((g) => g.lang === "eng" || g.lang === null)
    .map((g) => g.text);

/**
 * How many senses to keep, and how many renderings inside each.
 *
 * The sense cap is the one that matters: dropping a rendering inside a sense is
 * harmless, because every rendering in a group is the same meaning and the group
 * is still correct. Dropping a whole sense loses a distinct meaning, which is
 * the only thing an exam can use as a distractor.
 */
const MAX_SENSES = 8;
const MAX_RENDERINGS_PER_SENSE = 6;

// TASK-138 AC#10: both caps are silent, and a clipped group is a lost
// distractor. Counted here rather than guessed at, because the only way to know
// whether a cap bites is to measure it - 270 entries sit at MAX_SENSES and 972
// of 18,446 groups at MAX_RENDERINGS_PER_SENSE, and neither number means
// anything until it is compared against the distractor yield. Module scope,
// because `enrichFrom` is a separate function from the level loop.
let clippedSenses = 0;
let clippedRenderings = 0;

/**
 * The candidates whose kana include this entry's reading.
 *
 * A word with several readings is SEVERAL JMdict entries, and the anchor is
 * `vocab:{level}:{word}:{reading}`, so an item asks about ONE reading. Merging
 * all of them put another reading's meanings into the item, which is not a
 * ranking problem but wrong data for the anchor:
 *
 *   人   ひと  merged in the じん suffixes -> "-ian (e.g. Italian)" as the answer
 *   一日 いちにち merged in つきたち        -> "first day of the month" as a distractor
 *   暇   ひま  merged in いとま            -> a classical "(spare) time" gloss
 *
 * 1,021 of 8,505 entries - 12% - were affected. This is the mechanical version
 * of the judgement doc-23 §3 reserved for a human: it does not decide which
 * sense is most TEACHABLE, it only stops asking about a reading the item is not
 * about.
 *
 * Falls back to every candidate when no entry matches, so the 92 entries whose
 * reading is absent from JMdict's kana (a kana form of an entry that lists only
 * the other spelling) keep their current behaviour rather than losing senses.
 */
const candidatesForReading = (
  candidates: JmdictEntry[],
  reading: string
): JmdictEntry[] => {
  if (reading.length === 0) {
    return candidates;
  }
  const matching = candidates.filter((jmd) =>
    jmd.kana.some((kana) => kana.text === reading)
  );
  return matching.length > 0 ? matching : candidates;
};

/**
 * Walk the JMdict senses once: the renderings grouped per sense, and the coarse
 * POS codes folded into a set.
 */
const collectSenses = (
  candidates: JmdictEntry[]
): { groups: string[][]; partOfSpeech: Set<string> } => {
  const groups: string[][] = [];
  const partOfSpeech = new Set<string>();
  for (const jmd of candidates) {
    for (const sense of jmd.sense) {
      const all = [...new Set(englishGlosses(sense))];
      if (all.length > MAX_RENDERINGS_PER_SENSE) {
        clippedRenderings += 1;
      }
      const renderings = all.slice(0, MAX_RENDERINGS_PER_SENSE);
      if (renderings.length > 0) {
        groups.push(renderings);
      }
      for (const code of sense.partOfSpeech) {
        partOfSpeech.add(coarsePos(code));
      }
    }
  }
  return { groups, partOfSpeech };
};

/**
 * Dedupe whole groups, not glosses: two senses that render identically are
 * one sense as far as an exam is concerned, and merging them by gloss would
 * recreate the flattening this is fixing.
 */
const dedupeGroups = (groups: readonly string[][]): string[][] => {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = group.join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Merge glosses + coarse POS from a set of matching JMdict entries.
 *
 * The glosses are collected PER JMdict SENSE and kept grouped, because the flat
 * `meaning` string cannot say which of its parts mean the same thing. That
 * distinction is the whole of TASK-138 AC#8 and AC#10: 黄色 is one sense
 * ("yellow; amber"), so offering "amber" marks a correct answer wrong, and
 * 暇's "spare time; free time; leisure" is one sense out of seven.
 *
 * `meaning` is still emitted, unchanged in spirit, because the kanji deck, the
 * verb deck and several tests read it. It is a summary, not the structure.
 */
function enrichFrom(candidates: JmdictEntry[], entry: VocabEntry): void {
  const { groups, partOfSpeech } = collectSenses(candidates);
  if (groups.length > 0) {
    const senses = dedupeGroups(groups);
    if (senses.length > MAX_SENSES) {
      clippedSenses += 1;
    }
    entry.senses = senses.slice(0, MAX_SENSES);
    // Globally deduped, and NOT capped. The cap was the quiet cause of this
    // whole class of bug: 1,748 entries - 20% - had a `meaning` shorter than
    // their `senses`, hiding 9,442 glosses, and every legacy reader of
    // `meaning` silently saw a fraction of the data. The cost is bytes in
    // n*.json, which already ship the full `senses`; the benefit is that
    // `meaning` stops being a lossy summary that three surfaces were parsing as
    // if it were the structure.
    //
    // Dedupe is over glosses, not groups, so a gloss appearing in two different
    // senses is listed once (次 must not render as "next; ...; station; next").
    entry.meaning = [...new Set(entry.senses.flat())].join("; ");
  }
  if (partOfSpeech.size > 0) {
    entry.partOfSpeech = [...partOfSpeech].slice(0, 3).join(", ");
  }
}

// Known upstream corruption repairs, keyed `word:corrupt-reading` (found by
// the TASK-173.10 live browser pass, 2026-10-13: the pinned Bluskyo corpus
// carries exactly one bad reading, 賛成 as "Uӣ[い" — Cyrillic bytes, a
// Shift-JIS row decoded as cp1251 — and it reached a real N3 paper as a
// distractor). Keyed on the exact corrupt string so it can never silently
// rewrite a different row; if upstream fixes its data the entry stops firing.
const CORRUPTED_READINGS: Record<string, string> = {
  "賛成:Uӣ[い": "さんせい",
};

function joinCorpus(
  rawCorpus: Record<string, Array<{ level: number; reading: string }>>,
  jmdictData: JmdictFile
): Record<JlptLevel, VocabEntry[]> {
  const index = buildSurfaceIndex(jmdictData);

  const byLevel: Record<JlptLevel, VocabEntry[]> = {
    N1: [],
    N2: [],
    N3: [],
    N4: [],
    N5: [],
  };

  let matched = 0;
  let total = 0;

  for (const [word, readings] of Object.entries(rawCorpus)) {
    for (const { level, reading } of readings) {
      total += 1;
      const levelName = LEVEL_FROM_NUMBER[level];
      if (!levelName) {
        throw new Error(
          `unexpected level number ${level} for word "${word}" — upstream shape changed; update LEVEL_FROM_NUMBER`
        );
      }

      const repaired = CORRUPTED_READINGS[`${word}:${reading}`];
      if (repaired !== undefined) {
        console.log(
          `[corpus] repaired reading ${word}: ${reading} → ${repaired}`
        );
      }
      const entry: VocabEntry = {
        level: levelName,
        reading: repaired ?? reading,
        word,
      };
      const candidates = index.get(word) ?? index.get(entry.reading);
      if (candidates) {
        enrichFrom(candidatesForReading(candidates, entry.reading), entry);
        matched += 1;
      }

      byLevel[levelName].push(entry);
    }
  }

  console.log(
    `[join] matched ${matched}/${total} corpus entries (${(100 * matched) / total}%)`
  );
  return byLevel;
}

// --- Main -------------------------------------------------------------------

const corpus = (await fetchJson(JLPT_SOURCE_URL, "jlpt corpus")) as Record<
  string,
  Array<{ level: number; reading: string }>
>;
const jmdict = await downloadJmdict();
const byLevel = joinCorpus(corpus, jmdict);

const dataDir = new URL("../data/", import.meta.url);
mkdirSync(dataDir, { recursive: true });

let total = 0;
let withMeaning = 0;
for (const level of LEVELS) {
  const entries = byLevel[level];
  total += entries.length;
  withMeaning += entries.filter((e) => e.meaning).length;
  writeFileSync(
    new URL(`${level.toLowerCase()}.json`, dataDir),
    `${JSON.stringify(entries)}\n`
  );
  console.log(`${level}: ${entries.length}`);
}
console.log(
  `total: ${total} (${withMeaning} with English meanings, ${(100 * withMeaning) / total}%)`
);
console.log(
  `[caps] ${clippedSenses} entries at MAX_SENSES=${MAX_SENSES}, ${clippedRenderings} groups at MAX_RENDERINGS_PER_SENSE=${MAX_RENDERINGS_PER_SENSE}`
);
