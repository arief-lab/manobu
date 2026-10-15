import { createHash } from "node:crypto";

import type { ItemType, QuestionItem } from "@manobu/item-engine/types";
import type {
  DrillBatchProvider,
  DrillBatchRequest,
  DrillBatchResponse,
} from "./drill-lifecycle";
import { generateNextCards } from "./next-cards";

const MAX_CORPUS_CARDS = 120;

const stableItemId = (
  level: string,
  seed: string,
  vocabId: number,
  variant = "base"
): string =>
  `drill-${level.toLowerCase()}-${vocabId}-${createHash("sha256")
    .update(`${seed}:${level}:${vocabId}:${variant}`)
    .digest("hex")
    .slice(0, 12)}`;

const itemFromCards = (
  cards: Awaited<ReturnType<typeof generateNextCards>>,
  index: number,
  level: string,
  seed: string,
  itemType: ItemType,
  adaptation?: "near-neighbour" | "worked-example"
): QuestionItem | null => {
  const target = cards[index];
  const distractors = cards
    .filter((_, candidateIndex) => candidateIndex !== index)
    .map((card) => card.jp)
    .filter(
      (value, candidateIndex, values) =>
        values.indexOf(value) === candidateIndex
    )
    .slice(0, 3);
  if (!target || distractors.length < 3) {
    return null;
  }
  let prompt = "Choose the matching word.";
  if (adaptation === "worked-example") {
    prompt = `Worked example: choose the matching word for ${target.jp}.`;
  } else if (adaptation === "near-neighbour") {
    prompt = "Choose the near neighbour that completes the meaning.";
  }
  return {
    anchors: [`vocab:${level}:${target.vocabId}`],
    answerIndex: 0,
    explanation: null,
    fsrsVocabId: null,
    id: stableItemId(level, seed, target.vocabId, adaptation ?? "base"),
    itemType,
    level,
    options: [target.jp, ...distractors],
    passage: null,
    prompt,

    seedPart: seed,
    surface: "drill",
  };
};

export const createCorpusDrillBatchProvider = (): DrillBatchProvider => ({
  produce: async (request: DrillBatchRequest): Promise<DrillBatchResponse> => {
    const types = Object.entries(request.remainingTypeAllowance)
      .filter(([, allowance]) => allowance > 0)
      .sort(([, left], [, right]) => right - left)
      .map(([itemType]) => itemType as ItemType);
    if (types.length === 0) {
      return { exhausted: true, items: [] };
    }
    const cards = await generateNextCards(
      request.level,
      Math.min(MAX_CORPUS_CARDS, Math.max(request.count * 4, 8))
    );
    const excluded = new Set(request.excludedItemIds);
    const ordered = [
      ...cards.filter((card) =>
        request.anchors.includes(`vocab:${request.level}:${card.vocabId}`)
      ),
      ...cards.filter(
        (card) =>
          !request.anchors.includes(`vocab:${request.level}:${card.vocabId}`)
      ),
    ];
    const items = ordered
      .map((_, index) =>
        itemFromCards(
          ordered,
          index,
          request.level,
          request.seed,
          types[index % types.length] ?? "word-in-context",
          request.adaptation
        )
      )
      .filter((item): item is QuestionItem => item !== null)
      .filter((item) => !excluded.has(item.id))
      .slice(0, request.count);
    return { exhausted: items.length < request.count, items };
  },
});
