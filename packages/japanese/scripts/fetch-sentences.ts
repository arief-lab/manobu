/**
 * Regenerate `data/sentences/sentences.jsonl` — Japanese sentences with
 * English translations, from the Tatoeba weekly exports.
 *
 * Two upstreams (downloads.tatoeba.org, refreshed every Saturday 06:30 UTC):
 *   1. `sentences.tar.bz2` — all sentences, TSV: `id \t lang \t text`.
 *      CC BY 2.0 FR (attribution: Tatoeba contributors).
 *   2. `jpn_indices.tar.bz2` — Japanese→English index lines (Tanaka Corpus
 *      B-lines), TSV: `sentence_id \t meaning_id \t Text`. Public domain
 *      (2008 snapshot); newer rows CC BY 2.0.
 *
 * Join: keep Japanese sentences (lang == 'jpn') that have an English meaning
 * sentence (lang == 'eng'). The `Text` field is the Tanaka word-linkage
 * string (`word[reading] position` tokens) — word surfaces are extracted as
 * `linkedWords` (kana/kanji tokens only; ASCII punctuation dropped).
 *
 * The downloads (~80 MB + ~9 MB bz2) are cached at `.cache/sentences/`
 * (gitignored). Delete the cache or pass `--force` to re-download.
 *
 * Output: newline-delimited JSON, one pair per line:
 *   { id, jp, en, linkedWords, attribution }
 *
 * Run from this package: `bun run fetch:sentences [--force]`.
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// --- Upstreams (pinned) ------------------------------------------------------

const EXPORTS_BASE = "https://downloads.tatoeba.org/exports/";
const SENTENCES_URL = `${EXPORTS_BASE}sentences.tar.bz2`;
const JPN_INDICES_URL = `${EXPORTS_BASE}jpn_indices.tar.bz2`;

const CACHE_DIR = new URL("../.cache/sentences/", import.meta.url);
const OUT_FILE = new URL("../data/sentences/sentences.jsonl", import.meta.url);

/** JP sentence length cap — Tanaka pedagogy examples stay short. */
const MAX_JP_CHARS = 120;
/** Flush the tmp output file every N written pairs. */
const FLUSH_EVERY = 20_000;

// --- bz2 + tar extraction ----------------------------------------------------

/** Extract a single member from a .tar.bz2 via tar(1); returns its path. */
function extractTarBz2(
  archivePath: string,
  member: string,
  outDir: string
): string {
  execFileSync("tar", ["xjf", archivePath, "-C", outDir, member]);
  return join(outDir, member);
}

async function download(
  url: string,
  destPath: string,
  label: string
): Promise<void> {
  if (existsSync(destPath)) {
    const sizeMb = (statSync(destPath).size / 1024 / 1024).toFixed(1);
    console.log(`[${label}] using cached ${destPath} (${sizeMb} MB)`);
    return;
  }
  console.log(`[${label}] downloading ${url} …`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${label} download failed: ${response.status} ${response.statusText}`
    );
  }
  const data = new Uint8Array(await response.arrayBuffer());
  writeFileSync(destPath, data);
  console.log(
    `[${label}] downloaded ${(data.length / 1024 / 1024).toFixed(1)} MB → ${destPath}`
  );
}

// --- Streaming line readers --------------------------------------------------

/** Matches any token containing at least one non-ASCII char (kana/kanji). */
const NON_ASCII = /[^\p{ASCII}]/u;

async function* readLines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: stream,
  });
  for await (const line of rl) {
    yield line;
  }
}

/** Parse a Tatoeba sentences.csv line: `id \t lang \t text`. */
function parseSentenceLine(
  line: string
): { id: number; lang: string; text: string } | null {
  const firstTab = line.indexOf("\t");
  if (firstTab === -1) {
    return null;
  }
  const id = Number.parseInt(line.slice(0, firstTab), 10);
  if (!Number.isFinite(id)) {
    return null;
  }
  const rest = line.slice(firstTab + 1);
  const secondTab = rest.indexOf("\t");
  if (secondTab === -1) {
    return null;
  }
  return {
    id,
    lang: rest.slice(0, secondTab),
    text: rest.slice(secondTab + 1),
  };
}

/**
 * Extract word surfaces from a Tanaka B-line linkage string
 * (`word[reading] position` tokens; ASCII punctuation tokens dropped).
 */
function linkedWordsFrom(linkage: string): string[] {
  const words: string[] = [];
  for (const token of linkage.split(" ")) {
    const bracket = token.indexOf("[");
    const word = (bracket === -1 ? token : token.slice(0, bracket)).trim();
    if (word.length > 0 && NON_ASCII.test(word)) {
      words.push(word);
    }
  }
  return words;
}

// --- Main --------------------------------------------------------------------

const force = process.argv.includes("--force");
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(new URL("../data/sentences/", import.meta.url), { recursive: true });

const workDir = join(tmpdir(), `tatoeba-${Date.now()}`);
const cacheDirPath = CACHE_DIR.pathname;
const forceSuffix = force ? `-${Date.now()}` : "";
const sentencesArchive = join(cacheDirPath, `sentences${forceSuffix}.tar.bz2`);
const indicesArchive = join(cacheDirPath, `jpn_indices${forceSuffix}.tar.bz2`);

try {
  await download(SENTENCES_URL, sentencesArchive, "sentences");
  await download(JPN_INDICES_URL, indicesArchive, "jpn_indices");

  mkdirSync(workDir, { recursive: true });
  const sentencesCsv = extractTarBz2(
    sentencesArchive,
    "sentences.csv",
    workDir
  );
  const indicesCsv = extractTarBz2(indicesArchive, "jpn_indices.csv", workDir);

  // Pass 1: walk sentences.csv once — keep Japanese sentences (≤ MAX_JP_CHARS)
  // and English sentences, both keyed by id.
  console.log("[join] pass 1/2 — indexing jp + eng sentences …");
  const jpById = new Map<number, string>();
  const engById = new Map<number, string>();
  for await (const line of readLines(sentencesCsv)) {
    const parsed = parseSentenceLine(line);
    if (!parsed) {
      continue;
    }
    if (parsed.lang === "jpn") {
      if (parsed.text.length <= MAX_JP_CHARS) {
        jpById.set(parsed.id, parsed.text);
      }
    } else if (parsed.lang === "eng") {
      engById.set(parsed.id, parsed.text);
    }
  }
  console.log(
    `[join] indexed ${jpById.size.toLocaleString()} jp / ${engById.size.toLocaleString()} eng sentences`
  );

  // Pass 2: walk jpn_indices.csv — join jp sentence to its English meaning.
  console.log("[join] pass 2/2 — joining jpn_indices …");
  const tmpOut = `${OUT_FILE.pathname}.tmp`;
  if (existsSync(tmpOut)) {
    unlinkSync(tmpOut);
  }
  const pending: string[] = [];
  let wrote = 0;
  let seen = 0;
  const seenJpIds = new Set<number>();

  for await (const line of readLines(indicesCsv)) {
    const firstTab = line.indexOf("\t");
    if (firstTab === -1) {
      continue;
    }
    const jpId = Number.parseInt(line.slice(0, firstTab), 10);
    if (!Number.isFinite(jpId)) {
      continue;
    }
    // One output pair per Japanese sentence (first English meaning wins).
    if (seenJpIds.has(jpId)) {
      continue;
    }
    const rest = line.slice(firstTab + 1);
    const secondTab = rest.indexOf("\t");
    if (secondTab === -1) {
      continue;
    }
    const meaningId = Number.parseInt(rest.slice(0, secondTab), 10);
    const jp = jpById.get(jpId);
    const en = meaningId > 0 ? engById.get(meaningId) : undefined;
    if (jp === undefined || en === undefined) {
      continue;
    }
    seenJpIds.add(jpId);
    seen += 1;
    pending.push(
      `${JSON.stringify({
        attribution: "Tatoeba CC BY 2.0 / Tanaka Corpus PD",
        en,
        id: jpId,
        jp,
        linkedWords: linkedWordsFrom(rest.slice(secondTab + 1)),
      })}\n`
    );
    wrote += 1;
    if (pending.length >= FLUSH_EVERY) {
      appendFileSync(tmpOut, pending.join(""));
      pending.length = 0;
    }
  }
  if (pending.length > 0) {
    appendFileSync(tmpOut, pending.join(""));
  }
  renameSync(tmpOut, OUT_FILE.pathname);

  const outSizeMb = (statSync(OUT_FILE.pathname).size / 1024 / 1024).toFixed(1);
  console.log(
    `[done] wrote ${wrote.toLocaleString()} pairs (${seen.toLocaleString()} linked) → ${OUT_FILE.pathname} (${outSizeMb} MB)`
  );
  console.log(
    `[done] caches kept at ${cacheDirPath} — pass --force to re-download`
  );
} finally {
  rmSync(workDir, { force: true, recursive: true });
}
