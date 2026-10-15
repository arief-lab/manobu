import { describe, expect, it } from "bun:test";

import { CONJUGATION_SWEEP, deinflect, matchTarget } from "@/lib/deinflect";

/*
 * Mirrors crates/jlpt-mcp/src/deinflect.rs unit tests (TASK-23.27) — same
 * cases, so drift between the TS port and the Rust table fails loudly here.
 */

const forms = (query: string): string[] => deinflect(query).map((d) => d.form);

describe("deinflect (TS port parity)", () => {
  it("polite and polite past", () => {
    expect(forms("食べました")).toContain("食べる");
    expect(forms("買いました")).toContain("買う");
    expect(deinflect("食べました")[0]?.reason).toBe("PolitePast");
    expect(forms("食べます")).toContain("食べる");
  });

  it("past plain and onbin", () => {
    expect(forms("食べた")).toContain("食べる");
    expect(forms("飲んだ")).toContain("飲む");
    expect(forms("行った")).toContain("行く");
    expect(forms("話した")).toContain("話す");
  });

  it("adjective past and negative", () => {
    expect(forms("高かった")).toContain("高い");
    expect(forms("高くない")).toContain("高い");
    expect(forms("寒くなかった")).toContain("寒い");
  });

  it("verb negative godan a-column", () => {
    expect(forms("買わない")).toContain("買う");
    expect(forms("食べない")).toContain("食べる");
  });

  it("te-form onbin", () => {
    expect(forms("食べて")).toContain("食べる");
    expect(forms("飲んで")).toContain("飲む");
    expect(forms("泳いで")).toContain("泳ぐ");
    expect(forms("待って")).toContain("待つ");
  });

  it("conditional", () => {
    expect(forms("食べれば")).toContain("食べる");
    expect(forms("高ければ")).toContain("高い");
  });

  it("volitional", () => {
    expect(forms("食べよう")).toContain("食べる");
    expect(forms("行こう")).toContain("行く");
    expect(forms("しよう")).toContain("する");
  });

  it("want-to", () => {
    expect(forms("食べたい")).toContain("食べる");
    expect(forms("行きたかった")).toContain("行く");
  });

  it("potential passive causative", () => {
    expect(forms("食べられる")).toContain("食べる");
    expect(forms("食べさせる")).toContain("食べる");
  });

  it("irregular", () => {
    expect(forms("しました")).toContain("する");
    const kuru = forms("来ました");
    expect(kuru.some((f) => f === "くる" || f === "来る")).toBe(true);
  });

  it("polite negative past (drill-critical case)", () => {
    expect(forms("飲みませんでした")).toContain("飲む");
    expect(forms("食べません")).toContain("食べる");
  });

  it("polite potential (e-row masu stem)", () => {
    expect(forms("泳げます")).toContain("泳ぐ");
  });

  it("noun, or unknown yields nothing", () => {
    // mirrors Rust noun_or_unknown_yields_nothing exactly (選挙/パソコン/"").
    // Dictionary-form inputs are NOT empty on either side: the TASK-54
    // update made deinflect("食べる") emit the bare-potential pair
    // [食べる, 食ぶ] in both implementations (over-generation is safe —
    // the engine validates against the corpus; matchTarget skips identity
    // candidates). That behavior is pinned in the next test.
    expect(deinflect("選挙")).toHaveLength(0);
    expect(deinflect("パソコン")).toHaveLength(0);
    expect(deinflect("")).toHaveLength(0);
  });

  it("dictionary-form input emits the bare-potential pair (TASK-54 parity)", () => {
    expect(forms("食べる")).toEqual(["食べる", "食ぶ"]);
    expect(forms("泳げる")).toEqual(["泳げる", "泳ぐ"]);
    // the consumer guard: an identity candidate never grades as
    // "deinflected", and a dictionary-form answer to a te-form prompt
    // stays wrong, not a hint.
    expect(matchTarget("食べて", "食べる").kind).toBe("wrong");
  });

  it("candidates carry POS requirements", () => {
    for (const candidate of deinflect("食べました")) {
      expect(["verb", "adjective"]).toContain(candidate.requiredPos);
    }
  });
});

describe("matchTarget (drill grading)", () => {
  it("exact match", () => {
    expect(matchTarget("食べる", "食べる")).toEqual({ kind: "exact" });
    expect(matchTarget("食べる", " 食べる ")).toEqual({ kind: "exact" });
  });

  it("deinflected match carries reason and dictionary form", () => {
    const result = matchTarget("食べる", "食べました");
    expect(result).toEqual({
      dictionaryForm: "食べる",
      kind: "deinflected",
      reason: "PolitePast",
    });
  });

  it("wrong word stays wrong", () => {
    expect(matchTarget("食べる", "飲みました").kind).toBe("wrong");
    expect(matchTarget("食べる", "選挙").kind).toBe("wrong");
  });

  it("dictionary form is not treated as deinflected", () => {
    expect(matchTarget("食べる", "食べる")).toEqual({ kind: "exact" });
  });
});

describe("TASK-54 conjugation sweep (30 forms, parity with crates/jlpt-mcp)", () => {
  it("every form deinflects back to its target", () => {
    for (const [dictForm, inflectedForms] of CONJUGATION_SWEEP) {
      for (const form of inflectedForms) {
        const m = matchTarget(dictForm, form);
        expect(`${form}→${m.kind}`).not.toBe(`${form}→wrong`);
        if (m.kind === "deinflected") {
          expect(m.dictionaryForm).toBe(dictForm);
        }
      }
    }
  });
  it("verb past-negatives are deinflected, not wrong (TASK-54 core bug)", () => {
    expect(matchTarget("食べる", "食べなかった").kind).toBe("deinflected");
    expect(matchTarget("行く", "行かなかった").kind).toBe("deinflected");
    expect(matchTarget("する", "しなかった").kind).toBe("deinflected");
  });
  it("irregular potentials 行ける/できる deinflect (TASK-54)", () => {
    expect(matchTarget("行く", "行ける")).toEqual({
      dictionaryForm: "行く",
      kind: "deinflected",
      reason: "Potential",
    });
    expect(matchTarget("する", "できる")).toEqual({
      dictionaryForm: "する",
      kind: "deinflected",
      reason: "Potential",
    });
  });
});
