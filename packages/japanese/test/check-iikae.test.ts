/**
 * TASK-173.9.27 AC#6: the `check:iikae` gate is pinned with real assertions over
 * `iikaeRowIssues` (the exported per-row screen), not source-text checks. A clean
 * row passes; each defect the gate exists to catch is a separate fixture that must
 * fail. The last group runs the gate over the shipped stores themselves, so a
 * hand-edit that breaks shape is caught here rather than when a learner opens a
 * paper whose bracketed word has two defensible paraphrases in it.
 *
 * 言い換え類義 is mechanically falsifiable in one place and not in the other: the
 * licensed vocab corpus says whether the ASKED word is material this level has
 * met, and the assembly's leak rule says whether the passage prints its own
 * answer, but no word list decides that 頻繁 and しばしば agree in a given
 * sentence. So half of these fixtures are about the corpus and the leak agreeing,
 * and half are about the thing only a judge could see being *not* what this gate
 * pretends to check.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attestationFor,
  type IikaeRow,
  iikaeRowIssues,
} from "../scripts/check-iikae";

const NO_REJECTIONS = new Set<string>();

/** The paper's marking, read off the row the same way the gate reads it. */
const TARGET_RE = /「([^」]+)」/u;

/** The official instruction lines, transcribed from N1V.pdf p.5 問題3, N2V.pdf
 * p.7 問題5 and N3V.pdf p.6 問題4 rather than imported from the gate, so a drift
 * in `IIKAE_STEMS` fails here instead of being agreed with itself. */
const N1_STEM =
  "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。";
const N2_STEM =
  "＿＿＿の言葉に意味が最も近いものを、１・２・３・４から一つ選びなさい。";
const N3_STEM =
  "＿＿＿に意味が最も近いものを、１・２・３・４から一つえらびなさい。";

/** A row that clears every screen: the certified 怪しい shape, written out here so
 * the test does not grade the store against itself. One 「　」 around a headword
 * the N2 learner has met, four distinct paraphrases of which exactly one keeps
 * the sentence's meaning, that one frozen in the first slot, and a passage that
 * prints none of the four options. */
const baseRow = (): IikaeRow => ({
  answerIndex: 0,
  block: "iikae-ruiji",
  construction: "authored",
  evidence:
    "怪しいはこの文では信用できるか心配されることで、うさんくさいだけが同じ疑いを表す。",
  id: "n2-i-900",
  key: ["うさんくさい"],
  level: "N2",
  options: ["うさんくさい", "むずかしい", "気持ちよい", "静かな"],
  passage: "夜中に車の周りをうろついている「怪しい」男がいた。",
  provenance: "composed",
  stem: N2_STEM,
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

const screen = (
  row: IikaeRow,
  level = "N2",
  rejectedIds: ReadonlySet<string> = NO_REJECTIONS
): string[] => iikaeRowIssues(row, rejectedIds, attestationFor(level));

describe("iikaeRowIssues", () => {
  it("passes a clean row", () => {
    expect(screen(baseRow())).toEqual([]);
  });

  it("rejects a row whose construction is not authored", () => {
    const row = baseRow();
    row.construction = "sourced";
    expect(screen(row)).toContain("construction-is-sourced");
  });

  it("rejects a row that claims a licensed provenance it cannot have", () => {
    const row = baseRow();
    row.provenance = "licensed";
    expect(screen(row)).toContain("provenance-is-licensed");
  });

  it("rejects a composed row that claims no blind-cert", () => {
    const row = baseRow();
    row.validated = false;
    expect(screen(row)).toContain("not-validated");
  });

  it("rejects a row certified by anything other than the two blind passes", () => {
    const row = baseRow();
    row.validatedBy = "authored:draft";
    expect(screen(row)).toContain("validatedBy-is-authored:draft");
  });

  it("rejects a row the verdict record rejected", () => {
    expect(screen(baseRow(), "N2", new Set(["n2-i-900"]))).toContain(
      "row-judge-rejected"
    );
  });

  it("rejects a passage with no bracketed target, which asks nothing", () => {
    const row = baseRow();
    row.passage = "夜中に車の周りをうろついている怪しい男がいた。";
    expect(screen(row)).toContain("passage-target-brackets-0");
  });

  it("rejects a passage with two brackets, which asks two 小問 at once", () => {
    const row = baseRow();
    row.passage =
      "夜中に「静かな」車の周りをうろついている「怪しい」男がいた。";
    expect(screen(row)).toContain("passage-target-brackets-2");
  });

  it("rejects a bracketed target the level has not been taught", () => {
    // 嗚呼 lives only in the N1 band (the N1 sample paper's own 嗚呼 表記 小問).
    // A 小問 cannot ask a word the learner never met, whatever the options mean.
    const row = baseRow();
    row.passage = "彼は「嗚呼」と叫んで、転んだ自転車を拾い上げた。";
    row.evidence =
      "嗚呼は強い驚きの叫びだから、うさんくさいは同じ感情を表さない。";
    expect(screen(row)).toContain("target-not-attested-at-or-below-level:嗚呼");
  });

  it("rejects a bracketed target too long to be one word", () => {
    // The paper brackets a WORD. A surface that swallows a clause stops being the
    // 小問's target and becomes a translation exercise, which is the sentence
    // form TASK-173.9.28 owns.
    const row = baseRow();
    row.passage =
      "夜中に車の周りをうろついている「信用できるか分からない男だ」がいた。";
    expect(screen(row)).toContain("passage-target-13runes-above-8");
  });

  it("rejects a passage that is not a sentence", () => {
    const row = baseRow();
    row.passage = "夜中に車の周りをうろついている「怪しい」男";
    expect(screen(row)).toContain("passage-not-a-sentence");
  });

  it("rejects a passage outside the single-sentence length band", () => {
    const row = baseRow();
    row.passage = "「怪しい」。";
    expect(screen(row).some((issue) => issue.includes("runes-outside"))).toBe(
      true
    );
  });

  it("rejects the answer leak: a passage that prints its own key", () => {
    // THE case this screen exists for. `synonym-paraphrase` is absent from
    // `STIMULUS_ANSWER_TYPES`, so `hasStemLeak` searches prompt+passage for the
    // ANSWER TEXT, and a row whose sentence already contains うさんくさい is
    // dropped by the assembly in silence rather than graded.
    const row = baseRow();
    row.passage =
      "夜中に車の周りをうろついている「怪しい」男は、うさんくさい動きをしていた。";
    expect(screen(row)).toContain("option-in-passage:うさんくさい");
  });

  it("rejects a distractor printed inside the passage, the same match from the other side", () => {
    const row = baseRow();
    row.passage = "静かな夜中に車の周りをうろついている「怪しい」男がいた。";
    expect(screen(row)).toContain("option-in-passage:静かな");
  });

  it("rejects the target offered back as its own paraphrase", () => {
    // An item whose options include the bracketed word asks nothing: the learner
    // matches the surface instead of the meaning.
    const row = baseRow();
    row.options[3] = "怪しい";
    expect(screen(row)).toContain("target-offered-as-an-option:怪しい");
  });

  it("rejects a fifth option", () => {
    const row = baseRow();
    row.options.push("あぶない");
    expect(screen(row)).toContain("options-count-5");
  });

  it("rejects a duplicated option pair, which is a two-answer item in disguise", () => {
    const row = baseRow();
    row.options[2] = "むずかしい";
    expect(screen(row)).toContain("options-not-distinct");
  });

  it("rejects a blank option", () => {
    const row = baseRow();
    row.options[1] = " ";
    expect(screen(row)).toContain("option-blank");
  });

  it("rejects a row whose answerIndex was moved off the frozen key slot", () => {
    const row = baseRow();
    row.answerIndex = 2;
    expect(screen(row)).toContain("answerIndex-2");
  });

  it("rejects a key that is not the option the grader reads", () => {
    // The leak rule and the grader must read ONE string. A key naming another
    // option means the answer is two different words in two different places.
    const row = baseRow();
    row.key = ["むずかしい"];
    expect(screen(row)).toContain("key-not-one-answer-matching-options-0");
  });

  it("rejects a key that carries more than one answer", () => {
    const row = baseRow();
    row.key = ["うさんくさい", "むずかしい"];
    expect(screen(row)).toContain("key-not-one-answer-matching-options-0");
  });

  it("rejects a stem that drifted from the official instruction line", () => {
    const row = baseRow();
    row.stem =
      "＿＿＿の意味に最も近いものを、１・２・３・４から一つ選びなさい。";
    expect(screen(row)).toContain("stem-not-official-instruction-line");
  });

  it("rejects the N3 wording on an N2 row, because the levels print different lines", () => {
    const row = baseRow();
    row.stem = N3_STEM;
    expect(screen(row)).toContain("stem-not-official-instruction-line");
  });

  it("rejects a row filed under another 大問's block", () => {
    const row = baseRow();
    row.block = "hyouki";
    expect(screen(row)).toContain("block-is-hyouki");
  });

  it("rejects Latin script in the authored material", () => {
    const row = baseRow();
    row.passage = "夜中に自動車をうろついている「怪しい」strange 男がいた。";
    expect(screen(row)).toContain("latin-in-passage");
  });

  it("rejects a simplified-Chinese-only form in the evidence", () => {
    // The same vetted codepoint list `check-hyouki.ts` keeps: 时 is the
    // simplified form of 時計's first character, not the Japanese shinjitai.
    const row = baseRow();
    row.evidence =
      "怪しいは夜中にうろつく人物のことで、时計を見せないその手がうさんくさい。";
    expect(screen(row)).toContain("simplified-hanzi-in-evidence");
  });

  it("rejects a full-width digit pasted into the sentence", () => {
    // The n1-i-024 slip, pinned: the shipped line read ２人は「頻繁」に…, where
    // the ２ is full-width ASCII the paper never prints. Nothing in this 大問 has
    // a legal full-width blank to excuse it, unlike 語形成's （　）.
    const row = baseRow();
    row.passage = "夜中に２人の車が周りをうろついて、「怪しい」男がいた。";
    expect(screen(row)).toContain("fullwidth-ascii-in-passage");
  });

  it("rejects evidence that is not one Japanese sentence", () => {
    const row = baseRow();
    row.evidence = "cue";
    expect(screen(row)).toContain("evidence-not-one-japanese-sentence");
  });

  it("rejects evidence that never names the word the 小問 asks", () => {
    // Prose about some other word means the row carries another row's
    // justification.
    const row = baseRow();
    row.evidence = "自転車を拾う話なので、うさんくさいが最も近い答えになる。";
    expect(screen(row)).toContain("evidence-names-not-target:怪しい");
  });
});

describe("attestationFor", () => {
  it("sees an N5 headword from N2, because the 大問 asks with all known material", () => {
    expect(attestationFor("N2").wordsAtOrBelow.has("水")).toBe(true);
  });

  it("sees an N2 headword from N2 but not from N3, whose learner has not met it", () => {
    // 怪しい sits in the N2 band: the word form is legal material for an N2 小問
    // and above the N3 paper's reach.
    expect(attestationFor("N2").wordsAtOrBelow.has("怪しい")).toBe(true);
    expect(attestationFor("N3").wordsAtOrBelow.has("怪しい")).toBe(false);
    expect(attestationFor("N3").wordsAtOrBelow.has("容易")).toBe(true);
  });

  it("normalises the spelling before comparing, so one headword is one headword", () => {
    // The bands carry コーヒー with the full-width コ (U+30B3). The same word
    // written with the half-width ｺ (U+FF7A) is one vocabulary item, and NFKC is
    // what lets the target screen read it that way instead of refusing a legal
    // target on spelling width alone.
    const halfWidthCoffee = `${String.fromCodePoint(0xff_7a)}ーヒー`;
    const row = baseRow();
    row.passage = `朝のデスクで「${halfWidthCoffee}」を三杯も飲んで、夜も眠れなかった。`;
    row.evidence = `${halfWidthCoffee}は目を覚まさせる飲み物で、うさんくさいは同じ意味にならない。`;
    expect(screen(row)).toEqual([]);
  });
});

describe("the shipped 言い換え類義 stores", () => {
  const DATA_DIR = join(import.meta.dir, "..", "data", "reading");

  /** 小問数 × 4 papers from the blueprint: N1 prints 6 言い換え類義 小問 and N2/N3
   * print 5. */
  const SHIPPED = [
    { floor: 24, level: "N1", stem: N1_STEM },
    { floor: 20, level: "N2", stem: N2_STEM },
    { floor: 20, level: "N3", stem: N3_STEM },
  ] as const;

  const load = (level: string): IikaeRow[] =>
    JSON.parse(
      readFileSync(join(DATA_DIR, `${level.toLowerCase()}-iikae.json`), "utf8")
    ) as IikaeRow[];

  /** The bracketed word a row asks about, read the way the gate reads it. */
  const targetOf = (row: IikaeRow): string =>
    TARGET_RE.exec(row.passage)?.[1] ?? "";

  it("holds the floor of rows at each level and every row clears the gate", () => {
    for (const { level, floor } of SHIPPED) {
      const rows = load(level);
      const attestation = attestationFor(level);
      expect(rows.length).toBeGreaterThanOrEqual(floor);
      for (const row of rows) {
        expect(iikaeRowIssues(row, NO_REJECTIONS, attestation)).toEqual([]);
      }
    }
  });

  it("prints each level's own instruction line on every row", () => {
    for (const { level, stem } of SHIPPED) {
      for (const row of load(level)) {
        expect(row.stem).toBe(stem);
      }
    }
  });

  it("brackets exactly one attested target and prints no option in the sentence", () => {
    // The store-wide face of the leak screen: a future edit that pastes a
    // paraphrase into its own sentence is refused here even if every other
    // screen stayed green.
    for (const { level } of SHIPPED) {
      const attestation = attestationFor(level);
      for (const row of load(level)) {
        const target = targetOf(row).normalize("NFKC").toLowerCase();
        expect(target.length).toBeGreaterThan(0);
        expect(attestation.wordsAtOrBelow.has(target)).toBe(true);
        for (const option of row.options) {
          expect(row.passage.includes(option)).toBe(false);
        }
      }
    }
  });

  it("never spends one passage or one target twice, across the whole store", () => {
    // Level included: a word already asked at N3 is not a new 小問 at N1.
    const seenPassage = new Map<string, string>();
    const seenTarget = new Map<string, string>();
    const clashes: string[] = [];
    for (const { level } of SHIPPED) {
      for (const row of load(level)) {
        const entries: readonly (readonly [Map<string, string>, string])[] = [
          [seenPassage, row.passage],
          [seenTarget, targetOf(row).normalize("NFKC").toLowerCase()],
        ];
        for (const [owner, text] of entries) {
          const prior = owner.get(text);
          if (prior !== undefined) {
            clashes.push(`${row.id} reuses material from ${prior}`);
          }
          owner.set(text, row.id);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("asks a distinct target in every 小問", () => {
    const targets = SHIPPED.flatMap(({ level }) =>
      load(level).map((row) => targetOf(row).normalize("NFKC").toLowerCase())
    );
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("offers each 小問 a distinct option set", () => {
    const sets = SHIPPED.flatMap(({ level }) =>
      load(level).map((row) => row.options.join("/"))
    );
    expect(new Set(sets).size).toBe(sets.length);
  });

  it("ships nothing at N4 or N5, where the 大問 asks the sentence form", () => {
    // TASK-173.9.27 delivers the word form only. The bottom two levels print a
    // whole-sentence paraphrase task, so a word-form store there would be the
    // wrong construction under the right heading.
    for (const level of ["n4", "n5"]) {
      expect(existsSync(join(DATA_DIR, `${level}-iikae.json`))).toBe(false);
    }
  });
});
