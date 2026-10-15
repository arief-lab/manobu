/** JLPT levels, from most advanced to most basic. */
export type JlptLevel = "N1" | "N2" | "N3" | "N4" | "N5";

/**
 * One vocabulary entry. `meaning` and `partOfSpeech` are filled by the
 * JMdict enrichment step in `scripts/fetch-vocab.ts` (CC BY-SA 4.0 — see
 * `data/LICENSE.md`); entries JMdict doesn't cover keep them unset.
 * `example` is reserved for a future example-sentence source.
 */
export interface VocabEntry {
  /** Example sentence using the word, when known. */
  example?: string;
  /** JLPT level. */
  level: JlptLevel;
  /** English meaning(s), when the corpus has been enriched. */
  meaning?: string;
  /** Coarse part of speech, when known. */
  partOfSpeech?: string;
  /** Reading in hiragana. */
  reading: string;
  /**
   * English glosses GROUPED BY JMdict sense, so the structure survives.
   *
   * `meaning` is a flat semicolon-joined summary and it is lossy in a way that
   * matters: one JMdict sense holds several glosses that are alternative
   * RENDERINGS of the same meaning, so splitting `meaning` on `;` does not
   * yield senses - it yields synonyms. 黄色 is one sense, "yellow; amber", and
   * every part of it is a correct answer. 暇 is seven senses, of which the
   * first is "spare time; free time; leisure".
   *
   * An exam that offers another group as a distractor is offering a different
   * MEANING; one that offers another entry from the same group is marking a
   * correct answer wrong (TASK-138 AC#8). Only the grouped form can tell those
   * apart, and it is the authoritative answer for 100% of entries, where the
   * WordNet experiment (reverted in c75cd5b) reached 35%.
   */
  senses?: string[][];
  /** Surface form — kanji where the word has it, otherwise kana. */
  word: string;
}
