import { describe, expect, it } from "bun:test";
import {
  anchorLabelsFor,
  type CorpusGrammarEntry,
  type CorpusVocabEntry,
  examCorpus,
  grammarAnchorFor,
  vocabAnchorFor,
} from "../src/services/exam-corpus";

/*
 * TASK-160 AC#2/#3: the debrief's learner-facing names.
 *
 * `anchors` is a join key. `vocab:{level}:{word}:{reading}` degenerates to a
 * digest for entries whose surface is not text, and `grammar:{id}` is a slug,
 * so neither belongs in a sentence a learner reads. `anchorLabelsFor` answers
 * with what the entry IS, and an anchor the corpus does not carry yields
 * nothing rather than its own id.
 *
 * Over the REAL shipped corpus: the maps are built once per process from
 * `packages/japanese/data`, so a mock would pin this file's assumptions about
 * the corpus rather than the corpus.
 */

const ANCHOR_SHAPE = /(?:vocab|grammar|kanji):/;

const vocabEntry = (word: string, reading: string): CorpusVocabEntry => {
  const entry = [...(examCorpus()?.vocabByAnchor.values() ?? [])].find(
    (candidate) => candidate.word === word && candidate.reading === reading
  );
  if (entry === undefined) {
    throw new Error(`${word} (${reading}) is not in the shipped corpus`);
  }
  return entry;
};

const firstGrammarEntry = (): CorpusGrammarEntry => {
  const [entry] = examCorpus()?.grammarByLevel.get("N5") ?? [];
  if (entry === undefined) {
    throw new Error("the shipped corpus has no N5 grammar");
  }
  return entry;
};

describe("anchorLabelsFor (TASK-160)", () => {
  it("names a kanji entry with its word and its reading", () => {
    const entry = vocabEntry("村", "むら");
    expect(anchorLabelsFor([vocabAnchorFor(entry)], examCorpus())).toEqual([
      "村（むら）",
    ]);
  });

  it("names a kana entry once, not twice", () => {
    // 91 of 400 sampled N5 entries are written in kana, so word === reading.
    // 「テスト（テスト）」reads like a mistake.
    const entry = vocabEntry("テスト", "テスト");
    expect(anchorLabelsFor([vocabAnchorFor(entry)], examCorpus())).toEqual([
      "テスト",
    ]);
  });

  it("names a grammar entry with its construction", () => {
    const entry = firstGrammarEntry();
    expect(anchorLabelsFor([grammarAnchorFor(entry)], examCorpus())).toEqual([
      entry.pattern,
    ]);
  });

  it("omits the anchor it cannot name and keeps the ones it can", () => {
    const entry = vocabEntry("村", "むら");
    expect(
      anchorLabelsFor(
        ["vocab:N5:05d1e39637e1241d9290", vocabAnchorFor(entry)],
        examCorpus()
      )
    ).toEqual(["村（むら）"]);
  });

  it("yields nothing for an unresolvable corpus rather than the ids", () => {
    // The packaged-binary case: `examCorpus()` is null when the data directory
    // cannot be resolved, and a null corpus must not become a row of hashes.
    const entry = vocabEntry("村", "むら");
    expect(anchorLabelsFor([vocabAnchorFor(entry)], null)).toEqual([]);
  });

  it("preserves the anchor order it was handed", () => {
    // `anchorLabels` is documented as parallel to `anchors` in the contract,
    // and the review row joins them into one sentence.
    const kanji = vocabEntry("村", "むら");
    const grammar = firstGrammarEntry();
    expect(
      anchorLabelsFor(
        [grammarAnchorFor(grammar), vocabAnchorFor(kanji)],
        examCorpus()
      )
    ).toEqual([grammar.pattern, "村（むら）"]);
  });

  it("names every anchor the shipped corpus carries without printing an id", () => {
    // The AC#2 property at corpus scale rather than on three fixtures: over
    // every vocab and grammar anchor, the label is non-empty, is not the
    // anchor, and carries no namespace.
    const corpus = examCorpus();
    if (corpus === null) {
      throw new Error("the shipped corpus is not loaded");
    }
    for (const anchor of [
      ...corpus.vocabByAnchor.keys(),
      ...corpus.grammarByAnchor.keys(),
    ]) {
      const [label] = anchorLabelsFor([anchor], corpus);
      expect(label).toBeDefined();
      expect(label).not.toBe(anchor);
      expect(label).not.toMatch(ANCHOR_SHAPE);
      expect(label?.trim().length).toBeGreaterThan(0);
    }
  });
});
