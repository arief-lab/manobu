import { describe, expect, it } from "bun:test";

import {
  allocatePaperBlocks,
  allocatePaperItemTypes,
  allocatePaperMix,
  assemblePaper,
  defaultPaperBudgetFor,
  PAPER_BLOCKS,
  PAPER_BLUEPRINTS,
  PAPER_DEFAULT_BUDGETS,
  PAPER_ITEM_TYPE_WEIGHTS_V2,
  PAPER_LEVELS,
  PAPER_MODES,
  PAPER_REJECTION_REASON_ORDER,
  type PaperBlockId,
  type PaperCandidate,
  type PaperLevel,
  type PaperRejectionReason,
  type PaperRequest,
  type PaperSectionId,
  type PaperSlot,
  paperBlockInstruction,
  paperBlocksFor,
  paperBlocksForLandedItems,
  paperModeLabel,
  paperScoringFloorStatus,
  paperSectionForItemType,
  paperSectionIndicativeCount,
  paperSectionTimeLimitSeconds,
  paperUnfillableBlocks,
  parsePaperRequest,
  projectPaperForClient,
  shuffleQuestionItemOptions,
  validatePaper,
  validatePaperRequest,
} from "@manobu/item-engine/paper";
import { STIMULUS_REQUIREMENTS } from "@manobu/item-engine/stimuli";
import type {
  ItemCorpusView,
  ItemType,
  OptionSource,
  QuestionItem,
} from "@manobu/item-engine/types";
import { ITEM_TYPES } from "@manobu/item-engine/types";
import { validateQuestionItem } from "@manobu/item-engine/validation";

/** A Latin letter in an instruction means it stopped being a transcription of
 * the paper and became a paraphrase: the 選択肢 are printed １・２・３・４. */
const LATIN_SCRIPT_RE = /[A-Za-z]/;

const levelFromAnchor = (anchorId: string): string | null => {
  const parts = anchorId.split(":");
  return parts[1] ?? null;
};

const corpusView = (
  overrides: Partial<ItemCorpusView> = {}
): ItemCorpusView => ({
  isOptionSourceValid: () => true,
  resolveAnchor: (anchorId) =>
    anchorId.startsWith("corpus:")
      ? {
          id: anchorId,
          level: levelFromAnchor(anchorId),
          surfaces: [],
        }
      : null,
  satisfies: (item, optionIndex) =>
    optionIndex === item.answerIndex ? "yes" : "no",
  ...overrides,
});

const sourcesFor = (anchorId: string): OptionSource[] => [
  { anchorId, kind: "corpus", relation: "same-pos" },
  { anchorId, kind: "answer" },
  { anchorId, kind: "corpus", relation: "same-pos" },
  {
    anchorId,
    kind: "corpus",
    relation: "same-pos",
  },
];

const makeItem = (
  id: string,
  itemType: ItemType,
  level = "N5",
  overrides: Partial<QuestionItem> = {}
): QuestionItem => ({
  anchors: [`corpus:${level}:${id}`],
  answerIndex: 1,
  explanation: "generated explanation",
  fsrsVocabId: null,
  id,
  itemType,
  level,
  // A real-mode 大問 needs the material its shape asks for (表記 one authored
  // sentence, 情報検索 a document). The synthetic corpus stands in for a
  // fully-populated store, so a single-passage type carries its sentence;
  // without it the block-walk would score the 大問 short for a fixture gap
  // rather than a real shortage. Multi-passage types (統合理解) build their own
  // `stimuli`, so they are not produced through this generator.
  ...(STIMULUS_REQUIREMENTS[itemType]?.minPassages === 1
    ? { passage: "資料の本文です。" }
    : {}),
  options: ["wrong-a", "correct", "wrong-b", "wrong-c"],
  prompt: "choose the answer",
  script: itemType === "listening-detail" ? "spoken text" : null,
  surface: "exam",
  ...overrides,
});

const makeListeningItem = (
  overrides: Partial<QuestionItem> = {}
): QuestionItem =>
  makeItem("listening-base", "listening-detail", "N5", {
    id: "listening-base",
    ...overrides,
  });

const listeningRequest = parsePaperRequest({
  budget: { listening: 1 },
  level: "N5",
  sections: ["listening"],
  seed: "reason-seed",
});

const vocabularyRequest = parsePaperRequest({
  budget: { vocabulary: 1 },
  level: "N5",
  sections: ["vocabulary"],
  seed: "vocab-seed",
});

const slotFor = (
  item: QuestionItem,
  section: PaperSectionId,
  optionSources: readonly OptionSource[],
  sourceIndex = 0
): PaperSlot => ({
  block: null,
  item,
  optionSources,
  requestedSlotIndex: 0,
  section,
  sourceIndex,
});

const expectPaperReason = (
  reason: PaperRejectionReason,
  item: QuestionItem,
  optionSources: readonly OptionSource[],
  corpus: ItemCorpusView,
  request: PaperRequest = listeningRequest,
  section: PaperSectionId = "listening"
): void => {
  const result = validatePaper({
    corpus,
    request,
    slots: [slotFor(item, section, optionSources)],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe(reason);
  }
};

const candidatesFor = (request: PaperRequest): PaperCandidate[] => {
  const blueprint = PAPER_BLUEPRINTS[request.level];
  const candidates: PaperCandidate[] = [];
  for (const section of blueprint.sections) {
    if (!request.sections.includes(section.id)) {
      continue;
    }
    const allocation = allocatePaperMix({
      budget: request.budget[section.id] ?? 0,
      level: request.level,
      mode: request.mode,
      section: section.id,
    });
    for (const itemType of ITEM_TYPES) {
      for (let index = 0; index < allocation[itemType]; index += 1) {
        const id = `${section.id}-${itemType}-${index}`;
        const item = makeItem(id, itemType, request.level);
        candidates.push({
          item,
          optionSources: sourcesFor(
            item.anchors[0] ?? `corpus:${request.level}:${id}`
          ),
          section: section.id,
        });
      }
    }
  }
  return candidates;
};

const READING_BLOCK_IDS = new Set([
  "jouhou-kensaku",
  "naiyou-rikai-choubun",
  "naiyou-rikai-chuubun",
  "naiyou-rikai-tanbun",
  "shuchou-rikai-choubun",
  "tougou-rikai",
]);

/** One level's half of the 読解-band routing property: every 小問 type a
 * 読解-shaped 大問 places lands in the 読解 band and in NO other, at least one
 * type is actually placed, and the two bands stay disjoint. */
const expectReadingBandRouting = (level: "N1" | "N2" | "N3"): void => {
  const readingBand = PAPER_BLUEPRINTS[level].scoringSections.find(
    (section) => section.id === "reading"
  );
  const languageBand = PAPER_BLUEPRINTS[level].scoringSections.find(
    (section) => section.id === "language-knowledge"
  );
  if (!(readingBand?.itemTypes && languageBand?.itemTypes)) {
    throw new Error(`both bands must be itemTypes-filtered at ${level}`);
  }
  // Widen the `as const` blueprint tuples to the shared vocabulary so the
  // assertions compare ItemType to ItemType.
  const readingTypes: readonly ItemType[] = readingBand.itemTypes;
  const languageTypes: readonly ItemType[] = languageBand.itemTypes;
  let placed = 0;
  for (const block of PAPER_BLOCKS[level]) {
    if (!READING_BLOCK_IDS.has(block.id)) {
      continue;
    }
    for (const itemType of block.itemTypes) {
      placed += 1;
      expect(readingTypes).toContain(itemType);
      expect(languageTypes).not.toContain(itemType);
    }
  }
  expect(placed).toBeGreaterThan(0);
  for (const itemType of readingTypes) {
    expect(languageTypes).not.toContain(itemType);
  }
};

describe("paper policy", () => {
  it("keeps the official section shape, scoring caps and pass marks", () => {
    expect(PAPER_BLUEPRINTS.N5.sections.map((section) => section.id)).toEqual([
      "vocabulary",
      "grammar-reading",
      "listening",
    ]);
    expect(
      PAPER_BLUEPRINTS.N5.sections.map((section) => section.minutes)
    ).toEqual([20, 40, 30]);
    expect(PAPER_BLUEPRINTS.N3.sections).toHaveLength(3);
    expect(
      PAPER_BLUEPRINTS.N3.scoringSections.map((section) => section.cap)
    ).toEqual([60, 60, 60]);
    // TASK-173.13: N3 scores into the official three 得点区分, splitting 読解 out
    // of the merged 文法・読解 科目 exactly as N1/N2 do, not one column per section.
    expect(
      PAPER_BLUEPRINTS.N3.scoringSections.map((section) => section.id)
    ).toEqual(["language-knowledge", "reading", "listening"]);
    expect(PAPER_BLUEPRINTS.N4.scoringSections).toEqual([
      {
        cap: 120,
        id: "language-knowledge",
        passMark: 38,
        sourceSectionIds: ["vocabulary", "grammar-reading"],
      },
      {
        cap: 60,
        id: "listening",
        passMark: 19,
        sourceSectionIds: ["listening"],
      },
    ]);
    expect(PAPER_BLUEPRINTS.N2.sections.map((section) => section.id)).toEqual([
      "language-knowledge-reading",
      "listening",
    ]);
    expect(
      PAPER_BLUEPRINTS.N2.scoringSections.map((section) => section.cap)
    ).toEqual([60, 60, 60]);
    expect(
      PAPER_BLUEPRINTS.N2.scoringSections.map((section) => section.id)
    ).toEqual(["language-knowledge", "reading", "listening"]);
    expect(
      PAPER_BLUEPRINTS.N1.scoringSections.map((section) => section.cap)
    ).toEqual([60, 60, 60]);
    expect(PAPER_BLUEPRINTS.N1.sections[0]?.scoringSectionIds).toEqual([
      "language-knowledge",
      "reading",
    ]);
    expect(PAPER_BLUEPRINTS.N1.totalCap).toBe(180);
    expect(PAPER_BLUEPRINTS.N2.totalCap).toBe(180);
    expect(PAPER_LEVEL_PASS_MARKS).toEqual({
      N1: 100,
      N2: 90,
      N3: 95,
      N4: 90,
      N5: 80,
    });
  });

  it("uses concrete floor-minimum defaults and preserves overrides", () => {
    expect(PAPER_DEFAULT_BUDGETS).toEqual({
      N1: { "language-knowledge-reading": 40, listening: 10 },
      N2: { "language-knowledge-reading": 70, listening: 10 },
      N3: { "grammar-reading": 24, listening: 10, vocabulary: 10 },
      N4: { "grammar-reading": 10, listening: 10, vocabulary: 10 },
      N5: { "grammar-reading": 10, listening: 10, vocabulary: 10 },
    });
    expect(defaultPaperBudgetFor("N5")).toMatchObject({
      "grammar-reading": 10,
      listening: 10,
      vocabulary: 10,
    });
    expect(defaultPaperBudgetFor("N5", { listening: 0 }).listening).toBe(0);
    expect(
      defaultPaperBudgetFor("N1", { "language-knowledge-reading": 24 })
    ).toMatchObject({
      "language-knowledge-reading": 24,
      listening: 10,
    });
  });

  it("validates requests, applies defaults and rejects invalid values", () => {
    const result = validatePaperRequest({ level: "N5", seed: "seed" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.mode).toBe("shortened");
      expect(result.request.sections).toEqual([
        "vocabulary",
        "grammar-reading",
        "listening",
      ]);
      expect(result.request.budget).toMatchObject({
        "grammar-reading": 10,
        listening: 10,
        vocabulary: 10,
      });
      expect(result.request.focus).toEqual([]);
    }
    expect(
      validatePaperRequest({
        budget: { listening: 12 },
        level: "N5",
        seed: "seed",
      }).ok
    ).toBe(true);
    expect(
      validatePaperRequest({
        level: "N6",
        seed: "seed",
      }).ok
    ).toBe(false);
    expect(
      validatePaperRequest({
        level: "N5",
        sections: ["language-knowledge-reading"],
        seed: "seed",
      }).ok
    ).toBe(false);
    expect(
      validatePaperRequest({
        budget: { vocabulary: 1.5 },
        level: "N5",
        seed: "seed",
      }).ok
    ).toBe(false);
    expect(
      validatePaperRequest({
        level: "N5",
        mode: "practice",
        seed: "seed",
      }).ok
    ).toBe(false);
    expect(
      validatePaperRequest({
        budget: { vocabulary: 0 },
        level: "N5",
        sections: ["vocabulary"],
        seed: "empty",
      }).ok
    ).toBe(false);
  });

  it("reports D5 floors and the shortened raw-only distinction", () => {
    const below = paperScoringFloorStatus({
      budget: { "grammar-reading": 9, listening: 10, vocabulary: 10 },
      level: "N5",
    });
    expect(below.scoring).toBe("raw-only");
    expect(
      below.floors.find((floor) => floor.id === "language-knowledge")
    ).toMatchObject({
      itemCount: 19,
      minimumItems: 20,
      status: "unmet",
    });
    const atFloor = paperScoringFloorStatus({
      budget: { "grammar-reading": 10, listening: 10, vocabulary: 10 },
      level: "N5",
    });
    expect(atFloor.scoring).toBe("band");
    const n3 = paperScoringFloorStatus({
      budget: { "grammar-reading": 24, listening: 10, vocabulary: 10 },
      level: "N3",
    });
    expect(n3.floors.every((floor) => floor.status === "met")).toBe(true);
    // TASK-173.13: splitting 読解 out of the grammar-reading 科目 means the old
    // 10-per-section N3 paper no longer bands, because ~5 reading items cannot
    // clear the 10-item floor the new 読解 column needs. The raised default
    // (grammar-reading 24) clears it; the unmet band is now `reading`, not the
    // flat `grammar-reading` column that no longer exists.
    const n3Below = paperScoringFloorStatus({
      budget: { "grammar-reading": 10, listening: 10, vocabulary: 10 },
      level: "N3",
    });
    expect(n3Below.scoring).toBe("raw-only");
    expect(
      n3Below.floors.find((floor) => floor.id === "reading")
    ).toMatchObject({ itemCount: 5, minimumItems: 10, status: "unmet" });
    expect(
      n3Below.floors
        .filter((floor) => floor.id !== "reading")
        .every((floor) => floor.status === "met")
    ).toBe(true);
    const n1Below = paperScoringFloorStatus({
      budget: { "language-knowledge-reading": 20, listening: 10 },
      level: "N1",
    });
    expect(n1Below.scoring).toBe("raw-only");
    expect(
      n1Below.floors.find((floor) => floor.id === "reading")
    ).toMatchObject({ itemCount: 5, minimumItems: 10, status: "unmet" });
    const n1Viable = paperScoringFloorStatus({
      budget: { "language-knowledge-reading": 40, listening: 10 },
      level: "N1",
    });
    expect(n1Viable.floors.every((floor) => floor.status === "met")).toBe(true);
    const shortened = parsePaperRequest({
      budget: { "grammar-reading": 1, listening: 1, vocabulary: 1 },
      level: "N5",
      seed: "short",
    });
    expect(paperModeLabel(shortened)).toBe("shortened-paper-raw-only");
    const examConditions = parsePaperRequest({
      budget: { listening: 1 },
      level: "N5",
      mode: "exam-conditions",
      sections: ["listening"],
      seed: "exam",
    });
    expect(paperModeLabel(examConditions)).toBe("shortened-paper-raw-only");
    const viableExamConditions = parsePaperRequest({
      budget: { "grammar-reading": 10, listening: 10, vocabulary: 10 },
      level: "N5",
      mode: "exam-conditions",
      seed: "exam-viable",
    });
    expect(paperModeLabel(viableExamConditions)).toBe("exam-conditions");
  });

  it("allocates N3 long reading without changing other levels", () => {
    const allocation = allocatePaperItemTypes({
      budget: 10,
      level: "N3",
      section: "grammar-reading",
    });
    expect(allocation).toMatchObject({
      "long-reading": 2,
      "reading-info": 3,
    });
    expect(
      ITEM_TYPES.reduce((total, itemType) => total + allocation[itemType], 0)
    ).toBe(10);
    expect(
      paperSectionForItemType({ itemType: "long-reading", level: "N3" })
    ).toBe("grammar-reading");
    expect(
      paperSectionForItemType({ itemType: "long-reading", level: "N5" })
    ).toBeNull();
  });

  /**
   * TASK-173.9.29: a real paper places its 読解 大問 as short/medium/long 内容理解,
   * 主張理解, 統合理解 and 情報検索. Until this fix the 読解 band's `itemTypes`
   * held only the two flat-mix carriers, so every 小問 of those 大問 belonged to
   * NO band: the full real N1/N2/N3 papers never met the 読解 floor (shortfall 0
   * yet ready=false) and their result columns silently lost the points. This pins
   * the property for every 読解-shaped block the real blueprint places, and pins
   * that no type feeds two bands at once.
   */
  it("routes every placed 読解 type into the 読解 band and no other", () => {
    for (const level of ["N1", "N2", "N3"] as const) {
      expectReadingBandRouting(level);
    }
  });

  it("scales shortened section timers and preserves official exam timers", () => {
    expect(
      paperSectionTimeLimitSeconds({
        budget: 10,
        level: "N5",
        mode: "shortened",
        section: "listening",
      })
    ).toBe(900);
    expect(
      paperSectionTimeLimitSeconds({
        budget: 10,
        level: "N5",
        mode: "exam-conditions",
        section: "listening",
      })
    ).toBe(1800);
  });

  /**
   * TASK-173.1 AC#1/#2/#5 plus TASK-173.4 AC#2. `real` is a request the engine
   * accepts, and the three things the engine owns are the clock, the size and
   * the honesty label: the official minutes (like `exam-conditions`, NOT a
   * shorter paper), the official per-section item counts rather than the daily
   * practice default, and a `<mode>-paper-*` label that keeps an undersized
   * paper out of the banded results. A casual request still defaults to
   * `shortened`, and there the count does not move.
   */
  it("accepts the real mode, gives it the official minutes, and keeps the floor rule", () => {
    expect(PAPER_MODES).toContain("real");
    const accepted = validatePaperRequest({
      level: "N5",
      mode: "real",
      seed: "real",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error("the engine rejected a `real` request");
    }
    expect(accepted.request.mode).toBe("real");
    // A real paper is the size of the official one. The practice default of
    // 10 per section would leave no room for the 大問 after the first, and a
    // paper that drops 大問 silently is not the real thing.
    expect(accepted.request.budget).toEqual({
      "grammar-reading": paperSectionIndicativeCount({
        level: "N5",
        section: "grammar-reading",
      }),
      listening: paperSectionIndicativeCount({
        level: "N5",
        section: "listening",
      }),
      vocabulary: paperSectionIndicativeCount({
        level: "N5",
        section: "vocabulary",
      }),
    });
    expect(accepted.request.budget.vocabulary).toBeGreaterThan(
      defaultPaperBudgetFor("N5").vocabulary ?? 0
    );
    expect(
      paperSectionTimeLimitSeconds({
        budget: 10,
        level: "N5",
        mode: "real",
        section: "listening",
      })
    ).toBe(
      paperSectionTimeLimitSeconds({
        budget: 10,
        level: "N5",
        mode: "exam-conditions",
        section: "listening",
      })
    );
    expect(
      paperModeLabel(
        parsePaperRequest({ level: "N5", mode: "real", seed: "real" })
      )
    ).toBe("real-paper-banded");
    expect(
      paperModeLabel(
        parsePaperRequest({
          budget: { listening: 1 },
          level: "N5",
          mode: "real",
          sections: ["listening"],
          seed: "real-raw",
        })
      )
    ).toBe("real-paper-raw-only");
    const casual = validatePaperRequest({ level: "N5", seed: "casual" });
    expect(casual.ok && casual.request.mode).toBe("shortened");
    // TASK-173.4: and it cannot be BIGGER than the official one either. A section
    // asked for more 小問 than the paper has is the whole official section, so the
    // cap keeps the shortfall the size of the real gap rather than padding it with
    // questions that do not exist.
    const overAsked = parsePaperRequest({
      budget: { vocabulary: 40 },
      level: "N5",
      mode: "real",
      sections: ["vocabulary"],
      seed: "real-over",
    });
    expect(overAsked.budget.vocabulary).toBe(
      paperSectionIndicativeCount({ level: "N5", section: "vocabulary" })
    );
    // Under the official count the ask stands: a short real paper gets the 大問
    // that come first, which is the whole point of walking them in order.
    expect(
      parsePaperRequest({
        budget: { vocabulary: 9 },
        level: "N5",
        mode: "real",
        sections: ["vocabulary"],
        seed: "real-under",
      }).budget.vocabulary
    ).toBe(9);
    // The flat modes are untouched by the cap.
    expect(
      parsePaperRequest({
        budget: { vocabulary: 40 },
        level: "N5",
        sections: ["vocabulary"],
        seed: "shortened-over",
      }).budget.vocabulary
    ).toBe(40);
  });

  it("allocates exact integer mix budgets with largest remainders", () => {
    const allocation = allocatePaperItemTypes({
      budget: 10,
      level: "N5",
      section: "grammar-reading",
    });
    expect(allocation).toMatchObject({
      conjugation: 2,
      "grammar-form": 4,
      particle: 1,
      "reading-info": 3,
    });
    expect(
      ITEM_TYPES.reduce((total, itemType) => total + allocation[itemType], 0)
    ).toBe(10);
    expect(
      allocatePaperItemTypes({ budget: 0, level: "N5", section: "vocabulary" })
    ).toMatchObject({ "kanji-reading": 0, "word-in-context": 0 });
    expect(
      paperSectionForItemType({ itemType: "listening-detail", level: "N5" })
    ).toBe("listening");
    expect(
      paperSectionForItemType({ itemType: "kana-cell", level: "N5" })
    ).toBeNull();
    expect(PAPER_ITEM_TYPE_WEIGHTS_V2.N5.listening["listening-detail"]).toBe(
      100
    );
  });

  it("covers every paper rejection reason", () => {
    const cases: readonly {
      corpus: ItemCorpusView;
      item: QuestionItem;
      reason: PaperRejectionReason;
      sources: readonly OptionSource[];
    }[] = [
      {
        corpus: corpusView(),
        item: makeListeningItem({ anchors: [] }),
        reason: "no-anchor",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView(),
        item: makeListeningItem({ anchors: ["missing:1"] }),
        reason: "anchor-missing",
        sources: sourcesFor("missing:1"),
      },
      {
        corpus: corpusView(),
        item: makeItem("wrong-level", "listening-detail", "N4", {
          script: "spoken text",
        }),
        reason: "anchor-level",
        sources: sourcesFor("corpus:N4:wrong-level"),
      },
      {
        corpus: corpusView({
          satisfies: (_item, optionIndex) =>
            optionIndex === 1 || optionIndex === 2 ? "yes" : "no",
        }),
        item: makeListeningItem(),
        reason: "ambiguous",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView(),
        item: makeListeningItem({ options: ["a", "correct", "correct", "d"] }),
        reason: "duplicate-option",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView({
          isOptionSourceValid: (_item, source) => source.kind !== "derived",
        }),
        item: makeListeningItem(),
        reason: "unlucky-distractor",
        sources: [
          ...sourcesFor("corpus:N5:listening-base").slice(0, 3),
          {
            anchorId: "corpus:N5:listening-base",
            kind: "derived",
            rule: "wrong-form",
          },
        ],
      },
      {
        corpus: corpusView(),
        item: makeListeningItem({ prompt: "the correct answer" }),
        reason: "stem-leak",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView({ maxPassageLength: () => 2 }),
        item: makeListeningItem({ passage: "long passage" }),
        reason: "passage-length",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView(),
        item: makeListeningItem({ script: null }),
        reason: "script-missing",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView(),
        item: makeListeningItem({ options: ["a", "correct", "c"] }),
        reason: "option-count",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView(),
        item: makeListeningItem({ answerIndex: 9 }),
        reason: "answer-index",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView(),
        item: makeListeningItem(),
        reason: "answer-provenance",
        sources: [
          { anchorId: "corpus:N5:listening-base", kind: "answer" },
          {
            anchorId: "corpus:N5:listening-base",
            kind: "corpus",
            relation: "same-pos",
          },
          {
            anchorId: "corpus:N5:listening-base",
            kind: "corpus",
            relation: "same-pos",
          },
          {
            anchorId: "corpus:N5:listening-base",
            kind: "corpus",
            relation: "same-pos",
          },
        ],
      },
      {
        corpus: corpusView(),
        item: makeListeningItem({ fsrsVocabId: 7 }),
        reason: "fsrs-link",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
      {
        corpus: corpusView({ satisfies: () => "no" }),
        item: makeListeningItem(),
        reason: "no-correct-answer",
        sources: sourcesFor("corpus:N5:listening-base"),
      },
    ];
    for (const testCase of cases) {
      expectPaperReason(
        testCase.reason,
        testCase.item,
        testCase.sources,
        testCase.corpus
      );
    }
    const mixItem = makeItem("word-1", "word-in-context");
    const mixResult = validatePaper({
      corpus: corpusView(),
      request: vocabularyRequest,
      slots: [
        slotFor(mixItem, "vocabulary", sourcesFor(mixItem.anchors[0] ?? ""), 0),
        slotFor(
          makeItem("word-2", "word-in-context"),
          "vocabulary",
          sourcesFor("corpus:N5:word-2"),
          1
        ),
      ],
    });
    expect(mixResult.ok).toBe(false);
    if (!mixResult.ok) {
      expect(mixResult.reason).toBe("mix-mismatch");
    }
    const floorResult = validatePaper({
      corpus: corpusView(),
      request: parsePaperRequest({
        budget: { listening: 1 },
        level: "N5",
        mode: "exam-conditions",
        sections: ["listening"],
        seed: "floor",
      }),
      slots: [
        slotFor(
          makeListeningItem(),
          "listening",
          sourcesFor("corpus:N5:listening-base")
        ),
      ],
    });
    expect(floorResult.ok).toBe(false);
    if (!floorResult.ok) {
      expect(floorResult.reason).toBe("floor-unmet");
    }
  });

  it("keeps reason ordering stable", () => {
    expect(PAPER_REJECTION_REASON_ORDER.slice(0, 14)).toEqual([
      "no-anchor",
      "anchor-missing",
      "anchor-level",
      "ambiguous",
      "duplicate-option",
      "unlucky-distractor",
      "stem-leak",
      "mix-mismatch",
      "passage-missing",
      "passage-length",
      "script-missing",
      "stimuli-kind",
      "stimuli-count",
      "floor-unmet",
    ]);
  });

  it("rejects ambiguity and accepts a wrong-form sibling only for its target", () => {
    const item = makeItem("grammar-1", "grammar-form", "N5", {
      prompt: "te-form target",
    });
    const sources = sourcesFor(item.anchors[0] ?? "");
    sources[3] = {
      anchorId: item.anchors[0] ?? "",
      kind: "derived",
      rule: "wrong-form",
    };
    const targetCorpus = corpusView({
      satisfies: (candidate, optionIndex) =>
        candidate.prompt === "te-form target" &&
        optionIndex === candidate.answerIndex
          ? "yes"
          : "no",
    });
    const request = parsePaperRequest({
      budget: { "grammar-reading": 1 },
      level: "N5",
      sections: ["grammar-reading"],
      seed: "form",
    });
    expect(
      validatePaper({
        corpus: targetCorpus,
        request,
        slots: [slotFor(item, "grammar-reading", sources)],
      }).ok
    ).toBe(true);
    const ambiguous = validatePaper({
      corpus: corpusView({
        satisfies: (_candidate, optionIndex) =>
          optionIndex === 1 || optionIndex === 2 ? "yes" : "no",
      }),
      request: vocabularyRequest,
      slots: [
        slotFor(
          makeItem("word-ambiguous", "word-in-context"),
          "vocabulary",
          sourcesFor("corpus:N5:word-ambiguous")
        ),
      ],
    });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.reason).toBe("ambiguous");
    }
    expect(
      validateQuestionItem(
        { ...item, prompt: "different target" },
        sources,
        targetCorpus
      )
    ).toMatchObject({ ok: false, reason: "no-correct-answer" });
  });

  it("shuffles options deterministically without mutating the item", () => {
    const item = makeListeningItem({ id: "shuffle-item" });
    const originalOptions = [...item.options];
    const first = shuffleQuestionItemOptions({
      examId: "exam-1",
      item,
      seed: "seed-1",
    });
    const secondMount = shuffleQuestionItemOptions({
      examId: "exam-1",
      item: { ...item, options: [...item.options] },
      seed: "seed-1",
    });
    expect(first).toEqual(secondMount);
    expect(item.options).toEqual(originalOptions);
    expect(first.options[first.answerIndex]).toBe("correct");
    // The invariant that matters, and the one a broken shuffle also satisfies:
    // the four options are still all there, in some order.
    expect([...first.options].sort()).toEqual([...item.options].sort());
  });

  it("moves the answer off slot A across a paper, not just in one item (TASK-135)", () => {
    // The regression this pins: the option index used to be the LAST character
    // of the sort key, so the order was the identity for every item and every
    // paper answered A. Assert the DISTRIBUTION over many items, because a
    // single item can legitimately draw the identity (1 in 24).
    const items = Array.from({ length: 24 }, (_, index) =>
      makeListeningItem({ id: `paper-item-${index}` })
    );
    const answerIndexes = items.map(
      (item) =>
        shuffleQuestionItemOptions({
          examId: "exam-dist",
          item,
          seed: "seed-dist",
        }).answerIndex
    );
    // All four slots carry the answer somewhere across the paper, and no slot
    // carries all of them: the identity put 24 of 24 in slot 0.
    expect([...new Set(answerIndexes)].sort()).toEqual([0, 1, 2, 3]);
    for (const slot of [0, 1, 2, 3]) {
      const count = answerIndexes.filter((index) => index === slot).length;
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(answerIndexes.length);
    }
  });

  it("gives two items different orders under one exam and seed (TASK-135)", () => {
    const orders = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map(
      (id) =>
        shuffleQuestionItemOptions({
          examId: "exam-shared",
          item: makeListeningItem({ id }),
          seed: "seed-shared",
        }).options
    );
    expect(
      new Set(orders.map((options) => options.join("|"))).size
    ).toBeGreaterThan(1);
  });

  it("reproduces an order per exam and seed, and moves it for another seed (TASK-135)", () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      makeListeningItem({ id: `seeded-item-${index}` })
    );
    const orderFor = (seed: string) =>
      items.map(
        (item) =>
          shuffleQuestionItemOptions({
            examId: "exam-seed",
            item,
            seed,
          }).options
      );
    expect(orderFor("seed-a")).toEqual(orderFor("seed-a"));
    expect(orderFor("seed-a")).not.toEqual(orderFor("seed-b"));
  });

  it("assembles in accepted order, reports replacement and shortfall", () => {
    const request = parsePaperRequest({
      budget: { listening: 1 },
      level: "N5",
      sections: ["listening"],
      seed: "assembly",
    });
    const [valid] = candidatesFor(request);
    if (!valid) {
      throw new Error("test fixture did not produce a listening candidate");
    }
    const invalid: PaperCandidate = {
      ...valid,
      item: { ...valid.item, anchors: [] },
    };
    const replaced = assemblePaper({
      candidates: [invalid, valid],
      corpus: corpusView(),
      examId: "exam-assembly",
      request,
    });
    expect(replaced.ready).toBe(true);
    expect(replaced.shortfall).toBe(0);
    expect(replaced.rejections).toHaveLength(1);
    expect(replaced.rejections[0]).toMatchObject({
      reason: "no-anchor",
      slotIndex: 0,
    });
    const missing = assemblePaper({
      candidates: [invalid],
      corpus: corpusView(),
      examId: "exam-assembly",
      request,
    });
    expect(missing.ready).toBe(false);
    expect(missing.shortfall).toBe(1);
  });

  it("keeps assembled keys server-side and strips them from the client projection", () => {
    const request = parsePaperRequest({
      budget: { vocabulary: 1 },
      level: "N5",
      sections: ["vocabulary"],
      seed: "projection",
    });
    const [candidate] = candidatesFor(request);
    if (!candidate) {
      throw new Error("test fixture did not produce a vocabulary candidate");
    }
    const withSensitiveFields: PaperCandidate = {
      ...candidate,
      item: {
        ...candidate.item,
        explanation: "do not ship this explanation",
        fsrsVocabId: 42,
        script: "do not ship this script",
      },
    };
    const assembled = assemblePaper({
      candidates: [withSensitiveFields],
      corpus: corpusView(),
      examId: "exam-projection",
      request,
    });
    const projection = projectPaperForClient(assembled);
    const serialized = JSON.stringify(projection);
    for (const key of [
      "answerIndex",
      "explanation",
      "script",
      "fsrsVocabId",
      "optionSources",
    ]) {
      expect(serialized).not.toContain(`"${key}"`);
    }
    expect(serialized).not.toContain("do not ship this explanation");
    expect(serialized).not.toContain("do not ship this script");
  });

  it("accepts a shortened floor and rejects an exam-conditions floor claim", () => {
    const base = parsePaperRequest({
      budget: { "grammar-reading": 1, listening: 1, vocabulary: 1 },
      level: "N5",
      seed: "floor-assembly",
    });
    const candidates = candidatesFor(base);
    const shortened = assemblePaper({
      candidates,
      corpus: corpusView(),
      examId: "exam-short",
      request: base,
    });
    expect(shortened.ready).toBe(true);
    expect(shortened.validation.ok).toBe(true);
    expect(shortened.floors.scoring).toBe("raw-only");
    const exam = assemblePaper({
      candidates,
      corpus: corpusView(),
      examId: "exam-conditions",
      request: { ...base, mode: "exam-conditions" },
    });
    expect(exam.ready).toBe(false);
    expect(exam.validation.ok).toBe(false);
    if (!exam.validation.ok) {
      expect(exam.validation.reason).toBe("floor-unmet");
    }
  });

  it("gives N1 the integrated mix and no other level the types (TASK-132)", () => {
    const n1 = PAPER_ITEM_TYPE_WEIGHTS_V2.N1;
    expect(n1["language-knowledge-reading"]).toMatchObject({
      "integrated-reading": 25,
      "long-reading": 20,
      "reading-info": 15,
    });
    expect(n1.listening).toMatchObject({
      "integrated-listening": 60,
      "listening-detail": 40,
    });
    const readingAllocation = allocatePaperItemTypes({
      budget: 40,
      level: "N1",
      section: "language-knowledge-reading",
    });
    const listeningAllocation = allocatePaperItemTypes({
      budget: 10,
      level: "N1",
      section: "listening",
    });
    expect(readingAllocation["integrated-reading"]).toBeGreaterThan(0);
    expect(readingAllocation["long-reading"]).toBeGreaterThan(0);
    expect(readingAllocation["reading-info"]).toBeGreaterThan(0);
    expect(listeningAllocation["integrated-listening"]).toBeGreaterThan(0);
    expect(
      Object.values(readingAllocation).reduce((sum, count) => sum + count, 0)
    ).toBe(40);
    for (const level of ["N2", "N3", "N4", "N5"] as const) {
      const weights = PAPER_ITEM_TYPE_WEIGHTS_V2[level];
      for (const section of Object.values(weights)) {
        expect(section["integrated-reading"]).toBe(0);
        expect(section["integrated-listening"]).toBe(0);
      }
      expect(weights.listening["listening-detail"]).toBe(100);
    }
    expect(
      paperSectionForItemType({ itemType: "integrated-reading", level: "N1" })
    ).toBe("language-knowledge-reading");
    expect(
      paperSectionForItemType({ itemType: "integrated-listening", level: "N1" })
    ).toBe("listening");
    expect(
      paperSectionForItemType({ itemType: "integrated-reading", level: "N2" })
    ).toBeNull();
  });

  it("weights no real-paper-only reading type in any flat mix (TASK-173.9.3)", () => {
    // 短文, 中文, 主張理解, 情報検索 and 統合理解 are each sourced from a LEVEL
    // store that only a REAL paper walks, so a `shortened` or daily paper has
    // nothing to ask with them. A non-zero weight here would put an item type in
    // a flat mix that no picker can source, and the paper would come up short
    // for a block nobody authored.
    const realOnly = [
      "claim-understanding",
      "info-search",
      "medium-reading",
      "short-reading",
      "text-comparison",
    ] as const;
    for (const weights of Object.values(PAPER_ITEM_TYPE_WEIGHTS_V2)) {
      for (const section of Object.values(weights)) {
        for (const itemType of realOnly) {
          expect(section[itemType]).toBe(0);
        }
      }
    }
  });

  it("sends only passages to the client, in order (TASK-132)", () => {
    const request = parsePaperRequest({
      budget: { listening: 1 },
      level: "N1",
      sections: ["listening"],
      seed: "integrated-projection",
    });
    const [candidate] = candidatesFor(request);
    if (!candidate) {
      throw new Error("test fixture did not produce a listening candidate");
    }
    const assembled = assemblePaper({
      candidates: [
        {
          ...candidate,
          item: {
            ...candidate.item,
            itemType: "integrated-listening",
            script: null,
            stimuli: [
              { kind: "script", text: "秘密の台本です" },
              { kind: "passage", text: "最初の資料です。" },
              { kind: "passage", text: "第二の資料です。" },
            ],
          },
        },
      ],
      corpus: corpusView(),
      examId: "exam-integrated",
      request,
    });
    const projection = projectPaperForClient(assembled);
    expect(projection.sections[0]?.items[0]?.item.stimuli).toEqual([
      { kind: "passage", text: "最初の資料です。" },
      { kind: "passage", text: "第二の資料です。" },
    ]);
  });
});

/**
 * TASK-173.4 AC#3. The sequences below are pinned against the official
 * sources recorded in doc-26 §1 and §3: the per-level 大問のねらい PDFs
 * (`https://www.jlpt.jp/guideline/pdf/n5_revised.pdf`, `n4_revised.pdf`) give
 * block order, 大問 numbering and names; the composition page
 * (`https://www.jlpt.jp/guideline/testsections.html`) gives the 大問 x level
 * presence matrix that the negative assertions read. Per-block 小問数 is NOT
 * published by any current document, so nothing here pins a count as official:
 * the 2009 目安 numbers are asserted only as the shape the allocator walks, and
 * the field that carries them is named `indicativeCount`.
 */
describe("paper 大問 blocks", () => {
  const blockSequence = (level: PaperLevel): readonly string[] =>
    PAPER_BLOCKS[level].map(
      (block) => `${block.sectionId}:${block.bigQuestion}:${block.id}`
    );

  it("prints the N5 大問 in official order, restarting the numbering per 科目", () => {
    expect(blockSequence("N5")).toEqual([
      "vocabulary:1:kanji-yomi",
      "vocabulary:2:hyouki",
      "vocabulary:3:bunmi-kitei",
      "vocabulary:4:iikae-ruiji",
      "grammar-reading:1:bun-no-bunpou-1",
      "grammar-reading:2:bun-no-bunpou-2",
      "grammar-reading:3:bunshou-no-bunpou",
      "grammar-reading:4:naiyou-rikai-tanbun",
      "grammar-reading:5:naiyou-rikai-chuubun",
      "grammar-reading:6:jouhou-kensaku",
      "listening:1:kadai-rikai",
      "listening:2:point-rikai",
      "listening:3:hatsuwa-hyougen",
      "listening:4:sokuji-outou",
    ]);
    expect(
      paperBlocksFor({ level: "N5", section: "grammar-reading" }).map(
        (block) => block.name
      )
    ).toEqual([
      "文の文法1（文法形式の判断）",
      "文の文法2（文の組み立て）",
      "文章の文法",
      "内容理解（短文）",
      "内容理解（中文）",
      "情報検索",
    ]);
  });

  it("prints the N4 大問 in official order, one block longer than N5", () => {
    expect(blockSequence("N4")).toEqual([
      "vocabulary:1:kanji-yomi",
      "vocabulary:2:hyouki",
      "vocabulary:3:bunmi-kitei",
      "vocabulary:4:iikae-ruiji",
      "vocabulary:5:youhou",
      "grammar-reading:1:bun-no-bunpou-1",
      "grammar-reading:2:bun-no-bunpou-2",
      "grammar-reading:3:bunshou-no-bunpou",
      "grammar-reading:4:naiyou-rikai-tanbun",
      "grammar-reading:5:naiyou-rikai-chuubun",
      "grammar-reading:6:jouhou-kensaku",
      "listening:1:kadai-rikai",
      "listening:2:point-rikai",
      "listening:3:hatsuwa-hyougen",
      "listening:4:sokuji-outou",
    ]);
  });

  /**
   * The presence matrix's "―" half. A block that does not exist at a level must
   * not be walked there, or the paper invents a 大問 the learner never sees and
   * spends budget on nothing.
   */
  it("keeps the blocks the official low-level papers do not have out of them", () => {
    const idsAt = (level: PaperLevel): Set<PaperBlockId> =>
      new Set(PAPER_BLOCKS[level].map((block) => block.id));
    const absentAt: Record<PaperLevel, readonly PaperBlockId[]> = {
      N1: ["hatsuwa-hyougen", "hyouki", "goseikei"],
      N2: ["hatsuwa-hyougen"],
      N3: ["goseikei", "shuchou-rikai-choubun", "tougou-rikai"],
      N4: [
        "gaiyou-rikai",
        "goseikei",
        "naiyou-rikai-choubun",
        "shuchou-rikai-choubun",
        "tougou-rikai",
      ],
      N5: [
        "gaiyou-rikai",
        "goseikei",
        "naiyou-rikai-choubun",
        "shuchou-rikai-choubun",
        "tougou-rikai",
        "youhou",
      ],
    };
    for (const level of PAPER_LEVELS) {
      for (const id of absentAt[level]) {
        expect(idsAt(level).has(id)).toBe(false);
      }
    }
    // The near neighbours, so the table above cannot pass by omitting too much.
    expect(idsAt("N5").has("jouhou-kensaku")).toBe(true);
    expect(idsAt("N5").has("hatsuwa-hyougen")).toBe(true);
    expect(idsAt("N4").has("youhou")).toBe(true);
    expect(idsAt("N3").has("gaiyou-rikai")).toBe(true);
    expect(idsAt("N3").has("naiyou-rikai-choubun")).toBe(true);
    expect(idsAt("N2").has("hyouki")).toBe(true);
    expect(idsAt("N2").has("goseikei")).toBe(true);
  });

  /**
   * AC#2 in the smallest case the corpus can show: since TASK-173.9.27 every
   * N5 語彙 大問 names an item type, so a fully-populated corpus walks the
   * section 大問 by 大問 and fills each one to its own 目安 count, reporting no
   * hole. The other half of the AC, naming what cannot be filled, is asserted
   * on `paperUnfillableBlocks` below: a real-mode assemble cannot go short
   * (withholding a kind the mix asks for is a `mix-mismatch`, not a paper), so
   * a level whose corpus has no store for a kind is told to the engine through
   * `hasSource`, and the 言い換え類義 hole at N4/N5 - the real paper asks the
   * sentence-paraphrase form that TASK-173.9.28 will author - is the caller's
   * fact to name, not this walk's.
   */
  it("walks a real section 大問 by 大問 and fills every 大問 the corpus can source", () => {
    const request = parsePaperRequest({
      level: "N5",
      mode: "real",
      sections: ["vocabulary"],
      seed: "real-blocks",
    });
    const assembled = assemblePaper({
      candidates: candidatesFor(request),
      corpus: corpusView(),
      examId: "exam-real-blocks",
      request,
    });
    const [section] = assembled.sections;
    if (!section) {
      throw new Error("the assembled real paper has no section");
    }
    expect(section.blocks.map((block) => block.id)).toEqual([
      "kanji-yomi",
      "hyouki",
      "bunmi-kitei",
      "iikae-ruiji",
    ]);
    // Each block is asked for its own 目安 count, so the sums are read from the
    // table rather than repeated here: no test asserts a 小問数 as official.
    expect(section.blocks.map((block) => block.requestedItems)).toEqual(
      paperBlocksFor({ level: "N5", section: "vocabulary" }).map(
        (block) => block.indicativeCount
      )
    );
    // Every 大問 names a kind the corpus supplies, so each fills to its own
    // 目安 count and the section reports no shortfall. The counts are read
    // from the table, never asserted as official here.
    const shape = paperBlocksFor({ level: "N5", section: "vocabulary" });
    expect(section.blocks.map((block) => block.itemCount)).toEqual(
      shape.map((block) => block.indicativeCount)
    );
    expect(section.shortfall).toBe(0);
    // Items print in 大問 order: 漢字読み's 小問, then 表記's, then 文脈規定's,
    // then 言い換え類義's.
    const expectedBlockOrder = section.blocks.flatMap((block) =>
      Array.from({ length: block.itemCount }, () => block.id)
    );
    expect(section.items.map((item) => item.block)).toEqual(expectedBlockOrder);
    expect(section.items.map((item) => item.order)).toEqual(
      section.items.map((_, index) => index)
    );
    expect(assembled.ready).toBe(true);
    expect(assembled.validation.ok).toBe(true);
  });

  it("asks every 大問 of an unfilled section rather than padding the first", () => {
    const counts = paperBlocksFor({
      level: "N5",
      section: "listening",
    }).map((block) => block.indicativeCount);
    const allocation = allocatePaperBlocks({
      budget: paperSectionIndicativeCount({
        level: "N5",
        section: "listening",
      }),
      level: "N5",
      section: "listening",
    });
    expect(allocation.blocks.map((block) => block.requested)).toEqual(counts);
    expect(allocation.requestedItems).toBe(
      counts.reduce((total, count) => total + count, 0)
    );
    expect(allocation.unusedBudget).toBe(0);
    for (const block of allocation.blocks) {
      // Since TASK-173.8.1 every N4/N5 listening 大問 names an item type
      // (`listening-kadai` / `listening-point` / `listening-hatsuwa` /
      // `listening-sokuji`), so the walk allocates to them just like it does to
      // the reading blocks: a block is asked for `requested` items of its own
      // type, not 0.
      expect(block.itemTypeAllocation).not.toEqual({});
      const allocated = Object.values(block.itemTypeAllocation).reduce(
        (total, count) => total + count,
        0
      );
      expect(allocated).toBe(block.requested);
    }
    // A budget smaller than the official shape takes the 大問 from the front and
    // leaves the rest asking for nothing.
    const [firstCount] = counts;
    const truncated = allocatePaperBlocks({
      budget: (firstCount ?? 0) + 2,
      level: "N5",
      section: "listening",
    });
    expect(truncated.blocks.map((block) => block.requested)).toEqual([
      firstCount ?? 0,
      2,
      0,
      0,
    ]);
    expect(truncated.unusedBudget).toBe(0);
  });

  /**
   * TASK-173.4 AC#4: what a short real paper tells the learner. These are the 大問
   * the official shape asked for and nothing could fill, so naming them is the
   * only honest way to say where the paper gave up.
   */
  it("names the 大問 a real section asked for and could not build", () => {
    // Since TASK-173.9.27 every N5 語彙 大問 names an item type, so an
    // engine working from kinds alone no longer sees a hole here: 言い換え類義
    // left the static list the way 文脈規定 (TASK-173.5) and 表記
    // (TASK-173.9.25) did before it. The hole is real but it is a corpus fact,
    // and the caller that owns the corpus names it through `hasSource`: the
    // N5 paper asks the sentence-paraphrase form and no store supplies it
    // until TASK-173.9.28.
    expect(
      paperUnfillableBlocks({
        budget: paperSectionIndicativeCount({
          level: "N5",
          section: "vocabulary",
        }),
        level: "N5",
        section: "vocabulary",
      })
    ).toEqual([]);
    const holes = paperUnfillableBlocks({
      budget: paperSectionIndicativeCount({
        level: "N5",
        section: "vocabulary",
      }),
      hasSource: (block) => block.id !== "iikae-ruiji",
      level: "N5",
      section: "vocabulary",
    });
    expect(holes).toMatchObject([
      { bigQuestion: 4, id: "iikae-ruiji", section: "vocabulary" },
    ]);
    // The 小問 each one asked for is its own count, not the section's: the
    // sentence the learner gets has to say how big each hole is.
    expect(holes.map((block) => block.requestedItems)).toEqual([5]);
    // Listening now has item types (TASK-173.8.1), so the engine sees the blocks
    // as buildable and reports no 大問 as unfillable; a hole is now a corpus
    // fact the caller answers through `hasSource` (the N4/N5 stores under
    // TASK-173.8.1's AC#3).
    expect(
      paperUnfillableBlocks({
        budget: paperSectionIndicativeCount({
          level: "N5",
          section: "listening",
        }),
        level: "N5",
        section: "listening",
      })
    ).toEqual([]);
    const listeningHoles = paperUnfillableBlocks({
      budget: paperSectionIndicativeCount({
        level: "N5",
        section: "listening",
      }),
      hasSource: () => false,
      level: "N5",
      section: "listening",
    });
    expect(listeningHoles.map((block) => block.id)).toEqual([
      "kadai-rikai",
      "point-rikai",
      "hatsuwa-hyougen",
      "sokuji-outou",
    ]);
    // A budget that runs out mid-section names only a 大問 it asked for and has
    // no question kind for. At 14 小問 the walk reaches 表記, which now fills its
    // two slots, and never reaches 言い換え類義, so nothing is a hole: a block
    // asked for nothing is not reported.
    expect(
      paperUnfillableBlocks({ budget: 14, level: "N5", section: "vocabulary" })
    ).toEqual([]);
    expect(
      paperUnfillableBlocks({ budget: 0, level: "N5", section: "vocabulary" })
    ).toEqual([]);
    // The 大問 the engine can build (漢字読み, 表記, 文脈規定) are never named:
    // a budget that only reaches 漢字読み leaves no empty 大問 to report.
    expect(
      paperUnfillableBlocks({ budget: 12, level: "N5", section: "vocabulary" })
        .length
    ).toBe(0);
    for (const block of holes) {
      expect(block.name.length).toBeGreaterThan(0);
    }
  });

  /**
   * The widened rule. The engine can only see question KINDS, so a 大問 whose
   * kind exists but has no store at that level is a corpus fact the caller owns
   * and answers through `hasSource`. The predicate is consulted per 大問 and
   * defaults to sourceable, which is what keeps every caller that passes nothing
   * on the engine-only rule asserted above.
   */
  it("names a 大問 only where the caller's hasSource says nothing can fill it", () => {
    const input = {
      budget: 100,
      level: "N2",
      section: "language-knowledge-reading",
    } as const;
    // Without a predicate, 大問10 内容理解（短文） has a question kind, so the
    // engine reports the block as filled and names only the type-less ones.
    const engineOnly = paperUnfillableBlocks(input).map((block) => block.id);
    expect(engineOnly).not.toContain("naiyou-rikai-tanbun");
    // A caller that owns the corpus says this level has no 短文 store, and only
    // the block the predicate rejects is added.
    const withStoreAbsence = paperUnfillableBlocks({
      ...input,
      hasSource: (block) => block.id !== "naiyou-rikai-tanbun",
    }).map((block) => block.id);
    expect(withStoreAbsence).toContain("naiyou-rikai-tanbun");
    expect(withStoreAbsence.length).toBe(engineOnly.length + 1);
    // The predicate adds holes, never removes them, and an always-true predicate
    // is the default exactly.
    expect(engineOnly.every((id) => withStoreAbsence.includes(id))).toBe(true);
    expect(paperUnfillableBlocks({ ...input, hasSource: () => true })).toEqual(
      paperUnfillableBlocks(input)
    );
  });

  /**
   * The flat spread stays exactly where it was: a `shortened` paper is not a
   * failed real one, and it prints no 大問 headings.
   */
  it("keeps the block grouping out of every other mode", () => {
    const request = parsePaperRequest({
      budget: { vocabulary: 4 },
      level: "N5",
      sections: ["vocabulary"],
      seed: "shortened-blocks",
    });
    const assembled = assemblePaper({
      candidates: candidatesFor(request),
      corpus: corpusView(),
      examId: "exam-shortened-blocks",
      request,
    });
    const [section] = assembled.sections;
    if (!section) {
      throw new Error("the assembled paper has no section");
    }
    expect(section.blocks).toEqual([]);
    expect(section.items.map((item) => item.block)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const projection = projectPaperForClient(assembled);
    expect(projection.sections[0]?.blocks).toEqual([]);
    expect(projection.sections[0]?.items[0]?.block).toBeNull();
  });

  /**
   * AC#4 on the read side. `exam_items` stores a type, a section and an order,
   * so a stored paper is re-walked from the plan and its rows assigned to each
   * 大問 in order. A 大問 that came up short keeps its heading with the count it
   * reached (the TASK-173.5 case: 文脈規定 leans on a grammar pool a level can
   * run dry on, and erasing every heading for it is wrong). What is rejected is
   * a row that does not belong to the 大問 its position names, or more rows than
   * the shape holds: an old flat-mix paper, or one that cannot be a faithful
   * print of the official shape.
   */
  it("re-derives 大問 headings from stored rows, tolerating a short 大問 but not a wrong one", () => {
    const vocabulary = paperBlocksFor({
      level: "N5",
      section: "vocabulary",
    });
    const [firstBlock, , clozeBlock] = vocabulary;
    const firstCount = firstBlock?.indicativeCount ?? 0;
    const clozeCount = clozeBlock?.indicativeCount ?? 0;
    // The rows a filled real paper stores: 漢字読み's items, then 文脈規定's, in
    // 大問 order, with 表記 and 言い換え類義 contributing nothing between them.
    const derived = paperBlocksForLandedItems({
      budget: paperSectionIndicativeCount({
        level: "N5",
        section: "vocabulary",
      }),
      itemTypes: [
        ...Array.from({ length: firstCount }, () => "kanji-reading" as const),
        ...Array.from({ length: clozeCount }, () => "context-cloze" as const),
      ],
      level: "N5",
      mode: "real",
      section: "vocabulary",
    });
    expect(derived?.blocks.map((block) => block.itemCount)).toEqual([
      firstCount,
      0,
      clozeCount,
      0,
    ]);
    expect(derived?.itemBigQuestions).toEqual([
      ...Array.from({ length: firstCount }, () => firstBlock?.bigQuestion ?? 0),
      ...Array.from({ length: clozeCount }, () => clozeBlock?.bigQuestion ?? 0),
    ]);
    // The TASK-173.5 case the strict count match used to reject: 漢字読み fills,
    // 文脈規定 reaches only 5 of its 10 against a thin grammar pool, and BOTH
    // 大問 headings print with the counts actually reached.
    expect(
      paperBlocksForLandedItems({
        budget: paperSectionIndicativeCount({
          level: "N5",
          section: "vocabulary",
        }),
        itemTypes: [
          ...Array.from({ length: firstCount }, () => "kanji-reading" as const),
          ...Array.from({ length: 5 }, () => "context-cloze" as const),
        ],
        level: "N5",
        mode: "real",
        section: "vocabulary",
      })?.blocks.map((block) => block.itemCount)
    ).toEqual([firstCount, 0, 5, 0]);
    expect(
      paperBlocksForLandedItems({
        budget: 4,
        itemTypes: [
          "kanji-reading",
          "word-in-context",
          "kanji-reading",
          "word-in-context",
        ],
        level: "N5",
        mode: "real",
        section: "vocabulary",
      })
    ).toBeNull();
    // A paper that came up short on the 大問 the budget reached still keeps that
    // heading: 3 of the 4 rows land in 漢字読み, not no heading at all.
    expect(
      paperBlocksForLandedItems({
        budget: 4,
        itemTypes: ["kanji-reading", "kanji-reading", "kanji-reading"],
        level: "N5",
        mode: "real",
        section: "vocabulary",
      })
    ).toMatchObject({
      blocks: [
        { bigQuestion: 1, id: "kanji-yomi", itemCount: 3, requestedItems: 4 },
        { bigQuestion: 2, id: "hyouki", itemCount: 0 },
        { bigQuestion: 3, id: "bunmi-kitei", itemCount: 0 },
        { bigQuestion: 4, id: "iikae-ruiji", itemCount: 0 },
      ],
      itemBigQuestions: [1, 1, 1],
    });
    expect(
      paperBlocksForLandedItems({
        budget: 4,
        itemTypes: [
          "kanji-reading",
          "kanji-reading",
          "kanji-reading",
          "kanji-reading",
        ],
        level: "N5",
        mode: "shortened",
        section: "vocabulary",
      })
    ).toBeNull();
  });
});

/**
 * TASK-173.2 AC#1/#3: the instruction sentence a real paper prints under each
 * 大問 heading. Every string here was transcribed from the Foundation's 2018
 * レベル別 sample paper named beside it, which is the only source this repo has
 * for what the paper actually says; `doc-26` records where each PDF came from.
 * The test repeats the table on purpose: a Japanese instruction that gets
 * retyped from memory in six months has no PDF beside it, and this is the only
 * place the wording is checked against something.
 */
describe("paper block instructions (TASK-173.2)", () => {
  const OFFICIAL_INSTRUCTIONS: readonly {
    block: PaperBlockId;
    level: PaperLevel;
    source: string;
    text: string;
  }[] = [
    {
      block: "kanji-yomi",
      level: "N5",
      source: "N5V.pdf p.2 (もんだい1)",
      text: "＿＿＿ の ことばは ひらがなで どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
    },
    {
      block: "kanji-yomi",
      level: "N4",
      source: "N4V.pdf p.2 (もんだい1)",
      text: "＿＿＿ の ことばは ひらがなで どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
    },
    {
      block: "kanji-yomi",
      level: "N3",
      source: "N3V.pdf p.3 (問題1)",
      text: "＿＿＿ のことばの読み方として最もよいものを、１・２・３・４から一つ えらびなさい。",
    },
    {
      block: "kanji-yomi",
      level: "N2",
      source: "N2V.pdf p.3 (問題1)",
      text: "＿＿＿ の言葉の読み方として最もよいものを、１・２・３・４から一つ 選びなさい。",
    },
    {
      block: "kanji-yomi",
      level: "N1",
      source: "N1V.pdf p.3 (問題1)",
      text: "＿＿＿ の言葉の読み方として最もよいものを、１・２・３・４から一つ 選びなさい。",
    },
    {
      block: "bun-no-bunpou-1",
      level: "N5",
      source: "N5G.pdf p.2 (もんだい1)",
      text: "（　）に 何を 入れますか。１・２・３・４から いちばん いい ものを 一つ えらんで ください。",
    },
    {
      block: "bun-no-bunpou-1",
      level: "N4",
      source: "N4G.pdf p.2 (もんだい1)",
      text: "（　）に 何を 入れますか。１・２・３・４から いちばん いい ものを 一つ えらんで ください。",
    },
    {
      block: "bun-no-bunpou-1",
      level: "N3",
      source: "N3G.pdf p.3 (問題1)",
      text: "つぎの文の（　）に入れるのに最もよいものを、１・２・３・４から一つ えらびなさい。",
    },
    {
      block: "bun-no-bunpou-1",
      level: "N2",
      source: "N2G.pdf p.1 (問題7)",
      text: "次の文の（　）に入れるのに最もよいものを、１・２・３・４から一つ 選びなさい。",
    },
    {
      block: "bun-no-bunpou-1",
      level: "N1",
      source: "N1G.pdf p.1 (問題5)",
      text: "次の文の（　）に入れるのに最もよいものを、１・２・３・４から一つ 選びなさい。",
    },
    {
      block: "goseikei",
      level: "N2",
      source: "N2V.pdf p.5 (問題3)",
      text: "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。",
    },
    {
      block: "iikae-ruiji",
      level: "N1",
      source: "N1V.pdf p.5 (問題3)",
      text: "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。",
    },
    {
      block: "iikae-ruiji",
      level: "N2",
      source: "N2V.pdf p.7 (問題5)",
      text: "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。",
    },
    {
      block: "iikae-ruiji",
      level: "N3",
      source: "N3V.pdf p.6 (問題4)",
      text: "＿＿＿に意味が最も近いものを、１・２・３・４から一つえらびなさい。",
    },
    {
      // TASK-173.9.28: the N4 and N5 booklets print this heading word-for-word
      // the same, over the underlined sentence rather than a bracketed word.
      block: "iikae-ruiji",
      level: "N4",
      source: "N4V.pdf p.6 (もんだい4)",
      text: "＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
    },
    {
      block: "iikae-ruiji",
      level: "N5",
      source: "N5V.pdf p.7 (もんだい4)",
      text: "＿＿＿の ぶんと だいたい おなじ いみの ぶんが あります。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
    },
  ];

  for (const row of OFFICIAL_INSTRUCTIONS) {
    it(`prints the ${row.level} ${row.block} instruction from ${row.source}`, () => {
      expect(
        paperBlockInstruction({ block: row.block, level: row.level })
      ).toBe(row.text);
    });
  }

  it("keeps every instruction the paper's own sentence: no Latin, no em dash", () => {
    for (const row of OFFICIAL_INSTRUCTIONS) {
      // R-02 (AGENTS.md): no em dash in anything a learner reads. The copy-deck
      // guard cannot see this table, so the check lives with the strings.
      expect(row.text).not.toContain("—");
      // A Latin letter means the string stopped being a transcription and became
      // a paraphrase: the papers print １・２・３・４ in full width, never 1234.
      expect(row.text).not.toMatch(LATIN_SCRIPT_RE);
      expect(row.text).toContain("１・２・３・４から");
    }
  });

  it("names no instruction for a 大問 whose paper has not been read", () => {
    // The 聴解 blocks are still unfilled (PAPER_BLOCK_SHAPES), so nothing would
    // ever print their heading. A null is the honest answer, and the server
    // turns it into "no instruction line" rather than a guess. 表記 no longer
    // belongs here: since TASK-173.9.25 it prints its own line at N5-N2 and only
    // stays null at N1, which does not ask it. 語形成 likewise: since
    // TASK-173.9.26 it prints its own line at N2 (the only level whose blueprint
    // has the 大問), so the null now says "this level has no 語形成 大問", not
    // "nobody read a 語形成 paper".
    expect(
      paperBlockInstruction({ block: "goseikei", level: "N3" })
    ).toBeNull();
    expect(
      paperBlockInstruction({ block: "kadai-rikai", level: "N1" })
    ).toBeNull();
    expect(paperBlockInstruction({ block: "hyouki", level: "N1" })).toBeNull();
  });
});

/**
 * TASK-173.12 AC#1. Each 大問 a real paper can fill must list only item types
 * whose MATERIAL has the shape its official ねらい asks for. The ねらい column is
 * quoted verbatim from the Foundation's current レベル別 大問のねらい PDFs
 * (`doc-26` §1: `n5_revised.pdf`, `n4_revised.pdf`, `n3.pdf`, `n2.pdf`,
 * `n1_revised.pdf`), read with `pdftotext -layout -enc UTF-8`. The wording is the
 * same at every level for these four blocks, so it is quoted once here rather than
 * repeated per level.
 *
 * This is the guard TASK-173.2 deferred: 文の文法1's ねらい is 文の内容に合った文法形式か
 * どうかを判断する, which a `conjugation` item does not ask. A conjugation item names
 * one written word and offers inflected forms, so it carried word material with no
 * sentence into the block. The regression this pins is that `conjugation` is now in
 * NO filled block's item types: a `real` paper does not ask it at all (the block walk
 * is the only real-mode allocation), and `hyouki`/表記, whose ねらい is the kana→kanji
 * spelling of one word, carries only `word-spelling` (TASK-173.9.25) because
 * varying an inflection is not spelling a word.
 */
describe("paper block ねらい match their item material (TASK-173.12 AC#1)", () => {
  const filledBlocks: readonly {
    block: PaperBlockId;
    itemTypes: readonly ItemType[];
    nerai: string;
  }[] = [
    {
      block: "kanji-yomi",
      itemTypes: ["kanji-reading"],
      nerai: "漢字で書かれた語の読み方を問う",
    },
    {
      block: "bunmi-kitei",
      itemTypes: ["context-cloze"],
      nerai: "文脈によって意味的に規定される語が何であるかを問う",
    },
    {
      block: "bun-no-bunpou-1",
      itemTypes: ["grammar-form", "particle"],
      nerai: "文の内容に合った文法形式かどうかを判断することができるかを問う",
    },
    {
      // TASK-173.9.24: 文章の文法 asks whether a SENTENCE fits the flow of the
      // passage. The ねらい is worded identically at all five levels (n1_revised.pdf
      // 読解 大問7, n2.pdf 大問9, n3.pdf 大問3, n4_revised.pdf and n5_revised.pdf
      // 大問3), so no level wording has to be picked. `discourse-cloze` is the only
      // kind with that material: one authored 文章 holding one ＿＿ and four candidate
      // SENTENCES, judged on coherence, not on the form a 文の文法1 小問 asks.
      block: "bunshou-no-bunpou",
      itemTypes: ["discourse-cloze"],
      nerai: "文章の流れに合った文かどうかを判断することができるかを問う",
    },
    {
      // TASK-173.9.26: 語形成 asks what the learner knows about 派生語 and
      // 複合語 (n2.pdf 文字・語彙 大問3 - the 2018 N2V sample fills the block as
      // one kanji completing a printed compound, so the 複合語 half is the shape
      // the store authors to). `compound-completion` carries exactly that
      // material: a sentence printing the compound's fragment beside a （　）
      // and four single kanji, one of which completes an attested compound.
      block: "goseikei",
      itemTypes: ["compound-completion"],
      nerai: "派生語や複合語の知識を問う",
    },
    {
      // TASK-173.9.27: 言い換え類義 asks what is meaning-close to the printed
      // word or expression (n1_revised.pdf 文字・語彙 大問3 - the wording is
      // identical at n2.pdf 大問5, n3.pdf 大問4, n4_revised.pdf and
      // n5_revised.pdf 大問4, so ONE ねらい covers all five levels). The 大問
      // prints two shapes: `synonym-paraphrase` is the word form (one
      // 「　」-bracketed word plus four paraphrases) at N1/N2/N3, and
      // `sentence-paraphrase` is the whole-sentence form (one ＿＿＿-underlined
      // sentence plus four complete sentences) at N4/N5. Each level routes
      // exactly one of them through its blueprint row.
      block: "iikae-ruiji",
      itemTypes: ["sentence-paraphrase", "synonym-paraphrase"],
      nerai: "出題される語や表現と意味的に近い語や表現を問う",
    },
    {
      block: "bun-no-bunpou-2",
      itemTypes: ["star-ordering"],
      nerai:
        "統語的に正しく、かつ、意味が通る文を組み立てることができるかを問う",
    },
    {
      // TASK-173.7: 内容理解（短文） asks the learner to read a short passage
      // and answer what it says. Only N5 has a sourced 短文 store today, so the
      // ねらい is the N5 wording (n5_revised.pdf 読解 大問4); the higher levels
      // differ only in the character count. `short-reading` carries the passage
      // plus a Japanese comprehension stem and options, which is the material
      // this ねらい asks for.
      block: "naiyou-rikai-tanbun",
      itemTypes: ["short-reading"],
      nerai: "80字程度のテキストを読んで、内容が理解できるかを問う",
    },
    {
      // TASK-173.9.7: 情報検索 asks the reader to pick one fact out of one
      // notice. The ねらい is the N5 wording (n5_revised.pdf 読解 大問6); N4
      // prints the same sentence with 400字程度, so only the count differs.
      // `info-search` carries ONE 案内 document plus one Japanese lookup
      // question against it, which is the material this ねらい asks for. It is
      // NOT the multi-document 統合理解 (tougou-rikai), whose own kind
      // `text-comparison` was minted for in TASK-173.9.3.
      block: "jouhou-kensaku",
      itemTypes: ["info-search"],
      nerai:
        "案内やお知らせなど書き下ろした250字程度の情報素材の中から必要な情報を探し出すことができるかを問う",
    },
    {
      // TASK-173.9.3: 統合理解 prints TWO texts and asks what emerges from
      // 読み比べる them. `text-comparison` is the only kind with that material:
      // two passage stimuli (`STIMULUS_REQUIREMENTS.minPassages: 2`) and four
      // options whose key is the topic both documents print. The ねらい is the
      // N1 wording (n1_revised.pdf 読解 大問11); N2 大問12 prefixes
      // 比較的平易な内容の over the same 合計600字程度, so only that differs.
      block: "tougou-rikai",
      itemTypes: ["text-comparison"],
      nerai:
        "複数のテキスト（合計600字程度）を読み比べて、比較・統合しながら理解できるかを問う",
    },
  ];

  const itemTypesOf = (block: PaperBlockId): readonly ItemType[] => {
    // TASK-173.9.28: one 大問 can route a different form per level (言い換え類義
    // prints the word form at N1/N2/N3 and the whole-sentence form at N4/N5), so
    // what the 大問 may ask is the union of every level's row, not the first row
    // found. Every other block is routed the same at all its levels, so the union
    // is the single set they already shared.
    const itemTypes: ItemType[] = [];
    let printed = false;
    for (const level of PAPER_LEVELS) {
      for (const row of PAPER_BLOCKS[level]) {
        if (row.id !== block) {
          continue;
        }
        printed = true;
        for (const itemType of row.itemTypes) {
          if (!itemTypes.includes(itemType)) {
            itemTypes.push(itemType);
          }
        }
      }
    }
    if (!printed) {
      throw new Error(`${block} is printed by no level`);
    }
    // Sorted, because the union is a set: which level was walked first is not a
    // fact about the 大問.
    return itemTypes.sort();
  };

  it("routes every 言い換え類義 大問 to exactly one form, the form the paper at that level prints", () => {
    // The shape (`PAPER_BLOCK_SHAPES`) carries both forms because one ねらい covers
    // both; the level is what decides which one a learner sees. A 大問 that carried
    // both into allocation would split its 小問 across a word and a sentence, which
    // is a paper nobody printed (n4_revised.pdf and n5_revised.pdf 文字・語彙 大問4
    // ask the sentence form; n1_revised/n2/n3 ask the word form).
    const expectedFormByLevel = {
      N1: "synonym-paraphrase",
      N2: "synonym-paraphrase",
      N3: "synonym-paraphrase",
      N4: "sentence-paraphrase",
      N5: "sentence-paraphrase",
    } as const satisfies Record<PaperLevel, ItemType>;
    for (const level of PAPER_LEVELS) {
      const rows = PAPER_BLOCKS[level].filter(
        (row) => row.id === "iikae-ruiji"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.itemTypes).toEqual([expectedFormByLevel[level]]);
    }
  });

  it("quotes a ねらい that is the paper's own wording: no Latin script", () => {
    for (const row of filledBlocks) {
      // A Latin letter means this stopped being a transcription of the PDF and
      // became a paraphrase, which is the from-recall failure the source rule exists
      // to stop.
      expect(row.nerai).not.toMatch(LATIN_SCRIPT_RE);
      expect(row.nerai).toContain("問う");
    }
  });

  it("lists, for every filled 大問, only the item types whose material that ねらい asks for", () => {
    for (const row of filledBlocks) {
      expect(itemTypesOf(row.block)).toEqual(row.itemTypes);
    }
  });

  it("keeps conjugation out of every filled 大問, so a real paper never asks word material under a 文法 form ねらい", () => {
    // The misfiling TASK-173.2 pinned as intended and TASK-173.12 removes: conjugation
    // must appear in no block's item types at any level, because the block walk is the
    // only real-mode allocation and there is no real 大問 whose ねらい a conjugation
    // item answers.
    for (const level of PAPER_LEVELS) {
      for (const row of PAPER_BLOCKS[level]) {
        expect(row.itemTypes).not.toContain("conjugation");
      }
    }
    // Its grammar-reading flat weight is untouched, so the daily shortened mode still
    // emits it: the type is not gone from the engine, only from the real paper.
    expect(
      PAPER_ITEM_TYPE_WEIGHTS_V2.N5["grammar-reading"]?.conjugation
    ).toBeGreaterThan(0);
  });

  it("names 表記 and its `word-spelling` material, so conjugation's absence is a decision not a gap", () => {
    // 表記's ねらい (n5_revised.pdf 文字・語彙 大問2) is the spelling of ONE kana
    // word. Since TASK-173.9.25 the block carries `word-spelling`, the one kind
    // whose material is exactly that, so a real section no longer names 表記 as a
    // hole. A `conjugation` item varies an inflection across its options, which is
    // not spelling a word, so it stays out of every filled block all the same.
    const hyoukiNerai =
      "ひらがなで書かれた語が、漢字でどのように書かれるかを問う";
    expect(hyoukiNerai).not.toMatch(LATIN_SCRIPT_RE);
    expect(itemTypesOf("hyouki")).toEqual(["word-spelling"]);
    expect(
      paperUnfillableBlocks({
        budget: paperSectionIndicativeCount({
          level: "N5",
          section: "vocabulary",
        }),
        level: "N5",
        section: "vocabulary",
      }).map((block) => block.id)
    ).not.toContain("hyouki");
  });
});

const PAPER_LEVEL_PASS_MARKS = {
  N1: PAPER_BLUEPRINTS.N1.overallPassMark,
  N2: PAPER_BLUEPRINTS.N2.overallPassMark,
  N3: PAPER_BLUEPRINTS.N3.overallPassMark,
  N4: PAPER_BLUEPRINTS.N4.overallPassMark,
  N5: PAPER_BLUEPRINTS.N5.overallPassMark,
};
