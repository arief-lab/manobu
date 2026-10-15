/**
 * The vocabulary the composed masked-slot fixtures are built on: seven
 * in-level entries, six nouns and one irregular verb, which is enough for
 * `slotsFor` to find a blank candidate and for the distractor pool to offer a
 * same-category noun the filler sentence does not print.
 *
 * It is shared rather than copied because a second list can drift from the
 * first without either test noticing: the gate and the generator are each proven
 * against this index, so a fixture noun missing here would silently narrow what
 * the two halves agree about. Each gate keeps its own row, its own band and its
 * own assertions.
 */

import { buildVocabIndex, type VocabEntry } from "../scripts/reading-n4-corpus";

export const VOCAB: readonly VocabEntry[] = [
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "あめ",
    senses: [["rain"]],
    word: "雨",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "かぜ",
    senses: [["wind"]],
    word: "風",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "ゆき",
    senses: [["snow"]],
    word: "雪",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "てがみ",
    senses: [["letter"]],
    word: "手紙",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "どうぐ",
    senses: [["tool"]],
    word: "道具",
  },
  {
    level: "N5",
    partOfSpeech: "noun",
    reading: "でんしゃ",
    senses: [["train"]],
    word: "電車",
  },
  {
    level: "N5",
    partOfSpeech: "verb, intransitive verb",
    reading: "ふる",
    senses: [["fall"]],
    word: "降る",
  },
];

export const INDEX = buildVocabIndex(VOCAB);
