/**
 * The sentences the SECOND 中文 construction (TASK-173.9.15, N4 大問5) is proven
 * on: a topic noun in every sentence and one other listed noun in exactly one of
 * them, which is the shape `stitchDocument` assembles and `slotsFor` blanks.
 *
 * Shared between the generator test and the CI-gate test because the two halves
 * must fail on the same document: a fixture copied into each file can drift, and
 * then the gate would be re-proving a text the generator never saw.
 *
 * The tails are kana except for the two listed nouns, and that is load-bearing:
 * `coverageOf` charges every rune the segmenter cannot resolve, so a fixture that
 * slipped under the 0.8 floor would test the floor's refusal rather than the
 * stitch.
 */

import type { SourceSentence } from "../scripts/reading-n4-corpus";

export const stitchTail = (tail: string, id: string): SourceSentence => ({
  en: "",
  id,
  jp: `手紙${tail}`,
  linkedWords: [],
});

/** 手紙 in every sentence (the topic that makes the stitch one document), 電車 in
 * exactly one (the key), and no distractor noun printed at all. Module-local on
 * purpose: consumers ask for `stitchSentences()`, so the whole batch they receive
 * is the batch that was proven, never a slice a caller chose. */
const STITCH_TAILS: readonly string[] = [
  "をまたかきました。",
  "をゆっくりよみました。",
  "をもういちどだしました。",
  "をきょうさがしました。",
  "をともだちにおくりました。",
  "をねえからもらいました。",
  "をあのひとににくれました。",
  "をうっかりすてました。",
  "をかべにかざりました。",
  "をどこかになくしました。",
  "をよみかえしました。",
  "をにとうかきました。",
  "をはやくだしてください。",
  "をまだかいていません。",
  "をいまもさがしています。",
  "をせんせいにおみせしました。",
  "をきのうのよるにだしました。",
  "をぽすとにいれました。",
  "をとうきょうへだしました。",
  "をひとりでよんでいました。",
  "をながしてしまいました。",
  "をそっとてにとりました。",
  "をまたなくしてしまいました。",
  "をていねいにかいていました。",
  "をにぎやかによみました。",
  "をそくぜんのだしました。",
  "をゆっくりとさがしました。",
  "をもういちどよみました。",
  "をいつでもだせます。",
  "をすぐにだしました。",
];

export const stitchSentences = (): SourceSentence[] =>
  STITCH_TAILS.map((tail, index) => stitchTail(tail, `s${String(index)}`));

/** Turns the sentence that holds the key: the topic noun stays, so the document
 * is still one stitch, and 電車 becomes the only noun printed once. */
export const stitchKey = (sentences: SourceSentence[]): void => {
  sentences[4] = stitchTail("は電車のそばにありました。", "s4");
};
