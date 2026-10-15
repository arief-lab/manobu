import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir } from "../data-dir";

/**
 * TASK-138: the exam's candidate source. Before this, `exam-service.ts`
 * picked from `LOCAL_CATALOG`, sixteen hardcoded nouns, so every paper at
 * every level was a rotation of the same words and the anchors were digests
 * of synthetic ids. This module is the real supply: the same
 * `packages/japanese/data` the drill path and the jlpt-mcp crate already
 * read.
 *
 * Anchors use the crate's canonical format so the two implementations agree
 * (doc-21 §5, TASK-138 AC#7): `vocab:{level}:{word}:{reading}`,
 * `grammar:{id}`, `kanji:{character}`. The exam must not mint its own.
 *
 * `resolveDataDir()` is the packaged-bundle resolution (TASK-43); the
 * repo-relative fallback matches `jap-data.ts`. An unresolvable corpus is
 * `null` rather than a throw, and the caller degrades to an honest shortfall
 * instead of fabricating content — the same rule as `generateNextCards`.
 */

/** One vocabulary entry, as shipped. `meaning` is a semicolon-separated
 * list of glosses, NOT an array: an early version of TASK-138 measured
 * `len(meaning)` and reported 364 "senses" that were characters. */
export interface CorpusVocabEntry {
  readonly level: string;
  readonly meaning: string | null;
  readonly partOfSpeech: string | null;
  readonly reading: string;
  /** JMdict's sense groups, when the corpus carries them. See
   * `senseGroupsOf` for why this is not a convenience field. */
  readonly senses?: readonly (readonly string[])[] | null;
  readonly word: string;
}

/** One grammar point, as shipped. `examples` is the only stimulus material
 * in the desktop bundle, so it is what listening and reading items are
 * written from (doc-21 §6). */
export interface CorpusGrammarEntry {
  readonly examples: readonly { english: string; japanese: string }[];
  readonly id: string;
  readonly level: string;
  readonly meaning_en: string;
  readonly pattern: string;
}

export interface ExamCorpus {
  /** `grammar:{id}` -> entry. */
  readonly grammarByAnchor: ReadonlyMap<string, CorpusGrammarEntry>;
  /** `grammar:{id}` -> entry, for a single level. */
  readonly grammarByLevel: ReadonlyMap<string, readonly CorpusGrammarEntry[]>;
  /** `vocab:{level}:{word}:{reading}` -> entry. */
  readonly vocabByAnchor: ReadonlyMap<string, CorpusVocabEntry>;
  /** `vocab:{level}:{word}:{reading}` -> entry, for a single level. */
  readonly vocabByLevel: ReadonlyMap<string, readonly CorpusVocabEntry[]>;
}

/**
 * The entry's glosses as ONE flat list, which is what `meaning` is, in the
 * shipped priority order: `sense[0]` is the primary a learner should be taught
 * (TASK-138 AC#7), the rest the plausible distractor pool.
 *
 * Module-private: its only caller is `fullSensesOf` below, for the rows that
 * ship no `senses` at all. What it must NOT be used for is deciding whether a
 * gloss is a different MEANING: the semicolons are JMdict renderings, not sense
 * boundaries. Use `senseGroupsOf` for that.
 */
const sensesOf = (entry: CorpusVocabEntry): readonly string[] =>
  (entry.meaning ?? "")
    .split(";")
    .map((sense) => sense.trim())
    .filter((sense) => sense.length > 0);

/**
 * EVERY gloss the entry attests, which is `senses` flattened.
 *
 * This is the accessor to use wherever completeness matters, and `sensesOf` is
 * only for code that genuinely wants the summary. Three reasons, all measured
 * rather than argued:
 *
 * 1. `meaning` is CAPPED, so it is lossy. 1,748 of 8,481 entries - 20% - have a
 *    shorter `meaning` than `senses`, hiding 9,442 glosses. 暇 carries 24 in
 *    `senses` and 8 in `meaning`.
 * 2. The delimiter is AMBIGUOUS. JMdict glosses legitimately contain ";"
 *    inside parentheses, so splitting on it mangles the primary gloss outright:
 *    アウト is "out (of a ball; in tennis, etc.)" and the summary parse yields
 *    "out (of a ball". Four entries ship a wrong first gloss this way, and all
 *    four are wrong ANSWERS.
 * 3. `senses` is the authoritative form anyway, so reading the summary is a
 *    re-derivation with two failure modes.
 */
export const fullSensesOf = (entry: CorpusVocabEntry): readonly string[] =>
  entry.senses?.flat() ?? sensesOf(entry);

/**
 * The entry's glosses GROUPED BY MEANING: each group is one sense, and every
 * member of a group is a correct answer to "what does this word mean?".
 *
 * This is the distinction the exam needs and `meaning` cannot express. 黄色 has
 * one group - yellow, amber - so offering "amber" marks a correct answer wrong
 * (TASK-138 AC#8). 入口 likewise has ONE group, entrance/entry/gate/approach/
 * mouth, and 暇 has eight, the first of which is spare time/free time/leisure.
 * The WordNet experiment (reverted in c75cd5b) tried to recover this
 * downstream and got 1,196 single-sense entries wrong; the structure is right
 * here in the corpus, authoritative and free.
 *
 * An entry with no `senses` falls back to ONE group per gloss, which is the
 * conservative direction: it treats every gloss as possibly-synonymous, so the
 * caller withholds an own-sense distractor rather than offering a wrong one.
 */
export const senseGroupsOf = (
  entry: CorpusVocabEntry
): readonly (readonly string[])[] => {
  const groups = entry.senses;
  if (groups && groups.length > 0) {
    return groups;
  }
  return fullSensesOf(entry).map((gloss) => [gloss]);
};

/** The glosses that are a correct answer alongside `gloss` - its own group. */
export const synonymsOf = (
  entry: CorpusVocabEntry,
  gloss: string
): readonly string[] => {
  const group = senseGroupsOf(entry).find((candidate) =>
    candidate.includes(gloss)
  );
  return group ?? [];
};

/** The entry's part-of-speech tags, normalized. The shipped field mixes
 * granularities ("noun, pref", "intransitive verb"), so it is a filter, not
 * a form-class classifier (doc-21 §8: the SQL surface cannot tag, and the
 * crate's tagger is agent-only). */
export const partsOfSpeechOf = (entry: CorpusVocabEntry): readonly string[] =>
  (entry.partOfSpeech ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);

export const vocabAnchorFor = (entry: CorpusVocabEntry): string =>
  `vocab:${entry.level}:${entry.word}:${entry.reading}`;

export const grammarAnchorFor = (entry: CorpusGrammarEntry): string =>
  `grammar:${entry.id}`;

/**
 * The learner-facing name of each anchor (TASK-160). A corpus id is a join
 * key, not a word: `vocab:N5:<word>:<reading>` degenerates to
 * `vocab:N5:05d1e396…` for entries whose surface is not text, and
 * `grammar:<id>` is a slug. So the review surface prints what the entry IS:
 * the word with its reading for vocabulary, the construction for grammar.
 *
 * An anchor the corpus does not carry yields NOTHING rather than its own id.
 * A hash inside a sentence is the same defect wearing a label, and a row with
 * no label says less but lies less.
 */
export const anchorLabelsFor = (
  anchors: readonly string[],
  corpus: ExamCorpus | null
): string[] => {
  const labels: string[] = [];
  for (const anchor of anchors) {
    const vocab = corpus?.vocabByAnchor.get(anchor);
    if (vocab !== undefined) {
      // Kana entries have word === reading (see `hasKanjiSurface`), and
      // いい（いい） reads like a mistake.
      labels.push(
        vocab.word === vocab.reading
          ? vocab.word
          : `${vocab.word}（${vocab.reading}）`
      );
      continue;
    }
    const grammar = corpus?.grammarByAnchor.get(anchor);
    if (grammar !== undefined) {
      labels.push(grammar.pattern);
    }
  }
  return labels;
};

/** Whether an entry can be a conjugation target: some corpus files tag the
 * verb-ness as its own tag rather than inside `partOfSpeech`, so both are
 * checked. Conjugation items are sourced from verb entries (AC#2) and a noun
 * can never stand in for one. */
const KANJI = /[\u4e00-\u9fff]/;

/**
 * Whether an entry can be the target of a question that gives one half and
 * asks for the other. 91 of 400 sampled N5 entries are written in kana, so
 * `word === reading` (そうして, いい, キロ): asking for the reading of いい
 * with the answer いい is degenerate, and the validator's stem-leak rule
 * rejects it. Such entries are still fine as the ANSWER side of a gloss
 * question, so this is a filter for reading-shaped items, not a corpus
 * exclusion.
 */
const hasKanjiSurface = (entry: CorpusVocabEntry): boolean =>
  KANJI.test(entry.word);

/** Both halves present and distinct: a reading question needs a written form
 * whose reading is a different string. String inequality, not a script test -
 * 入る/はいる and 甘い/あまい are kanji words with good readings, and a script
 * test rejected 388 of 698 N5 entries to exclude the 91 that are truly
 * kana-only (いい, キロ). */
export const isDistinctSurfaceEntry = (entry: CorpusVocabEntry): boolean =>
  hasKanjiSurface(entry) && entry.reading !== entry.word;

export const isVerbEntry = (entry: CorpusVocabEntry): boolean => {
  const tags = partsOfSpeechOf(entry);
  if (tags.some((tag) => tag.includes("verb"))) {
    return true;
  }
  return (entry.meaning ?? "").toLowerCase().includes("conjugation");
};

const readJson = <T>(path: string): T | null => {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
};

const levelFile = (dir: string, level: string): string =>
  join(dir, `${level.toLowerCase()}.json`);

const loadVocabLevel = (
  dir: string,
  level: string
): readonly CorpusVocabEntry[] => {
  const raw = readJson<CorpusVocabEntry[]>(levelFile(dir, level));
  if (!raw) {
    return [];
  }
  // 2 of 700 N5 entries ship a null meaning and two a null partOfSpeech
  // (measured 2026-09-26). An entry with no gloss cannot be a recognition
  // target, so it is dropped here rather than becoming a blank option.
  return raw.filter(
    (entry) =>
      typeof entry.word === "string" &&
      entry.word.length > 0 &&
      typeof entry.reading === "string" &&
      fullSensesOf(entry).length > 0
  );
};

const loadGrammarLevel = (
  dir: string,
  level: string
): readonly CorpusGrammarEntry[] => {
  const raw = readJson<CorpusGrammarEntry[]>(
    join(dir, "grammar", `${level.toLowerCase()}.json`)
  );
  return raw ?? [];
};

const buildCorpus = (dir: string): ExamCorpus => {
  const vocabByLevel = new Map<string, readonly CorpusVocabEntry[]>();
  const grammarByLevel = new Map<string, readonly CorpusGrammarEntry[]>();
  const vocabByAnchor = new Map<string, CorpusVocabEntry>();
  const grammarByAnchor = new Map<string, CorpusGrammarEntry>();

  for (const level of ["N5", "N4", "N3", "N2", "N1"]) {
    const vocab = loadVocabLevel(dir, level);
    const grammar = loadGrammarLevel(dir, level);
    vocabByLevel.set(level, vocab);
    grammarByLevel.set(level, grammar);
    for (const entry of vocab) {
      vocabByAnchor.set(vocabAnchorFor(entry), entry);
    }
    for (const entry of grammar) {
      grammarByAnchor.set(grammarAnchorFor(entry), entry);
    }
  }

  return { grammarByAnchor, grammarByLevel, vocabByAnchor, vocabByLevel };
};

let cached: ExamCorpus | null | undefined;

/** The data directory: the packaged-bundle resolution (TASK-43) or the
 * repo-relative fallback that matches `jap-data.ts`. Every corpus reader in
 * this module resolves through here so they agree on one directory. */
const resolveCorpusDir = (): string =>
  resolveDataDir() ??
  join(import.meta.dir, "../../../../packages/japanese/data");

/** The exam's corpus, read once per process. `null` when the data directory
 * cannot be resolved (a packaged binary with no resources), which callers
 * must handle as an honest shortfall rather than by inventing content. */
export const examCorpus = (): ExamCorpus | null => {
  if (cached !== undefined) {
    return cached;
  }
  const dir = resolveCorpusDir();
  // `resolveDataDir` probes for n5.json, so it answers for a packaged bundle;
  // the second check covers a repo tree where the level files are reachable
  // only under their own casing.
  const resolvable =
    existsSync(levelFile(dir, "N5")) || existsSync(levelFile(dir, "n5"));
  cached = resolvable ? buildCorpus(dir) : null;
  return cached;
};

/**
 * TASK-173.7: one 短文 (short-passage 内容理解) item, as shipped in
 * `packages/japanese/data/reading/{level}.json`. This is vendored authentic
 * reading content, NOT derived from the vocabulary/grammar corpora: a 短文
 * question asks comprehension of a passage, so the passage, the Japanese
 * question stem, the four Japanese options and which one is correct all come
 * as one authored unit. See `packages/japanese/data/LICENSE.md` for provenance
 * and license.
 */
export interface CorpusShortReadingEntry {
  readonly answerIndex: number;
  readonly block: string;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  readonly passage: string;
  /** TASK-173.9.5: `licensed` = verbatim from a third-party item corpus (trusted
   * in real mode); `composed` = Japanese this repo assembled itself, in two
   * shapes - AUTHORED prose written for the block with its question in the stem
   * (the ねらい route: every 読解 大問 N1 and N2 prints, and 短文, 中文 and 情報検索
   * at N3/N4), or, until TASK-173.9.21 emptied the last of them, a masked-slot
   * cloze whose key is the word a pinned source paragraph prints. A composed item
   * is refused in real mode UNLESS `validated` is true (its key was falsified
   * offline); absent on the shipped N5 store, which `shortReadingSourceFor` reads
   * as `licensed`. */
  readonly provenance?: "licensed" | "composed";
  /** TASK-173.9.5 AC#2: the ids of the pinned source documents whose verbatim
   * text makes up `passage` - a 白書 paragraph, a PDL1.0 情報素材 snapshot - so the
   * package gate can prove the passage is a subset of attested licensed prose and
   * not a silent paraphrase. For a masked-slot row the passage is that source with
   * ONE word replaced by the blank, and the gate proves the restore. An AUTHORED
   * row carries none, because crediting a document that does not exist is how
   * written material gets laundered into sourced material; licensed (verbatim
   * third-party) entries carry none either. */
  readonly sourceIds?: readonly string[];
  readonly stem: string;
  /** TASK-173.9.5: a composed entry whose answer key has passed the offline
   * distractor-falsification pass (the key answers, no distractor also
   * answers). Only a `composed` + `validated` entry serves a real paper; the
   * flag is an audited freeze, recorded with `validatedBy`, trusted at assembly
   * the way a licensed store row is. Absent (or false) refuses the item in real.
   * A masked-slot row's freeze is machine-checked rather than judged (its gate
   * re-derives the key from the source paragraph); an authored row's is machine-
   * checked for structure and then blind-judged twice with the keys withheld. */
  readonly validated?: boolean;
  /** TASK-173.9.5: who signed off `validated`, so a freeze is attributable
   * rather than anonymous. A generated row names its pipeline
   * (`deterministic:gen-reading-*`) because no model judged it; an authored row
   * names `authored:agent-blind-judged`, which claims exactly the two blind judge
   * passes and nothing more. */
  readonly validatedBy?: string;
}

const loadReadingLevel = (
  dir: string,
  file: string
): readonly CorpusShortReadingEntry[] => {
  const raw = readJson<CorpusShortReadingEntry[]>(join(dir, "reading", file));
  if (!raw) {
    return [];
  }
  // A candidate that cannot be scored is dropped here rather than becoming a
  // blank 小問: it must carry a passage, a Japanese stem, exactly four
  // distinct options, and an answer index inside that range.
  return raw.filter(
    (entry) =>
      typeof entry.passage === "string" &&
      entry.passage.length > 0 &&
      typeof entry.stem === "string" &&
      entry.stem.length > 0 &&
      entry.options.length === 4 &&
      entry.answerIndex >= 0 &&
      entry.answerIndex < entry.options.length
  );
};

const loadShortReadingLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}.json`);

/**
 * TASK-173.9.2: the 中文 (medium) reading store for one level, as shipped in
 * `packages/japanese/data/reading/{level}-chuubun.json`. Same row shape and
 * same trust model as the 短文 store (composed prose that serves real mode only
 * once validated); the difference is the passage length and the block it fills.
 */
const loadMediumReadingLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-chuubun.json`);

const loadChuushouLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-chuushou.json`);

/**
 * TASK-173.9.12: the 長文 (long-passage 内容理解) store for one level, as shipped
 * in `packages/japanese/data/reading/{level}-choubun.json`. Same row shape as the
 * 中文 store, two different passages behind it: N1 still ships the composed
 * masked-slot row of TASK-173.9.12, whose text is a window of 2 to 5 CONSECUTIVE
 * 白書 paragraphs joined with newlines, so the window's paragraph ids travel
 * together in `sourceIds` and `check:reading-choubun` re-proves their adjacency.
 * N3 ships the AUTHORED 書き下ろし 長文 of TASK-173.9.16, which carries no
 * `sourceIds` because no document stands behind it.
 */
const loadChoubunLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-choubun.json`);

/** The two-document store row. It is NOT a `CorpusShortReadingEntry`: a 統合理解
 * 小問 prints a PAIR, so both texts travel together and neither is the
 * "passage". */
export interface CorpusTougouReadingEntry {
  readonly answerIndex: number;
  readonly block: string;
  readonly id: string;
  readonly level: string;
  readonly options: readonly string[];
  /** The two documents of the pair, in the order the row was composed: verbatim
   * 白書 paragraphs on the N1 lookup route, written prose on the N2 authored one
   * (TASK-173.9.20). Neither document is the "passage", which is why this row is
   * not a `CorpusShortReadingEntry`. */
  readonly passages: readonly string[];
  readonly provenance?: "licensed" | "composed";
  readonly sourceIds?: readonly string[];
  readonly stem: string;
  readonly validated?: boolean;
  readonly validatedBy?: string;
}

const loadTougouLevel = (
  dir: string,
  level: string
): readonly CorpusTougouReadingEntry[] => {
  const raw = readJson<CorpusTougouReadingEntry[]>(
    join(dir, "reading", `${level.toLowerCase()}-tougou.json`)
  );
  if (!raw) {
    return [];
  }
  // A pair that cannot be printed or scored is dropped here rather than becoming
  // a half 小問: it must carry TWO non-empty documents, a Japanese stem, four
  // options, and an answer index inside that range.
  return raw.filter(
    (entry) =>
      entry.passages.length === 2 &&
      entry.passages.every(
        (text) => typeof text === "string" && text.length > 0
      ) &&
      typeof entry.stem === "string" &&
      entry.stem.length > 0 &&
      entry.options.length === 4 &&
      entry.answerIndex >= 0 &&
      entry.answerIndex < entry.options.length
  );
};

/**
 * TASK-173.9.7: the 情報検索 store for one level, as shipped in
 * `packages/japanese/data/reading/{level}-jouhou.json`. Same row shape as the
 * 短文 store and the same licensed trust: one question against one 案内 or
 * お知らせ document, verbatim from the vendored JLPTSuccess paper.
 */
const loadJouhouLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-jouhou.json`);

const loadUsageLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-usage.json`);

const loadBunshouLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-bunshou.json`);

const loadHyoukiLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-hyouki.json`);

const loadGoseikeiLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-goseikei.json`);

const loadIikaeLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-iikae.json`);

const loadKiteiLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-kitei.json`);

const loadIikaeSentenceLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-iikae-sentence.json`);

const loadListeningKadaiLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-kadai.json`);

const loadListeningPointLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-point.json`);

const loadListeningHatsuwaLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-hatsuwa.json`);

const loadListeningSokujiLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-sokuji.json`);

/**
 * TASK-173.9.4.1: the 概要理解 rows for one level (`{level}-gaiyou.json`). The
 * N3 store opens this block (paper.ts PAPER_BLOCK_SHAPES["gaiyou-rikai"]), and
 * the row carries the same scenario/question/options shape the loader already
 * expects: the scenario is the heard monologue, the question asks what the
 * whole talk says, and only N3 ships a file so every other level is a named
 * hole (TASK-173.1), not a fabricated 小問.
 */
const loadListeningGaiyouLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-gaiyou.json`);

/**
 * TASK-173.9.4.2: the 聴解統合理解 rows for one level (`{level}-choukai.json`).
 * The row shape is the same one-per-小問 shape; the BLOCK's own rule is that a
 * script appears exactly twice (二つの質問), which the offline gate proves and
 * the group-aware picker serves (`listeningChoukaiSourceFor`).
 */
const loadListeningChoukaiLevel = (
  dir: string,
  level: string
): readonly CorpusShortReadingEntry[] =>
  loadReadingLevel(dir, `${level.toLowerCase()}-choukai.json`);

let chuushouCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.2 slice 2: the 主張理解（長文） items for one level. Real-mode
 * `shuchou-rikai-choubun` draws from here, mirroring `mediumReadingStoreFor`.
 * Only N2 and N1 have a `{level}-chuushou.json` at all, and both now ship the
 * AUTHORED written arguments: N2 since TASK-173.9.20 and N1 since TASK-173.9.21,
 * which retired that level's one-paragraph 白書 window with the authored-key claim.
 * Every other level returns the empty array, which is what makes a level with no
 * file short its 主張理解 block and refuse rather than fabricate one (TASK-173.1).
 */
export const claimUnderstandingStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (chuushouCache === undefined) {
    const dir = resolveCorpusDir();
    chuushouCache = new Map();
    for (const each of ["N5", "N4", "N3", "N2", "N1"]) {
      chuushouCache.set(each, loadChuushouLevel(dir, each));
    }
  }
  return chuushouCache.get(level) ?? [];
};

let tougouCache: Map<string, readonly CorpusTougouReadingEntry[]> | undefined;

/**
 * TASK-173.9.3: the 統合理解 pairs for one level. Real-mode `tougou-rikai` draws
 * from here, mirroring `claimUnderstandingStoreFor`. Only N2 and N1 have a
 * `{level}-tougou.json` at all, and both now ship the AUTHORED written pairs whose
 * key is a relation NEITHER document prints: N2 since TASK-173.9.20 and N1 since
 * TASK-173.9.21, which retired that level's shared-topic lookup. Every other level
 * returns the empty array, which is what makes a level with no file short its
 * 統合理解 block and refuse rather than fabricate a comparison (TASK-173.1).
 */
export const tougouStoreFor = (
  level: string
): readonly CorpusTougouReadingEntry[] => {
  if (tougouCache === undefined) {
    const dir = resolveCorpusDir();
    tougouCache = new Map();
    for (const each of ["N5", "N4", "N3", "N2", "N1"]) {
      tougouCache.set(each, loadTougouLevel(dir, each));
    }
  }
  return tougouCache.get(level) ?? [];
};

let readingCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.7: the 短文 items for one level. Real-mode `naiyou-rikai-tanbun`
 * draws from here. Every level N5-N1 ships a `{level}.json` store (licensed at
 * N5, AUTHORED at N4/N3/N2, masked-slot at N1 until TASK-173.9.21), so an empty
 * array here is a missing file: it is what makes a paper short its 短文 block and
 * refuse rather than fabricate one (TASK-173.1).
 */
export const shortReadingStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (readingCache === undefined) {
    const dir = resolveCorpusDir();
    readingCache = new Map();
    for (const each of ["N5", "N4", "N3", "N2", "N1"]) {
      readingCache.set(each, loadShortReadingLevel(dir, each));
    }
  }
  return readingCache.get(level) ?? [];
};

let mediumReadingCache:
  | Map<string, readonly CorpusShortReadingEntry[]>
  | undefined;

/**
 * TASK-173.9.2: the 中文 items for one level. Real-mode `naiyou-rikai-chuubun`
 * draws from here, mirroring `shortReadingStoreFor`. Every level N5-N1 ships a
 * `{level}-chuubun.json` store (licensed at N5, AUTHORED at N4/N3/N2, masked-slot
 * off the 白書 at N1 until TASK-173.9.21), so an empty array here is a missing
 * file: it is what
 * makes a paper short its 中文 block and refuse rather than fabricate one
 * (TASK-173.1).
 */
export const mediumReadingStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (mediumReadingCache === undefined) {
    const dir = resolveCorpusDir();
    mediumReadingCache = new Map();
    for (const each of ["N5", "N4", "N3", "N2", "N1"]) {
      mediumReadingCache.set(each, loadMediumReadingLevel(dir, each));
    }
  }
  return mediumReadingCache.get(level) ?? [];
};

let choubunCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.12: the 長文 items for one level. Real-mode `naiyou-rikai-choubun`
 * draws from here, mirroring `mediumReadingStoreFor`. Only the levels whose
 * blueprint prints the 大問 have a file: N1 ships a masked 白書 window and N3 an
 * authored 書き下ろし 長文 (TASK-173.9.16, which closed the hole doc-27 §4
 * measured and §10 decided to fill by writing rather than sourcing). N4 has no
 * 内容理解（長文） 大問 at all (the N4 blueprint stops at 情報検索), so an empty
 * array is what keeps a paper printing the canned `LONG_READING_PASSAGE` under no
 * 長文 ねらい.
 */
export const choubunStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (choubunCache === undefined) {
    const dir = resolveCorpusDir();
    choubunCache = new Map();
    for (const each of ["N5", "N4", "N3", "N2", "N1"]) {
      choubunCache.set(each, loadChoubunLevel(dir, each));
    }
  }
  return choubunCache.get(level) ?? [];
};

let jouhouCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.7: the 情報検索 items for one level. Real-mode `jouhou-kensaku`
 * draws from here, mirroring `shortReadingStoreFor`. N5 has the licensed notices;
 * N3 and N4 have AUTHORED 書き下ろし 素材 (TASK-173.9.18 and TASK-173.9.19); N2 and
 * N1 have the composed PDL1.0 情報素材 of TASK-173.9.13, and this is the one 読解
 * 大問 N2 did NOT author: its 素材 are vendored snapshots, so growth means adding a
 * document to the pinned set, which is how N2 reached four 素材 and eight rows
 * (TASK-173.9.20) while N1 still has three and six. A level with no file still
 * returns the empty array, which is what makes a paper short its 情報検索 block and
 * report the hole rather than fabricate a notice (TASK-173.1).
 *
 * Every file carries rows stamped with its own level, and that is not a duplicate
 * to be collapsed: the assembled item carries `request.level` while the anchor
 * records the entry's own level, and `validateAnchors` rejects an item whose anchor
 * level differs (`packages/item-engine/src/validation.ts`), so a row served at N4
 * has to say N4.
 *
 * Until TASK-173.9.19, N4 and (since TASK-173.9.3) N3 answered that by copying the
 * twelve licensed N5 notices and changing only the stamp, because upstream's own N4
 * 読解 paper is unserviceable here (its options are English glosses, which the
 * 情報検索 ねらい does not ask for). That was a ねらい problem rather than a licence
 * problem: the official 大問 budgets a 400字程度 素材 at N4 and a
 * 書き下ろした情報素材 at N3 (doc-26 §3.5, §4), and a 160-245-rune N5 案内 is neither.
 * Both levels now ship written 素材 whose band is far above that set
 * (`JOUHOU_AUTHORED_BAND`), so the borrow cannot return silently, and the licensed
 * set is read at N5 alone.
 */
export const jouhouStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (jouhouCache === undefined) {
    const dir = resolveCorpusDir();
    jouhouCache = new Map();
    for (const each of ["N5", "N4", "N3", "N2", "N1"]) {
      jouhouCache.set(each, loadJouhouLevel(dir, each));
    }
  }
  return jouhouCache.get(level) ?? [];
};

let usageCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.23: the 用法 items for one level. Real-mode `youhou` draws from
 * here, mirroring `jouhouStoreFor`'s contract: the row is a whole 用法 item
 * written for the block (`passage` = the stem sentence, `options` = the four
 * grammatical forms, `answerIndex` = the target form), so no vocab surface is
 * derived and no licensed grammar pattern is re-used. The target form is drawn
 * from the licensed `packages/japanese/data/grammar/{level}.json` pattern store
 * (which already supplies 文の文法1); the three distractors are authored in the
 * store itself. A level with no `usage` store file returns the empty array, which
 * makes the real paper's 用法 大問 come up short rather than fabricate (TASK-173.1).
 *
 * TASK-179: N4 joins the list, because the N4 format prints 用法 5 小問 (doc-26
 * §3.2) and `gen-usage.ts`/`check-usage.ts` now carry the level. N5 stays out on
 * purpose: the N5 format has no 用法 大問 at all (doc-26 §3.1), so a hypothetical
 * `n5-usage.json` would be content no paper can ask.
 */
export const usageStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (usageCache === undefined) {
    const dir = resolveCorpusDir();
    usageCache = new Map();
    for (const each of ["N4", "N3", "N2", "N1"]) {
      usageCache.set(each, loadUsageLevel(dir, each));
    }
  }
  return usageCache.get(level) ?? [];
};

let bunshouCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.24: the 文章の文法 items for one level. Real-mode
 * `bunshou-no-bunpou` draws from here, mirroring `usageStoreFor`'s contract: the
 * row is a whole AUTHORED 文章の文法 item written for the block (`passage` = the
 * short 文章 holding exactly one ＿＿, `options` = the four candidate sentences,
 * `answerIndex` = the one that restores the discourse, `stem` = the official 大問
 * instruction line). Nothing licensed pairs a passage with its own removed
 * sentence, so the key is not re-derivable offline the way a 用法 target form is:
 * the two blind judge passes are the solvability proof and `check:bunshou`
 * re-proves the shape plus the cert record. All five levels print this 大問 with
 * 5 小問 (doc-26 §3.1-§3.5) and all five now carry a store: TASK-179 added the N4
 * and N5 legs, whose papers word the instruction 文章の意味を考えて rather than
 * N3's 文章全体の内容を考えて, which is why the stem is per level and not inherited.
 * A level with no store file returns the empty array, so the real paper names the
 * hole instead of fabricating (TASK-173.1).
 */
export const bunshouStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (bunshouCache === undefined) {
    const dir = resolveCorpusDir();
    bunshouCache = new Map();
    for (const each of ["N5", "N4", "N3", "N2", "N1"]) {
      bunshouCache.set(each, loadBunshouLevel(dir, each));
    }
  }
  return bunshouCache.get(level) ?? [];
};

let hyoukiCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.25: the 表記 items for one level. Real-mode `hyouki` draws from
 * here, mirroring `bunshouStoreFor`'s contract: the row is a whole AUTHORED
 * 表記 小問 written for the block (`passage` = the sentence printing one word
 * in kana, `options` = the four spellings, `answerIndex` = the one that writes
 * that word, `stem` = the official 大問 instruction line). The key spelling is
 * a vocab-corpus-attested word+reading pair; the wrong spellings are the
 * official classes (a real word read differently, or a component-mangled
 * non-word), which is what makes each row mechanically falsifiable against
 * `data/{level}.json` even though the two blind passes certify context fit.
 * 表記 prints at N5/N4/N3/N2 (paper.ts:633, :610, :585, :560) and N1 does not
 * ask it. A level with no store file returns the empty array, so the real
 * paper names the hole instead of fabricating (TASK-173.1).
 */
export const hyoukiStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (hyoukiCache === undefined) {
    const dir = resolveCorpusDir();
    hyoukiCache = new Map();
    for (const each of ["N5", "N4", "N3", "N2"]) {
      hyoukiCache.set(each, loadHyoukiLevel(dir, each));
    }
  }
  return hyoukiCache.get(level) ?? [];
};

let goseikeiCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.26: the 語形成 items for one level. Real-mode `goseikei` draws from
 * here, mirroring `hyoukiStoreFor`'s contract: the row is a whole AUTHORED 語形成
 * 小問 written for the block (`passage` = the sentence printing the compound's
 * fragment beside the （　） blank, `options` = the four single kanji,
 * `answerIndex` = the one that completes the compound, `stem` = the official 大問
 * instruction line). The key compound is pure-kanji attested in the N5–N2 vocab
 * bands and every distractor completion is unattested there, which is what makes
 * each row mechanically falsifiable against `data/{level}.json` even though the
 * two blind passes certify context fit. 語形成 prints only at N2 (paper.ts 大問3)
 * and no other level asks it. A level with no store file returns the empty
 * array, so the real paper names the hole instead of fabricating (TASK-173.1).
 */
export const goseikeiStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (goseikeiCache === undefined) {
    const dir = resolveCorpusDir();
    goseikeiCache = new Map();
    for (const each of ["N2"]) {
      goseikeiCache.set(each, loadGoseikeiLevel(dir, each));
    }
  }
  return goseikeiCache.get(level) ?? [];
};

let iikaeCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.27: the 言い換え類義 items for one level. Real-mode `iikae-ruiji`
 * draws from here, mirroring `goseikeiStoreFor`'s contract: the row is a whole
 * AUTHORED 言い換え類義 小問 written for the block (`passage` = the sentence
 * printing one 「　」-bracketed word, `options` = the four paraphrases,
 * `answerIndex` = the one whose meaning the sentence keeps, `stem` = the
 * official 大問 instruction line). The bracketed target is the exact headword
 * of the level's own band file and the key never appears in the passage, which
 * is what makes each row mechanically falsifiable against `data/{level}.json`
 * even though synonymy itself is a judgement the two blind passes certify.
 * The word form prints at N1/N2/N3 (paper.ts 大問3/5/4); N4/N5 ask the
 * whole-sentence paraphrase form, which is a different construction with its own
 * store (`iikaeSentenceStoreFor`, TASK-173.9.28), so a word-form file is never
 * looked for at those levels and the real paper names the hole rather than
 * fabricating one (TASK-173.1).
 */
export const iikaeStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (iikaeCache === undefined) {
    const dir = resolveCorpusDir();
    iikaeCache = new Map();
    for (const each of ["N1", "N2", "N3"]) {
      iikaeCache.set(each, loadIikaeLevel(dir, each));
    }
  }
  return iikaeCache.get(level) ?? [];
};

let kiteiCache: Map<string, readonly CorpusShortReadingEntry[]> | undefined;

/**
 * TASK-173.9.29: the 文脈規定 (context-cloze) items for one level. Real-mode
 * bunmi-kitei at N3/N2/N1 draws from here, on `iikaeStoreFor`'s contract with a
 * different blank: `passage` is one authored sentence printing one （　） blank,
 * `options` are four same-part-of-speech words, `answerIndex` is the only one
 * the sentence's own context admits (the official shape measured from the 2018
 * 語彙 samples: N3V 問題３, N2V 問題４, N1V 問題２). What is mechanically
 * falsifiable is the shape and the vocabulary: every option is an attested word
 * of one POS family, the key never prints in the passage, and `evidence` is the
 * passage with the key restored - `check:kitei` re-proves that contract. Which
 * of four grammatical fits is the ONE that suits the context is a judgement, and
 * that is what the two blind passes certify. The derived grammar-example join
 * (`clozeSourceFor`) is retired at these levels because it could fill 2/11, 1/7
 * and 0/7 of a real paper (measured 2026-10-13); it stays the N4/N5 path, where
 * the join still fills. A level with no store file returns the empty array, so
 * the real paper names the hole instead of fabricating (TASK-173.1).
 */
export const kiteiStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (kiteiCache === undefined) {
    const dir = resolveCorpusDir();
    kiteiCache = new Map();
    for (const each of ["N3", "N2", "N1"]) {
      kiteiCache.set(each, loadKiteiLevel(dir, each));
    }
  }
  return kiteiCache.get(level) ?? [];
};

let iikaeSentenceCache:
  | Map<string, readonly CorpusShortReadingEntry[]>
  | undefined;

/**
 * TASK-173.9.28: the 言い換え類義 whole-SENTENCE items for one level. Real-mode
 * `iikae-ruiji` at N4/N5 draws from here, on `iikaeStoreFor`'s contract with a
 * different material: `passage` is the underlined sentence itself (the official
 * 大問 marks nothing inside it), `options` are four COMPLETE sentences each
 * re-saying that sentence with one piece swapped, `answerIndex` is the one whose
 * facts the swap keeps, and `stem` is the N4/N5 instruction line read from
 * N4V.pdf p.6 / N5V.pdf p.7. What is mechanically falsifiable is the shape
 * (one sentence, four same-frame sentences, the key not printed in the passage -
 * `check:iikae-sentence`); that the swapped sentence MEANS the underlined one is
 * a judgement, which is what the two blind passes certify. Only N4 and N5 print
 * this form, so every other level returns the empty array.
 */
export const iikaeSentenceStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (iikaeSentenceCache === undefined) {
    const dir = resolveCorpusDir();
    iikaeSentenceCache = new Map();
    for (const each of ["N4", "N5"]) {
      iikaeSentenceCache.set(each, loadIikaeSentenceLevel(dir, each));
    }
  }
  return iikaeSentenceCache.get(level) ?? [];
};

let listeningKadaiCache:
  | Map<string, readonly CorpusShortReadingEntry[]>
  | undefined;

/**
 * TASK-173.8.1: the 課題理解 (listening task-understanding) rows for one level.
 * Real-mode `kadai-rikai` at N4/N5 draws from here (`packages/japanese/data/
 * reading/{level}-kadai.json`). `passage` is the spoken SCRIPT, not printed text:
 * the picker routes it to the item's `script` column, never its `passage`
 * column, because the learner hears the dialogue and answers from hearing it.
 * The store is TWO routes in one file: `provenance: "licensed"` rows are
 * verbatim JLPTSuccess 課題理解 items (CC BY-SA 4.0, LICENSE §29) with their
 * option order adjusted here (key first, page order comes from the shuffle),
 * and `composed` rows are this repo's own dialogues, certified by the two blind
 * passes and frozen by `check:listening-kadai`. A composed row without
 * `validated` is refused in real mode exactly as in every 読解 store, and a
 * drained store leaves the 大問 short with the hole NAMED, not fabricated
 * (TASK-173.1).
 */
export const listeningKadaiStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (listeningKadaiCache === undefined) {
    const dir = resolveCorpusDir();
    listeningKadaiCache = new Map();
    for (const each of ["N1", "N2", "N3", "N4", "N5"]) {
      listeningKadaiCache.set(each, loadListeningKadaiLevel(dir, each));
    }
  }
  return listeningKadaiCache.get(level) ?? [];
};

let listeningPointCache:
  | Map<string, readonly CorpusShortReadingEntry[]>
  | undefined;

/**
 * TASK-173.8.1: the ポイント理解 rows for one level (`{level}-point.json`), on
 * `listeningKadaiStoreFor`'s contract: the scenario is heard, the question asks
 * for one point of it (a reason, a detail), and the same licensed/composed two
 * routes share the file.
 */
export const listeningPointStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (listeningPointCache === undefined) {
    const dir = resolveCorpusDir();
    listeningPointCache = new Map();
    for (const each of ["N1", "N2", "N3", "N4", "N5"]) {
      listeningPointCache.set(each, loadListeningPointLevel(dir, each));
    }
  }
  return listeningPointCache.get(level) ?? [];
};

let listeningHatsuwaCache:
  | Map<string, readonly CorpusShortReadingEntry[]>
  | undefined;

/**
 * TASK-173.8.1: the 場面対応 rows for one level (`{level}-hatsuwa.json`): the
 * heard material is ONE spoken situation and the options are things the learner
 * could SAY. Same two routes; JLPTSuccess's 8 clean utterance_expression items
 * are the licensed half (its 3-choice rows are refused here — our 小問 shape
 * prints four, same as every other block).
 */
export const listeningHatsuwaStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (listeningHatsuwaCache === undefined) {
    const dir = resolveCorpusDir();
    listeningHatsuwaCache = new Map();
    for (const each of ["N3", "N4", "N5"]) {
      listeningHatsuwaCache.set(each, loadListeningHatsuwaLevel(dir, each));
    }
  }
  return listeningHatsuwaCache.get(level) ?? [];
};

let listeningSokujiCache:
  | Map<string, readonly CorpusShortReadingEntry[]>
  | undefined;

/**
 * TASK-173.8.1: the 即時応答 rows for one level (`{level}-sokuji.json`): the
 * heard material is ONE spoken phrase and the options are instant responses.
 * JLPTSuccess prints this 大問 as 3-choice phrase-matches, the wrong shape for
 * our four-option 小問, so the store is fully AUTHORED and the two blind passes
 * are the whole solvability proof, exactly as for 文章の文法 (§24).
 */
export const listeningSokujiStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (listeningSokujiCache === undefined) {
    const dir = resolveCorpusDir();
    listeningSokujiCache = new Map();
    for (const each of ["N1", "N2", "N3", "N4", "N5"]) {
      listeningSokujiCache.set(each, loadListeningSokujiLevel(dir, each));
    }
  }
  return listeningSokujiCache.get(level) ?? [];
};

let listeningGaiyouCache:
  | Map<string, readonly CorpusShortReadingEntry[]>
  | undefined;

/**
 * TASK-173.9.4.1: the 概要理解 rows for one level (`{level}-gaiyou.json`), on
 * `listeningKadaiStoreFor`'s contract. The block's heard material is ONE
 * coherent monologue and the question asks what the talk says overall (話者の
 * 意図や主張, measured off the official N3 ねらい PDF and recorded in doc-26 §4),
 * which is what separates it from a ポイント理解 dialogue. N1/N2/N3 ship this
 * store, so N4/N5 papers come up with the 大問 a named hole (TASK-173.1).
 */
export const listeningGaiyouStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (listeningGaiyouCache === undefined) {
    const dir = resolveCorpusDir();
    listeningGaiyouCache = new Map();
    for (const each of ["N1", "N2", "N3"]) {
      listeningGaiyouCache.set(each, loadListeningGaiyouLevel(dir, each));
    }
  }
  return listeningGaiyouCache.get(level) ?? [];
};

let listeningChoukaiCache:
  | Map<string, readonly CorpusShortReadingEntry[]>
  | undefined;

/**
 * TASK-173.9.4.2: the 聴解統合理解 rows for one level (`{level}-choukai.json`),
 * on `listeningKadaiStoreFor` contract with ONE difference the block owns: the
 * same script backs TWO 小問 (二つの質問, N2L.pdf 問題5), so the picker serves
 * the pair together and spends the script once. N1 and N2 ship the store
 * (TASK-173.9.4.3), and every other level is a named hole (TASK-173.1).
 */
export const listeningChoukaiStoreFor = (
  level: string
): readonly CorpusShortReadingEntry[] => {
  if (listeningChoukaiCache === undefined) {
    const dir = resolveCorpusDir();
    listeningChoukaiCache = new Map();
    for (const each of ["N1", "N2"]) {
      listeningChoukaiCache.set(each, loadListeningChoukaiLevel(dir, each));
    }
  }
  return listeningChoukaiCache.get(level) ?? [];
};

/** Test seam: the module caches, so a test that swaps the data directory
 * needs the cache cleared. Named `__test__` to match `data-dir.ts`. */
export const __test__ = {
  resetCorpusCache: (): void => {
    bunshouCache = undefined;
    cached = undefined;
    chuushouCache = undefined;
    choubunCache = undefined;
    goseikeiCache = undefined;
    hyoukiCache = undefined;
    iikaeCache = undefined;
    iikaeSentenceCache = undefined;
    jouhouCache = undefined;
    kiteiCache = undefined;
    listeningChoukaiCache = undefined;
    listeningGaiyouCache = undefined;
    listeningHatsuwaCache = undefined;
    listeningKadaiCache = undefined;
    listeningPointCache = undefined;
    listeningSokujiCache = undefined;
    mediumReadingCache = undefined;
    readingCache = undefined;
    tougouCache = undefined;
    usageCache = undefined;
  },
};
