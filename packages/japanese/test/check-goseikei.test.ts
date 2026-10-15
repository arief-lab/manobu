/**
 * TASK-173.9.26 AC#6: the `check:goseikei` gate is pinned with real assertions
 * over `goseikeiRowIssues` (the exported per-row screen), not source-text
 * checks. A clean row passes; each defect the gate exists to catch is a
 * separate fixture that must fail. The last group runs the gate over the shipped
 * store itself, so a hand-edit that breaks shape is caught here rather than when
 * a learner opens a paper whose blank has two defensible completions in it.
 *
 * 語形成 is mechanically falsifiable where 文章の文法 was not: the licensed vocab
 * corpus says which single kanji completes the printed fragment into a real
 * word (the supply walk's own three clauses), and the same corpus is what the
 * assembly's leak rule consults downstream. So half of these fixtures are about
 * the corpus agreeing, and half about the things only a judge could see (does
 * the SENTENCE mean the compound) being *not* what this gate pretends to check.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attestationFor,
  type GoseikeiRow,
  goseikeiRowIssues,
} from "../scripts/check-goseikei";
import { expectNoReusedTexts } from "./reading-reuse-ledger";

const NO_REJECTIONS = new Set<string>();

/** The official N2 instruction line, transcribed from N2V.pdf p.5 問題３ rather
 * than imported from the gate, so a drift in `GOSEIKEI_STEMS` fails here instead
 * of being agreed with itself. */
const N2_STEM =
  "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。";

/** A row that clears every screen: the round-D recertified 機関車 shape, written
 * out here so the test does not grade the store against itself. One （　） glued
 * after the attested fragment 機関, four distinct single kanji the N2 learner
 * has met, 車 frozen in the first slot as the only completion that is a word,
 * and a passage that prints neither the compound nor the answer kanji (電車
 * would leak 車; the shipped line says 急な山道 instead). */
const baseRow = (): GoseikeiRow => ({
  answerIndex: 0,
  block: "goseikei",
  construction: "authored",
  evidence: "蒸気の力でレールの上を走る自走車両は機関車なので車が入る。",
  id: "n2-g-900",
  key: ["機関車"],
  level: "N2",
  options: ["車", "員", "手", "代"],
  passage:
    "石炭を燃やす古い蒸気機関（　）は、急な山道をゆっくり力強く登っていった。",
  provenance: "composed",
  stem: N2_STEM,
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

describe("goseikeiRowIssues", () => {
  it("passes a clean row", () => {
    expect(
      goseikeiRowIssues(baseRow(), NO_REJECTIONS, attestationFor("N2"))
    ).toEqual([]);
  });

  it("rejects a row whose construction is not authored", () => {
    const row = baseRow();
    row.construction = "sourced";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("construction-is-sourced");
  });

  it("rejects a row that claims a licensed provenance it cannot have", () => {
    const row = baseRow();
    row.provenance = "licensed";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("provenance-is-licensed");
  });

  it("rejects a composed row that claims no blind-cert", () => {
    const row = baseRow();
    row.validated = false;
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("not-validated");
  });

  it("rejects a row certified by anything other than the two blind passes", () => {
    const row = baseRow();
    row.validatedBy = "authored:draft";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("validatedBy-is-authored:draft");
  });

  it("rejects a row the verdict record rejected", () => {
    expect(
      goseikeiRowIssues(baseRow(), new Set(["n2-g-900"]), attestationFor("N2"))
    ).toContain("row-judge-rejected");
  });

  it("rejects a passage with no blank, which asks nothing", () => {
    const row = baseRow();
    row.passage =
      "石炭を燃やす古い蒸気機関車は、急な山道をゆっくり登っていった。";
    const issues = goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"));
    expect(issues).toContain("passage-blanks-0");
  });

  it("rejects a passage with two blanks, which asks two 小問 at once", () => {
    const row = baseRow();
    row.passage =
      "石炭を燃やす古い蒸気機関（　）は、急な（　）道をゆっくり力強く登っていった。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("passage-blanks-2");
  });

  it("rejects a blank that is not glued to a compound fragment", () => {
    // The paper's （　） sits DIRECTLY beside the compound's fragment:
    // 機関（　） or （　）水準. A blank glued to some other word completes nothing.
    const row = baseRow();
    row.passage =
      "蒸気の古い車庫（　）は、急な山道をゆっくり力強く登っていった。";
    const issues = goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"));
    expect(
      issues.some((issue) =>
        issue.startsWith("blank-not-adjacent-to-compound-fragment")
      )
    ).toBe(true);
  });

  it("rejects a fragment that is not an attested word", () => {
    // All four official 小問 print a real word beside the blank (結婚, 水準,
    // 日本, 使用). 線電 is a stub no band carries, so the item would ask a
    // completion of a non-word.
    const row = baseRow();
    row.key = ["線電車"];
    row.passage =
      "石炭を燃やす古い線電（　）は、急な山道をゆっくり力強く登っていった。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("fragment-not-attested-word:線電");
  });

  it("rejects a passage that is not a sentence", () => {
    const row = baseRow();
    row.passage = "石炭を燃やす古い蒸気機関（　）";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("passage-not-a-sentence");
  });

  it("rejects a passage outside the single-sentence length band", () => {
    const row = baseRow();
    row.passage = "線（　）。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2")).some(
        (issue) => issue.includes("runes-outside")
      )
    ).toBe(true);
  });

  it("rejects the compound leak: a passage that prints the whole compound", () => {
    const row = baseRow();
    row.passage =
      "機関車の模型を眺めたあと、蒸気機関（　）は急な山道をゆっくり力強く登っていった。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("compound-in-passage:機関車");
  });

  it("rejects the answer leak: a passage that prints the key kanji anywhere, even inside another word", () => {
    // THE n2-g-013 case, pinned forever: the shipped passage once read 電車より
    // 静かに走った, and 電車 contains 車, so `hasStemLeak` (prompt+passage
    // contains the answer text) would have dropped the row at assembly in
    // silence. A gate that only screens the whole compound misses this.
    const row = baseRow();
    row.passage = "石炭を燃やす古い蒸気機関（　）は、電車より静かに走った。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("key-kanji-in-passage:車");
  });

  it("rejects a fifth option", () => {
    const row = baseRow();
    row.options.push("両");
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("options-count-5");
  });

  it("rejects a duplicated option pair, which is a two-answer item in disguise", () => {
    const row = baseRow();
    row.options[2] = "員";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("options-not-distinct");
  });

  it("rejects an option too long to be the paper's single kanji", () => {
    const row = baseRow();
    row.options[3] = "両両";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("option-not-single-kanji:両両");
  });

  it("rejects an option written in kana", () => {
    const row = baseRow();
    row.options[2] = "くるま";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("option-not-single-kanji:くるま");
  });

  it("rejects a distractor kanji the N2 learner has never met", () => {
    // 嗚 occurs only in the N1 band's 嗚呼, so offering it asks a character no
    // N2 course has taught. The distractor pool is the at-or-below-N2 kanji,
    // exactly the supply walk's clause 3.
    const row = baseRow();
    row.options[3] = "嗚";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("option-kanji-above-level:嗚");
  });

  it("rejects a row whose answerIndex was moved off the frozen key slot", () => {
    const row = baseRow();
    row.answerIndex = 2;
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("answerIndex-2");
  });

  it("rejects an answer kanji that is not at either end of the compound", () => {
    // The paper's blank sits at ONE END (結婚（観）, （高）水準), so options[0]
    // must be the compound's first or last character. 関 is the compound's
    // MIDDLE kanji: 機関車 neither starts nor ends with it, so no one-end
    // fragment split can produce it as the answer.
    const row = baseRow();
    row.options[0] = "関";
    const issues = goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"));
    expect(issues).toContain("key-option-not-at-compound-end:関");
  });

  it("rejects a compound the bands at or below N2 do not carry", () => {
    // 機関車輌 is no word; the key's corpus attestation is what makes the
    // answer defensible without a dictionary.
    const row = baseRow();
    row.key = ["機関車輌"];
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("compound-not-attested-at-or-below-level:機関車輌");
  });

  it("rejects a distractor whose completion with the fragment is an attested word", () => {
    // 大学生 is an attested word, so offering 生 beside the fragment 大学 prints
    // a second defensible completion: the very two-answer risk the round-1
    // judges flagged on 農産物/鉱産物/林産物. 大学院's own store distractors
    // avoid it; this fixture reintroduces it on purpose.
    const row = {
      ...baseRow(),
      evidence: "大学院の話なので院が入る、が大学生も語として存在する。",
      key: ["大学院"],
      options: ["院", "生", "部", "科"],
      passage: "語学を学ぶため、彼女は去年から大学（　）で勉強を続けている。",
    } satisfies GoseikeiRow;
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("distractor-completion-attested:大学生");
  });

  it("rejects a stem that drifted from the official instruction line", () => {
    const row = baseRow();
    row.stem =
      "（ ）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("stem-not-official-instruction-line");
  });

  it("rejects a row filed under another 大問's block", () => {
    const row = baseRow();
    row.block = "hyouki";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("block-is-hyouki");
  });

  it("rejects Latin script in the authored material", () => {
    const row = baseRow();
    row.passage =
      "石炭を燃やす古い蒸気機関（　）は、mountainな山道をゆっくり登った。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("latin-in-passage");
  });

  it("rejects a simplified-Chinese-only form in the passage", () => {
    // The same vetted codepoint list `check-hyouki.ts` keeps: 時's simplified
    // form is not the Japanese shinjitai.
    const row = baseRow();
    row.passage =
      "石炭を燃やす古い蒸気機関（　）は、毎时ゆっくり山道を登っていった。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("simplified-hanzi-in-passage");
  });

  it("tolerates the blank's own full-width parens but nothing else smuggled", () => {
    // The （　） is the paper's orthography; a full-width digit elsewhere is an
    // authoring slip. The screen runs with the blank stripped, so both are true.
    const row = baseRow();
    row.passage =
      "石炭を燃やす古い蒸気機関（　）は、１つの山道をゆっくり力強く登っていった。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("fullwidth-ascii-in-passage");
  });

  it("rejects evidence that is not one Japanese sentence", () => {
    const row = baseRow();
    row.evidence = "cue";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("evidence-not-one-japanese-sentence");
  });

  it("rejects evidence that names neither the compound nor its fragment", () => {
    // n2-g-003 legitimately explains why 不 attaches to 規則 without printing
    // 不規則, so the naming screen accepts either; prose about some other word
    // clears neither and must fail.
    const row = baseRow();
    row.evidence = "山道を登る話なので、急という漢字が最もよい答えになる。";
    expect(
      goseikeiRowIssues(row, NO_REJECTIONS, attestationFor("N2"))
    ).toContain("evidence-names-neither-compound-nor-fragment");
  });
});

describe("attestationFor", () => {
  it("sees an N5 word from N2, because the 大問 asks with all known material", () => {
    const n2 = attestationFor("N2");
    expect(n2.wordsBySpellingAtOrBelow.has("水")).toBe(true);
    expect(n2.kanjiAtOrBelow.has("水")).toBe(true);
  });

  it("does not see an N1 word or kanji from N2, but its universe still knows the word exists", () => {
    // 嗚呼 lives only in the N1 band: the learner has not met 嗚 (so it cannot
    // be offered as a distractor), yet `allWords` carries 嗚呼, which is what
    // lets the two-answer guard refuse an N1-attested completion too.
    const n2 = attestationFor("N2");
    expect(n2.wordsBySpellingAtOrBelow.has("嗚呼")).toBe(false);
    expect(n2.kanjiAtOrBelow.has("嗚")).toBe(false);
    expect(n2.allWords.has("嗚呼")).toBe(true);
  });
});

describe("the shipped 語形成 store", () => {
  const DATA_DIR = join(import.meta.dir, "..", "data", "reading");

  /** The instruction line transcribed from N2V.pdf p.5 問題３, written out a
   * second time so the store is graded against the paper, not against the gate. */
  const OFFICIAL_STEM =
    "（　）に入れるのに最もよいものを、１・２・３・４から一つ選びなさい。";

  /** 小問数 × 4 papers from the blueprint: N2 prints 5 語形成 小問 (paper.ts:587). */
  const FLOOR = 20;

  const load = (): GoseikeiRow[] =>
    JSON.parse(
      readFileSync(join(DATA_DIR, "n2-goseikei.json"), "utf8")
    ) as GoseikeiRow[];

  const loadRejected = (): Set<string> => {
    try {
      const raw = JSON.parse(
        readFileSync(join(DATA_DIR, "n2-goseikei-rejected.json"), "utf8")
      ) as { rejectedIds: string[] }[];
      return new Set(raw.flatMap((record) => record.rejectedIds ?? []));
    } catch {
      return new Set<string>();
    }
  };

  it("holds 20+ rows that all clear the gate", () => {
    const rows = load();
    const rejectedIds = loadRejected();
    const attestation = attestationFor("N2");
    expect(rows.length).toBeGreaterThanOrEqual(FLOOR);
    for (const row of rows) {
      expect(goseikeiRowIssues(row, rejectedIds, attestation)).toEqual([]);
    }
  });

  it("prints the N2 instruction line on every row", () => {
    for (const row of load()) {
      expect(row.stem).toBe(OFFICIAL_STEM);
    }
  });

  it("burns every rejected id instead of re-shipping it", () => {
    const shipped = new Set(load().map((row) => row.id));
    for (const rejected of loadRejected()) {
      expect(shipped.has(rejected)).toBe(false);
    }
  });

  it("keeps the burned n2-g-017 out of the store", () => {
    // Two rounds of judge failure on the same 来年 anchor made it uncertifiable;
    // the id must stay in the reject record and off the paper.
    expect(loadRejected().has("n2-g-017")).toBe(true);
    expect(load().map((row) => row.id)).not.toContain("n2-g-017");
  });

  it("never prints the answer kanji inside its own passage", () => {
    // The n2-g-013 lesson as a store-wide pin, so a future edit that pastes
    // 電車 (or any other 車-carrier) into a 車 row is refused here even if every
    // other screen stayed green.
    for (const row of load()) {
      expect(row.passage.includes(row.options[0] ?? "")).toBe(false);
    }
  });

  it("never spends one passage or one compound twice", () => {
    expectNoReusedTexts([load()], (row) => [row.passage, row.key[0] ?? ""]);
  });

  it("asks a distinct compound in every 小問", () => {
    // Distractor kanji may repeat (the real papers re-offer the same shapes);
    // the compound being completed is the item's identity.
    const compounds = load().map((row) => row.key[0] ?? "");
    expect(new Set(compounds).size).toBe(compounds.length);
  });

  it("offers each 小問 a distinct option set", () => {
    const sets = load().map((row) => row.options.join("/"));
    expect(new Set(sets).size).toBe(sets.length);
  });
});
