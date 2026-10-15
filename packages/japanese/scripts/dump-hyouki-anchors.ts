/**
 * TASK-173.9.25 authoring support (scratch, .cache is gitignored): dump the
 * 表記 anchor shortlist per level. An anchor qualifies when
 *
 *   1. its band entry is written in kanji (word differs from reading),
 *   2. its reading is CUMULATIVELY UNIQUE: no word at or below the level is
 *      attested under the same kana in a second spelling, because a second
 *      attested spelling makes the kana question two-answer no matter what
 *      context the paper writes (the official papers keep to unambiguous
 *      anchors: なみ offers 波 against non-なみ words), and
 *   3. the word appears in the sentence corpus (it lives in real prose).
 *
 * The output feeds the authoring agents: word, reading, and a corpus sentence
 * containing it as a 文脈 seed. Writes only into .cache/hyouki-probe/.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface VocabEntry {
  readonly level: string;
  readonly reading: string;
  readonly word: string;
}

const DATA_DIR = join(import.meta.dir, "..", "data");
const OUT_DIR = join(import.meta.dir, "..", ".cache", "hyouki-probe");

const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

const loadVocabBand = (band: string): VocabEntry[] => {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, `${band.toLowerCase()}.json`), "utf8")
  ) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { entries?: VocabEntry[] }).entries ?? []);
  return list as VocabEntry[];
};

const sentencesByWord = new Map<string, string>();
{
  const path = join(DATA_DIR, "sentences", "sentences.jsonl");
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const row = JSON.parse(line) as { jp: string };
    sentencesByWord.set(row.jp, row.jp);
  }
}
const sentences = [...sentencesByWord.values()];
const corpus = sentences.join("\n");

const BANDS = {
  N2: ["n5", "n4", "n3", "n2"],
  N3: ["n5", "n4", "n3"],
  N4: ["n5", "n4"],
  N5: ["n5"],
} as const;
const TARGET_BAND = { N2: "n2", N3: "n3", N4: "n4", N5: "n5" } as const;

for (const level of ["N5", "N4", "N3", "N2"] as const) {
  const cumulative: VocabEntry[] = [];
  for (const band of BANDS[level]) {
    cumulative.push(...loadVocabBand(band));
  }
  const readings = new Map<string, Set<string>>();
  for (const entry of cumulative) {
    const group = readings.get(entry.reading) ?? new Set<string>();
    group.add(entry.word);
    readings.set(entry.reading, group);
  }
  const seen = new Set<string>();
  const anchors: { word: string; reading: string; seed: string }[] = [];
  for (const entry of loadVocabBand(TARGET_BAND[level])) {
    if (seen.has(entry.word) || !KANJI_RE.test(entry.word)) {
      continue;
    }
    if (entry.word === entry.reading) {
      continue;
    }
    const group = readings.get(entry.reading);
    if (group === undefined || group.size !== 1) {
      continue;
    }
    if (!corpus.includes(entry.word)) {
      continue;
    }
    seen.add(entry.word);
    const seed = sentences.find((jp) => jp.includes(entry.word)) ?? "";
    anchors.push({ reading: entry.reading, seed, word: entry.word });
  }
  const out = join(OUT_DIR, `anchors-${level.toLowerCase()}.json`);
  writeFileSync(out, JSON.stringify(anchors, null, 1));
  console.log(`${level}: ${anchors.length} eligible anchors -> ${out}`);
}
