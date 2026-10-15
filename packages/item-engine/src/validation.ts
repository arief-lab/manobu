import {
  stimulusPassageText,
  stimulusRequirement,
  stimulusTexts,
} from "./stimuli";
import type {
  ItemCorpusView,
  ItemRejectionReason,
  ItemValidationResult,
  OptionSatisfaction,
  OptionSource,
  QuestionItem,
  ResolvedAnchor,
} from "./types";

const FSRS_ITEM_TYPES: readonly QuestionItem["itemType"][] = [
  "kanji-reading",
  "word-in-context",
];

type RejectionResult = Extract<ItemValidationResult, { ok: false }>;

const normalizeSurface = (value: string): string =>
  value.trim().normalize("NFC").toLocaleLowerCase();

const reject = (
  reason: ItemRejectionReason,
  anchorIds: readonly string[] = [],
  optionIndexes: readonly number[] = []
): RejectionResult => ({ anchorIds, ok: false, optionIndexes, reason });

const resolveAnchors = (
  anchors: readonly string[],
  corpus: ItemCorpusView
): { missing: string[]; resolved: ResolvedAnchor[] } => {
  const missing: string[] = [];
  const resolved: ResolvedAnchor[] = [];
  for (const anchorId of anchors) {
    const anchor = corpus.resolveAnchor(anchorId);
    if (!anchor) {
      missing.push(anchorId);
      continue;
    }
    resolved.push(anchor);
  }
  return { missing, resolved };
};

const duplicateOptionIndexes = (options: readonly string[]): number[] => {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  options.forEach((option, index) => {
    const normalized = normalizeSurface(option);
    if (seen.has(normalized)) {
      duplicates.push(index);
      return;
    }
    seen.add(normalized);
  });
  return duplicates;
};

/**
 * Types whose answer is expected to appear in their own stimulus. Looking for
 * the answer in the stimulus there would reject every valid reading and
 * listening item, so only the stem counts as leak evidence for them.
 */
const STIMULUS_ANSWER_TYPES: readonly QuestionItem["itemType"][] = [
  // The 主張理解 key term is sourced from the passage (the authored claim is
  // anchored to a word the source prints), so the answer appearing in the
  // stimulus is the construction, not a leak; only the stem can leak it.
  "claim-understanding",
  "integrated-listening",
  "integrated-reading",
  // 情報検索 asks for a fact the document prints (a price, a time, a day), so
  // the answer sitting in the notice is the point of the item, not a leak.
  "info-search",
  "listening-detail",
  // TASK-173.8.1: a 聴解 小問 is answered from what the learner HEARS. The 課題理解
  // answer is routinely spoken in its own dialogue (the woman says カフェの 前で
  // 会いましょう and the option IS カフェの 前), exactly like `info-search` above,
  // so the stimulus is the evidence the answer legitimately sits in, not a leak.
  "listening-hatsuwa",
  "listening-kadai",
  // TASK-173.9.4.1: 概要理解 is answered from what the learner HEARS, exactly
  // like its siblings: the talk decides the answer and the option may restate a
  // word the talk says - that is the 大問 working, not a leak.
  "listening-gaiyou",
  // TASK-173.9.4.2: 聴解統合理解 likewise: the long dialogue decides the
  // answer and an option may restate words it speaks.
  "listening-choukai",
  "listening-point",
  "listening-sokuji",
  "long-reading",
  "reading-info",
  "short-reading",
  // 統合理解 asks what BOTH documents mention, so the key being printed twice
  // is the construction; only the stem could leak it, and the stem is fixed.
  "text-comparison",
];

const hasStemLeak = (item: QuestionItem): boolean => {
  const answer = item.options[item.answerIndex];
  if (!answer) {
    return false;
  }
  const normalizedAnswer = normalizeSurface(answer);
  if (!normalizedAnswer) {
    return false;
  }
  const evidence = STIMULUS_ANSWER_TYPES.includes(item.itemType)
    ? item.prompt
    : `${item.prompt}\n${stimulusPassageText(item)}`;
  return normalizeSurface(evidence).includes(normalizedAnswer);
};

const validateShape = (item: QuestionItem): RejectionResult | null => {
  if (item.anchors.length === 0) {
    return reject("no-anchor");
  }
  if (item.options.length !== 4) {
    return reject("option-count");
  }
  if (
    !Number.isInteger(item.answerIndex) ||
    item.answerIndex < 0 ||
    item.answerIndex >= item.options.length
  ) {
    return reject("answer-index");
  }
  return null;
};

const validateAnchors = (
  item: QuestionItem,
  corpus: ItemCorpusView
): RejectionResult | null => {
  const { missing, resolved } = resolveAnchors(item.anchors, corpus);
  if (missing.length > 0) {
    return reject("anchor-missing", missing);
  }
  if (
    item.fsrsVocabId !== undefined &&
    item.fsrsVocabId !== null &&
    !FSRS_ITEM_TYPES.includes(item.itemType)
  ) {
    return reject("fsrs-link");
  }
  const wrongLevel = resolved
    .filter((anchor) => anchor.level !== null && anchor.level !== item.level)
    .map((anchor) => anchor.id);
  return wrongLevel.length > 0 ? reject("anchor-level", wrongLevel) : null;
};

const validateOptions = (
  item: QuestionItem,
  optionSources: readonly OptionSource[],
  corpus: ItemCorpusView
): RejectionResult | null => {
  const duplicates = duplicateOptionIndexes(item.options);
  if (duplicates.length > 0) {
    return reject("duplicate-option", [], duplicates);
  }
  if (optionSources.length !== item.options.length) {
    return reject(
      "unlucky-distractor",
      [],
      item.options.map((_, index) => index)
    );
  }
  const invalidSources = optionSources
    .map((source, index) =>
      item.anchors.includes(source.anchorId) &&
      corpus.isOptionSourceValid(item, source)
        ? -1
        : index
    )
    .filter((index) => index >= 0);
  if (invalidSources.length > 0) {
    return reject("unlucky-distractor", [], invalidSources);
  }
  const answerSourceIndexes = optionSources
    .map((source, index) => (source.kind === "answer" ? index : -1))
    .filter((index) => index >= 0);
  return answerSourceIndexes.length === 1 &&
    answerSourceIndexes[0] === item.answerIndex
    ? null
    : reject("answer-provenance", [], answerSourceIndexes);
};

const evaluateSatisfaction = (
  item: QuestionItem,
  corpus: ItemCorpusView
): [OptionSatisfaction[], RejectionResult | null] => {
  const satisfaction = item.options.map((_, index) =>
    corpus.satisfies ? corpus.satisfies(item, index) : "unknown"
  );
  const satisfyingIndexes = satisfaction
    .map((value, index) => (value === "yes" ? index : -1))
    .filter((index) => index >= 0);
  if (satisfyingIndexes.length > 1) {
    return [satisfaction, reject("ambiguous", [], satisfyingIndexes)];
  }
  if (
    satisfyingIndexes.length === 0 &&
    satisfaction.every((value) => value === "no")
  ) {
    return [satisfaction, reject("no-correct-answer")];
  }
  return [satisfaction, null];
};

/**
 * The legacy single-stimulus types keep their own reason names; an absent
 * stimulus on an integrated type is a kind or count failure instead, which is
 * why there is no separate "no stimuli at all" reason: an empty set is always
 * already a missing required kind.
 */
const MISSING_STIMULUS_REASON: Readonly<
  Partial<Record<QuestionItem["itemType"], ItemRejectionReason>>
> = {
  "info-search": "passage-missing",
  "listening-choukai": "script-missing",
  "listening-detail": "script-missing",
  "listening-gaiyou": "script-missing",
  "listening-hatsuwa": "script-missing",
  "listening-kadai": "script-missing",
  "listening-point": "script-missing",
  "listening-sokuji": "script-missing",
  "long-reading": "passage-missing",
  "medium-reading": "passage-missing",
  "short-reading": "passage-missing",
};

const validateStimulusLength = (
  item: QuestionItem,
  corpus: ItemCorpusView
): RejectionResult | null => {
  const passageText = stimulusPassageText(item);
  if (passageText.length === 0) {
    return null;
  }
  const maxPassageLength = corpus.maxPassageLength?.(item);
  if (maxPassageLength === null || maxPassageLength === undefined) {
    return null;
  }
  return [...passageText].length > maxPassageLength
    ? reject("passage-length")
    : null;
};

const validateStimuli = (
  item: QuestionItem,
  corpus: ItemCorpusView
): RejectionResult | null => {
  const requirement = stimulusRequirement(item.itemType);
  if (requirement) {
    const passages = stimulusTexts(item, "passage").length;
    const scripts = stimulusTexts(item, "script").length;
    const missingKind =
      (requirement.minPassages > 0 && passages === 0) ||
      (requirement.minScripts > 0 && scripts === 0);
    if (missingKind) {
      return reject(MISSING_STIMULUS_REASON[item.itemType] ?? "stimuli-kind");
    }
    if (
      passages < requirement.minPassages ||
      scripts < requirement.minScripts
    ) {
      return reject("stimuli-count");
    }
  }
  return validateStimulusLength(item, corpus);
};

const validateContent = (
  item: QuestionItem,
  corpus: ItemCorpusView
): RejectionResult | null => {
  const stimulusError = validateStimuli(item, corpus);
  if (stimulusError) {
    return stimulusError;
  }
  if (hasStemLeak(item)) {
    return reject("stem-leak", [], [item.answerIndex]);
  }
  return null;
};

export const validateQuestionItem = (
  item: QuestionItem,
  optionSources: readonly OptionSource[],
  corpus: ItemCorpusView
): ItemValidationResult => {
  const shapeError = validateShape(item);
  if (shapeError) {
    return shapeError;
  }
  const anchorError = validateAnchors(item, corpus);
  if (anchorError) {
    return anchorError;
  }
  const optionError = validateOptions(item, optionSources, corpus);
  if (optionError) {
    return optionError;
  }
  const [satisfaction, satisfactionError] = evaluateSatisfaction(item, corpus);
  if (satisfactionError) {
    return satisfactionError;
  }
  return (
    validateContent(item, corpus) ?? {
      assurance: satisfaction.includes("unknown")
        ? "structural-only"
        : "deterministic",
      ok: true,
    }
  );
};
