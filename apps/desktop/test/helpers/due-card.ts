import type { DueCard } from "@manobu/api-contract/schemas/cards";

/** A `GET /cards/due` row as the sidecar serves one: `review` state with a
 *  graded D/S, unless the caller overrides. */
export const makeDueCard = (over: Partial<DueCard> = {}): DueCard => ({
  createdAt: "2026-09-01",
  difficulty: 5,
  due: "2026-09-05",
  id: 12,
  isLeech: false,
  jp: "食べる",
  lapses: 0,
  level: "n5",
  reading: "たべる",
  stability: 10,
  state: "review",
  vocabId: 10,
  ...over,
});
