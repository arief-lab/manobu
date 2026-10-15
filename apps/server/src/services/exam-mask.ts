/**
 * TASK-142 / doc-21 §9.1: mask the target realization so a grammar item stops
 * being answerable by string-match.
 *
 * The defect this exists to remove, verbatim from an assembled paper:
 *
 *     Choose the pattern that completes: 朝ごはんを食べました。
 *       options: Verb stem + ました (answer) / ません / ませんでした / ましたが
 *
 * `hasStemLeak` passes it, because the answer STRING is not a substring of the
 * evidence. But ました is visible inside 食べました, so a learner matches the
 * visible form to the option without reading any Japanese. Single-correct-
 * answer is not answerability, and non-derivability is a different property
 * from non-appearance, which is why no validator finds this.
 *
 * The rule is the trailing literal of the pattern. `Verb stem + ました` names
 * the literal ました; `X + を` names を. Measured across the shipped grammar
 * points: 540 of 595 patterns carry a trailing literal, and for 361 of those
 * the literal actually occurs in at least one example. The other 179 either
 * spell the form differently (Noun + ではない against ではありません) or name
 * a morphological process rather than a surface (Verb-て), and 55 patterns
 * have no "+" at all. Those are recorded as unmaskable rather than faked.
 *
 * A mask is VERIFIED, not assumed. The literal must be a whole token under
 * `vaporetto_split`, and the masked sentence is re-tokenized to confirm the
 * literal is gone. A literal that is only a substring of a longer token
 * (です inside ですが) would otherwise be masked mid-word and produce a
 * corrupt sentence, and an unverified mask is worse than no mask at all.
 *
 * Listening items are NOT masked: their script is never sent to the client
 * (TASK-132 keeps `script` server-side), so there is no text to read off.
 */

/** The blank a masked stimulus shows. Full-width low line, the convention in
 * Japanese worksheets, and present in Japanese fonts - ASCII underscores
 * render thin and inconsistent next to kana. */
export const MASK_BLANK = "＿＿";

import type { ItemMask, MaskStrategy } from "@manobu/item-engine/types";

/** The masking record. The shape is the item's (`ItemMask`); this adds the
 * sentence, which is presentation and never persisted. */
export interface MaskResult extends ItemMask {
  readonly masked: string;
}

/** Splits Japanese into tokens, or null when the tokenizer is unavailable. A
 * null tokenizer degrades to unmaskable rather than masking blind. Async
 * because the only splitter available to a model-free path is the SQLite
 * extension, and the user database is a drizzle handle whose raw SQL is
 * promise-returning. */
export type TokenSplitter = (text: string) => Promise<readonly string[] | null>;

/** The surface a pattern names, taken from after the last "+". "Verb stem +
 * ました" yields ました; "Place に Noun が あります" yields あります; a pattern
 * with no "+" has no surface and is unmaskable by this rule. */
export const targetLiteralOf = (pattern: string): string | null => {
  const plus = pattern.lastIndexOf("+");
  if (plus === -1) {
    return null;
  }
  const literal = pattern.slice(plus + 1).trim();
  return literal.length > 0 ? literal : null;
};

/**
 * Mask the pattern's trailing literal in the sentence.
 *
 * `split` gates and verifies; it is called at most twice, and the second call
 * is what turns an assumption into a verified mask. Every failure path returns
 * `verified: false` with the reason, because an item that claims to be masked
 * without a check is the outcome this task exists to prevent.
 */
export const maskRealization = async ({
  blank = MASK_BLANK,
  pattern,
  sentence,
  split,
}: {
  blank?: string;
  pattern: string;
  sentence: string;
  split: TokenSplitter;
}): Promise<MaskResult> => {
  const unmaskable = (
    strategy: MaskStrategy,
    found: string | null
  ): MaskResult => ({
    literal: found,
    masked: sentence,
    strategy,
    verified: false,
  });

  const literal = targetLiteralOf(pattern);
  if (!literal) {
    return unmaskable("no-literal-in-pattern", null);
  }
  if (!sentence.includes(literal)) {
    return unmaskable("literal-absent-from-sentence", literal);
  }

  const before = await split(sentence);
  if (!before) {
    return unmaskable("literal-not-a-token", literal);
  }
  if (!before.includes(literal)) {
    // The literal occurs only inside a longer token, so replacing it would cut
    // a word in half. ですが is the case that motivates this.
    return unmaskable("literal-not-a-token", literal);
  }

  const masked = sentence.replaceAll(literal, blank);
  const after = await split(masked);
  if (!after || after.includes(literal)) {
    return unmaskable("unverified-after-masking", literal);
  }
  return { literal, masked, strategy: "trailing-literal", verified: true };
};

/**
 * TASK-173.5 / doc-26 §4: blank one WORD out of a real sentence, for the
 * 文脈規定 cloze.
 *
 * Same verified discipline as `maskRealization`, for a different target: there
 * the masked string is a grammar pattern's trailing literal, here it is a
 * vocabulary surface the sentence originally held. The learner reads the
 * sentence with `＿＿` and picks the word from four same-part-of-speech options,
 * so the answer must not be visible anywhere else in the line.
 *
 * The extra guard is the occurrence count. `replaceAll` blanks every SUBSTRING
 * occurrence of the word, and a word that also lives inside a longer token
 * (思う inside 思い込む, say) would be cut in half there, corrupting a second word
 * and leaking the answer as its remnant. So the number of whole-token
 * occurrences must equal the number of substring occurrences before masking;
 * when they differ, some occurrence is not a standalone token and the mask is
 * declined rather than applied.
 */
export const maskWord = async ({
  blank = MASK_BLANK,
  sentence,
  split,
  word,
}: {
  blank?: string;
  sentence: string;
  split: TokenSplitter;
  word: string;
}): Promise<MaskResult> => {
  const unmaskable = (
    strategy: MaskStrategy,
    found: string | null
  ): MaskResult => ({
    literal: found,
    masked: sentence,
    strategy,
    verified: false,
  });

  if (!sentence.includes(word)) {
    return unmaskable("literal-absent-from-sentence", word);
  }

  const before = await split(sentence);
  if (!before) {
    return unmaskable("literal-not-a-token", word);
  }
  const tokenOccurrences = before.filter((token) => token === word).length;
  if (tokenOccurrences === 0) {
    // The word occurs only inside a longer token, so masking would cut a word
    // in half.
    return unmaskable("literal-not-a-token", word);
  }
  // AC#4 leak pre-check, and the one thing `maskRealization` does not need:
  // substring occurrences counted the way `replaceAll` counts them must equal
  // the whole-token occurrences, or an occurrence lives inside another word.
  const substringOccurrences = sentence.split(word).length - 1;
  if (substringOccurrences !== tokenOccurrences) {
    return unmaskable("unverified-after-masking", word);
  }

  const masked = sentence.replaceAll(word, blank);
  const after = await split(masked);
  if (!after || after.includes(word)) {
    return unmaskable("unverified-after-masking", word);
  }
  return { literal: word, masked, strategy: "context-word", verified: true };
};

/**
 * TASK-173.6 / doc-26 §4: blank the WHOLE fragment region out of a real
 * sentence, for the 文の組み立て star-ordering item.
 *
 * The cloze masks one WORD; a star item asks the learner to reassemble FOUR
 * fragments into a sentence with one slot marked ★, so the region that must
 * disappear is the concatenation of all four fragments - one contiguous span
 * of the original. The learner should not be able to read any fragment off the
 * passage: the four cells stand in for the entire region, and the ★ sits over
 * the cell the answer fills.
 *
 * Same verified discipline as the other two maskers, for a third target. The
 * region is a whole run of tokens by construction (the source split the sentence
 * at token boundaries), so the gates here are different from `maskWord`'s:
 *
 *  1. reconstruction equality. `prefix + fragments.join("") + suffix` must
 *     reproduce the sentence byte-for-byte. The source already checks this, so
 *     it is a second net here, not the only one, and it is what makes the mask
 *     claim trustworthy independently of the source.
 *  2. single occurrence. The joined span must occur exactly once in the
 *     sentence. If the same run also lives inside the printed prefix or
 *     suffix, blanking the region would still leave that fragment visible
 *     elsewhere, so the mask is declined rather than leaking the answer.
 *
 * Every cell is one `MASK_BLANK` regardless of how long its fragment is, so the
 * blank width never tells the learner how many morae the missing piece had. The
 * re-tokenized masked sentence confirms the span is gone before the mask is
 * claimed, exactly as the others re-tokenize.
 */
export const maskFragmentSpan = async ({
  blank = MASK_BLANK,
  fragments,
  prefix,
  sentence,
  split,
  starSlot,
  suffix,
}: {
  blank?: string;
  fragments: readonly string[];
  prefix: string;
  sentence: string;
  split: TokenSplitter;
  starSlot: number;
  suffix: string;
}): Promise<MaskResult> => {
  const unmaskable = (
    strategy: MaskStrategy,
    found: string | null
  ): MaskResult => ({
    literal: found,
    masked: sentence,
    strategy,
    verified: false,
  });

  const span = fragments.join("");
  if (span.length === 0) {
    return unmaskable("literal-absent-from-sentence", null);
  }
  // Gate 1: the region is a real, exhaustive decomposition of the sentence.
  if (prefix + span + suffix !== sentence) {
    return unmaskable("literal-absent-from-sentence", span);
  }
  // Gate 2: the region occurs once, so blanking it cannot leave the same
  // fragment printed inside the surrounding context.
  if (sentence.split(span).length - 1 !== 1) {
    return unmaskable("unverified-after-masking", span);
  }

  const cells = fragments
    .map((_, index) => (index === starSlot ? `★${blank}` : blank))
    .join(" ");
  const masked = prefix + cells + suffix;
  const after = await split(masked);
  if (!after || after.includes(span)) {
    return unmaskable("unverified-after-masking", span);
  }
  return { literal: span, masked, strategy: "fragment-span", verified: true };
};
