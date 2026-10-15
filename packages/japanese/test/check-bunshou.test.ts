/**
 * TASK-173.9.24 AC#7: the `check:bunshou` gate is pinned with real assertions
 * over `bunshouRowIssues` (the exported per-row screen), not source-text checks.
 * A clean row passes; each defect the gate exists to catch is a separate
 * fixture that must fail. The last group runs the gate over the shipped stores
 * themselves, so a hand-edit that breaks shape is caught here rather than when
 * a learner opens a paper with two defensible answers in it.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BunshouRow, bunshouRowIssues } from "../scripts/check-bunshou";
import { expectNoReusedTexts } from "./reading-reuse-ledger";

const NO_REJECTIONS = new Set<string>();

const N3_STEM =
  "つぎの文章を読んで、文章全体の内容を考えて、＿＿に入る最もよいものを、１・２・３・４から一つえらびなさい。";

/** A row that clears every screen: 4 sentences, one mid-passage blank joined by
 * 、, four distinct in-band options, the level's own instruction line. */
const baseRow = (): BunshouRow => ({
  answerIndex: 0,
  block: "bunshou-no-bunpou",
  construction: "authored",
  evidence: "前の文が店主の心得を述べており、後ろの文がその結果を述べている。",
  id: "n3-b-90",
  key: ["そのほうが客は自分の足で本に出会える"],
  level: "N3",
  options: [
    "そのほうが客は自分の足で本に出会える",
    "だから店主は在庫を減らすことにした",
    "書店は開店して三十年になる",
    "つまり本は高い買いものである",
  ],
  passage:
    "うちの町には小さな書店が一軒だけ残っている。店主は客が本を選ぶじゃまをしないように、声をかけるタイミングを長く考えてきた。＿＿。だから本を探しに来た人が、つい店での立ち話を楽しんでしまうのもよくわかる。",
  provenance: "composed",
  stem: N3_STEM,
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

describe("bunshouRowIssues", () => {
  it("passes a clean row", () => {
    expect(bunshouRowIssues(baseRow(), NO_REJECTIONS)).toEqual([]);
  });

  it("rejects a composed row that claims no blind-cert", () => {
    const row = baseRow();
    row.validated = false;
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain("not-validated");
  });

  it("rejects a row certified by anything other than the two blind passes", () => {
    const row = baseRow();
    row.validatedBy = "authored:draft";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "validatedBy-is-authored:draft"
    );
  });

  it("rejects a row the verdict record rejected", () => {
    expect(bunshouRowIssues(baseRow(), new Set(["n3-b-90"]))).toContain(
      "row-judge-rejected"
    );
  });

  it("rejects a passage with two blanks, which asks two 小問 at once", () => {
    const row = baseRow();
    row.passage = row.passage.replace(
      "声をかけるタイミングを長く考えてきた。",
      "＿＿を長く考えてきた。"
    );
    const issues = bunshouRowIssues(row, NO_REJECTIONS);
    expect(
      issues.some((issue) => issue.startsWith("passage-blank-count-"))
    ).toBe(true);
  });

  it("rejects a passage with no blank at all", () => {
    const row = baseRow();
    row.passage = row.passage.replaceAll("＿＿", "店");
    expect(
      bunshouRowIssues(row, NO_REJECTIONS).some((issue) =>
        issue.startsWith("passage-blank-count-")
      )
    ).toBe(true);
  });

  it("rejects a blank left in the first sentence, where there is no flow to restore", () => {
    const row = baseRow();
    row.passage =
      "＿＿からである。店主は客のじゃまをしないように考えてきた。本を選ぶ時間が客にとっていちばん大切な時間だからである。だから人が立ち話を楽しんでしまうのもよくわかる。";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "blank-in-first-sentence"
    );
  });

  it("rejects a blank in the last sentence, which has no following text", () => {
    const row = baseRow();
    row.passage =
      "うちの町には小さな書店が一軒だけ残っている。店主は客のじゃまをしないように考えてきた。声をかけるタイミングを長く工夫してきた。だから人が立ち話を楽しんでしまうのもよくわかる。＿＿、それが店の流儀である。";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "blank-in-last-sentence"
    );
  });

  it("rejects a blank joined to the text by nothing", () => {
    const row = baseRow();
    row.passage = row.passage.replace("＿＿。", "＿＿が");
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "blank-followed-by-が"
    );
  });

  it("rejects a distractor the passage already prints verbatim", () => {
    const row = baseRow();
    row.options[1] = "小さな書店が一軒だけ残っている";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "option-verbatim-in-passage:小さな書店が一軒だけ残っている"
    );
  });

  it("rejects a fifth option", () => {
    const row = baseRow();
    row.options.push("つまり本は高い買い物である");
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain("options-count-5");
  });

  it("rejects a duplicated option pair, which is a two-answer item in disguise", () => {
    const row = baseRow();
    // The fourth option's own text, written twice: options 2 and 3 now say the
    // same thing, so the item has one answer printed in two slots.
    row.options[2] = "つまり本は高い買いものである";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "options-not-distinct"
    );
  });

  it("rejects an option that carries the blank marker itself", () => {
    const row = baseRow();
    row.options[2] = "＿＿について考える必要がある";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "option-carries-blank:＿＿について考える必要がある"
    );
  });

  it("rejects an option that ends in a full stop, which the paper never prints", () => {
    const row = baseRow();
    row.options[3] = "つまり本は高い買いものである。";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "option-ends-with-period:つまり本は高い買いものである。"
    );
  });

  it("rejects a key that is not options[0]", () => {
    const row = baseRow();
    row.key = ["つまり本は高い買いものである"];
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain("key-not-options-0");
  });

  it("rejects a row whose answerIndex was moved off the frozen key slot", () => {
    const row = baseRow();
    row.answerIndex = 2;
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain("answerIndex-2");
  });

  it("rejects a stem that drifted from this level's official instruction line", () => {
    const row = baseRow();
    row.stem =
      "次の文章を読んで、＿＿に入る最もよいものを、１・２・３・４から一つ選びなさい。";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "stem-not-official-instruction-line"
    );
  });

  it("rejects a row filed under another 大問's block", () => {
    const row = baseRow();
    row.block = "bun-no-bunpou-2";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "block-is-bun-no-bunpou-2"
    );
  });

  it("rejects a passage outside its level's length band", () => {
    const row = baseRow();
    row.passage = "短い。＿＿、続き。店が残っている。";
    expect(
      bunshouRowIssues(row, NO_REJECTIONS).some((issue) =>
        issue.startsWith("passage-")
      )
    ).toBe(true);
  });

  it("rejects an option outside its level's length band", () => {
    const row = baseRow();
    row.options[3] = "短";
    expect(
      bunshouRowIssues(row, NO_REJECTIONS).some((issue) =>
        issue.startsWith("option-")
      )
    ).toBe(true);
  });

  it("rejects Latin script in the authored material", () => {
    const row = baseRow();
    row.options[2] = "タイミングは timing の問題である";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain("latin-in-option2");
  });

  it("rejects a simplified-Chinese-only form in the passage", () => {
    const row = baseRow();
    row.passage = row.passage.replace("タイミング", "时間");
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "simplified-hanzi-in-passage"
    );
  });

  it("accepts the ordinary Japanese kanji a naive hanzi screen would ban", () => {
    const row = baseRow();
    row.passage = row.passage.replace("店での立ち話", "写真と机と医院の話題");
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toEqual([]);
  });

  it("rejects evidence that is not a Japanese sentence", () => {
    const row = baseRow();
    row.evidence = "cue";
    expect(bunshouRowIssues(row, NO_REJECTIONS)).toContain(
      "evidence-not-one-japanese-sentence"
    );
  });
});

describe("the shipped 文章の文法 stores", () => {
  const DATA_DIR = join(import.meta.dir, "..", "data", "reading");

  for (const level of ["N3", "N2", "N1"]) {
    it(`holds ${level} rows that all clear the gate`, () => {
      const rows = JSON.parse(
        readFileSync(
          join(DATA_DIR, `${level.toLowerCase()}-bunshou.json`),
          "utf8"
        )
      ) as BunshouRow[];
      const rejected = JSON.parse(
        readFileSync(
          join(DATA_DIR, `${level.toLowerCase()}-bunshou-rejected.json`),
          "utf8"
        )
      ) as { rejectedIds: string[] }[];
      const rejectedIds = new Set(
        rejected.flatMap((record) => record.rejectedIds ?? [])
      );
      expect(rows.length).toBeGreaterThanOrEqual(20);
      for (const row of rows) {
        expect(bunshouRowIssues(row, rejectedIds)).toEqual([]);
      }
    });
  }

  it("never spends one passage or one option twice across the three levels", () => {
    const rowSets = ["N3", "N2", "N1"].map(
      (level) =>
        JSON.parse(
          readFileSync(
            join(DATA_DIR, `${level.toLowerCase()}-bunshou.json`),
            "utf8"
          )
        ) as BunshouRow[]
    );
    expectNoReusedTexts(rowSets, (row) => [row.passage, ...row.options]);
  });
});
