/**
 * TASK-173.9.25 supply walk (AC#3): the OFFICIAL 表記 shape, measured from the
 * 2018 sample papers (`https://www.jlpt.jp/samples/sample2018/pdf/{N5,N4,N3,N2}V.pdf`),
 * prints one word of a sentence in kana and offers four spellings, exactly one
 * of which is that word. The wrong options are NOT same-reading homophones (the
 * first draft of this task assumed that and was wrong): they are real words
 * whose reading differs from the printed kana (なみ → 池/湖/港, only 波 reads
 * なみ) and fabricated component-mangled spellings (満足 → 満続/万続/万足), plus
 * katakana mora-shuffle variants at N5 (ワイシャツ → ウイシャソ). So a fillable
 * item needs ONE corpus fact, not a group of four:
 *
 *   1. an attested word written in kanji at or below the level, whose
 *      `reading` is the kana the sentence will print (the key),
 *   2. that word appearing in the sentence corpus (a spelling no sentence
 *      carries cannot be asked inside one), and
 *   3. a sentence context the item can present — the corpus gives attestation
 *      that the word lives in real prose; the item sentence itself is authored
 *      like every other composed store.
 *
 * The wrong options carry NO corpus-supply requirement: a mangled spelling is
 * correct precisely BECAUSE it is unattested, and this script's own attestation
 * data is the tool that will later prove it. What can run out is anchors, and
 * one spent anchor backs exactly one 小問 store-wide (cross-level reuse is the
 * bunshou precedent), so the per-band count is the real supply.
 *
 * This script MEASURES and reports the per-band anchor count against the depth
 * floor (小問数 x 4 papers: N5 8x4=32, N4 6x4=24, N3 6x4=24, N2 5x4=20). It
 * writes nothing: the result decides whether 表記 ships at a level or keeps
 * declining with a named hole, and that decision is made by the numbers, not
 * by taste - the TASK-173.6 slice-4 precedent.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface VocabEntry {
  readonly level: string;
  readonly reading: string;
  readonly word: string;
}

const DATA_DIR = join(import.meta.dir, "..", "data");

// 小問数 x 4 papers, from PAPER_BLOCKS (N5 :635, N4 :612, N3 :587, N2 :563).
const FLOORS: Readonly<Record<"N5" | "N4" | "N3" | "N2", number>> = {
  N2: 5 * 4,
  N3: 6 * 4,
  N4: 6 * 4,
  N5: 8 * 4,
};

const KANA_RE = /[\u3041-\u309F\u30A1-\u30FF]/;
const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

const loadVocabBand = (band: string): VocabEntry[] => {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, `${band.toLowerCase()}.json`), "utf8")
  ) as unknown;
  // Same defensive shape as every other reader in this package: the file is
  // either a bare array or { entries: [...] }.
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { entries?: VocabEntry[] }).entries ?? []);
  return list as VocabEntry[];
};

const corpusText = (): string => {
  const text = readFileSync(
    join(DATA_DIR, "sentences", "sentences.jsonl"),
    "utf8"
  );
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    out.push((JSON.parse(line) as { jp: string }).jp);
  }
  return out.join("\n");
};

const corpus = corpusText();

for (const band of ["N5", "N4", "N3", "N2"] as const) {
  const entries = loadVocabBand(band);
  const kanjiAnchors = new Set<string>();
  for (const entry of entries) {
    if (
      entry.word.length === 0 ||
      entry.word === entry.reading ||
      !KANJI_RE.test(entry.word) ||
      !KANA_RE.test(entry.reading)
    ) {
      // A pure-kana entry has no kanji 表記 to ask.
      continue;
    }
    kanjiAnchors.add(entry.word);
  }
  let attested = 0;
  for (const word of kanjiAnchors) {
    if (corpus.includes(word)) {
      attested += 1;
    }
  }
  const floor = FLOORS[band];
  console.log(
    `${band}: ${kanjiAnchors.size} kanji-spelled words in the band, ` +
      `${attested} attested in the sentence corpus ` +
      `(floor ${floor} = 小問数 x 4 papers) -> ` +
      (attested >= floor ? "SHIPS" : "DECLINES")
  );
}
