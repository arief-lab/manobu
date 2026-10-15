/**
 * TASK-173.9.29 AC#5: the `check:kitei` gate is pinned with real assertions
 * over `kiteiRowIssues` (the exported per-row screen), not source-text checks.
 * A clean row passes; each defect the gate exists to catch is a separate
 * fixture that must fail. The last group runs the gate over all three shipped
 * stores, so a hand-edit that breaks shape is caught here rather than when a
 * learner opens a paper whose blank four words could all defensibly fill.
 *
 * 文脈規定 is NOT mechanically certifiable the way 語形成 was: the corpus
 * cannot say which word the CONTEXT pins, only which words the learner has met.
 * So this gate screens the falsifiable half (the blank, the sentence, the
 * option set against the bands at or below the level, the POS family, the
 * evidence reconstruction, the stamps, the orthography) and the two blind
 * judge passes certify the half no corpus can see. The fixtures below are all
 * about the falsifiable half, and the leak fixture is the one the assembly
 * would otherwise drop in silence: a 文脈規定 passage may print NONE of its
 * four options, not merely not the answer, because printing a distractor
 * narrows the elimination the 小問 exists to test.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type KiteiRow,
  kiteiRowIssues,
  posAtOrBelow,
} from "../scripts/check-kitei";
import { expectNoReusedTexts } from "./reading-reuse-ledger";

const NO_REJECTIONS = new Set<string>();

/** The N3 instruction line, transcribed from N3V.pdf p.3 問題３ rather than
 * imported from the gate, so a drift in `KITEI_STEMS` fails here instead of
 * being agreed with itself. Note 選: the N3 paper writes えらびなさい. */
const N3_STEM =
  "（　）に入れるのに最もよいものを、１・２・３・４から一つえらびなさい。";

/** The N2 and N1 papers write the same line with the kanji 選びなさい
 * (N2V.pdf p.4 問題４, N1V.pdf 問題２). */
const N21_STEM =
  "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。";

/** A row that clears every screen: the shipped n3-k-001 shape written out here
 * so the test does not grade the store against itself. One （　） in an adult
 * sentence, four distinct attested N3 nouns (so the POS family holds), 予約
 * first as the answer, and a passage printing none of the four options. */
const baseRow = (): KiteiRow => ({
  answerIndex: 0,
  block: "bunmi-kitei",
  construction: "authored",
  evidence:
    "有名レストランの席を予約しておいたから、土曜の夜でも安心して入れる。",
  id: "n3-k-900",
  key: ["予約"],
  level: "N3",
  options: ["予約", "会議", "授業", "旅行"],
  passage:
    "有名レストランの席を（　）しておいたから、土曜の夜でも安心して入れる。",
  provenance: "composed",
  stem: N3_STEM,
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

/** The same shape at N2, on the 選びなさい line. */
const baseRowN2 = (): KiteiRow => ({
  answerIndex: 0,
  block: "bunmi-kitei",
  construction: "authored",
  evidence: "価格を上げたのに、客足にはまるで影響が出ず、店長は拍子抜けした。",
  id: "n2-k-900",
  key: ["影響"],
  level: "N2",
  options: ["影響", "面積", "時間", "回数"],
  passage: "価格を上げたのに、客足にはまるで（　）が出ず、店長は拍子抜けした。",
  provenance: "composed",
  stem: N21_STEM,
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

const n3 = posAtOrBelow("N3");
const n2 = posAtOrBelow("N2");

describe("kiteiRowIssues", () => {
  it("passes a clean N3 row", () => {
    expect(kiteiRowIssues(baseRow(), NO_REJECTIONS, n3)).toEqual([]);
  });

  it("passes a clean N2 row", () => {
    expect(kiteiRowIssues(baseRowN2(), NO_REJECTIONS, n2)).toEqual([]);
  });

  it("rejects a row whose construction is not authored", () => {
    const row = baseRow();
    row.construction = "sourced";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "construction-is-sourced"
    );
  });

  it("rejects a row that claims a licensed provenance it cannot have", () => {
    const row = baseRow();
    row.provenance = "licensed";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "provenance-is-licensed"
    );
  });

  it("rejects a composed row that claims no blind-cert", () => {
    const row = baseRow();
    row.validated = false;
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain("not-validated");
  });

  it("rejects a row certified by anything other than the two blind passes", () => {
    const row = baseRow();
    row.validatedBy = "authored:draft";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "validatedBy-is-authored:draft"
    );
  });

  it("rejects a row the verdict record rejected", () => {
    expect(kiteiRowIssues(baseRow(), new Set(["n3-k-900"]), n3)).toContain(
      "row-judge-rejected"
    );
  });

  it("rejects a passage with no blank, which asks nothing", () => {
    const row = baseRow();
    row.passage =
      "有名レストランの席を予約しておいたから、土曜の夜でも安心して入れる。";
    row.evidence = row.passage;
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "passage-blanks-0"
    );
  });

  it("rejects a passage with two blanks, which asks two 小問 at once", () => {
    const row = baseRow();
    row.passage =
      "有名レストランの席を（　）しておいたから、（　）の夜でも安心して入れる。";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "passage-blanks-2"
    );
  });

  it("rejects a passage that is not a sentence", () => {
    const row = baseRow();
    row.passage = "有名レストランの席を（　）しておく";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "passage-not-a-sentence"
    );
  });

  it("rejects a passage outside the single-sentence length band", () => {
    const row = baseRow();
    row.passage = "席を（　）。";
    expect(
      kiteiRowIssues(row, NO_REJECTIONS, n3).some((issue) =>
        issue.includes("runes-outside")
      )
    ).toBe(true);
  });

  it("rejects the answer leak: a passage that prints its own key", () => {
    // `hasStemLeak` searches prompt+passage for the ANSWER text, so a row that
    // prints 予約 at its own blank is dropped at assembly in silence.
    const row = baseRow();
    row.passage =
      "予約した有名レストランの席は（　）済みで、土曜の夜でも安心して入れる。";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "option-verbatim-in-passage:予約"
    );
  });

  it("rejects a distractor leak: a passage that prints any of the three wrong options too", () => {
    // THE 文脈規定-specific screen, 語形成's version would miss it: printing a
    // distractor narrows the elimination the 小問 exists to test, so the gate
    // screens ALL FOUR options, not just the answer.
    const row = baseRow();
    row.passage =
      "会議のあと有名レストランの席を（　）しておいたから、安心して入れる。";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "option-verbatim-in-passage:会議"
    );
  });

  it("rejects a key that is not the frozen first option", () => {
    const row = baseRow();
    row.key = ["旅行"];
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "key-not-one-answer"
    );
  });

  it("rejects a fifth option", () => {
    const row = baseRow();
    row.options.push("案内");
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain("options-count-5");
  });

  it("rejects a duplicated option pair, which is a two-answer item in disguise", () => {
    const row = baseRow();
    row.options[2] = "会議";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "options-not-distinct"
    );
  });

  it("rejects an option the N3 learner has never met", () => {
    // 曖昧 lives only in the N1 band, so offering it at N3 asks a word no N3
    // course has taught. The option pool is the at-or-below-N3 vocab, exactly
    // the supply walk's attestation clause.
    const row = baseRow();
    row.options[3] = "曖昧";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "option-not-attested-at-or-below-level:曖昧"
    );
  });

  it("rejects a distractor outside the answer's part-of-speech family", () => {
    // The paper prints one form class per 小問: nouns beside nouns. 高い is an
    // i-adjective attested since N5, so it clears attestation but shares no
    // JMdict tag with the suru-noun 予約.
    const row = baseRow();
    row.options[3] = "高い";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "pos-family-mismatch:高い"
    );
  });

  it("rejects a row whose answerIndex was moved off the frozen key slot", () => {
    const row = baseRow();
    row.answerIndex = 2;
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain("answerIndex-2");
  });

  it("rejects evidence that is not the passage with the answer slotted in", () => {
    // `evidence` is the mechanical blankability proof: the exact byte
    // substitution of options[0] into the one （　）. Prose, or a sentence with
    // the answer pasted somewhere else, proves nothing about the blank.
    const row = baseRow();
    row.evidence = "予約という名詞が文脈に最もよく合う答えになる。";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "evidence-not-blank-reconstruction"
    );
  });

  it("rejects evidence that is not one Japanese sentence", () => {
    const row = baseRow();
    row.evidence = "cue";
    const issues = kiteiRowIssues(row, NO_REJECTIONS, n3);
    expect(issues).toContain("evidence-not-one-japanese-sentence");
  });

  it("rejects an N3 row wearing the N2 paper's instruction line", () => {
    // The two lines differ by one glyph (えらび vs 選び); a store that drifted
    // onto the wrong level's line must fail, not print the wrong paper's voice.
    const row = baseRow();
    row.stem = N21_STEM;
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "stem-not-official-instruction-line"
    );
  });

  it("rejects a row filed under another 大問's block", () => {
    const row = baseRow();
    row.block = "hyouki";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain("block-is-hyouki");
  });

  it("rejects Latin script in the authored material", () => {
    const row = baseRow();
    row.passage =
      "有名レストランの席を（　）しておいたから、vipの客でも安心して入れる。";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "latin-in-passage"
    );
  });

  it("rejects a simplified-Chinese-only form in the passage", () => {
    const row = baseRow();
    row.passage =
      "有名レストランの席を（　）しておいたから、毎时安心して入れる。";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "simplified-hanzi-in-passage"
    );
  });

  it("tolerates the blank's own full-width parens but nothing else smuggled", () => {
    // The （　） is the paper's orthography; a full-width digit elsewhere is an
    // authoring slip. The screen runs with the blank stripped, so both are true.
    const row = baseRow();
    row.passage =
      "有名な店の席を（　）しておいたから、１つの不安もないまま入れる。";
    expect(kiteiRowIssues(row, NO_REJECTIONS, n3)).toContain(
      "fullwidth-ascii-in-passage"
    );
  });
});

describe("posAtOrBelow", () => {
  it("sees an N5 word from N2, because the 大問 asks with all known material", () => {
    expect(n2.has("時間")).toBe(true);
  });

  it("does not see an N1-only word at N3", () => {
    // 曖昧 occurs in the N1 band only, so an N3 小問 may not offer it.
    expect(n3.has("曖昧")).toBe(false);
    expect(n2.has("曖昧")).toBe(false);
  });
});

describe("the shipped 文脈規定 stores", () => {
  const DATA_DIR = join(import.meta.dir, "..", "data", "reading");

  const load = (level: string): KiteiRow[] =>
    JSON.parse(
      readFileSync(join(DATA_DIR, `${level.toLowerCase()}-kitei.json`), "utf8")
    ) as KiteiRow[];

  const loadRejected = (level: string): Set<string> => {
    try {
      const raw = JSON.parse(
        readFileSync(
          join(DATA_DIR, `${level.toLowerCase()}-kitei-rejected.json`),
          "utf8"
        )
      ) as { rejectedIds: string[] }[];
      return new Set(raw.flatMap((record) => record.rejectedIds ?? []));
    } catch {
      return new Set<string>();
    }
  };

  const POS = { N1: posAtOrBelow("N1"), N2: n2, N3: n3 };
  const LEVELS = ["N3", "N2", "N1"] as const;

  // Depth floors from the blueprint (小問数 x 3 papers): N3 prints 11 文脈規定
  // 小問, N2 and N1 print 7 each.
  const FLOORS: Record<(typeof LEVELS)[number], number> = {
    N1: 21,
    N2: 21,
    N3: 33,
  };
  const STEMS: Record<(typeof LEVELS)[number], string> = {
    N1: N21_STEM,
    N2: N21_STEM,
    N3: N3_STEM,
  };

  for (const level of LEVELS) {
    it(`holds ${FLOORS[level]}+ ${level} rows that all clear the gate`, () => {
      const rows = load(level);
      const rejectedIds = loadRejected(level);
      expect(rows.length).toBeGreaterThanOrEqual(FLOORS[level]);
      for (const row of rows) {
        expect(kiteiRowIssues(row, rejectedIds, POS[level])).toEqual([]);
      }
    });

    it(`prints the ${level} paper's own instruction line on every row`, () => {
      for (const row of load(level)) {
        expect(row.stem).toBe(STEMS[level]);
      }
    });

    it(`burns every rejected ${level} id instead of re-shipping it`, () => {
      const shipped = new Set(load(level).map((row) => row.id));
      for (const rejected of loadRejected(level)) {
        expect(shipped.has(rejected)).toBe(false);
      }
    });
  }

  it("never prints ANY of its four options inside its own passage", () => {
    // The store-wide leak pin, all four options per row: a future edit that
    // pastes a distractor (or the answer) into the sentence is refused here
    // even if every other screen stayed green.
    for (const level of ["N3", "N2", "N1"]) {
      for (const row of load(level)) {
        for (const option of row.options) {
          expect(row.passage.includes(option)).toBe(false);
        }
      }
    }
  });

  it("carries evidence that is exactly its blank filled", () => {
    for (const level of ["N3", "N2", "N1"]) {
      for (const row of load(level)) {
        expect(row.evidence).toBe(
          row.passage.replace("（　）", row.options[0] ?? "")
        );
      }
    }
  });

  it("never spends one passage or one answer twice, across the whole family", () => {
    // The three stores feed papers that share nothing, but one served store
    // must not print the same 小問 twice in one paper, and an answer word used
    // at two levels would be the same item wearing two stamps.
    expectNoReusedTexts(["N3", "N2", "N1"].map(load), (row) => [
      row.passage,
      row.key[0] ?? "",
    ]);
  });

  it("offers each 小問 a distinct option set", () => {
    const sets: string[] = [];
    for (const level of ["N3", "N2", "N1"]) {
      for (const row of load(level)) {
        sets.push(row.options.join("/"));
      }
    }
    expect(new Set(sets).size).toBe(sets.length);
  });
});
