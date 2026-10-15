/**
 * TASK-173.9.26 authoring support (scratch, .cache is gitignored): dump the
 * 語形成 anchor shortlist at N2. An anchor qualifies when, under the OFFICIAL
 * 2018 compound-completion shape (partial compound + （　） + four single
 * kanji, measured from N2V.pdf 問題３),
 *
 *   1. the word is an attested pure-kanji N2-band compound of length >= 3,
 *   2. the blank sits at one END and the split offers >= 3 distractor kanji
 *      whose completion with the fragment is attested as NO word in ANY band
 *      (the two-answer guard the supply walk measures), and
 *   3. the compound appears in the sentence corpus (a seed for the author;
 *      the printed sentence itself is written fresh, the 表記 precedent).
 *
 * The distractor sample is NOT the pick list: it is the 30 most frequent
 * clean kanji (frequent in the bands at or below N2), because the official
 * options are kanji the learner really met. The gate re-proves unattested-
 * completion for whatever the author finally offers. Writes only into
 * .cache/goseikei-probe/.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface VocabEntry {
  readonly reading: string;
  readonly word: string;
}

const DATA_DIR = join(import.meta.dir, "..", "data");
const OUT_DIR = join(import.meta.dir, "..", ".cache", "goseikei-probe");

const KANJI_ONLY_RE = /^[\u4E00-\u9FFF\u3400-\u4DBF]+$/;

const loadVocabBand = (band: string): VocabEntry[] => {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, `${band.toLowerCase()}.json`), "utf8")
  ) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { entries?: VocabEntry[] }).entries ?? []);
  return list as VocabEntry[];
};

const bands = ["N5", "N4", "N3", "N2", "N1"] as const;

const allWords = new Set<string>();
const kanjiFrequency = new Map<string, number>();

for (const band of bands) {
  const atOrBelowN2 = band !== "N1";
  for (const entry of loadVocabBand(band)) {
    if (entry.word.length === 0) {
      continue;
    }
    allWords.add(entry.word);
    if (atOrBelowN2) {
      for (const ch of new Set(entry.word)) {
        if (KANJI_ONLY_RE.test(ch)) {
          kanjiFrequency.set(ch, (kanjiFrequency.get(ch) ?? 0) + 1);
        }
      }
    }
  }
}

const knownKanji = [...kanjiFrequency.keys()];

const n2Entries = loadVocabBand("N2");
const n2Keys = new Set<string>();
for (const entry of n2Entries) {
  if (KANJI_ONLY_RE.test(entry.word) && entry.word.length >= 3) {
    n2Keys.add(entry.word);
  }
}

const sentences: string[] = [];
for (const line of readFileSync(
  join(DATA_DIR, "sentences", "sentences.jsonl"),
  "utf8"
).split("\n")) {
  if (line.length > 0) {
    sentences.push((JSON.parse(line) as { jp: string }).jp);
  }
}

type Blank = "first" | "last";

const cleanDistractorsFor = (
  fragment: string,
  key: string,
  blank: Blank
): string[] => {
  const out: string[] = [];
  for (const kanji of knownKanji) {
    if (kanji === key) {
      continue;
    }
    const completion = blank === "last" ? fragment + kanji : kanji + fragment;
    if (!allWords.has(completion)) {
      out.push(kanji);
    }
  }
  return out;
};

interface Anchor {
  blank: Blank;
  cleanCount: number;
  distractors: string[];
  fragment: string;
  key: string;
  seeds: string[];
  word: string;
}

const anchors: Anchor[] = [];
for (const word of n2Keys) {
  let best: Anchor | null = null;
  for (const blank of ["first", "last"] as const) {
    const fragment = blank === "last" ? word.slice(0, -1) : word.slice(1);
    const key = blank === "last" ? word.slice(-1) : word.slice(0, 1);
    // The official 小問 print a real WORD beside the blank (結婚, 水準, 日本,
    // 使用); a stub like 間割 is not the ねらい, so the fragment must itself
    // be attested.
    if (!allWords.has(fragment)) {
      continue;
    }
    const clean = cleanDistractorsFor(fragment, key, blank);
    if (clean.length < 3) {
      continue;
    }
    const seeds = sentences.filter((jp) => jp.includes(word)).slice(0, 3);
    if (seeds.length === 0) {
      continue;
    }
    clean.sort(
      (a, b) =>
        (kanjiFrequency.get(b) ?? 0) - (kanjiFrequency.get(a) ?? 0) ||
        a.localeCompare(b)
    );
    const candidate: Anchor = {
      blank,
      cleanCount: clean.length,
      distractors: clean.slice(0, 30),
      fragment,
      key,
      seeds,
      word,
    };
    if (best === null || candidate.cleanCount > best.cleanCount) {
      best = candidate;
    }
  }
  if (best !== null) {
    anchors.push(best);
  }
}

anchors.sort((a, b) => a.word.localeCompare(b.word, "ja"));

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, "anchors-n2.json");
writeFileSync(out, JSON.stringify(anchors, null, 1));
console.log(`${anchors.length} sentence-backed anchors -> ${out}`);
