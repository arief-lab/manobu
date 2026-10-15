import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { UserDatabase } from "@manobu/db/item-store";
import type {
  CorpusGrammarEntry,
  ExamCorpus,
} from "../src/services/exam-corpus";
import { MASK_BLANK, type TokenSplitter } from "../src/services/exam-mask";
import { manualContentDb, removeSqliteDbFiles } from "./harness";

/*
 * TASK-173.6: the 文の組み立て (sentence-assembly) star-ordering item.
 *
 * A real 文の文法2 小問 prints a sentence with the whole four-fragment region
 * blanked, marks ONE of the four cells with ★, and offers the four fragments
 * scrambled; the learner reassembles the sentence and answers which fragment
 * lands at ★. The format was pinned from the JLPT guidebook (pp.43-44): a
 * sentence-ending 。 may never sit inside the blank (rule ②).
 *
 * `context-cloze` (TASK-173.5) is the precedent, but the shape is different in
 * one way that matters for the tests: a cloze blanks a single WORD and the
 * options are that family's siblings, while a star blanks a whole SPAN and the
 * options ARE the fragments. So this file pins the new `star-ordering` type end
 * to end against the real seams (never a reimplementation that could drift):
 *
 *   - the split (`starSourceFor`), which cuts a grammar example into four
 *     contiguous, distinct, reconstructing fragments and spends the example,
 *   - the presentation branch (`candidatePresentationFor`), which masks the whole
 *     region through `maskFragmentSpan` and marks exactly one ★ cell,
 *   - the DB round-trip, which guards the two mask invariants in item-store.ts
 *     (`maskRecord` whitelists `fragment-span`, `MASK_STRATEGIES` decodes it),
 *   - the validator as the belt: a duplicate option is refused, and AC#4's write-
 *     time refusal rejects a star item a SECOND offered fragment can also fill
 *     with an attested, legal reassembly, while the guidebook 。 rule stops a
 *     sentence-ending fragment from counting as that second answer,
 *   - the measurement walk, which is the Slice-4 enablement gate: how many clean
 *     star sources each level's grammar pool actually yields.
 */

const { DB_PATH, DB_URL } = manualContentDb("star");

const { createItemStore } = await import("@manobu/db/item-store");
const { grammarAnchorFor } = await import("../src/services/exam-corpus");
const { examCorpus } = await import("../src/services/exam-corpus");
const { __test__ } = await import("../src/services/exam-service");
const { maskFragmentSpan } = await import("../src/services/exam-mask");
const { validateQuestionItem } = await import("@manobu/item-engine/validation");
const { examTokenSplitter, __test__: tokenizerTest } = await import(
  "../src/services/content-tokenizer"
);

/** A segmenter with fixed boundaries, so the split and the mask are tested
 * against a known tokenization rather than trusting the extension. */
const splitterOf = (
  calls: readonly (readonly string[] | null)[]
): TokenSplitter => {
  let index = 0;
  return () => {
    const preset = calls[index];
    index += 1;
    return Promise.resolve(preset ?? null);
  };
};

const grammar = (id: string, japanese: string): CorpusGrammarEntry => ({
  examples: [{ english: "test sentence", japanese }],
  id,
  level: "N5",
  meaning_en: "test pattern",
  pattern: "X + テスト",
});

/** The real catalog type the picker expects, read off its own signature rather
 * than reimplemented here (it is a private interface in the service). */
type StarCatalog = Parameters<typeof __test__.starSourceFor>[0]["catalog"];

/** The awaited, non-null source `starSource` yields. `starSource` is async, so
 * its `ReturnType` is a Promise and needs unwrapping before `NonNullable`. */
type StarSource = NonNullable<Awaited<ReturnType<typeof starSource>>>;

const newCatalog = (): StarCatalog =>
  ({ usedGrammarIds: new Set<string>() }) as never;

/** A `PaperRequest` with only the field the split actually reads: `seed`, which
 * seeds the digest that picks the cut points and the ★ slot. Never `examId`. */
const requestFor = (seed: string) =>
  ({ focus: [], level: "N5", mode: "real", sections: [], seed }) as never;

/** One sentence whose first 、 leaves six middle tokens: enough to divide four
 * ways, so the split is exercised against a fixed tokenization. */
const SENTENCE = "きのう、友達と公園で遊びました。";
const SENTENCE_TOKENS = [
  "きのう",
  "、",
  "友達",
  "と",
  "公園",
  "で",
  "遊び",
  "ました",
  "。",
];

const starSource = (
  pool: readonly CorpusGrammarEntry[],
  index: number,
  seed = "seed",
  split = splitterOf([SENTENCE_TOKENS])
) =>
  __test__.starSourceFor({
    catalog: newCatalog(),
    grammarPool: pool,
    index,
    itemType: "star-ordering",
    offset: 0,
    request: requestFor(seed),
    section: "grammar-reading" as never,
    split,
  });

let db: UserDatabase;
let store: ReturnType<typeof createItemStore>;

beforeAll(async () => {
  const { createUserDb } = await import("@manobu/db");
  db = await createUserDb(DB_URL);
  store = createItemStore(db);
});

afterAll(() => {
  removeSqliteDbFiles(DB_PATH);
});

describe("starSourceFor", () => {
  it("cuts an example into four distinct fragments that rebuild it", async () => {
    const source = await starSource([grammar("g-star", SENTENCE)], 0);
    expect(source).not.toBeNull();
    const found = source as NonNullable<typeof source>;

    // AC#2: the four fragments are a lossless, contiguous decomposition.
    const fragments = found.fragments ?? [];
    const distractors = [...found.distractors];
    expect(fragments).toHaveLength(4);
    expect(new Set(fragments).size).toBe(4);
    expect(found.starSlot).toBeGreaterThanOrEqual(0);
    expect(found.starSlot).toBeLessThan(4);
    expect(fragments[found.starSlot ?? 0]).toBe(found.target);
    expect(
      fragments.filter((_, position) => position !== (found.starSlot ?? 0))
    ).toEqual(distractors);

    // The context and region are the sentence itself: prefix + fragments + 。.
    expect(found.stimulus?.japanese).toBe(SENTENCE);
    expect(SENTENCE).toContain(found.fragments?.join("") ?? "﻿");
    // The trailing 。 is the printed suffix, never a fragment (rule ②), so no
    // fragment carries a sentence-ending glyph into the blank.
    for (const fragment of found.fragments ?? []) {
      expect(fragment).not.toContain("。");
    }

    // A star item never fabricates and never trips the real-mode fallback, so
    // it stays out of the sourcing ledger, asks in no cue, and anchors to the
    // grammar example, not a vocabulary entry.
    expect(found.pattern).toBeNull();
    expect(found.cue).toBe("");
    expect(found.sourcingCase).toBeUndefined();
    expect(found.anchorId).toBe(grammarAnchorFor(grammar("g-star", SENTENCE)));
  });

  it("is deterministic in the seed, and only the seed drives the cut", async () => {
    const pool = [grammar("g-star", SENTENCE)];
    const a = await starSource(pool, 0, "one");
    const b = await starSource(pool, 0, "one");
    const c = await starSource(pool, 0, "two");
    const first = a as NonNullable<typeof a>;
    const again = b as NonNullable<typeof b>;
    const other = c as NonNullable<typeof c>;
    // Same seed, same request, same item, so a resumed exam rebuilds it exactly.
    expect(again.target).toBe(first.target);
    expect(again.starSlot).toBe(first.starSlot);
    expect(again.fragments).toEqual(first.fragments);
    // A different seed still yields a clean, reconstructing split: the digest
    // reads only `request.seed` (never an examId), so the cut varies with the
    // seed but always rebuilds the same sentence.
    expect(other.fragments).toHaveLength(4);
    const fragments = other.fragments as string[];
    expect(SENTENCE).toContain(fragments.join(""));
    expect(fragments[other.starSlot as number]).toBe(other.target);
  });

  it("declines when no tokenizer is available, rather than split blind", async () => {
    const source = await starSource(
      [grammar("g-star", SENTENCE)],
      0,
      "seed",
      splitterOf([null])
    );
    expect(source).toBeNull();
  });

  it("declines a middle that will not divide four ways", async () => {
    // Two middle tokens cannot fill four fragments of at least one token each.
    const source = await starSource(
      [grammar("g-short", "猫がいる。")],
      0,
      "seed",
      splitterOf([["猫", "が", "いる", "。"]])
    );
    expect(source).toBeNull();
  });

  it("declines a sentence with a period stranded inside the region", async () => {
    // A 。 that is not the final token would have to sit inside a blank cell,
    // which the format forbids, so the whole example is declined.
    const source = await starSource(
      [grammar("g-mid", "そう。そう。")],
      0,
      "seed",
      splitterOf([["そう", "。", "そう", "。"]])
    );
    expect(source).toBeNull();
  });

  it("declines when the fragments would not reconstruct the sentence", async () => {
    // The tokens do not join back to the sentence (a tokenizer that dropped a
    // character), so the reconstruction gate withholds the candidate.
    const source = await starSource(
      [grammar("g-lossy", "ABCDE。")],
      0,
      "seed",
      splitterOf([["A", "B", "C", "D", "E", "X"]])
    );
    expect(source).toBeNull();
  });

  it("spends the grammar example only on success", async () => {
    const catalog = newCatalog();
    const pool = [grammar("g-spend", SENTENCE)];
    const split = splitterOf([SENTENCE_TOKENS, SENTENCE_TOKENS]);
    const first = await __test__.starSourceFor({
      catalog,
      grammarPool: pool,
      index: 0,
      itemType: "star-ordering",
      offset: 0,
      request: requestFor("seed"),
      section: "grammar-reading" as never,
      split,
    });
    expect(first).not.toBeNull();
    expect(catalog.usedGrammarIds.has("g-spend")).toBe(true);
    // A second call over the same spent example yields nothing: one sentence
    // never backs two items.
    const second = await __test__.starSourceFor({
      catalog,
      grammarPool: pool,
      index: 0,
      itemType: "star-ordering",
      offset: 0,
      request: requestFor("seed"),
      section: "grammar-reading" as never,
      split,
    });
    expect(second).toBeNull();
  });
});

describe("the presentation branch masks the whole region and marks ★", () => {
  it("blanks every fragment cell, shows one ★, and keeps the sentence gone", async () => {
    const source = await starSource([grammar("g-star", SENTENCE)], 0);
    const found = source as NonNullable<typeof source>;
    // The masker re-tokenizes the MASKED line once; it must not still contain
    // the joined span, so return a token list that clearly dropped it.
    const maskedTokens = ["きのう", "、", "＿＿", "＿ ★＿＿", "＿ ＿ ＿", "。"];
    const result = await __test__.candidatePresentationFor({
      itemType: "star-ordering",
      // Gated on the item type, not the section, so pass a section that would
      // otherwise take the grammar-reading mask branch and prove it does not.
      section: "grammar-reading" as never,
      source: found,
      split: splitterOf([maskedTokens]),
    });
    expect(result.mask?.strategy).toBe("fragment-span");
    expect(result.mask?.verified).toBe(true);
    const passage = result.passage as string;
    // AC#1: four equal-width cells, exactly one carrying ★.
    expect(passage.split(MASK_BLANK).length - 1).toBe(4);
    expect(passage.split("★").length - 1).toBe(1);
    // The whole region is gone, so no fragment is readable off the line.
    for (const fragment of found.fragments ?? []) {
      expect(passage).not.toContain(fragment);
    }
    // The printed context survived: it is still a sentence, not a deletion.
    expect(passage).toContain("きのう");
  });

  it("does not mask for a non-star item that shares the sentence", async () => {
    // The branch is itemType-gated: a `word-in-context` over the same stimulus
    // takes neither the cloze nor the star mask, so `mask` stays null.
    const glossSource = {
      ...((await starSource([grammar("g-star", SENTENCE)], 0)) as StarSource),
    };
    const result = await __test__.candidatePresentationFor({
      itemType: "word-in-context",
      section: "vocabulary" as never,
      source: glossSource,
      split: splitterOf([SENTENCE_TOKENS]),
    });
    expect(result.mask).toBeNull();
  });
});

describe("the DB round-trip accepts a verified fragment-span mask", () => {
  // Guards the two runtime-only invariants in item-store.ts: `maskRecord` on
  // write and `MASK_STRATEGIES` on read. Neither is compile-checked, and a
  // correctly-masked star item that trips either throws.
  it("stores and re-reads the mask unchanged", async () => {
    const source = await starSource([grammar("g-star", SENTENCE)], 0);
    const found = source as NonNullable<typeof source>;
    const fragments = found.fragments as string[];
    const context = SENTENCE.indexOf(fragments.join(""));
    const mask = await maskFragmentSpan({
      fragments,
      prefix: SENTENCE.slice(0, context),
      sentence: SENTENCE,
      split: splitterOf([["きのう", "、", "＿", "★＿", "＿", "＿", "。"]]),
      starSlot: found.starSlot ?? 0,
      suffix: SENTENCE.slice(context + fragments.join("").length),
    });
    expect(mask.verified).toBe(true);

    const anchor = grammarAnchorFor(grammar("g-star", SENTENCE));
    // `distractors` already omits the ★ fragment, so [target, ...distractors] is
    // the four distinct fragments with the answer at index 0.
    const item = {
      anchors: [anchor],
      answerIndex: 0,
      id: "star-roundtrip",
      itemType: "star-ordering" as const,
      level: "N5",
      mask,
      options: [found.target, ...found.distractors],
      passage: mask.masked,
      prompt:
        "Put the fragments in order to build the sentence. Choose the one that fits ★.",
      surface: "exam" as const,
    };

    await store.storeItem(item);
    const read = await store.resolveItem(item.id);
    expect(read).not.toBeNull();
    const resolved = read as NonNullable<typeof read>;
    expect(resolved.mask).toEqual({
      literal: mask.literal,
      strategy: "fragment-span",
      verified: true,
    });
    expect(resolved.passage).toBe(mask.masked);
  });

  it("refuses to persist a verified mask for a strategy that did not re-verify", async () => {
    const item = {
      anchors: [grammarAnchorFor(grammar("g-star", SENTENCE))],
      answerIndex: 0,
      id: "star-bad-verify",
      itemType: "star-ordering" as const,
      level: "N5",
      mask: {
        literal: "友達と公園で遊びました",
        strategy: "literal-not-a-token" as const,
        verified: true,
      },
      options: ["友達", "と", "公園", "遊びました"],
      passage: "友達と公園で遊びました",
      prompt:
        "Put the fragments in order to build the sentence. Choose the one that fits ★.",
      surface: "exam" as const,
    };
    await expect(store.storeItem(item)).rejects.toThrow(
      "an item mask cannot be verified unless the literal was masked"
    );
  });
});

describe("the validator is the belt, not the picker", () => {
  // A synthetic corpus is the honest fixture here: AC#4 asks whether a SECOND
  // offered fragment can fill ★ with an ATTESTED reassembly, and the only way to
  // pin both the refusal and its absence deterministically is to control which
  // sentences the corpus attests. The real-corpus walk (below) is what proves the
  // picker's genuine sources are accepted.
  const corpusOf = (sentences: readonly string[]): ExamCorpus => ({
    grammarByAnchor: new Map(),
    grammarByLevel: new Map([
      [
        "N5",
        sentences.map((japanese, index) => ({
          examples: [{ english: "", japanese }],
          id: `attest-${index}`,
          level: "N5",
          meaning_en: "",
          pattern: "",
        })),
      ],
    ]),
    vocabByAnchor: new Map(),
    vocabByLevel: new Map(),
  });

  const anchor = "grammar:g-star";
  const view = (
    targetByItemId: Map<string, string>,
    corpus: ExamCorpus,
    fragmentRecords: Map<
      string,
      { fragments: string[]; sentence: string; starSlot: number }
    >
  ) => ({
    ...__test__.candidateCatalogCorpus(
      targetByItemId,
      new Map([[anchor, "N5"]]),
      corpus,
      fragmentRecords as never
    ),
    // The synthetic corpus carries no resolvable anchors; overriding these two
    // keeps the ONLY gate on the star satisfaction rule, exactly as the cloze
    // belt overrides `isOptionSourceValid`.
    isOptionSourceValid: () => true,
    resolveAnchor: (id: string) => ({
      id,
      level: "N5",
      surfaces: ["exam"] as const,
    }),
  });

  const sources = (options: readonly string[], answerIndex: number) =>
    options.map((_, index) =>
      index === answerIndex
        ? { anchorId: anchor, kind: "answer" as const }
        : {
            anchorId: anchor,
            kind: "corpus" as const,
            relation: "stimulus" as const,
          }
    );

  const starItem = (
    id: string,
    options: readonly string[],
    answerIndex: number,
    passage: string
  ) => ({
    anchors: [anchor],
    answerIndex,
    id,
    itemType: "star-ordering" as const,
    level: "N5",
    options,
    passage,
    prompt:
      "Put the fragments in order to build the sentence. Choose the one that fits ★.",
    surface: "exam" as const,
  });

  it("rejects a duplicated option", () => {
    const item = starItem("dup", ["赤", "が", "が", "た"], 0, "★＿ ＿ ＿ ＿");
    const result = validateQuestionItem(
      item as never,
      sources(item.options, 0),
      view(
        new Map([["dup", "赤"]]),
        corpusOf(["赤ががた"]),
        new Map([
          [
            "dup",
            {
              fragments: ["赤", "が", "が", "た"],
              sentence: "赤ががた",
              starSlot: 0,
            },
          ],
        ])
      ) as never
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("duplicate-option");
    }
  });

  it("AC#4: rejects a star item a second offered fragment can also fill", () => {
    // fragments rebuild 赤が走った; the corpus ALSO attests が赤走った, which is
    // the same four fragments reordered so が lands at the ★ slot (index 0). So
    // が is a second correct answer and `evaluateSatisfaction` refuses the item.
    const item = starItem("amb", ["赤", "が", "走っ", "た"], 0, "★＿ ＿ ＿ ＿");
    const result = validateQuestionItem(
      item as never,
      sources(item.options, 0),
      view(
        new Map([["amb", "赤"]]),
        corpusOf(["赤が走った", "が赤走った"]),
        new Map([
          [
            "amb",
            {
              fragments: ["赤", "が", "走っ", "た"],
              sentence: "赤が走った",
              starSlot: 0,
            },
          ],
        ])
      ) as never
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ambiguous");
    }
  });

  it("accepts a star item whose only valid fill is the answer", () => {
    // Same fragments, but the corpus attests ONLY the original ordering, so no
    // distractor can fill ★ with an attested reassembly: the answer is unique.
    const item = starItem("ok", ["赤", "が", "走っ", "た"], 0, "★＿ ＿ ＿ ＿");
    const result = validateQuestionItem(
      item as never,
      sources(item.options, 0),
      view(
        new Map([["ok", "赤"]]),
        corpusOf(["赤が走った"]),
        new Map([
          [
            "ok",
            {
              fragments: ["赤", "が", "走っ", "た"],
              sentence: "赤が走った",
              starSlot: 0,
            },
          ],
        ])
      ) as never
    );
    expect(result.ok).toBe(true);
  });

  it("guidebook rule ②: a sentence-ending fragment is never a second answer", () => {
    // The corpus attests た。赤が走っ, which would place the period-carrying
    // fragment at ★ (index 0), but that reassembly parks 。 in a non-final slot,
    // so it is ILLEGAL and must not count. The item is therefore accepted: the
    // rule is what stops a false `ambiguous` refusal that would shrink the fill.
    const item = starItem(
      "period",
      ["赤", "が", "走っ", "た。"],
      0,
      "★＿ ＿ ＿ ＿"
    );
    const result = validateQuestionItem(
      item as never,
      sources(item.options, 0),
      view(
        new Map([["period", "赤"]]),
        // The original is 赤が走った。; the tempting-but-illegal alt is present.
        corpusOf(["赤が走った。", "た。赤が走っ"]),
        new Map([
          [
            "period",
            {
              fragments: ["赤", "が", "走っ", "た。"],
              sentence: "赤が走った。",
              starSlot: 0,
            },
          ],
        ])
      ) as never
    );
    expect(result.ok).toBe(true);
  });
});

describe("the star split is accepted on a real picker source", () => {
  // The synthetic fixtures prove the refusal works; this proves it does not fire
  // spuriously on a genuine source: a real N5 grammar example, split, masked, and
  // validated through the shipped corpus's own `satisfies`.
  const split = (() => {
    tokenizerTest.resetContentTokenizer();
    return examTokenSplitter();
  })();

  /** Walk a bounded window of the pool; take the first source whose mask
   * re-verifies, because the join is seeded but not every example survives the
   * four-way split. */
  const firstVerifiedStar = async (
    base: Omit<Parameters<typeof __test__.starSourceFor>[0], "index">
  ) => {
    for (let index = 0; index < 40; index += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the grammar spend is shared mutable catalog state and the search stops at the first reconstructed source, so the attempts must land in order rather than race.
      const source = await __test__.starSourceFor({ ...base, index });
      if (!source) {
        break;
      }
      const presentation = await __test__.candidatePresentationFor({
        itemType: "star-ordering",
        section: base.section,
        source,
        split: base.split,
      });
      if (presentation.mask?.verified && presentation.passage) {
        return {
          anchorId: source.anchorId,
          passage: presentation.passage,
          source,
        };
      }
    }
    return null;
  };

  it("builds a validated item from the live grammar pool", async () => {
    const tokens = await split(SENTENCE);
    expect(
      tokens,
      "vaporetto_split is not live in the test path"
    ).not.toBeNull();

    const corpus = examCorpus();
    const pool = corpus?.grammarByLevel.get("N5") ?? [];
    expect(pool.length).toBeGreaterThan(0);

    const catalog = newCatalog();
    const found = await firstVerifiedStar({
      catalog,
      grammarPool: pool,
      itemType: "star-ordering",
      offset: 0,
      request: requestFor("belt"),
      section: "grammar-reading" as never,
      split,
    });
    expect(
      found,
      "no N5 grammar example yielded a verified star split"
    ).not.toBeNull();
    const { anchorId, passage, source } = found as NonNullable<typeof found>;
    const item = starItemFor(anchorId, source, passage);
    const targetByItemId = new Map([[item.id, source.target]]);
    const fragmentRecords = new Map([
      [
        item.id,
        {
          fragments: source.fragments as string[],
          sentence: source.stimulus?.japanese as string,
          starSlot: source.starSlot ?? 0,
        },
      ],
    ]);
    const result = validateQuestionItem(
      item as never,
      item.options.map((_, index) =>
        index === item.answerIndex
          ? { anchorId, kind: "answer" as const }
          : { anchorId, kind: "corpus" as const, relation: "stimulus" as const }
      ),
      __test__.candidateCatalogCorpus(
        targetByItemId,
        new Map([[anchorId, "N5"]]),
        corpus,
        fragmentRecords
      ) as never
    );
    expect(result.ok).toBe(true);
  });
});

/** A minimal well-formed item for a real source: the four fragments as options,
 * answer at index 0, the masked line as the passage. */
const starItemFor = (
  anchorId: string,
  source: StarSource,
  passage: string
) => ({
  anchors: [anchorId],
  answerIndex: 0,
  id: `real-${source.anchorId}`,
  itemType: "star-ordering" as const,
  level: "N5",
  options: [source.target, ...source.distractors],
  passage,
  prompt:
    "Put the fragments in order to build the sentence. Choose the one that fits ★.",
  surface: "exam" as const,
});

describe("文の組み立て counts its grammar-pool need in the paper demand", () => {
  /*
   * Every accepted star item spends one grammar anchor: `starSourceFor` walks the
   * shared grammar pool for the example sentence to cut (exam-service.ts
   * `catalog.usedGrammarIds.add`), exactly like the cloze. So `paperGrammarDemand`
   * must count the 文の組み立て slots or the block starves behind the grammar
   * section it shares the pool with - the TASK-148 hole, re-opened for a new
   * family. Pinned on the function's arithmetic (reserve 0) rather than one
   * assembled paper, because the shortage only bites a repeated paper.
   */
  const realN5 = (budget: number) =>
    ({
      budget: { "grammar-reading": budget },
      focus: [],
      level: "N5",
      mode: "real",
      sections: ["grammar-reading"],
      seed: "demand",
    }) as const;

  it("adds the 文の組み立て slots the block walk reaches", () => {
    // N5 grammar-reading 大問 order: bun-no-bunpou-1 (16, grammar family) then
    // bun-no-bunpou-2 (5, star family). Real mode walks 大問 by 大問, so a budget
    // of 16 fills only 大問1 (all grammar family) and 18 spills 2 into the star
    // block. The DIFFERENCE isolates the star contribution from the grammar
    // family it shares the pool with; dropping `|| family === "star"` from the
    // demand gate takes those 2 back out, and this catches it.
    const base = __test__.paperGrammarDemand(realN5(16), 0);
    const withStar = __test__.paperGrammarDemand(realN5(18), 0);
    expect(withStar - base).toBe(2);
  });

  it("counts each star slot only past 大問1's own allocation", () => {
    // The non-vacuity control the main assertion leans on: crossing from 大問1
    // into 大問2 adds demand one slot at a time, all of it the star family,
    // because 大問1 is capped at its 16 official 小問. So 16->17 is exactly one
    // star slot and 16->18 is two; removing `|| family === "star"` collapses
    // both to zero, which is what the mutation gate checks.
    expect(
      __test__.paperGrammarDemand(realN5(17), 0) -
        __test__.paperGrammarDemand(realN5(16), 0)
    ).toBe(1);
  });
});

describe("the measurement walk sizes the enablement floor (Slice 4 gate)", () => {
  // The 文の組み立て block is 5 小問 at every level, so a level can only carry
  // the block if its grammar pool yields at least 5 clean, non-repeating star
  // sources. N5 is the expected binding constraint (fewest grammar points). This
  // test PRINTS the per-level fill so the number is recorded, and asserts the
  // floor only where the plan intends to enable.
  const split = (() => {
    tokenizerTest.resetContentTokenizer();
    return examTokenSplitter();
  })();
  const LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
  const FLOOR = 5;

  it("every level reaches the 5-source floor", async () => {
    const corpus = examCorpus();
    expect(corpus).not.toBeNull();
    const fill: Record<string, number> = {};
    for (const level of LEVELS) {
      // biome-ignore lint/performance/noAwaitInLoops: the catalog's grammar spend is shared mutable state within a level, so the walk must be sequential; the levels themselves are cheap bookkeeping.
      fill[level] = await measureStarFill(corpus, level, split);
    }
    // Report the measurement to the run log so it is reviewable.
    console.info(`star-fill per level: ${JSON.stringify(fill)}`);
    for (const level of LEVELS) {
      expect(
        fill[level],
        `${level} yields ${fill[level]} clean star sources, below the ${FLOOR}-slot block floor`
      ).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

const measureStarFill = async (
  corpus: ExamCorpus | null,
  level: string,
  split: TokenSplitter
): Promise<number> => {
  const pool = corpus?.grammarByLevel.get(level) ?? [];
  const catalog = newCatalog();
  let count = 0;
  for (let index = 0; index < pool.length + 1; index += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: shared catalog grammar spend.
    const source = await __test__.starSourceFor({
      catalog,
      grammarPool: pool,
      index,
      itemType: "star-ordering",
      offset: 0,
      request: requestFor(`measure:${level}`),
      section: "grammar-reading" as never,
      split,
    });
    if (!source) {
      break;
    }
    const presentation = await __test__.candidatePresentationFor({
      itemType: "star-ordering",
      section: "grammar-reading" as never,
      source,
      split,
    });
    if (presentation.mask?.verified && presentation.passage) {
      count += 1;
    }
  }
  return count;
};
