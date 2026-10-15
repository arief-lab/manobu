/**
 * TASK-173.9.25 AC#6: the `check:hyouki` gate is pinned with real assertions
 * over `hyoukiRowIssues` (the exported per-row screen), not source-text checks.
 * A clean row passes; each defect the gate exists to catch is a separate
 * fixture that must fail. The last group runs the gate over the shipped stores
 * themselves, so a hand-edit that breaks shape is caught here rather than when
 * a learner opens a paper whose blank has two defensible spellings in it.
 *
 * 表記 differs from every other authored family here in that the key IS
 * mechanically falsifiable: the licensed vocab corpus says which spelling the
 * printed kana takes (AC#1, #2). So half of these fixtures are about the corpus
 * agreeing, and half about the things only a judge could see being *not* what
 * this gate pretends to check.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attestationFor,
  type HyoukiRow,
  hyoukiRowIssues,
} from "../scripts/check-hyouki";
import { expectNoReusedTexts } from "./reading-reuse-ledger";

const NO_REJECTIONS = new Set<string>();

/** The CJK Unified Ideographs block, used to screen a key spelling that carries
 * no kanji (a katakana 表記 like ワイシャツ). Top-level because Biome flags a
 * regex literal inside a `.filter` callback as a per-call allocation. */
const KANJI_RE = /[\u4E00-\u9FFF]/;
/** The one 「…」 span that a real 表記 sentence prints as the asked word. */
const KANA_QUOTE_RE = /「([^」]*)」/;

/** The official N5 instruction line, written out from N5V.pdf もんだい２ rather
 * than imported from the gate, so a drift in `HYOUKI_STEMS` fails here instead
 * of being agreed with itself. */
const N5_STEM =
  "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。";

/** A row that clears every screen: one hiragana span in a single sentence, four
 * distinct kanji options with the key frozen first, and a printed kana the N5
 * corpus gives exactly one spelling to. */
const baseRow = (): HyoukiRow => ({
  answerIndex: 0,
  block: "hyouki",
  construction: "authored",
  evidence:
    "学校が町の東の方にあるという話なので、東の漢字が正しい表記である。",
  id: "n5-h-900",
  key: ["東"],
  level: "N5",
  options: ["東", "南", "売", "束"],
  passage: "日本語の学校は町の「ひがし」にあります。",
  provenance: "composed",
  stem: N5_STEM,
  validated: true,
  validatedBy: "authored:agent-blind-judged",
});

const optionsOf = (row: HyoukiRow): string => row.options.join("/");

describe("hyoukiRowIssues", () => {
  it("passes a clean row", () => {
    expect(
      hyoukiRowIssues(baseRow(), NO_REJECTIONS, attestationFor("N5"))
    ).toEqual([]);
  });

  it("rejects a row whose construction is not authored", () => {
    const row = baseRow();
    row.construction = "sourced";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "construction-is-sourced"
    );
  });

  it("rejects a row that claims a licensed provenance it cannot have", () => {
    const row = baseRow();
    row.provenance = "licensed";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "provenance-is-licensed"
    );
  });

  it("rejects a composed row that claims no blind-cert", () => {
    const row = baseRow();
    row.validated = false;
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "not-validated"
    );
  });

  it("rejects a row certified by anything other than the two blind passes", () => {
    const row = baseRow();
    row.validatedBy = "authored:draft";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "validatedBy-is-authored:draft"
    );
  });

  it("rejects a row the verdict record rejected", () => {
    expect(
      hyoukiRowIssues(baseRow(), new Set(["n5-h-900"]), attestationFor("N5"))
    ).toContain("row-judge-rejected");
  });

  it("rejects a passage with no kana span, which prints nothing to spell", () => {
    const row = baseRow();
    row.passage = "日本語の学校は町にあります。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "passage-lacks-a-single-kana-span"
    );
  });

  it("rejects a passage with two spans, which asks two 小問 at once", () => {
    const row = baseRow();
    row.passage = "「むかし」から日本語の学校は町の「ひがし」にあります。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "passage-lacks-a-single-kana-span"
    );
  });

  it("rejects a span that already carries kanji, which answers itself", () => {
    const row = baseRow();
    row.passage = "日本語の学校は町の「東」にあります。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "passage-lacks-a-single-kana-span"
    );
  });

  it("rejects a passage that is not a sentence", () => {
    const row = baseRow();
    row.passage = "日本語の学校は町の「ひがし」にあります";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "passage-not-a-sentence"
    );
  });

  it("rejects a passage outside the single-sentence length band", () => {
    const row = baseRow();
    row.passage = "「ひがし」。";
    const issues = hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"));
    expect(
      issues.some(
        (issue) => issue.startsWith("passage-0") || issue.startsWith("passage-")
      )
    ).toBe(true);
    expect(issues.some((issue) => issue.includes("runes-outside"))).toBe(true);
  });

  it("rejects the leak: a passage that prints the key it asks for", () => {
    const row = baseRow();
    row.passage =
      "東側の校門から入ると、日本語の学校は町の「ひがし」にあります。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "key-spelling-in-passage:東"
    );
  });

  it("rejects a fifth option", () => {
    const row = baseRow();
    row.options.push("京");
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "options-count-5"
    );
  });

  it("rejects a duplicated option pair, which is a two-answer item in disguise", () => {
    const row = baseRow();
    row.options[2] = "南";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "options-not-distinct"
    );
  });

  it("rejects an option that carries the span markers", () => {
    const row = baseRow();
    row.options[2] = "「東」";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "option-carries-span:「東」"
    );
  });

  it("rejects an option that ends in a full stop, which the paper never prints", () => {
    const row = baseRow();
    row.options[3] = "束。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "option-ends-with-period:束。"
    );
  });

  it("rejects a distractor the passage already prints verbatim", () => {
    const row = baseRow();
    row.passage =
      "日本語の学校は南の校舎に移り、町の「ひがし」にはありません。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "option-verbatim-in-passage:南"
    );
  });

  it("rejects an option too long to be a word", () => {
    const row = baseRow();
    row.options[3] = "東のほうにある校舎";
    expect(
      hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5")).some((issue) =>
        issue.startsWith("option-9runes-outside")
      )
    ).toBe(true);
  });

  it("rejects a key that is not options[0]", () => {
    const row = baseRow();
    row.key = ["南"];
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "key-not-options-0"
    );
  });

  it("rejects a row whose answerIndex was moved off the frozen key slot", () => {
    const row = baseRow();
    row.answerIndex = 2;
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "answerIndex-2"
    );
  });

  it("rejects a printed kana the corpus spells two ways", () => {
    // 弾く and 引く are both N5 words reading ひく, so ひく can never anchor a
    // 表記 小問: the paper would print one kana and accept two answers.
    const row = baseRow();
    row.passage = "ピアノの練習を毎日して、よく「ひく」練習もしている。";
    row.key = ["引く"];
    row.options = ["引く", "弾る", "弓", "匹く"];
    const issues = hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"));
    expect(
      issues.some((issue) =>
        issue.startsWith("printed-kana-not-uniquely-attested:")
      )
    ).toBe(true);
  });

  it("rejects a printed kana the corpus does not spell at all", () => {
    const row = baseRow();
    row.passage = "毎朝パンと卵を「たべない」。";
    row.key = ["不食"];
    row.options = ["不食", "食ん", "不旦", "蚀"];
    expect(
      hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5")).some((issue) =>
        issue.startsWith("printed-kana-not-uniquely-attested")
      )
    ).toBe(true);
  });

  it("rejects a kanji-shape option written in kana", () => {
    const row = baseRow();
    row.options[3] = "ひがし";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "kanji-shape-option-lacks-kanji:ひがし"
    );
  });

  it("rejects a stem that drifted from this level's official instruction line", () => {
    const row = baseRow();
    row.stem =
      "次の文章を読んで、＿＿に入る最もよいものを、１・２・３・４から一つ選びなさい。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "stem-not-official-instruction-line"
    );
  });

  it("rejects a row filed under another 大問's block", () => {
    const row = baseRow();
    row.block = "bun-no-bunpou-2";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "block-is-bun-no-bunpou-2"
    );
  });

  it("rejects Latin script in the authored material", () => {
    const row = baseRow();
    row.options[2] = "売A";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "latin-in-option2"
    );
  });

  it("rejects a simplified-Chinese-only form in the passage", () => {
    const row = baseRow();
    row.passage = "日本語の学校は町の「ひがし」に时にあります。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "simplified-hanzi-in-passage"
    );
  });

  it("rejects half-width ASCII in an option", () => {
    const row = baseRow();
    row.options[1] = "南1";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "halfwidth-ascii-in-option1"
    );
  });

  it("rejects evidence that is not a Japanese sentence naming the key", () => {
    const row = baseRow();
    row.evidence = "cue";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "evidence-not-one-japanese-sentence-naming-the-key"
    );
  });
});

describe("the katakana 表記 小問", () => {
  /** The N5V もんだい２ #1 shape: the paper prints わいしゃつ and asks for the
   * katakana spelling, with mora-shuffled non-words as the wrong options. */
  const kanaRow = (): HyoukiRow => ({
    ...baseRow(),
    answerIndex: 0,
    evidence:
      "服の話なので、かっぷではなくワイシャツを表すカタカナ語が正しい表記である。",
    key: ["ワイシャツ"],
    options: ["ワイシャツ", "ウイシャソ", "ワイシャソ", "ウイシャツ"],
    passage: "父は出勤するとき、いつも白い「わいしゃつ」を着る。",
    provenance: "composed",
  });

  it("passes the plain case flip of an attested katakana word", () => {
    // The katakana→hiragana shift is 0x60 DOWNWARD: ワ U+30EF is わ U+308F.
    // A gate that shifts the other way lands in the bopomofo block and refuses
    // every real katakana row, which is exactly how the first pass died.
    expect(kanaRow().key[0]).toBe("ワイシャツ");
    const issues = hyoukiRowIssues(
      {
        ...kanaRow(),
        evidence: "父はシャツを着るという話で、ワイシャツが正しい表記である。",
      },
      NO_REJECTIONS,
      attestationFor("N5")
    );
    expect(issues).toEqual([]);
  });

  it("rejects a printed kana that is not the key's case flip", () => {
    const row = kanaRow();
    row.passage = "父は出勤するとき、いつも白い「ういしゃつ」を着る。";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "kana-shape-key-not-case-flip-of-printed"
    );
  });

  it("rejects a katakana key the level's corpus does not carry", () => {
    const row = kanaRow();
    row.key = ["ワイヤレス"];
    row.options = ["ワイヤレス", "ウイヤレス", "ワイヤレッ", "ウヤレス"];
    row.passage = "父は出勤するとき、いつも白い「わいしゃつ」を着る。";
    const issues = hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"));
    expect(issues).toContain("kana-shape-key-not-case-flip-of-printed");
  });

  it("rejects a kana-shape option written in kanji", () => {
    const row = kanaRow();
    row.options[3] = " shirts".trim();
    expect(
      hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5")).some((issue) =>
        issue.startsWith("kana-shape-option-not-katakana")
      )
    ).toBe(true);
  });

  it("rejects a distractor that is itself an attested katakana word", () => {
    // シャツ is an N5 word, so offering it for わいしゃつ turns the 小問 into a
    // vocabulary test rather than a 表記 test.
    const row = kanaRow();
    row.options[3] = "シャツ";
    expect(hyoukiRowIssues(row, NO_REJECTIONS, attestationFor("N5"))).toContain(
      "kana-shape-option-is-attested-word:シャツ"
    );
  });

  it("does not accuse the key of being an attested word", () => {
    // options[0] is the key and the key is attested by design; a screen that
    // checks it too rejects every katakana row in the store.
    const issues = hyoukiRowIssues(
      kanaRow(),
      NO_REJECTIONS,
      attestationFor("N5")
    );
    expect(
      issues.some((issue) =>
        issue.startsWith("kana-shape-option-is-attested-word")
      )
    ).toBe(false);
  });
});

describe("attestationFor", () => {
  it("sees an N5 word from N2, because the 大問 asks with all known material", () => {
    const n2 = attestationFor("N2");
    expect(n2.wordsBySpelling.has("東")).toBe(true);
    expect(n2.wordsByReading.get("ひがし")?.has("東")).toBe(true);
  });

  it("does not see an N1 word from N5", () => {
    // A spelling whose only band sits above the level is not a legal anchor:
    // the learner has never met that word, so the item tests nothing. 嗚呼 is an
    // N1 entry; neither its spelling nor its reading appears in the N5 band.
    const n5 = attestationFor("N5");
    expect(n5.wordsBySpelling.has("嗚呼")).toBe(false);
    expect(n5.wordsByReading.has("ああ")).toBe(false);
  });
});

describe("the shipped 表記 stores", () => {
  const DATA_DIR = join(import.meta.dir, "..", "data", "reading");

  /** The four instruction lines, transcribed from the 2018 sample PDFs. N2
   * really prints no 「、」 after を and N3 really has one: that asymmetry is
   * the paper's own, and a store that "fixed" it would stop matching the
   * blueprint the assembly reads. */
  const OFFICIAL_STEMS = {
    N2: "＿＿＿ の言葉を漢字で書くとき、最もよいものを１・２・３・４から一つ 選びなさい。",
    N3: "＿＿＿ のことばを漢字で書くとき、最もよいものを、１・２・３・４から一つ えらびなさい。",
    N4: "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
    N5: "＿＿＿ の ことばは どう かきますか。１・２・３・４から いちばん いい ものを ひとつ えらんで ください。",
  } satisfies Record<string, string>;

  /** 小問数 × 4 papers, from the blueprint: N5 8, N4 6, N3 6, N2 5. */
  const FLOORS: Record<string, number> = { N2: 20, N3: 24, N4: 24, N5: 32 };

  const load = (level: string): HyoukiRow[] =>
    JSON.parse(
      readFileSync(join(DATA_DIR, `${level.toLowerCase()}-hyouki.json`), "utf8")
    ) as HyoukiRow[];

  const loadRejected = (level: string): Set<string> => {
    try {
      const raw = JSON.parse(
        readFileSync(
          join(DATA_DIR, `${level.toLowerCase()}-hyouki-rejected.json`),
          "utf8"
        )
      ) as { rejectedIds: string[] }[];
      return new Set(raw.flatMap((record) => record.rejectedIds ?? []));
    } catch {
      return new Set<string>();
    }
  };

  for (const level of ["N5", "N4", "N3", "N2"] as const) {
    it(`holds ${level} rows that all clear the gate`, () => {
      const rows = load(level);
      const rejectedIds = loadRejected(level);
      const attestation = attestationFor(level);
      expect(rows.length).toBeGreaterThanOrEqual(FLOORS[level] ?? 0);
      for (const row of rows) {
        expect(hyoukiRowIssues(row, rejectedIds, attestation)).toEqual([]);
      }
    });

    it(`prints ${level}'s own instruction line on every row`, () => {
      for (const row of load(level)) {
        expect(row.stem).toBe(OFFICIAL_STEMS[level]);
      }
    });
  }

  it("keeps the N2 line comma-less and the N3 line comma-ed, as the papers print", () => {
    expect(OFFICIAL_STEMS.N2).not.toContain("ものを、");
    expect(OFFICIAL_STEMS.N3).toContain("ものを、");
  });

  it("holds at most one katakana 小問 per paper at N5 and none above", () => {
    for (const level of ["N5", "N4", "N3", "N2"]) {
      const kana = load(level).filter(
        (row) => !KANJI_RE.test(row.key[0] ?? "")
      );
      expect(kana.length).toBeLessThanOrEqual(level === "N5" ? 4 : 0);
    }
  });

  it("never spends one passage or one key spelling twice across the four levels", () => {
    expectNoReusedTexts(["N5", "N4", "N3", "N2"].map(load), (row) => [
      row.passage,
      row.key[0] ?? "",
    ]);
  });

  it("burns every rejected id instead of re-shipping it", () => {
    for (const level of ["N5", "N4", "N3", "N2"]) {
      const shipped = new Set(load(level).map((row) => row.id));
      for (const rejected of loadRejected(level)) {
        expect(shipped.has(rejected)).toBe(false);
      }
    }
  });

  it("asks a distinct printed kana in every 小問", () => {
    // Two rows over the same kana is the same 小問 twice, however different the
    // sentences look.
    const printed = new Map<string, string>();
    const clashes: string[] = [];
    for (const level of ["N5", "N4", "N3", "N2"]) {
      for (const row of load(level)) {
        const kana = KANA_QUOTE_RE.exec(row.passage)?.[1] ?? "";
        const prior = printed.get(`${level}:${kana}`);
        if (prior !== undefined) {
          clashes.push(`${row.id} repeats the kana asked by ${prior}`);
        }
        printed.set(`${level}:${kana}`, row.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("offers each level's 表記 with a distinct distractor set", () => {
    for (const level of ["N5", "N4", "N3", "N2"]) {
      const sets = load(level).map((row) => optionsOf(row));
      expect(new Set(sets).size).toBe(sets.length);
    }
  });
});
