import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { UserDatabase } from "@manobu/db/item-store";
import type {
  CorpusGrammarEntry,
  CorpusVocabEntry,
} from "../src/services/exam-corpus";
import {
  MASK_BLANK,
  maskWord,
  type TokenSplitter,
} from "../src/services/exam-mask";
import { manualContentDb, removeSqliteDbFiles } from "./harness";

/*
 * TASK-173.5: the 文脈規定 (context-determinacy) cloze.
 *
 * A real 大問3 item prints a Japanese sentence with one word blanked (＿＿) and
 * four same-part-of-speech options; the learner picks the word the sentence
 * originally held. The engine had no such shape - `word-in-context` answers with
 * an English gloss, which doc-26 §4 says is explicitly NOT this block - so this
 * file pins the new `context-cloze` type end to end:
 *
 *   - the masker (`maskWord`), by its verified discipline and its occurrence
 *     count, which is the leak pre-check `maskRealization` does not need,
 *   - the join (`clozeSourceFor`), which pairs a grammar example sentence with a
 *     blankable same-level vocab word and refuses a slot it cannot fill,
 *   - the presentation branch (`candidatePresentationFor`), gated on ITEM TYPE
 *     because 文脈規定 lives in the VOCABULARY section at N3-N5,
 *   - the DB round-trip, which guards the two mask invariants in item-store.ts
 *     (`maskRecord` on write, `MASK_STRATEGIES` on read),
 *   - the validator as the belt: an unmasked passage or a duplicate option is
 *     refused, and a cross-lemma near-synonym is ACCEPTED, which documents the
 *     honest residual limitation of the accept-and-document decision (the answer
 *     oracle is byte-equality, so it cannot see that 始まる also fits where
 *     始める was blanked).
 *
 * Slice 4 enabled the block (`PAPER_BLOCK_SHAPES["bunmi-kitei"]` now carries
 * `context-cloze`), so a `real` paper asks cloze items. The seams here are still
 * driven directly rather than through a reimplementation that could drift,
 * because the mask, join and pool-demand rules are what must not regress, not
 * whether one particular paper happens to fill.
 */

const { DB_PATH, DB_URL } = manualContentDb("cloze");

const { createItemStore } = await import("@manobu/db/item-store");
const { examCorpus, vocabAnchorFor } = await import(
  "../src/services/exam-corpus"
);
const { __test__ } = await import("../src/services/exam-service");
const { validateQuestionItem } = await import("@manobu/item-engine/validation");
const { examTokenSplitter, __test__: tokenizerTest } = await import(
  "../src/services/content-tokenizer"
);

/** A segmenter with fixed boundaries, so the masker and the join are tested
 * against a known tokenization rather than trusting the extension. The mask
 * logic never has to trust it - that is the point of the verification. */
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

/** One vocabulary entry, enough to satisfy the join's POS and same-entry rules. */
const vocab = (
  word: string,
  partOfSpeech: string,
  level = "N5"
): CorpusVocabEntry => ({
  level,
  meaning: `${word} (test)`,
  partOfSpeech,
  reading: word,
  word,
});

const grammar = (id: string, japanese: string): CorpusGrammarEntry => ({
  examples: [{ english: "test sentence", japanese }],
  id,
  level: "N5",
  meaning_en: "test pattern",
  pattern: "X + テスト",
});

const newCatalog = () =>
  ({
    usedGrammarIds: new Set<string>(),
    usedVocabWords: new Set<string>(),
  }) as never;

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

describe("maskWord", () => {
  it("blanks the word and verifies it is gone", async () => {
    const result = await maskWord({
      sentence: "私はりんごを食べます。",
      split: splitterOf([
        ["私", "は", "りんご", "を", "食べ", "ます", "。"],
        ["私", "は", MASK_BLANK, "を", "食べ", "ます", "。"],
      ]),
      word: "りんご",
    });
    expect(result.strategy).toBe("context-word");
    expect(result.verified).toBe(true);
    expect(result.literal).toBe("りんご");
    expect(result.masked).toBe(`私は${MASK_BLANK}を食べます。`);
    // The rest of the sentence survived, which is what makes it a question
    // rather than a deletion.
    expect(result.masked).toContain("食べます");
  });

  it("blanks every whole-token occurrence, so a later one cannot give it away", async () => {
    const result = await maskWord({
      sentence: "花が咲く。花が美しい。",
      split: splitterOf([
        ["花", "が", "咲く", "。", "花", "が", "美しい", "。"],
        [MASK_BLANK, "が", "咲く", "。", MASK_BLANK, "が", "美しい", "。"],
      ]),
      word: "花",
    });
    expect(result.verified).toBe(true);
    expect(result.masked).not.toContain("花");
    expect(result.masked.split(MASK_BLANK).length - 1).toBe(2);
  });

  it("refuses when the word only lives inside a longer token", async () => {
    // 行き occurs as a substring of the single fused token 行きます, never as a
    // token itself. Blanking it would cut that word in half, so the masker
    // declines rather than corrupt the sentence.
    const result = await maskWord({
      sentence: "行きます。",
      split: splitterOf([["行きます", "。"]]),
      word: "行き",
    });
    expect(result.strategy).toBe("literal-not-a-token");
    expect(result.verified).toBe(false);
    expect(result.masked).toBe("行きます。");
  });

  it("refuses when a substring occurrence would be cut out of a longer word", async () => {
    // 花 appears once as its own token and once inside the fused token 花見.
    // `replaceAll` would blank both, and blanking the 花 inside 花見 corrupts
    // that word. The occurrence-count guard declines rather than half-mask.
    const result = await maskWord({
      sentence: "花を見る。花見が好き。",
      split: splitterOf([
        ["花", "を", "見る", "。", "花見", "が", "好き", "。"],
      ]),
      word: "花",
    });
    expect(result.strategy).toBe("unverified-after-masking");
    expect(result.verified).toBe(false);
    expect(result.masked).toBe("花を見る。花見が好き。");
  });

  it("refuses to report a mask it could not re-verify", async () => {
    // MUTATION SEAM TARGET (Seam A). The second tokenization still contains the
    // word, so the blank did not take and the mask is not trustworthy. A mutant
    // that skips the re-verification would claim `verified: true` here.
    const result = await maskWord({
      sentence: "りんごを食べます。",
      split: splitterOf([
        ["りんご", "を", "食べ", "ます", "。"],
        ["りんご", MASK_BLANK, "を", "食べ", "ます", "。"],
      ]),
      word: "りんご",
    });
    expect(result.strategy).toBe("unverified-after-masking");
    expect(result.verified).toBe(false);
  });

  it("degrades to unmaskable when no tokenizer is available", async () => {
    const result = await maskWord({
      sentence: "りんごを食べます。",
      split: () => Promise.resolve(null),
      word: "りんご",
    });
    expect(result.verified).toBe(false);
    expect(result.strategy).toBe("literal-not-a-token");
    expect(result.masked).toBe("りんごを食べます。");
  });
});

describe("clozeSourceFor", () => {
  it("pairs a grammar example with a blankable vocab word and same-POS distractors", async () => {
    const vocabPool = [
      vocab("りんご", "noun"),
      vocab("本", "noun"),
      vocab("犬", "noun"),
      vocab("猫", "noun"),
    ];
    const grammarPool = [grammar("g-apple", "私はりんごを食べます。")];
    const source = await __test__.clozeSourceFor({
      catalog: newCatalog(),
      grammarPool,
      index: 0,
      offset: 0,
      split: splitterOf([["私", "は", "りんご", "を", "食べ", "ます", "。"]]),
      vocabPool,
    });
    expect(source).not.toBeNull();
    const found = source as NonNullable<typeof source>;
    expect(found.target).toBe("りんご");
    expect(found.anchorId).toBe(
      vocabAnchorFor(vocabPool[0] as CorpusVocabEntry)
    );
    expect(found.pattern).toBeNull();
    expect(found.stimulus?.japanese).toBe("私はりんごを食べます。");
    // Four options, target first, three distinct same-POS siblings.
    const options = [found.target, ...found.distractors];
    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
    expect(options).not.toContain("私");
    expect(found.sourcingCase).toBeUndefined();
  });

  it("declines a word whose only extra occurrence is inside a longer token", async () => {
    // MUTATION SEAM TARGET (Seam B). 花 is one whole token but two substrings
    // (it also sits inside 花見), so the occurrence-count guard must withhold it.
    // A mutant that drops the equality check would spend 花 and ship a cloze
    // that cuts 花見 in half.
    const vocabPool = [
      vocab("花", "noun"),
      vocab("本", "noun"),
      vocab("犬", "noun"),
      vocab("猫", "noun"),
    ];
    const grammarPool = [grammar("g-flower", "花を見る。花見が好き。")];
    const source = await __test__.clozeSourceFor({
      catalog: newCatalog(),
      grammarPool,
      index: 0,
      offset: 0,
      split: splitterOf([
        ["花", "を", "見る", "。", "花見", "が", "好き", "。"],
      ]),
      vocabPool,
    });
    expect(source).toBeNull();
  });

  it("declines when no same-POS sibling pool can fill four options", async () => {
    // A level too thin for three siblings is an honest shortfall, not a
    // three-option item the blueprint's shape validator would reject anyway.
    const vocabPool = [vocab("りんご", "noun"), vocab("本", "adjective")];
    const grammarPool = [grammar("g-thin", "私はりんごを食べます。")];
    const source = await __test__.clozeSourceFor({
      catalog: newCatalog(),
      grammarPool,
      index: 0,
      offset: 0,
      split: splitterOf([["私", "は", "りんご", "を", "食べ", "ます", "。"]]),
      vocabPool,
    });
    expect(source).toBeNull();
  });

  it("declines rather than mask blind when the tokenizer is unavailable", async () => {
    // AC#4 honesty: no verified tokenization means no cloze, never a sentence
    // with the answer still visible.
    const vocabPool = [
      vocab("りんご", "noun"),
      vocab("本", "noun"),
      vocab("犬", "noun"),
      vocab("猫", "noun"),
    ];
    const grammarPool = [grammar("g-nosplit", "私はりんごを食べます。")];
    const source = await __test__.clozeSourceFor({
      catalog: newCatalog(),
      grammarPool,
      index: 0,
      offset: 0,
      split: () => Promise.resolve(null),
      vocabPool,
    });
    expect(source).toBeNull();
  });

  it("spends both the grammar example and the vocab word", async () => {
    const catalog = newCatalog();
    const spent = catalog as {
      usedGrammarIds: Set<string>;
      usedVocabWords: Set<string>;
    };
    const vocabPool = [
      vocab("りんご", "noun"),
      vocab("本", "noun"),
      vocab("犬", "noun"),
      vocab("猫", "noun"),
    ];
    const grammarPool = [grammar("g-spend", "私はりんごを食べます。")];
    const first = await __test__.clozeSourceFor({
      catalog,
      grammarPool,
      index: 0,
      offset: 0,
      split: splitterOf([["私", "は", "りんご", "を", "食べ", "ます", "。"]]),
      vocabPool,
    });
    expect(first).not.toBeNull();
    expect(spent.usedGrammarIds.has("g-spend")).toBe(true);
    expect(spent.usedVocabWords.has("りんご")).toBe(true);
    // A second call over the same single grammar point finds nothing new,
    // because one sentence never backs two cloze items.
    const second = await __test__.clozeSourceFor({
      catalog,
      grammarPool,
      index: 0,
      offset: 0,
      split: splitterOf([["私", "は", "りんご", "を", "食べ", "ます", "。"]]),
      vocabPool,
    });
    expect(second).toBeNull();
  });
});

describe("a real N5 cloze, joined and masked through the live tokenizer", () => {
  // The Slice 3.5 measurement reported vaporetto live in this path; assert it
  // rather than assume it, because a null splitter silently converts the fill
  // into zero cloze items.
  const split = (() => {
    tokenizerTest.resetContentTokenizer();
    return examTokenSplitter();
  })();

  const catalog = newCatalog();
  /** Walk a bounded window of the pool; take the first source whose mask
   * re-verifies, because the join is seeded but not every found word survives
   * re-tokenization. */
  const firstVerifiedCloze = async (
    base: Omit<Parameters<typeof __test__.clozeSourceFor>[0], "index">
  ) => {
    for (let index = 0; index < 25; index += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the catalog's word/grammar spend is shared mutable state and the search stops at the first verified mask, so the attempts must land in order rather than race.
      const source = await __test__.clozeSourceFor({ ...base, index });
      if (!source) {
        break;
      }
      const presentation = await __test__.candidatePresentationFor({
        itemType: "context-cloze",
        section: "vocabulary",
        source,
        split: base.split,
      });
      if (presentation.mask?.verified && presentation.passage) {
        return {
          mask: presentation.mask,
          passage: presentation.passage,
          source,
        };
      }
    }
    return null;
  };

  it("produces a verified blank from the real grammar/vocab pools", async () => {
    const tokens = await split("私はりんごを食べます。");
    expect(
      tokens,
      "vaporetto_split is not live in the test path"
    ).not.toBeNull();

    const corpus = examCorpus();
    expect(corpus).not.toBeNull();
    const vocabPool = corpus?.vocabByLevel.get("N5") ?? [];
    const grammarPool = corpus?.grammarByLevel.get("N5") ?? [];
    expect(vocabPool.length).toBeGreaterThan(0);
    expect(grammarPool.length).toBeGreaterThan(0);

    const found = await firstVerifiedCloze({
      catalog,
      grammarPool,
      offset: 0,
      split,
      vocabPool,
    });
    expect(
      found,
      "no N5 grammar example yielded a verified cloze"
    ).not.toBeNull();
    const { mask, passage, source } = found as NonNullable<typeof found>;

    // AC#1: the printed line carries the blank and keeps the rest of the
    // sentence, and the mask is the verified context-word strategy.
    expect(mask.strategy).toBe("context-word");
    expect(mask.verified).toBe(true);
    expect(passage).toContain(MASK_BLANK);
    expect(passage).not.toContain(source.target);

    // AC#2: four options, the answer is the word the sentence held, and it is a
    // whole token of that source example.
    const options = [source.target, ...source.distractors];
    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
    const exampleTokens = await split(source.stimulus?.japanese ?? "");
    expect(exampleTokens).toContain(source.target);
  });
});

describe("the DB round-trip accepts a verified context-word mask", () => {
  // Guards the two runtime-only invariants in item-store.ts: `maskRecord`
  // (:633) on write and `MASK_STRATEGIES` (:649) on read. Neither is
  // compile-checked, and a correctly-masked cloze that trips either throws.
  it("stores and re-reads the mask unchanged", async () => {
    const sentence = "私はりんごを食べます。";
    const split = splitterOf([
      ["私", "は", "りんご", "を", "食べ", "ます", "。"],
      ["私", "は", MASK_BLANK, "を", "食べ", "ます", "。"],
    ]);
    const mask = await maskWord({ sentence, split, word: "りんご" });
    expect(mask.verified).toBe(true);

    const anchor = "vocab:N5:りんご:りんご";
    const item = {
      anchors: [anchor],
      answerIndex: 0,
      id: "cloze-roundtrip",
      itemType: "context-cloze" as const,
      level: "N5",
      mask,
      options: ["りんご", "本", "犬", "猫"],
      passage: mask.masked,
      prompt: "Choose the word that best completes the sentence.",
      surface: "exam" as const,
    };

    await store.storeItem(item);
    const read = await store.resolveItem(item.id);
    expect(read).not.toBeNull();
    const resolved = read as NonNullable<typeof read>;
    expect(resolved.mask).toEqual({
      literal: "りんご",
      strategy: "context-word",
      verified: true,
    });
    expect(resolved.passage).toBe(`私は${MASK_BLANK}を食べます。`);
  });

  it("refuses to persist a verified mask for a strategy that did not re-verify", async () => {
    // The write-side invariant itself: a `literal-not-a-token` mask claims
    // nothing was verified, so `verified: true` must throw rather than store a
    // leaky claim.
    const item = {
      anchors: ["vocab:N5:りんご:りんご"],
      answerIndex: 0,
      id: "cloze-bad-verify",
      itemType: "context-cloze" as const,
      level: "N5",
      mask: {
        literal: "りんご",
        strategy: "literal-not-a-token" as const,
        verified: true,
      },
      options: ["りんご", "本", "犬", "猫"],
      passage: "りんご",
      prompt: "Choose the word that best completes the sentence.",
      surface: "exam" as const,
    };
    await expect(store.storeItem(item)).rejects.toThrow(
      "an item mask cannot be verified unless the literal was masked"
    );
  });
});

describe("the validator is the belt, not the picker", () => {
  const corpus = examCorpus();
  // A REAL anchor, because `candidateCatalogCorpus.resolveAnchor` only resolves
  // an anchor the shipped corpus carries at a level. A synthetic id would fail
  // the anchor check before the shape/content rule under test is reached.
  const beltEntry = (corpus?.vocabByLevel.get("N5") ?? [])[0] as
    | CorpusVocabEntry
    | undefined;
  const anchor = beltEntry ? vocabAnchorFor(beltEntry) : "";
  const beltLevel = beltEntry?.level ?? "N5";
  // The REAL validator view; a hand-rolled `satisfies` proves nothing about the
  // service. `isOptionSourceValid` is overridden true so the shape and content
  // checks below are the only gate, exactly as the gloss-ambiguity test does.
  const view = (targetByItemId: Map<string, string>) => ({
    ...__test__.candidateCatalogCorpus(
      targetByItemId,
      new Map([[anchor, beltLevel]]),
      corpus,
      // A cloze item has no star fragments, so its satisfaction never consults
      // this ledger; an empty map is the honest view for this suite.
      new Map()
    ),
    isOptionSourceValid: () => true,
  });

  const sources = (item: {
    anchors: readonly string[];
    options: readonly string[];
    answerIndex: number;
  }) =>
    item.options.map((_, index) =>
      index === item.answerIndex
        ? { anchorId: item.anchors[0] as string, kind: "answer" as const }
        : {
            anchorId: item.anchors[0] as string,
            kind: "corpus" as const,
            relation: "same-pos" as const,
          }
    );

  const baseItem = (overrides: Record<string, unknown>) => ({
    anchors: [anchor],
    answerIndex: 0,
    id: `belt-${Math.random().toString(16).slice(2)}`,
    itemType: "context-cloze" as const,
    level: beltLevel,
    options: ["りんご", "本", "犬", "猫"],
    passage: `私は${MASK_BLANK}を食べます。`,
    prompt: "Choose the word that best completes the sentence.",
    surface: "exam" as const,
    ...overrides,
  });

  it("rejects a duplicated option", () => {
    const item = baseItem({ options: ["りんご", "本", "本", "猫"] });
    const result = validateQuestionItem(
      item as never,
      sources(item),
      view(new Map([[item.id, "りんご"]])) as never
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("duplicate-option");
    }
  });

  it("rejects a cloze whose passage still shows the answer (unmasked)", () => {
    // The leak AC#4 exists for: if the mask branch ever ships the sentence with
    // the word in it, `hasStemLeak` (which reads prompt + passage for a type
    // outside STIMULUS_ANSWER_TYPES) refuses it, so it cannot reach a learner.
    const item = baseItem({ passage: "私はりんごを食べます。" });
    const result = validateQuestionItem(
      item as never,
      sources(item),
      view(new Map([[item.id, "りんご"]])) as never
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("stem-leak");
    }
  });

  it("accepts a well-formed cloze, including one with a cross-lemma near-synonym distractor", () => {
    // DOCUMENTED RESIDUAL LIMITATION (the accept-and-document decision). The
    // answer oracle is byte-equality, so it marks only the blanked word correct.
    // 始める (the answer) and 始まる (also fits this sentence in the real world)
    // are different strings, so the validator cannot see 始まる as a second
    // correct answer and SHIPS it. The picker withholds the target's own
    // synonyms, which is all an offline path can do; this test pins that a
    // structurally valid cloze validates rather than pretending the ambiguity
    // gate catches it.
    const item = baseItem({
      options: ["始める", "始まる", "本", "犬"],
      passage: `私が${MASK_BLANK}。`,
    });
    const result = validateQuestionItem(
      item as never,
      sources(item),
      view(new Map([[item.id, "始める"]])) as never
    );
    expect(result.ok).toBe(true);
  });
});

describe("文脈規定 counts its grammar-pool need in the paper demand", () => {
  /*
   * Every DERIVED cloze spends one grammar anchor: `clozeSourceFor` walks the
   * shared grammar pool for the example sentence to blank (exam-service.ts
   * `catalog.usedGrammarIds.add`). So `paperGrammarDemand`, which sizes that
   * pool for the whole paper, has to count the 文脈規定 slots or the cloze block
   * starves behind the grammar section it shares the pool with - the exact
   * TASK-148 hole, re-opened for a new family.
   *
   * TASK-173.9.29 moved that demand: at N3/N2/N1 文脈規定 is served whole-row
   * from the kitei store and spends NO grammar anchor, so the arithmetic pin
   * lives on N4, where the join still serves, and a sibling pin below proves
   * the store levels dropped out.
   *
   * Pinned on the function's arithmetic, not on an assembled paper, because a
   * single paper fills even with an undersized pool; the shortage only bites a
   * repeated paper once `seenAnchors` has spent the shared pool, which is not
   * something one build can show. The isolation below leans on N4's 大問 order.
   */
  const realN4 = (budget: number) =>
    ({
      budget: { vocabulary: budget },
      focus: [],
      level: "N4",
      mode: "real",
      sections: ["vocabulary"],
      seed: "demand",
    }) as const;

  const realN2 = (budget: number) =>
    ({
      budget: { "language-knowledge-reading": budget },
      focus: [],
      level: "N2",
      mode: "real",
      sections: ["language-knowledge-reading"],
      seed: "demand",
    }) as const;

  it("adds the 文脈規定 slots the block walk reaches", () => {
    // N4 大問 order: 漢字読み9, 表記6 = 15, then 文脈規定10. A budget of 17
    // therefore spends 15 on the first two 大問 and leaves 2 for 文脈規定.
    // 漢字読み is the `reading` family and 表記 the `hyouki` store family
    // (TASK-173.9.25), so neither draws on the grammar pool. The ONLY
    // grammar-pool demand here is those two cloze candidates: N4 keeps the
    // derived `clozeSourceFor` join (TASK-173.9.29 left N4/N5 on it).
    expect(__test__.paperGrammarDemand(realN4(17), 0)).toBe(2);
  });

  it("counts nothing from a 大問 that does not draw on the grammar pool", () => {
    // The control that makes the "2" above attributable to cloze alone: a budget
    // of 5 reaches only 漢字読み (reading family), which `paperGrammarDemand`
    // must not count. If it did, the widening would be over-claiming the pool.
    expect(__test__.paperGrammarDemand(realN4(5), 0)).toBe(0);
  });

  it("drops the 文脈規定 slots the kitei store serves (TASK-173.9.29)", () => {
    // The N2 budget that used to count 2 cloze candidates now counts none:
    // 文脈規定 at N3/N2/N1 is store-served and spends no grammar anchor.
    // Counting it would prepend anchors to a pool the walk never draws from
    // and shift the seed's grammar ordering away from the proven paper.
    expect(__test__.paperGrammarDemand(realN2(17), 0)).toBe(0);
  });
});
