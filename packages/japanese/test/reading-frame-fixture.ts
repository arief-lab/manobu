/**
 * The frame-key prologue the cloze gates share when they falsify the
 * `answer-frame-ambiguous` screen: split the fixture's source text into
 * sentences as a throwaway "source" paragraph, locate the sentence that
 * carries the answer, and return the frame key the corpus screen reads. What
 * each gate does with the key, tamper a fillers map and run its own
 * `checkEntry`, stays in the gate's own test file.
 */

import { frameKeyFor, splitSentences } from "../scripts/reading-chuubun-corpus";
import type { VocabIndex } from "../scripts/reading-n4-corpus";

export const frameKeyOfAnswer = ({
  answer,
  index,
  sourceText,
}: {
  readonly answer: string;
  readonly index: VocabIndex;
  readonly sourceText: string;
}): string => {
  const sentences = splitSentences({
    id: "source",
    license: "",
    pageId: "",
    pageUrl: "",
    source: "",
    text: sourceText,
    title: "",
  });
  const sentenceIndex = sentences.findIndex((sentence) =>
    sentence.text.includes(answer)
  );
  return frameKeyFor(sentences, sentenceIndex, answer, index);
};
