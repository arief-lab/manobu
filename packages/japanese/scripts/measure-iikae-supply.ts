/**
 * TASK-173.9.27 supply walk (AC#3): the OFFICIAL word-level 言い換え類義 shape,
 * measured from the 2018 sample papers (N1V.pdf p.4 問題14-19, N2V.pdf p.6
 * 問題23-27, N3V.pdf p.5 問題26-30), prints a sentence with one word/表現
 * UNDERLINED and offers FOUR SHORT JAPANESE options, exactly one closest in
 * meaning (かねがね→以前から, 安堵した→ほっとした, 横断禁止→渡ってはいけません).
 * The N4/N5 大問4 is a different form (whole sentence underlined, four
 * complete-sentence options) and belongs to TASK-173.9.28; this walk measures
 * the word form at N1/N2/N3 only.
 *
 * Synonymy is NOT mechanically re-derivable from this repo's corpora: each
 * JMdict-gloss entry carries one meaning field, so gloss overlap is a
 * CANDIDATE generator, never a proof (doc-27 §11). The clauses here are the
 * mechanical floor a candidate owes before the blind passes ever see it:
 *
 *   1. the underlined word W is an entry of the level's own band (the 大問
 *      tests that level's vocabulary),
 *   2. seed partners S are attested in a band AT OR BELOW the level (the
 *      samples answer a hard word with a plainer one: 安堵した→ほっとした),
 *   3. a seed pair shares an EXACT JMdict gloss token and its coarse POS
 *      category agrees (verb transitivity must not clash; a bare verb
 *      matches either) - a SEED for the author, not a proof of synonymy,
 *   4. W's surface appears in at least one corpus sentence (the sentence
 *      route: Tatoeba-backed vs authored, decided by this count, not taste),
 *   5. same-category in-band words that do NOT share W's gloss exist as
 *      distractor candidates (the blind passes then certify they read as
 *      wrong IN CONTEXT).
 *
 * What CAN run out is authored-and-certified rows, and the walk cannot
 * measure that (see the SEED rule below). What it measures instead is the
 * decidable raw material per level: distinct level words, how many appear in
 * the sentence corpus (the sentence route: Tatoeba-backed vs authored,
 * decided by this count, not taste), and how many carry at least one
 * exact-gloss seed partner for the author. The depth floor (小問数 x 4 papers:
 * N1 24, N2 20, N3 20; PAPER_BLOCKS paper.ts:587/:613/:637) is compared
 * against the sentence-backed count: a level whose words do not even appear
 * in 20-24 distinct sentences has a raw-material problem; above that, whether
 * the floor is met is answered by the certification yield, the same way the
 * 用法/文章の文法 family answers it. A level that still cannot certify the
 * floor declines and stays a named hole (TASK-173.4). It writes nothing.
 *
 * Scratch tool, the measure-goseikei-supply precedent: run directly, no npm
 * entry, output pasted into the task notes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface VocabEntry {
  readonly level: string;
  readonly meaning?: string;
  readonly partOfSpeech?: string;
  readonly reading: string;
  readonly senses?: string[][];
  readonly word: string;
}

const DATA_DIR = join(import.meta.dir, "..", "data");

// 小問数 x 4 papers for the word form (PAPER_BLOCKS paper.ts:613/:639/:663).
const LEVELS = ["N1", "N2", "N3"] as const;
const FLOORS: Record<(typeof LEVELS)[number], number> = {
  N1: 24,
  N2: 20,
  N3: 20,
};

const BANDS = ["N5", "N4", "N3", "N2", "N1"] as const;

const bandIndex = (band: string): number => BANDS.indexOf(band as never);

const loadVocabBand = (band: string): VocabEntry[] => {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, `${band.toLowerCase()}.json`), "utf8")
  ) as unknown;
  return (Array.isArray(raw) ? raw : []) as VocabEntry[];
};

const entriesByBand = new Map<string, VocabEntry[]>();
for (const band of BANDS) {
  entriesByBand.set(band, loadVocabBand(band));
}

/** The gloss strings of one meaning line, trimmed and lowercased, empties
 * dropped; shared by the senses walk and the `meaning` fallback so both
 * normalize identically. */
const normalizedGlosses = (glosses: Iterable<string | undefined>): string[] => {
  const out: string[] = [];
  for (const gloss of glosses) {
    const trimmed = (gloss ?? "").trim().toLowerCase();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
  }
  return out;
};

/** Normalized gloss set: one entry's whole meaning surface, lowercased. */
const glossesOf = (entry: VocabEntry): Set<string> => {
  const senses = Array.isArray(entry.senses) ? entry.senses : [];
  const fromSenses = senses.flatMap((sense) => normalizedGlosses(sense ?? []));
  if (fromSenses.length > 0) {
    return new Set(fromSenses);
  }
  return new Set(normalizedGlosses((entry.meaning ?? "").split(";")));
};

/**
 * Coarse POS categories the option set must agree on. Transitive and
 * intransitive verbs clash; a bare "verb" matches either.
 */
const categoriesOfPart = (part: string): readonly string[] => {
  if (part.includes("verb")) {
    if (part.includes("transitive") && !part.includes("intransitive")) {
      return ["vt"];
    }
    if (part.includes("intransitive")) {
      return ["vi"];
    }
    return ["vt", "vi"];
  }
  if (part.includes("adjective")) {
    return ["adj"];
  }
  if (part.includes("noun")) {
    return ["n"];
  }
  if (part.includes("adverb")) {
    return ["adv"];
  }
  if (part === "expression") {
    return ["expr"];
  }
  return [];
};

const posCategories = (entry: VocabEntry): Set<string> => {
  const out = new Set<string>();
  for (const part of (entry.partOfSpeech ?? "").split(",")) {
    for (const category of categoriesOfPart(part.trim())) {
      out.add(category);
    }
  }
  return out;
};

/**
 * SEED rule, not a screen: two entries sharing an EXACT gloss token are a
 * candidate pair worth an author's look, nothing more. The first draft of this
 * walk also matched >= 4-char gloss prefixes and counted matched pairs as the
 * supply; the 2026-10-11 run falsified both (愛想/友達 via friend<friendliness,
 * 愛想/好き via an exact "liking", neither a Japanese synonym), so synonymy
 * existence is NOT measured here at all - it is decided by the blind passes
 * (AC#3), exactly as the task description always said it would be.
 */
const glossesMatch = (a: string, b: string): boolean => a === b;

const shareGloss = (x: Set<string>, y: Set<string>): boolean => {
  for (const a of x) {
    for (const b of y) {
      if (glossesMatch(a, b)) {
        return true;
      }
    }
  }
  return false;
};

const sentenceTexts: string[] = [];
for (const line of readFileSync(
  join(DATA_DIR, "sentences", "sentences.jsonl"),
  "utf8"
).split("\n")) {
  if (line.length > 0) {
    sentenceTexts.push((JSON.parse(line) as { jp: string }).jp);
  }
}

interface Candidate {
  distractorPool: number;
  reading: string;
  sentenceCount: number;
  synonyms: string[];
  word: string;
}

interface EntryView {
  glosses: Set<string>;
  pos: Set<string>;
  word: string;
}

const viewOf = (entry: VocabEntry): EntryView => ({
  glosses: glossesOf(entry),
  pos: posCategories(entry),
  word: entry.word,
});

for (const level of LEVELS) {
  const atOrBelow = new Set(
    BANDS.filter((band) => bandIndex(band) <= bandIndex(level))
  );
  const pool: EntryView[] = [];
  for (const band of atOrBelow) {
    for (const entry of entriesByBand.get(band) ?? []) {
      const view = viewOf(entry);
      if (view.word.length > 0 && view.glosses.size > 0 && view.pos.size > 0) {
        pool.push(view);
      }
    }
  }
  const targets = entriesByBand.get(level) ?? [];

  // Dedupe targets by surface; one row per distinct underlined word.
  const bySurface = new Map<string, VocabEntry>();
  for (const entry of targets) {
    if (entry.word.length > 0 && !bySurface.has(entry.word)) {
      bySurface.set(entry.word, entry);
    }
  }

  const candidates: Candidate[] = [];
  for (const [word, target] of bySurface) {
    const targetView = viewOf(target);
    const { glosses: targetGlosses, pos: targetPos } = targetView;
    if (targetGlosses.size === 0 || targetPos.size === 0) {
      continue;
    }
    const synonyms: string[] = [];
    let nonSynonymSamePos = 0;
    for (const entry of pool) {
      if (entry.word === word) {
        continue;
      }
      let posAgrees = false;
      for (const p of entry.pos) {
        if (targetPos.has(p)) {
          posAgrees = true;
          break;
        }
      }
      if (!posAgrees) {
        continue;
      }
      if (shareGloss(targetGlosses, entry.glosses)) {
        if (!synonyms.includes(entry.word)) {
          synonyms.push(entry.word);
        }
      } else {
        nonSynonymSamePos += 1;
      }
    }
    let sentenceCount = 0;
    for (const jp of sentenceTexts) {
      if (jp.includes(word)) {
        sentenceCount += 1;
      }
    }
    candidates.push({
      distractorPool: nonSynonymSamePos,
      reading: target.reading,
      sentenceCount,
      synonyms: synonyms.slice(0, 4),
      word,
    });
  }

  const sentenceBacked = candidates.filter((c) => c.sentenceCount > 0).length;
  const seeded = candidates.filter((c) => c.synonyms.length > 0).length;
  const floor = FLOORS[level];
  console.log(
    `言い換え類義 word-form supply ${level}: ${String(candidates.length)} ` +
      "distinct level words with gloss+POS data; " +
      `${String(seeded)} carry >= 1 exact-gloss same-POS SEED partner ` +
      `(author's aid, not a synonymy proof); ` +
      `${String(sentenceBacked)} appear in the sentence corpus`
  );
  console.log(
    `  raw material vs floor ${String(floor)}: ` +
      `${sentenceBacked >= floor ? "SHIPS (sentence-backed words)" : "DECLINES"}` +
      `; whether the floor CERTIFIES is the blind passes' answer, the ` +
      "用法/文章の文法 precedent"
  );
  candidates.sort(
    (a, b) =>
      b.synonyms.length - a.synonyms.length || b.sentenceCount - a.sentenceCount
  );
  for (const c of candidates.slice(0, 40)) {
    console.log(
      `  ${c.word}【${c.reading}】 seeds=[${c.synonyms.join(", ")}] ` +
        `distractorPool=${String(c.distractorPool)} ` +
        `sentences=${String(c.sentenceCount)}`
    );
  }
}
