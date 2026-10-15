export const ITEM_SURFACES = ["drill", "exam", "checkpoint"] as const;
export const ITEM_TYPES = [
  "kanji-reading",
  "word-spelling",
  "compound-completion",
  "synonym-paraphrase",
  "sentence-paraphrase",
  "word-in-context",
  "context-cloze",
  "discourse-cloze",
  "star-ordering",
  "grammar-form",
  "usage",
  "conjugation",
  "particle",
  "reading-info",
  "long-reading",
  "medium-reading",
  "short-reading",
  "claim-understanding",
  "text-comparison",
  "info-search",
  "integrated-reading",
  "listening-detail",
  "integrated-listening",
  "listening-kadai",
  "listening-point",
  "listening-hatsuwa",
  "listening-sokuji",
  "listening-choukai",
  "listening-gaiyou",
  "kana-cell",
] as const;

export type ItemSurface = (typeof ITEM_SURFACES)[number];
export type ItemType = (typeof ITEM_TYPES)[number];

export const STIMULUS_KINDS = ["passage", "script"] as const;
export type StimulusKind = (typeof STIMULUS_KINDS)[number];

/**
 * One reading passage or one spoken script an item depends on. An integrated
 * item carries several in order, which is why the singular `passage`/`script`
 * fields are the materialized single-stimulus projection of this list.
 */
export interface Stimulus {
  kind: StimulusKind;
  text: string;
}

/**
 * TASK-142: how a stimulus's target realization was masked, recorded on the
 * item so an unmasked item is VISIBLY unmasked rather than silently leaky.
 *
 * `verified` is never inferred. An item may only claim a verified strategy
 * (`trailing-literal`, TASK-142; `context-word`, TASK-173.5; `fragment-span`,
 * TASK-173.6) with `verified: true` when the masked surface was re-tokenized
 * and found gone; the
 * failure paths that would otherwise produce a corrupt sentence
 * (`literal-not-a-token`, which would cut a word in half, and
 * `unverified-after-masking`) both report `verified: false` and leave the
 * sentence intact. That invariant is what a test asserts.
 */
export type MaskStrategy =
  | "trailing-literal"
  | "context-word"
  | "fragment-span"
  | "no-literal-in-pattern"
  | "literal-absent-from-sentence"
  | "literal-not-a-token"
  | "unverified-after-masking";

export interface ItemMask {
  /** The literal that was masked, or null when the pattern named none. */
  literal: string | null;
  strategy: MaskStrategy;
  verified: boolean;
}

export interface QuestionItem {
  anchors: readonly string[];
  answerIndex: number;
  explanation?: string | null;
  fsrsVocabId?: number | null;
  id: string;
  itemType: ItemType;
  level: string;
  /** TASK-142: the masking record, or null for an item with nothing to mask
   * (a vocabulary item, a listening item whose script never leaves the
   * server). Null means NOT masked; it never means masked-and-fine. */
  mask?: ItemMask | null;
  options: readonly string[];
  passage?: string | null;
  prompt: string;
  script?: string | null;
  seedPart?: string | null;
  /** TASK-173.2: the Japanese line the paper prints for this 小問 - the
   * material the learner reads in place of the English `prompt`. Null for
   * every item a real paper does not ask, and for a sentence-material item
   * whose material already travels as `passage`. */
  stem?: string | null;
  stimuli?: readonly Stimulus[] | null;
  surface: ItemSurface;
}

export interface ResolvedAnchor {
  id: string;
  level: string | null;
  surfaces: readonly string[];
}

export type OptionSource =
  | { anchorId: string; kind: "answer" }
  | {
      anchorId: string;
      kind: "authored";
      relation: "stimulus";
      sourceId: string;
    }
  | {
      anchorId: string;
      kind: "corpus";
      relation: "same-form-class" | "same-pos" | "stimulus";
    }
  | {
      anchorId: string;
      kind: "derived";
      rule: "same-verb-form" | "wrong-form";
    };

export type OptionSatisfaction = "no" | "unknown" | "yes";

export interface ItemCorpusView {
  isOptionSourceValid: (item: QuestionItem, source: OptionSource) => boolean;
  maxPassageLength?: (item: QuestionItem) => number | null;
  resolveAnchor: (anchorId: string) => ResolvedAnchor | null;
  satisfies?: (item: QuestionItem, optionIndex: number) => OptionSatisfaction;
}

export type ItemRejectionReason =
  | "ambiguous"
  | "answer-provenance"
  | "anchor-level"
  | "anchor-missing"
  | "duplicate-option"
  | "fsrs-link"
  | "no-anchor"
  | "no-correct-answer"
  | "option-count"
  | "answer-index"
  | "passage-missing"
  | "passage-length"
  | "script-missing"
  | "stem-leak"
  | "stimuli-count"
  | "stimuli-kind"
  | "unlucky-distractor";

export type ItemValidationResult =
  | {
      assurance: "deterministic" | "structural-only";
      ok: true;
    }
  | {
      anchorIds: readonly string[];
      ok: false;
      optionIndexes: readonly number[];
      reason: ItemRejectionReason;
    };
