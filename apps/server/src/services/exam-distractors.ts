import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  choiceOptions,
  classify,
  conjugate,
  FORM_IDS,
  type FormId,
  type VerbEntry,
  wrongRuleVariant,
} from "@manobu/japanese/conjugation";
import { resolveDataDir } from "../data-dir";

/*
 * Distractor family 3 - "same rule, wrong application" (TASK-145 AC#3,
 * doc-21 §9.1).
 *
 * The other two families are tag-shaped: same entry other sense, and same
 * part of speech. Both are filters over a pool, which is why §9.1 calls family
 * 3 the one a filter cannot produce - its members share a LEMMA and differ
 * only in application, so there is no tag to match on. 飲みません / 飲みました /
 * 飲みましょう share a stem, a POS and a reading, and the exam cannot tell
 * them apart with a tag filter. A learner can, once they know the rule.
 *
 * The important thing about this file is that it is NOT model work. The
 * conjugation table already computes family 3 exactly - `choiceOptions` in
 * `@manobu/japanese/conjugation` builds "the correct form, then the
 * wrong-rule variant, then other forms of the SAME verb", and
 * `wrongRuleVariant` is the error a learner actually makes (飲ません for a
 * godan, 食べって for an ichidan, はいて for はいって). So the family is
 * assembled from the table, deterministically, for free. What the model is
 * left with is the sentence the verb is dropped into, and THAT PATH IS UNBUILT:
 * nothing in this repo calls a model to produce exam content, so there is no
 * authoring service to read. TASK-145 AC#2 is the task that would add it.
 *
 * THE N5 CEILING, stated rather than hidden: the shipped deck is
 * `verbs-n5.json`, 111 verbs, because `packages/japanese/scripts/gen-verbs.ts`
 * reads `n5.json`. So family 3 is available at N5 and returns null above it,
 * and `familyThreeAvailable` reports that so a caller can degrade to a
 * same-tag pool instead of silently shipping a weaker item. Widening the deck
 * is a generator change, deliberately not smuggled in here.
 */

/** One row of `verbs-n5.json`, which stores short keys. */
interface DeckRow {
  m: string;
  r: string;
  w: string;
}

export interface FamilyThreeItem {
  /** The correct option, always present in `options`. */
  answer: string;
  /** The dictionary form, which the prompt shows and the answer does not. */
  dictionaryForm: string;
  /** The inflection the item asks for. */
  form: FormId;
  kanji: string;
  /** Four options: the answer plus three same-lemma or wrong-rule forms. */
  options: readonly string[];
  reading: string;
  /** The verb stem every same-lemma option shares, e.g. 飲 for 飲みます. */
  stem: string;
  /**
   * The wrong-rule variant when the table has one for this verb+form, e.g.
   * 飲ません for a godan ます item. Null when the form has no pedagogical
   * error worth offering (the table returns null for a godan potential,
   * because 飲られる is valid Japanese and offering it would be a lie).
   */
  wrongRule: string | null;
}

const FORM_QUESTION: Record<FormId, string> = {
  masen: "the ません form",
  nai: "the ない form",
  potential: "the れる form",
  ta: "the た form",
  tai: "the たい form",
  te: "the て form",
};

const deckPath = (): string => {
  const base =
    resolveDataDir() ??
    join(import.meta.dir, "../../../../packages/japanese/data");
  return join(base, "verbs-n5.json");
};

/**
 * The shipped verb deck, or [] when it is absent (a packaged bundle that did
 * not ship it, per TASK-43's resource layout). Returning [] rather than
 * throwing is deliberate: a missing deck means family 3 is unavailable, and
 * the caller already has a same-tag fallback, so failing the whole paper over
 * an optional improvement would be the wrong trade.
 */
export const verbDeck = (): readonly VerbEntry[] => {
  const path = deckPath();
  if (!existsSync(path)) {
    return [];
  }
  const rows = JSON.parse(readFileSync(path, "utf8")) as DeckRow[];
  const out: VerbEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // `classify` is the same classifier the lesson deck uses, so an entry that
    // survives here is one the table can actually inflect. 帰る is the
    // godan-regex trap and classify() rejects it, which is why the deck is
    // generated through this path rather than trusted raw.
    const verb = classify(row.r);
    if (verb === null || seen.has(verb.reading)) {
      continue;
    }
    seen.add(verb.reading);
    out.push(verb);
  }
  return out;
};

/** True when the deck can supply family 3 at all (N5 today, see the ceiling). */
export const familyThreeAvailable = (deck?: readonly VerbEntry[]): boolean =>
  (deck ?? verbDeck()).length > 0;

/**
 * Family 3 options for one verb and one target form.
 *
 * `deterministic: true` is not cosmetic here. `choiceOptions` shuffles with
 * `Math.random()` by default, which is right for a lesson card and wrong for
 * an exam: a paper that reorders its own options on every assembly cannot
 * replay. The presentation order is the paper's seeded shuffle to decide, and
 * this returns a stable set for it to permute.
 *
 * Null when the verb cannot be classified - never a guess.
 */
export const familyThreeOptions = ({
  verb,
  form,
}: {
  verb: VerbEntry;
  form: FormId;
}): readonly string[] => choiceOptions(verb, form, { deterministic: true });

/**
 * A whole family-3 item: the dictionary form as the cue, four options, and
 * the answer. The answer is the conjugated form and the prompt shows only the
 * dictionary form, so the answer string is not a substring of the evidence -
 * which is what `stem-leak` checks and what the desktop's Conjugate Lab
 * already established as the question shape.
 */
export const familyThreeItem = ({
  verb,
  form,
}: {
  verb: VerbEntry;
  form: FormId;
}): FamilyThreeItem => {
  const options = familyThreeOptions({ form, verb });
  const answer = conjugate(verb, form);
  const near = wrongRuleVariant(verb, form);
  return {
    answer,
    dictionaryForm: verb.reading,
    form,
    kanji: verb.kanji,
    options,
    reading: verb.reading,
    stem: verb.stem,
    // A wrong-rule variant that EQUALS the answer is not a distractor, it is
    // the answer wearing a hat, and shipping it would put a duplicate in the
    // options. This is not hypothetical: きます classifies as ichidan, so its
    // ichidan wrong-rule ません form is きません - which is also the correct
    // kuru ません form. `choiceOptions` already drops it (`near !== correct`);
    // this repeats the guard because the variant is reported as data here, and
    // a consumer that trusted a non-null `wrongRule` would put a duplicate in
    // the options. The engine's `null` means "no pedagogical error worth
    // offering", so `null` is also the honest answer for a collision.
    wrongRule: near === null || near === answer ? null : near,
  };
};

/** The prompt a family-3 item asks, naming the form and never the rule. */
export const familyThreePrompt = (item: FamilyThreeItem): string =>
  `Which one is ${FORM_QUESTION[item.form]} of ${item.dictionaryForm}?`;

/** Every (verb, form) pair the deck can build, for a distribution assertion. */
export const everyFamilyThreeItem = (
  deck?: readonly VerbEntry[]
): readonly FamilyThreeItem[] => {
  const verbs = deck ?? verbDeck();
  const out: FamilyThreeItem[] = [];
  for (const verb of verbs) {
    for (const form of FORM_IDS) {
      out.push(familyThreeItem({ form, verb }));
    }
  }
  return out;
};
