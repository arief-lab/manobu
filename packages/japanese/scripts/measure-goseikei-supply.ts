/**
 * TASK-173.9.26 supply walk (AC#2): the OFFICIAL 語形成 shape, measured from
 * the 2018 N2 sample paper (`https://www.jlpt.jp/samples/sample2018/pdf/N2V.pdf`),
 * prints a sentence with a partial compound and a blank,
 * `男女の結婚（　）の違いについて調べた。`, and offers FOUR SINGLE KANJI,
 * exactly one of which completes the compound (観; 識/念/察 do not).
 *
 * The task's first draft assumed the 漢字読み circles-and-reorderings shape
 * instead; the sample paper falsified that, and this walk measures the REAL
 * one. Every mechanical clause the item owes:
 *
 *   1. the key must be an attested pure-kanji compound of length >= 3 in the
 *      N2 band (the 小問 asks an N2 word; length >= 3 keeps the printed
 *      fragment at two kanji like every official 小問),
 *   2. the blank sits at ONE END of the compound (the paper puts it first or
 *      last: 結婚（観）, （高）水準), and the PRINTED FRAGMENT is itself an
 *      attested word in some band (all four official 小問 print a real word
 *      beside the blank: 結婚, 水準, 日本, 使用; （時）間割 prints a stub,
 *      which is not the ねらい),
 *   3. a distractor is a single kanji the learner has met (it occurs in some
 *      word of the bands at or below N2) whose completion with the fragment
 *      is attested as NO word in ANY band N5-N1 — an attested completion is
 *      the two-answer risk the blind passes (AC#3) then judge for sentence
 *      fit, exactly the guard the 表記 walk uses.
 *
 * What can run out is compounds with a clean option set, and one spent
 * compound backs exactly one 小問, so the count of clean candidates is the
 * real supply. This script MEASURES and reports it against the depth floor
 * (5 小問 x 4 papers = 20 at N2, from PAPER_BLOCKS paper.ts:587). It also
 * counts how many clean candidates appear in the sentence corpus, which is
 * the number that decides the sentence route (Tatoeba-sourced vs authored) —
 * the walk decides, not taste. It writes nothing.
 *
 * Scratch tool, the measure-hyouki-supply precedent: run directly, no npm
 * entry, output pasted into the task notes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface VocabEntry {
  readonly reading: string;
  readonly word: string;
}

const DATA_DIR = join(import.meta.dir, "..", "data");

// 小問数 x 4 papers for 語形成: N2 only, 5 x 4 (paper.ts:587).
const FLOOR = 20;

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

// The attestation universe: every word field of every band. A distractor
// completion must NOT be in it.
const allWords = new Set<string>();
// The kanji the learner has met by N2: every kanji occurring in a word of a
// band at or below N2. Distractors are drawn from this pool.
const knownKanji = new Set<string>();

for (const band of bands) {
  const atOrBelowN2 = band !== "N1";
  for (const entry of loadVocabBand(band)) {
    if (entry.word.length === 0) {
      continue;
    }
    allWords.add(entry.word);
    if (atOrBelowN2) {
      for (const ch of entry.word) {
        if (KANJI_ONLY_RE.test(ch)) {
          knownKanji.add(ch);
        }
      }
    }
  }
}

const n2Entries = loadVocabBand("N2");
const n2Keys = new Set<string>();
for (const entry of n2Entries) {
  if (KANJI_ONLY_RE.test(entry.word) && entry.word.length >= 3) {
    n2Keys.add(entry.word);
  }
}

const sentenceLines: string[] = [];
for (const line of readFileSync(
  join(DATA_DIR, "sentences", "sentences.jsonl"),
  "utf8"
).split("\n")) {
  if (line.length > 0) {
    sentenceLines.push((JSON.parse(line) as { jp: string }).jp);
  }
}

type Blank = "first" | "last";

interface Split {
  fragment: string;
  key: string;
}

/** The single kanji the blank is, and the fragment printed next to it. */
const splitOf = (word: string, blank: Blank): Split =>
  blank === "last"
    ? { fragment: word.slice(0, -1), key: word.slice(-1) }
    : { fragment: word.slice(1), key: word.slice(0, 1) };

/** Distractor kanji whose completion with the fragment is no word at all. */
const cleanDistractorsFor = (fragment: string, key: string, blank: Blank) => {
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

interface Candidate {
  blank: Blank;
  cleanDistractors: number;
  fragment: string;
  key: string;
  sentences: number;
  word: string;
}

// One candidate per compound: the split with the more clean distractors wins.
// The row IS the compound (spent once per store, the cross-level reuse screen
// of every composed store).
const byWord = new Map<string, Candidate>();
for (const word of n2Keys) {
  let best: Candidate | null = null;
  for (const blank of ["first", "last"] as const) {
    const { fragment, key } = splitOf(word, blank);
    if (!allWords.has(fragment)) {
      continue;
    }
    const clean = cleanDistractorsFor(fragment, key, blank).length;
    if (clean < 3) {
      continue;
    }
    const candidate: Candidate = {
      blank,
      cleanDistractors: clean,
      fragment,
      key,
      sentences: 0,
      word,
    };
    if (best === null || candidate.cleanDistractors > best.cleanDistractors) {
      best = candidate;
    }
  }
  if (best !== null) {
    byWord.set(word, best);
  }
}

let sentenceBacked = 0;
for (const [word, candidate] of byWord) {
  for (const jp of sentenceLines) {
    if (jp.includes(word)) {
      candidate.sentences += 1;
    }
  }
  if (candidate.sentences > 0) {
    sentenceBacked += 1;
  }
}

console.log(
  `語形成 supply: ${byWord.size} N2 compounds complete with a single kanji ` +
    "onto an attested word fragment, against >= 3 unattested alternatives " +
    `(floor ${FLOOR})`
);
console.log(
  `  of those, ${sentenceBacked} are attested in the sentence corpus ` +
    "(the authoring-seed count)"
);
console.log(
  `  mechanical supply -> ${byWord.size >= FLOOR ? "SHIPS" : "DECLINES"}`
);
console.log(
  `  sentence-backed  -> ${sentenceBacked >= FLOOR ? "ENOUGH" : "NOT ENOUGH"}`
);
// The printed list is the pick-off sheet for the authoring agent: each line
// shows the blank shape the paper will print and how many clean distractor
// kanji the fragment already offers.
for (const [word, candidate] of byWord) {
  const shape =
    candidate.blank === "last"
      ? `${candidate.fragment}（${candidate.key}）`
      : `（${candidate.key}）${candidate.fragment}`;
  console.log(
    `  ${word} ${shape} distractors=${String(candidate.cleanDistractors)} ` +
      `sentences=${String(candidate.sentences)}`
  );
}
