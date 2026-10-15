import type { ItemType, QuestionItem, Stimulus, StimulusKind } from "./types";

/**
 * What an item type owes the learner before it can be called answerable. A
 * type absent from the table owes nothing, which is why `reading-info` keeps
 * its optional passage and `kana-cell` never sees a stimulus.
 */
export interface StimulusRequirement {
  minPassages: number;
  minScripts: number;
}

export const STIMULUS_REQUIREMENTS: Readonly<
  Partial<Record<ItemType, StimulusRequirement>>
> = {
  "claim-understanding": { minPassages: 1, minScripts: 0 },
  // TASK-173.9.26: 語形成 prints one authored sentence holding the compound's
  // printed fragment beside the （　） blank, and the four options are the
  // candidate single kanji. The sentence is the whole material, so it owes
  // exactly one stimulus; the completed compound is NOT printed in it (only its
  // fragment is), so a sentence that printed the whole compound would leak the
  // answer and `hasStemLeak` checks for exactly that - this type is deliberately
  // absent from `STIMULUS_ANSWER_TYPES`.
  "compound-completion": { minPassages: 1, minScripts: 0 },
  // TASK-173.9.24: 文章の文法 prints one authored passage holding one ＿＿, and the
  // four options are the candidate SENTENCES that could fill it. The passage is
  // the whole material of the 小問, so it owes exactly one stimulus; the answer is
  // an option, never text found in the passage.
  "discourse-cloze": { minPassages: 1, minScripts: 0 },
  // TASK-173.9.7: 情報検索 asks one question against ONE 案内 or お知らせ
  // document, so one passage is the whole shape. The multi-document case is the
  // 統合理解 block (`tougou-rikai`, `text-comparison`), not this one.
  "info-search": { minPassages: 1, minScripts: 0 },
  "integrated-listening": { minPassages: 0, minScripts: 1 },
  "integrated-reading": { minPassages: 2, minScripts: 0 },
  "listening-choukai": { minPassages: 0, minScripts: 1 },
  "listening-detail": { minPassages: 0, minScripts: 1 },
  // TASK-173.9.4.1: 概要理解 owes one script too - the longer coherent text the
  // learner hears once. Same contract as the four sibling 聴解 types: the script
  // IS the material, the question is printed, the answer is a candidate option.
  "listening-gaiyou": { minPassages: 0, minScripts: 1 },
  "listening-hatsuwa": { minPassages: 0, minScripts: 1 },
  // TASK-173.8.1: the four N4/N5 聴解 blocks each owe one script - the spoken
  // scenario the learner hears once. 課題理解/ポイント理解 are short dialogues,
  // 場面対応 is a spoken situation, 即時応答 a single spoken phrase; in every
  // case the script IS the material and the answer is a candidate option, never
  // text the script prints.
  "listening-kadai": { minPassages: 0, minScripts: 1 },
  "listening-point": { minPassages: 0, minScripts: 1 },
  "listening-sokuji": { minPassages: 0, minScripts: 1 },
  "long-reading": { minPassages: 1, minScripts: 0 },
  "medium-reading": { minPassages: 1, minScripts: 0 },
  // TASK-173.9.28: the whole-SENTENCE form of 言い換え類義 prints one sentence with
  // one part underlined ＿＿＿, and the four options are candidate paraphrases of
  // that WHOLE sentence. The underlined sentence is the whole material of the
  // 小問, so it owes exactly one stimulus; the answer is a different sentence
  // saying the same thing, never text found in the stimulus - and `hasStemLeak`
  // checks prompt+passage for exactly that, so this type is deliberately absent
  // from `STIMULUS_ANSWER_TYPES`.
  "sentence-paraphrase": { minPassages: 1, minScripts: 0 },
  "short-reading": { minPassages: 1, minScripts: 0 },
  // TASK-173.9.27: 言い換え類義 prints one authored sentence with one word in
  // 「　」 brackets, and the four options are candidate paraphrases of that
  // word. The sentence is the whole material of the 小問, so it owes exactly one
  // stimulus; the answer is a paraphrase of the bracketed word, never text found
  // in the sentence - a sentence that printed the key would answer itself, and
  // `hasStemLeak` checks prompt+passage for exactly that, so this type is
  // deliberately absent from `STIMULUS_ANSWER_TYPES`.
  "synonym-paraphrase": { minPassages: 1, minScripts: 0 },
  // TASK-173.9.3: 統合理解 is 読み比べて両方に現れる話題を出す, so the 小問 is not
  // answerable from one document. Two passages is the shape, and the item is
  // only ever sourced from a real pair, never from the canned
  // `INTEGRATED_READING_PASSAGES` that `integrated-reading` prints.
  "text-comparison": { minPassages: 2, minScripts: 0 },
  // TASK-173.9.25: 表記 prints one authored sentence with one word written in
  // kana, and the four options are the candidate spellings of that word. The
  // sentence is the whole material of the 小問, so it owes exactly one stimulus;
  // the answer is an option, never text found in the sentence - a sentence that
  // DID print the key's kanji form would leak it, and `hasStemLeak` checks
  // prompt+passage for exactly that, so this type is deliberately absent from
  // `STIMULUS_ANSWER_TYPES`.
  "word-spelling": { minPassages: 1, minScripts: 0 },
};

type ItemStimulusFields = Pick<QuestionItem, "passage" | "script" | "stimuli">;

const nonEmpty = (text: string | null | undefined): text is string =>
  typeof text === "string" && text.trim().length > 0;

/**
 * The item's ordered stimulus set. `stimuli` is canonical; a row written
 * before the set existed still reads correctly through the singular
 * `passage`/`script` fields, so the two shapes never disagree.
 */
export const itemStimuli = (item: ItemStimulusFields): readonly Stimulus[] => {
  const declared = (item.stimuli ?? []).filter((stimulus) =>
    nonEmpty(stimulus.text)
  );
  if (declared.length > 0) {
    return declared;
  }
  return [
    ...(nonEmpty(item.passage)
      ? [{ kind: "passage", text: item.passage } satisfies Stimulus]
      : []),
    ...(nonEmpty(item.script)
      ? [{ kind: "script", text: item.script } satisfies Stimulus]
      : []),
  ];
};

export const stimulusTexts = (
  item: ItemStimulusFields,
  kind: StimulusKind
): readonly string[] =>
  itemStimuli(item)
    .filter((stimulus) => stimulus.kind === kind)
    .map((stimulus) => stimulus.text);

/** The declared set with empty stimuli dropped, as a write should store it. */
export const declaredStimuli = (
  item: ItemStimulusFields
): readonly Stimulus[] =>
  (item.stimuli ?? []).filter((stimulus) => nonEmpty(stimulus.text));

/** The reading text of every passage stimulus, in order, as one body of text. */
export const stimulusPassageText = (item: ItemStimulusFields): string =>
  stimulusTexts(item, "passage").join("\n\n");

/**
 * The value the singular `passage`/`script` columns carry: the first stimulus
 * of that kind, so a multi-stimulus item still reads as a passage item to the
 * consumers that only know the single-stimulus shape.
 */
export const firstStimulusText = (
  item: ItemStimulusFields,
  kind: StimulusKind
): string | null => stimulusTexts(item, kind)[0] ?? null;

export const stimulusRequirement = (
  itemType: ItemType
): StimulusRequirement | null => STIMULUS_REQUIREMENTS[itemType] ?? null;

export const requiresStimulus = (itemType: ItemType): boolean =>
  stimulusRequirement(itemType) !== null;

export const isStimulusKind = (value: unknown): value is StimulusKind =>
  value === "passage" || value === "script";

/**
 * Narrows a stored JSON payload to stimuli, or returns null when the row holds
 * something this engine does not understand. The caller decides what an
 * unreadable cell means; the item store treats it as corruption.
 */
export const parseStimuli = (raw: unknown): readonly Stimulus[] | null => {
  if (!Array.isArray(raw)) {
    return null;
  }
  const stimuli: Stimulus[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    if (!("kind" in entry && "text" in entry)) {
      return null;
    }
    if (!(isStimulusKind(entry.kind) && nonEmpty(entry.text))) {
      return null;
    }
    stimuli.push({ kind: entry.kind, text: entry.text });
  }
  return stimuli;
};
