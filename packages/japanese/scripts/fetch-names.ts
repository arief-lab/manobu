/**
 * Regenerate `data/names.jsonl` — the JMnedict proper-noun corpus (doc-2
 * §2.5, TASK-23.6).
 *
 * Upstream: JMnedict via `scriptin/jmdict-simplified` (CC BY-SA 4.0 — see
 * `data/LICENSE.md` §10). Shape:
 * `{ names: [{ kanji[], kana[], name_type[], name_translations[] }] }` —
 * same entry shape as JMdict but `name_type` tags instead of senses
 * (JMnedict carries NO English glosses; translations are non-English).
 *
 * Output: one JSON object per line (JSONL — matches the kanjivg/sentences
 * precedent so the Rust side parses it streaming, not as one giant array):
 *   { "id": 500000001, "word": "田中", "reading": "たなか", "name_type": "surname" }
 *
 * Filter: entries with at least one kanji + kana form (kana-only names
 * would duplicate the reading column; they stay reachable via search).
 * One name_type per row (the first tag) — the MCP `list_names_by_type`
 * tool filters on it.
 *
 * Run from this package: `bun run fetch:names [--force]`.
 */

import { execFileSync } from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Upstream (pinned, same release line as fetch-vocab.ts) -----------------

/** JMnedict via scriptin/jmdict-simplified, pinned to the fetch-vocab tag. */
const JMNEDICT_TAG = "3.6.2+20260803141815";
/** Version part of the tag — also the filename inside the release tarball. */
const [JMNEDICT_VERSION] = JMNEDICT_TAG.split("+");
const JMNEDICT_URL =
  "https://github.com/scriptin/jmdict-simplified/releases/download/" +
  `${encodeURIComponent(JMNEDICT_TAG)}/jmnedict-all-${encodeURIComponent(JMNEDICT_TAG)}.json.tgz`;

const CACHE_DIR = new URL("../.cache/", import.meta.url);
const JMNEDICT_CACHE = new URL(
  `jmnedict-all-${JMNEDICT_VERSION}.json`,
  CACHE_DIR
);
const OUTPUT = new URL("../data/names.jsonl", import.meta.url);

// --- JMnedict shapes --------------------------------------------------------

interface JmnedictName {
  kana: Array<{ text: string }>;
  kanji: Array<{ text: string }>;
  /** Simplified-JSON shape: the name-type tags ride on the translation entries. */
  translation: Array<{ type?: string[] }>;
}

interface JmnedictFile {
  /** The simplified release names the array `words` for both dicts. */
  words: JmnedictName[];
}

// --- Download + cache -------------------------------------------------------

async function fetchAndCache(skipCache: boolean): Promise<JmnedictFile> {
  if (!skipCache) {
    try {
      const cached = readFileSync(JMNEDICT_CACHE, "utf8");
      const parsed = JSON.parse(cached) as JmnedictFile;
      console.log(
        `[jmnedict] cache hit: ${parsed.words.length} names → ${JMNEDICT_CACHE.pathname}`
      );
      return parsed;
    } catch {
      // No cache — fall through to the download.
    }
  }
  console.log(`[jmnedict] downloading ${JMNEDICT_URL}`);
  const response = await fetch(JMNEDICT_URL);
  if (!response.ok) {
    throw new Error(
      `download failed: ${response.status} ${response.statusText}`
    );
  }
  const data = new Uint8Array(await response.arrayBuffer());
  // Same minimal tar reader as fetch-vocab (bun has no stdlib tar).
  const tgzPath = join(tmpdir(), `jmnedict-${Date.now()}.tgz`);
  const outDir = join(tmpdir(), `jmnedict-${Date.now()}`);
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(tgzPath, data);
    execFileSync("tar", [
      "xzf",
      tgzPath,
      "-C",
      outDir,
      `jmnedict-all-${JMNEDICT_VERSION}.json`,
    ]);
    const jsonPath = join(outDir, `jmnedict-all-${JMNEDICT_VERSION}.json`);
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as JmnedictFile;
    writeFileSync(JMNEDICT_CACHE, JSON.stringify(parsed));
    console.log(
      `[jmnedict] cached ${parsed.words.length} names → ${JMNEDICT_CACHE.pathname}`
    );
    return parsed;
  } finally {
    rmSync(tgzPath, { force: true });
    rmSync(outDir, { force: true, recursive: true });
  }
}

// --- Transform ---------------------------------------------------------------

interface NameRow {
  id: number;
  name_type: string;
  reading: string;
  word: string;
}

/**
 * Flatten JMnedict → JSONL rows. Entries with kanji forms emit one row per
 * (kanji × first kana) pair — the same surface may have multiple readings
 * (e.g. 北海道 ほっかいどう/ほっかい). Entries without kanji (kana-only
 * names) emit one row with word = reading, flagged `name_type` as-is; the
 * consumer can filter `word === reading` to detect them.
 */
function transform(names: JmnedictFile): NameRow[] {
  const rows: NameRow[] = [];
  let id = 5_000_000; // names.jsonl ids start at 5M — disjoint from sentences (1..~150k).
  for (const name of names.words) {
    const nameType = name.translation[0]?.type?.[0] ?? "unclassified";
    const firstKana = name.kana[0]?.text ?? "";
    for (const { text: kanji } of name.kanji) {
      rows.push({ id, name_type: nameType, reading: firstKana, word: kanji });
      id += 1;
    }
    if (name.kanji.length === 0 && firstKana !== "") {
      rows.push({
        id,
        name_type: nameType,
        reading: firstKana,
        word: firstKana,
      });
      id += 1;
    }
  }
  return rows;
}

// --- Main --------------------------------------------------------------------

const force = process.argv.includes("--force");
const data = await fetchAndCache(force);
const rows = transform(data);
const out = createWriteStream(OUTPUT);
for (const row of rows) {
  out.write(`${JSON.stringify(row)}\n`);
}
out.end();
await new Promise<void>((resolve, reject) => {
  out.on("finish", resolve);
  out.on("error", reject);
});
console.log(`[jmnedict] wrote ${rows.length} rows → ${OUTPUT.pathname}`);
