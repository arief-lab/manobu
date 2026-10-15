/**
 * TASK-173.9.23.1 AC#5: the `check:usage` gate is pinned with REAL assertions
 * over `usageRowIssues` (the exported per-row screen), not source-text checks.
 * A clean row passes; each defect the gate exists to catch is a separate
 * fixture that must fail.
 */

import { describe, expect, it } from "bun:test";
import {
  type GrammarRow,
  type UsageRow,
  usageRowIssues,
} from "../scripts/check-usage";

const GRAMMAR: GrammarRow[] = [
  {
    examples: [
      {
        english: "x",
        japanese: "日本語は勉強すればするほど面白くなる。",
        source: "original",
      },
    ],
    id: "hodo",
    level: "N3",
    pattern: "V plain non-past + ほど",
  },
];

const byId = new Map(GRAMMAR.map((r) => [r.id, r]));
const NO_REJECTIONS = new Set<string>();

const baseRow = (): UsageRow => ({
  answerIndex: 0,
  block: "youhou",
  construction: "authored",
  evidence: "ほど",
  id: "n3-u-01",
  key: ["ほど"],
  level: "N3",
  options: ["ほど", "なく", "ばかり", "しか"],
  passage: "日本語は勉強すればする＿＿面白くなる。",
  provenance: "composed",
  sourceIds: ["hodo"],
  stem: "つぎの文の（  ）に入れるのに、いちばん 適切 なものを、１・２・３・４から一つ えらびなさい。",
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

describe("usageRowIssues", () => {
  it("passes a clean row", () => {
    expect(usageRowIssues(baseRow(), byId, NO_REJECTIONS)).toEqual([]);
  });

  it("rejects an unvalidated row", () => {
    const row = baseRow();
    row.validated = false;
    expect(usageRowIssues(row, byId, NO_REJECTIONS)).toContain("not-validated");
  });

  it("rejects a row the judge verdicts rejected", () => {
    const rejected = new Set<string>(["n3-u-01"]);
    expect(usageRowIssues(baseRow(), byId, rejected)).toContain(
      "row-judge-rejected"
    );
  });

  it("rejects a key that is not the pattern's own form", () => {
    const row = baseRow();
    row.options = ["なく", "ほど", "ばかり", "しか"];
    row.key = ["なく"];
    // なく occurs 0x in the example, so the occurrences screen also fires.
    expect(usageRowIssues(row, byId, NO_REJECTIONS)).not.toEqual([]);
  });

  it("rejects a distractor that is a substring of the key", () => {
    const row = baseRow();
    row.options = ["ばかりでなく", "ばかり", "なく", "しか"];
    row.key = ["ばかりでなく"];
    expect(usageRowIssues(row, byId, NO_REJECTIONS)).toContain(
      "distractor-is-substring-of-key:ばかり"
    );
  });

  it("rejects a repeated option", () => {
    const row = baseRow();
    row.options = ["ほど", "なく", "なく", "しか"];
    expect(usageRowIssues(row, byId, NO_REJECTIONS)).toContain(
      "options-not-distinct"
    );
  });

  it("rejects a passage with more than one blank", () => {
    const row = baseRow();
    row.passage = "日本語は＿＿勉強すればする＿＿面白くなる。";
    expect(usageRowIssues(row, byId, NO_REJECTIONS)).toContain(
      "passage-blank-count-not-1"
    );
  });
});
