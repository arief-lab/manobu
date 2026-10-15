import { describe, expect, it } from "bun:test";
import type { Question } from "../src/lib/mock";
import { offlinePaperCard, offlinePaperItems } from "../src/lib/paper-fallback";

const questions: readonly Question[] = [
  {
    choiceIds: ["a", "b", "c", "d"],
    choices: { a: "です", b: "だ", c: "でした", d: "ではありません" },
    correctId: "a",
    grammarId: "n5-desu",
    id: "q1",
    prompt: "これは本__。",
  },
  {
    choiceIds: ["a", "b", "c", "d"],
    choices: { a: "8時間", b: "12時間", c: "24時間", d: "48時間" },
    correctId: "c",
    grammarId: "reading-info-retrieval",
    id: "q2",
    prompt: "何時間ですか。",
    section: "reading",
  },
];

describe("offline paper fallback", () => {
  it("returns a non-empty honest paper without a client answer key", () => {
    const card = offlinePaperCard("N5", questions);
    const items = offlinePaperItems("N5", questions);
    expect(card.total).toBe(2);
    expect(card.validated).toBe(2);
    expect(card.offline).toBe(true);
    expect(card.phase).toBe("ready");
    expect(card.sections.map((section) => section.id)).toEqual([
      "vocabulary",
      "grammar-reading",
    ]);
    expect(JSON.stringify({ card, items })).not.toContain("correctId");
    expect(items.every((item) => item.options.length === 4)).toBe(true);
  });
});
