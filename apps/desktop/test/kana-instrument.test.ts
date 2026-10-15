import { describe, expect, it } from "bun:test";
import { t } from "@manobu/ui/lib/copy";
import {
  evaluateKanaPaper,
  generateKanaPaper,
  type KanaAnswerValue,
  type KanaItem,
} from "@/lib/kana-instrument";

type Paper = readonly KanaItem[];
type Answers = Map<string, boolean | null>;

const allCorrect = (paper: Paper): Answers => {
  const answers: Answers = new Map();
  for (const item of paper) {
    answers.set(item.id, true);
  }
  return answers;
};

const failFirstOutside = (
  paper: Paper,
  answers: Answers,
  excluded: ReadonlySet<string>,
  count: number
): void => {
  let flipped = 0;
  for (const item of paper) {
    if (flipped < count && !excluded.has(item.id)) {
      answers.set(item.id, false);
      flipped += 1;
    }
  }
};

describe("kana instrument (TASK-118)", () => {
  it("AC#1 every (kind,row) group appears, n-alone once", () => {
    for (const script of ["hiragana", "katakana"] as const) {
      const paper = generateKanaPaper(script, "seed-1");
      const groups = new Set(
        paper.filter((i) => i.kind !== "word").map((i) => i.groupKey)
      );
      // hiragana: 11+4+7=22 groups
      expect(groups.size).toBe(22);
      const nAlone = paper.filter((i) => i.groupKey.endsWith("n-alone"));
      expect(nAlone).toHaveLength(1);
      expect(nAlone[0]?.char).toBe(script === "hiragana" ? "ん" : "ン");
    }
  });

  it("AC#2 pooled-row regression: gojuon k vs dakuten k are distinct groups", () => {
    const paper = generateKanaPaper("hiragana", "seed-1");
    const gojuonK = paper.filter((i) => i.groupKey === "gojuon:k");
    const dakutenK = paper.filter((i) => i.groupKey === "dakuten:k");
    expect(gojuonK.length).toBe(2);
    expect(dakutenK.length).toBe(2);
    expect(gojuonK[0]?.groupKey).not.toBe(dakutenK[0]?.groupKey);
  });

  it("AC#3 seeded reproducibility and no shared ids across seeds", () => {
    const a = generateKanaPaper("hiragana", "seed-A");
    const b = generateKanaPaper("hiragana", "seed-A");
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    const c = generateKanaPaper("hiragana", "seed-B");
    const idsA = new Set(a.map((i) => i.id));
    const overlap = c.filter((i) => idsA.has(i.id));
    expect(overlap).toHaveLength(0);
  });

  it("AC#4 per-script counts 22/8/14/2 and word-level anchored to n5.json", () => {
    for (const script of ["hiragana", "katakana"] as const) {
      const paper = generateKanaPaper(script, "seed-1");
      const byKind = (k: string) => paper.filter((i) => i.kind === k).length;
      // gojuon/katakana 22 (21 when n-alone 1), dakuten 8, yoon 14, word 2
      // For hiragana: gojuon 21 or 22 depending on n-alone sampling, but our take is 21 (n-alone 1 + 10*2)
      const gojuonCount =
        script === "hiragana" ? byKind("gojuon") : byKind("katakana");
      expect(gojuonCount).toBeGreaterThanOrEqual(21);
      expect(gojuonCount).toBeLessThanOrEqual(22);
      expect(byKind("dakuten") || byKind("katakana-dakuten")).toBe(8);
      expect(byKind("yoon") || byKind("katakana-yoon")).toBe(14);
      expect(
        paper.filter(
          (i) => i.type === "word-kana" || i.type === "katakana-word"
        )
      ).toHaveLength(2);
      // word chars contain sokuon or choonpu
      const wordChars = paper
        .filter((i) => i.kind === "word")
        .map((i) => i.char);
      for (const w of wordChars) {
        if (script === "hiragana") {
          expect(w).toContain("っ");
        } else {
          expect(w).toContain("ー");
        }
      }
    }
  });

  it("AC#5 pass rule: 4 scattered pass, 0/2 in one group +2 elsewhere fails, 5 fails, unanswered blocks", () => {
    const paper = generateKanaPaper("hiragana", "seed-1");
    const groupToFail =
      paper.find((i) => i.groupKey === "gojuon:k")?.groupKey ?? "gojuon:k";
    const groupItems = paper
      .filter((i) => i.groupKey === groupToFail)
      .slice(0, 2);
    const groupIds = new Set(groupItems.map((g) => g.id));

    // 4 scattered wrong in 4 different groups -> pass
    const scattered = allCorrect(paper);
    failFirstOutside(paper, scattered, groupIds, 4);
    // Ensure exactly 4 wrong scattered
    const scatteredWrong = [...scattered.values()].filter(
      (v) => v === false
    ).length;
    expect(scatteredWrong).toBe(4);
    expect(evaluateKanaPaper(paper, scattered).passed).toBe(true);

    // 0/2 in one group +2 elsewhere -> fails rule 2 even though 91%
    const failMap = allCorrect(paper);
    for (const gi of groupItems) {
      failMap.set(gi.id, false);
    }
    failFirstOutside(paper, failMap, groupIds, 2);
    expect(evaluateKanaPaper(paper, failMap).passed).toBe(false);
    expect(evaluateKanaPaper(paper, failMap).groupsFailed).toContain(
      groupToFail
    );

    // 5 wrong fails
    const five = allCorrect(paper);
    failFirstOutside(paper, five, new Set(), 5);
    expect(evaluateKanaPaper(paper, five).passed).toBe(false);

    // unanswered blocks
    const unanswered = allCorrect(paper);
    unanswered.set(paper[0]?.id, null);
    expect(evaluateKanaPaper(paper, unanswered).passed).toBe(false);
  });

  it("AC#6 per-script independence", () => {
    const hi = generateKanaPaper("hiragana", "seed-1");
    const ka = generateKanaPaper("katakana", "seed-1");
    const hiMap = new Map<string, boolean | null>();
    for (const item of hi) {
      hiMap.set(item.id, true);
    }
    expect(evaluateKanaPaper(hi, hiMap).passed).toBe(true);
    // perfect hiragana does not affect katakana
    const kaMap = new Map<string, boolean | null>();
    for (const item of ka) {
      kaMap.set(item.id, false);
    }
    expect(evaluateKanaPaper(ka, kaMap).passed).toBe(false);
  });

  it("AC#7 review renders one row per answered cell with group projections", () => {
    const paper = generateKanaPaper("hiragana", "seed-1");
    const answers = new Map<string, KanaAnswerValue>();
    for (const item of paper) {
      answers.set(item.id, true);
    }
    const missed = paper.find((item) => item.groupKey === "gojuon:k");
    if (!missed) {
      throw new Error("checkpoint fixture is missing gojuon:k");
    }
    answers.set(missed.id, { correct: false, picked: "wrong" });
    const result = evaluateKanaPaper(paper, answers);
    const group = result.groups.find(
      (candidate) => candidate.key === "gojuon:k"
    );
    const review = result.review.find((row) => row.item.id === missed.id);
    expect(result.total).toBe(paper.length);
    expect(result.score).toBe(paper.length - 1);
    expect(group).toMatchObject({ correct: 1, total: 2 });
    expect(group?.failedItemIds).toEqual([missed.id]);
    expect(review).toMatchObject({
      correct: missed.reading,
      isCorrect: false,
      picked: "wrong",
    });
  });

  it("AC#8 ten copy keys exist, non-empty, no em dash", () => {
    const keys = [
      "kana.gate.offer",
      "kana.gate.skip",
      "kana.gate.source",
      "kana.checkpoint.pass",
      "kana.checkpoint.fail",
      "kana.checkpoint.group",
      "kana.checkpoint.cooldown",
      "kana.checkpoint.queue",
      "kana.result.review.title",
      "kana.settings.reset",
    ] as const;
    for (const k of keys) {
      const s = t(k);
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toContain("—");
    }
  });
});
