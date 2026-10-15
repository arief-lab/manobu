/**
 * Fetch KanjiVG stroke-order SVGs (TASK-23.5.1, doc-2 §5.3).
 *
 * Downloads the PINNED KanjiVG release zip, keeps only the kanji that
 * appear in `data/kanji.json` (the KANJIDIC2 corpus the app ships), strips
 * the XML prolog (DOCTYPE + internal ATTLIST block + copyright comment),
 * and emits ONE JSONL file `data/kanjivg/kanjivg.jsonl` — one object per
 * line: `{ "c": "<kanji char>", "s": "<svg document string>" }`.
 *
 * Why one JSONL rather than thousands of loose SVGs: the Rust sidecar
 * gzip-embeds corpus files (`crates/jlpt-mcp/build.rs`); 6,417 tiny files
 * would blow the tarball/inode budget while a single stream compresses to
 * a few MB (measured: ~30.6 MB raw → ~4.5 MB gzip for the corpus subset).
 *
 * Coverage note (measured at r20260714): main.zip carries 6,703 files and
 * covers ALL `jlpt_waller`-classified kanji in the corpus. The missing
 * corpus chars are kyūjitai (traditional forms) whose shinjitai counterpart
 * IS covered — main.zip intentionally excludes variants (that is all.zip).
 *
 * Upstream: https://github.com/KanjiVG/kanjivg (CC BY-SA 3.0 — attribution
 * Ulrich Apel + share-alike; see data/LICENSE.md §9).
 *
 * Run from this package: `bun run fetch:kanjivg [--force]`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RELEASE = "r20260714";
const ZIP_URL = `https://github.com/KanjiVG/kanjivg/releases/download/${RELEASE}/kanjivg-20260714-main.zip`;

const DATA_DIR = join(import.meta.dir, "..", "data");
const OUT_PATH = join(DATA_DIR, "kanjivg", "kanjivg.jsonl");
const CACHE_PATH = join(import.meta.dir, ".cache", `kanjivg-${RELEASE}.zip`);

const force = process.argv.includes("--force");

// --- download (cached) ------------------------------------------------------

mkdirSync(join(CACHE_PATH, ".."), { recursive: true });
if (force || !existsSync(CACHE_PATH)) {
  console.log(`[fetch:kanjivg] downloading ${ZIP_URL}…`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) {
    throw new Error(
      `[fetch:kanjivg] ${ZIP_URL} → HTTP ${res.status} ${res.statusText}`
    );
  }
  writeFileSync(CACHE_PATH, Buffer.from(await res.arrayBuffer()));
  console.log(`[fetch:kanjivg] cached ${CACHE_PATH}`);
} else {
  console.log(
    `[fetch:kanjivg] using cached ${CACHE_PATH} (--force to refresh)`
  );
}

// --- corpus filter set ------------------------------------------------------

const kanjiJson: unknown = JSON.parse(
  readFileSync(join(DATA_DIR, "kanji.json"), "utf-8")
);
if (
  kanjiJson === null ||
  typeof kanjiJson !== "object" ||
  !("kanji" in kanjiJson) ||
  !Array.isArray(kanjiJson.kanji)
) {
  throw new Error(
    "[fetch:kanjivg] data/kanji.json is not a { metadata, kanji[] } envelope"
  );
}
const kanjiEntries: Array<{ character: string }> = kanjiJson.kanji;
// KanjiVG also covers kana (all 208 of kana.json) — DrillLab.Canvas ghost
// overlays need those (TASK-23.5.2 AC#3), so the filter is corpus-kanji ∪
// kana. Measured: +208 files, ~+310 KB raw (~+45 KB gz).
const kanaPath = join(DATA_DIR, "kana.json");
const kanaChars: string[] = existsSync(kanaPath)
  ? (
      JSON.parse(readFileSync(kanaPath, "utf-8")) as Array<{ char: string }>
    ).map((entry) => entry.char)
  : [];
const corpusChars = [
  ...new Set([...kanjiEntries.map((entry) => entry.character), ...kanaChars]),
];
const corpusSet = new Set(corpusChars);
console.log(
  `[fetch:kanjivg] corpus has ${corpusSet.size} chars (${kanjiEntries.length} kanji + ${kanaChars.length} kana)`
);

// --- unzip + filter ---------------------------------------------------------
//
// Bun cannot read zip archives natively; shell out to `unzip` (available on
// every dev/CI platform this repo targets — same assumption as
// fetch-sentences.ts's tar).

const proc = Bun.spawn([
  "unzip",
  "-o",
  "-q",
  CACHE_PATH,
  "-d",
  CACHE_PATH.replace(/\.zip$/, "-x"),
]);
const unzipExit = await proc.exited;
if (unzipExit !== 0) {
  throw new Error(`[fetch:kanjivg] unzip exited ${unzipExit}`);
}

const extractDir = CACHE_PATH.replace(/\.zip$/, "-x");
const svgDir = join(extractDir, "kanji");

const lines: string[] = [];
let missingFromZip = 0;

for (const char of corpusChars) {
  const codepoint = char.codePointAt(0);
  if (codepoint === undefined) {
    throw new Error(
      `[fetch:kanjivg] empty character in corpus: ${JSON.stringify(char)}`
    );
  }
  const svgPath = join(
    svgDir,
    `${codepoint.toString(16).padStart(5, "0")}.svg`
  );
  if (!existsSync(svgPath)) {
    missingFromZip += 1;
    continue;
  }
  const svg = readFileSync(svgPath, "utf-8");
  // Strip everything before <svg: DOCTYPE + internal DTD entity block +
  // the per-file copyright comment. The CC BY-SA 3.0 license text lives in
  // data/LICENSE.md (the per-file headers are identical boilerplate); the
  // attribution requirement is satisfied at the corpus level.
  const start = svg.indexOf("<svg ");
  if (start < 0) {
    throw new Error(`[fetch:kanjivg] ${svgPath}: no <svg> element found`);
  }
  lines.push(
    JSON.stringify({ c: char, s: svg.slice(start).trim() }, undefined, 0)
  );
}

if (lines.length === 0) {
  throw new Error("[fetch:kanjivg] zero kanji matched — check the zip layout");
}

// --- write ------------------------------------------------------------------

mkdirSync(join(OUT_PATH, ".."), { recursive: true });
writeFileSync(OUT_PATH, `${lines.join("\n")}\n`);
console.log(
  `[fetch:kanjivg] wrote ${OUT_PATH}: ${lines.length} kanji (${missingFromZip} corpus chars absent from main.zip — kyūjitai variants)`
);

console.log(
  `[fetch:kanjivg] done. Commit data/kanjivg/kanjivg.jsonl. Release pinned: ${RELEASE} (CC BY-SA 3.0).`
);
