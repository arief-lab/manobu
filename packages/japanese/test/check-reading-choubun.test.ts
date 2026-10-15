/**
 * `check:reading-choubun` is pinned with real data assertions over fixtures, not
 * source-text reads (TASK-134). The valid row is built by the REAL generator
 * (`buildChoubunEntry`) and proven by the REAL gate (`checkEntry`), so the two
 * halves cannot drift apart, and every defect this gate exists to catch must come
 * back with its own issue code: a tampered blank, a distractor the window prints,
 * a lost signature, a lost validation flag, a lost construction tag, a judge
 * rejection, a paragraph another store already spends, a passage outside the
 * 長文 band, an id list the corpus no longer admits, a frame the corpus licenses
 * a second noun in, and a window under THIS block's own 0.85 floor.
 *
 * The last two are the family's own: the floor is 5 points looser than N1's
 * `COVERAGE_FLOOR` (doc-27 §1) and the window is a multi-paragraph id list
 * rather than one paragraph, so a collage, a cross-page pair and a gap all land
 * on `window-not-admissible` because `choubunWindowsFor` is the single thing that
 * decides them.
 *
 * The whole-file half runs over a fixture corpus holding these same two
 * paragraphs: pointed at the shipped store it re-reads every word list and the
 * whole 白書, the minute the `check:reading-choubun` script already pays in CI.
 *
 * THE MASKED ARM IS GATED AT N1 ON PURPOSE, and TASK-173.9.21 did not move it.
 * The shipped N1 store is authored now, so no frozen N1 row runs these screens,
 * and this file is the only place the windowed proof still executes. That is why
 * `check-reading-choubun.ts` carries no `construction-not-for-{level}` refusal
 * like its four siblings: a windowed row tagged at N1 has to reach the corpus
 * screens, not be turned away at the door for a level the store no longer uses.
 * What keeps a mixed store honest is `mixed-constructions`, tested below.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ChoubunReadingEntry,
  checkEntry,
  checkReadingFile,
} from "../scripts/check-reading-choubun";
import { buildChoubunEntry } from "../scripts/gen-reading-choubun";
import {
  AUTHORED_MAX_EVIDENCE_RATIO,
  AUTHORED_MIN_EVIDENCE_RUNES,
  AUTHORED_MIN_INTENTS,
  AUTHORED_SIGNER,
  comprehensionIntentFor,
} from "../scripts/reading-authored-corpus";
import {
  CHOUBUN_AUTHORED_BAND,
  CHOUBUN_COVERAGE_FLOOR,
  CHOUBUN_MAX_PASSAGE_LENGTH,
  CHOUBUN_MIN_PASSAGE_LENGTH,
  readChoubunRejections,
} from "../scripts/reading-choubun-corpus";
import {
  buildFrameFillers,
  COVERAGE_FLOOR,
  coverageOf,
  frameKeyFor,
  LEVEL_RANKS,
  splitSentences,
} from "../scripts/reading-chuubun-corpus";
import { BLANK } from "../scripts/reading-n4-corpus";
import { identityRejectionTests } from "./reading-identity-suite";
import { INDEX, VOCAB } from "./reading-noun-vocab";
import { vocabFixtureDir } from "./reading-store-fixture";

const FILLER =
  "これはとてもながいぶんしょうでありまして、よみにくいところもありますが、さいごまでよんでください。";

/** Twenty-two kanji with no entry in this fixture's index, none of them a
 * distractor or the answer: enough copies put a window under the 0.85 floor
 * while keeping it inside the 900-1200 band. */
const KANJI = "継続的発展推進検討会構成員選出方法改善措置実施";

const P1 = FILLER.repeat(10);
const P2 = `${FILLER.repeat(9)}電車が降る。`;
const SOURCE_TEXT = `${P1}\n${P2}`;
const WINDOW_KEY = "t-1+t-2";
/** The fixture corpus's two paragraphs as one jsonl block: every store dir whose
 * rows make the whole-file walk read the 白書 writes exactly this. */
const HAKUSHO_LINES = `${[
  { id: "t-1", pageId: "t", source: "credit", text: P1 },
  { id: "t-2", pageId: "t", source: "credit", text: P2 },
]
  .map((row) => JSON.stringify(row))
  .join("\n")}\n`;
// `Record<string, number>` read through a variable key with a fallback, the
// form every check script in this package uses: tsc's noUncheckedIndexedAccess
// needs the fallback and biome's useLiteralKeys forbids the shorthand form.
const LEVEL: string = "N1";
const N1_RANK = LEVEL_RANKS[LEVEL] ?? 0;
const N1_COVERAGE_FLOOR = COVERAGE_FLOOR[LEVEL] ?? 1;

const base = buildChoubunEntry(
  {
    ids: ["t-1", "t-2"],
    pageId: "t",
    pageUrl: "https://example.test/",
    runes: [...SOURCE_TEXT].length,
    sourceCredit: "credit",
    text: SOURCE_TEXT,
  },
  "N1",
  INDEX,
  new Map()
);

if (base === null) {
  throw new Error("fixture must produce a 長文 row");
}

const HARD_SOURCE = `${P1}\n${FILLER.repeat(8)}${KANJI.repeat(8)}電車が降る。`;

const check = (
  entry: ChoubunReadingEntry,
  sourceText: string = SOURCE_TEXT,
  rejections: ReadonlySet<string> = new Set(),
  spent: ReadonlySet<string> = new Set()
): readonly string[] =>
  checkEntry({
    entry,
    fillers: new Map(),
    index: INDEX,
    level: "N1",
    rejections,
    spent,
    windows: new Map([[WINDOW_KEY, sourceText]]),
  });

const withEntry = (
  overrides: Partial<ChoubunReadingEntry>
): ChoubunReadingEntry => ({ ...base, ...overrides });

describe("checkEntry: a valid generated row passes", () => {
  it("reports no issues", () => {
    expect(check(base)).toEqual([]);
  });

  it("keeps the fixture inside the band it is tested against", () => {
    const runes = [...base.passage].length;
    expect(runes).toBeGreaterThanOrEqual(CHOUBUN_MIN_PASSAGE_LENGTH);
    expect(runes).toBeLessThanOrEqual(CHOUBUN_MAX_PASSAGE_LENGTH);
  });
});

describe("checkEntry: the construction defects it exists to catch", () => {
  it("rejects a tampered blank (the answer no longer restores the window)", () => {
    const tampered = withEntry({ passage: base.passage.replace(BLANK, "雪") });
    expect(check(tampered)).toContain("passage-not-restorable-to-source");
  });

  it("rejects a distractor printed in the source", () => {
    const swapped = base.options.map((option, index) =>
      index === base.answerIndex ? option : "降る"
    );
    expect(check(withEntry({ options: swapped }))).toContain(
      "distractor-occurs-in-source"
    );
  });

  const battery = {
    base,
    gate: (entry: ChoubunReadingEntry, ids: ReadonlySet<string>) =>
      check(entry, SOURCE_TEXT, ids),
    tamper: withEntry,
  };
  identityRejectionTests(battery);

  it("rejects a row that lost its construction tag", () => {
    expect(check(withEntry({ construction: undefined }))).toContain(
      "construction-not-masked-slot"
    );
  });

  it("rejects a row stamped for another 大問", () => {
    expect(check(withEntry({ block: "naiyou-rikai-chuubun" }))).toContain(
      "block-not-choubun"
    );
  });

  it("rejects a paragraph another store already prints", () => {
    // The same screen the generator runs, named per paragraph so the receipt of a
    // failed freeze says WHICH window member collided.
    expect(check(base, SOURCE_TEXT, new Set(), new Set(["t-2"]))).toContain(
      "source-spent-by-another-store:t-2"
    );
  });

  it("rejects a passage outside the 長文 band on either side", () => {
    const tooLong = withEntry({
      passage: `${".".repeat(10)}${"あ".repeat(CHOUBUN_MAX_PASSAGE_LENGTH)}＿＿だ。`,
    });
    expect(check(tooLong)).toContain("passage-too-long");
    const tooShort = withEntry({ passage: "短い＿＿文。" });
    expect(check(tooShort)).toContain("passage-too-short");
  });

  it("rejects a window the corpus does not admit", () => {
    // No ids at all, and an id list that is not one of the corpus's windows. The
    // gate looks the list up in `choubunWindowsFor`'s own output, so a gap, a
    // cross-page pair and a collage all land on one issue: adjacency, page scope
    // and the band are that builder's rules, not four hand-written predicates.
    expect(check(withEntry({ sourceIds: [] }))).toContain("sourceIds-empty");
    expect(check(withEntry({ sourceIds: ["t-1", "t-3"] }))).toContain(
      "window-not-admissible"
    );
    expect(check(withEntry({ sourceIds: ["t-2"] }))).toContain(
      "window-not-admissible"
    );
  });

  it("rejects a window under this block's own floor", () => {
    const hard = withEntry({ passage: HARD_SOURCE.replace("電車", BLANK) });
    expect(coverageOf(HARD_SOURCE, INDEX, N1_RANK)).toBeLessThan(
      CHOUBUN_COVERAGE_FLOOR
    );
    expect(check(hard, HARD_SOURCE)).toEqual([
      "source-coverage-below-choubun-floor",
    ]);
  });

  it("screens 長文 looser than every other 大問 at N1, on purpose", () => {
    // The divergence this gate is the only witness of: a window cleared of the
    // 中文 bar must still be refused by nothing here.
    expect(CHOUBUN_COVERAGE_FLOOR).toBeLessThan(N1_COVERAGE_FLOOR);
    expect(coverageOf(SOURCE_TEXT, INDEX, N1_RANK)).toBeLessThan(1);
  });

  it("rejects a slot whose frame the corpus licenses another noun in", () => {
    const answer = base.options[base.answerIndex] as string;
    const sentences = splitSentences({
      id: "source",
      license: "",
      pageId: "",
      pageUrl: "",
      source: "",
      text: SOURCE_TEXT,
      title: "",
    });
    const sentenceIndex = sentences.findIndex((sentence) =>
      sentence.text.includes(answer)
    );
    const key = frameKeyFor(sentences, sentenceIndex, answer, INDEX);
    const fillers = buildFrameFillers(sentences, INDEX, N1_RANK);
    // The real screen says one noun fills this frame; the tampered map claims a
    // second, and the row must stop being defensible on that alone.
    expect([...(fillers.get(key) ?? new Set())]).toEqual([answer]);
    const tampered = new Map(fillers);
    tampered.set(key, new Set([...(fillers.get(key) ?? new Set()), "雪"]));
    expect(
      checkEntry({
        entry: base,
        fillers: tampered,
        index: INDEX,
        level: "N1",
        rejections: new Set(),
        spent: new Set(),
        windows: new Map([[WINDOW_KEY, SOURCE_TEXT]]),
      })
    ).toContain("answer-frame-ambiguous");
  });
});

describe("checkReadingFile: the file-level invariants", () => {
  /** A store dir with the fixture's own two-paragraph corpus and a cumulative
   * index built from the shared seven-word vocabulary, so the whole-file walk
   * costs milliseconds instead of re-reading the shipped 白書 and word lists (the
   * row-level half above, and `bun run check:reading-choubun`, cover the real
   * freeze). */
  const storeWith = (rows: readonly ChoubunReadingEntry[]): string => {
    const { storeDir } = vocabFixtureDir({
      prefix: "choubun-file-",
      vocab: VOCAB,
    });
    writeFileSync(join(storeDir, "hakusho.jsonl"), HAKUSHO_LINES, "utf8");
    const storePath = join(storeDir, "n1-choubun.json");
    writeFileSync(storePath, JSON.stringify(rows), "utf8");
    return storePath;
  };

  const reportsOf = (rows: readonly ChoubunReadingEntry[]) => {
    const storePath = storeWith(rows);
    return checkReadingFile({
      dataDir: join(storePath, "../.."),
      level: "N1",
      storePath,
    });
  };

  it("refuses one row printed twice, by id, text, source and answer", () => {
    const issues = reportsOf([base, base]).flatMap((report) => report.issues);
    expect(issues).toContain("duplicate-id");
    expect(issues).toContain("duplicate-passage");
    expect(issues).toContain("duplicate-source");
    expect(issues).toContain("duplicate-answer");
  });

  it("refuses a store too small to fill one real 大問", () => {
    // N1 大問10 prints 4 小問, so a 1-row freeze is a shortfall the gate names
    // rather than a paper that quietly drops the block.
    const reports = reportsOf([base]);
    const fileReport = reports.find((report) => report.entryId === "(file)");
    expect(fileReport?.issues).toEqual(["too-few-items:1<4"]);
  });

  it("reads a row the shipped judge record rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "choubun-reject-"));
    writeFileSync(
      join(dir, "n1-choubun-rejected.json"),
      JSON.stringify([{ rejectedIds: [base.id] }]),
      "utf8"
    );
    expect(
      check(base, SOURCE_TEXT, readChoubunRejections(dir, "N1"))
    ).toContain("row-judge-rejected");
  });
});

/**
 * The authored branch (TASK-173.9.16 AC#2): a comprehension 小問 with no source
 * window, so none of the corpus screens above run on it. These tests are the
 * evidence that the branch is a screen and not a pass-through: every defect the
 * shape can express has to be named, and the clean row has to pass with NO 白書
 * corpus, NO spent set and NO frame map in scope.
 */
const W_LINE =
  "担当者は毎朝、道路の表面温度と地面の温度と通行人の数を同じ時刻に測り、ノートの余白にその日の天気も書きつけている。";
const W_EVIDENCE = "地面に太陽の光が当たらなければ、道路が熱を外へ出さない。";
const W_PASSAGE = `${W_LINE.repeat(7)}\n${W_EVIDENCE}だから日が落ちてからも道路は冷めにくいという。\n${W_LINE.repeat(2)}`;
const W_STEM =
  "歩道に木を植えると、夜の町も涼しくなるといわれているのはなぜか。";
// A `Record<string, PassageBand>` read through a variable key with a fallback,
// the same form as `LEVEL_RANKS[LEVEL] ?? 0` above: a literal key here would be
// either an unreachable fallback for biome or a possibly-undefined for tsc.
const N3_KEY: string = "N3";
const N3_BAND = CHOUBUN_AUTHORED_BAND[N3_KEY] ?? { max: 0, min: 0 };

const authored = (
  overrides: Partial<ChoubunReadingEntry> = {}
): ChoubunReadingEntry => ({
  answerIndex: 1,
  block: "naiyou-rikai-choubun",
  construction: "authored",
  evidence: W_EVIDENCE,
  id: "w-1",
  level: "N3",
  options: [
    "毎日同じ時刻に測っているから。",
    "地面が太陽の熱をためないから。",
    "歩行者の数が減ったから。",
    "担当者がノートを続けているから。",
  ],
  passage: W_PASSAGE,
  provenance: "composed",
  stem: W_STEM,
  validated: true,
  validatedBy: AUTHORED_SIGNER,
  ...overrides,
});

/** The authored row's own check: no corpus, no spent set, no frame map. Nothing
 * here reads `hakusho.jsonl`, which is the point. */
const checkWritten = (entry: ChoubunReadingEntry): readonly string[] =>
  checkEntry({
    entry,
    fillers: new Map(),
    index: INDEX,
    level: "N3",
    rejections: new Set(),
    spent: new Set(),
    windows: new Map(),
  });

describe("checkEntry: an authored row", () => {
  it("passes with no corpus in scope", () => {
    expect(checkWritten(authored())).toEqual([]);
  });

  it("keeps the fixture inside the band it is tested against", () => {
    const runes = [...W_PASSAGE].length;
    expect(runes).toBeGreaterThanOrEqual(N3_BAND.min);
    expect(runes).toBeLessThanOrEqual(N3_BAND.max);
  });

  it("refuses a level with no authored band", () => {
    // N2 prints no 内容理解（長文）大問 at all, so the authored arm has no N2 band
    // and cannot borrow N1's or N3's. A row tagged authored at a level this table
    // does not name is a mistake, not a pass: it has no screens to run. (N1 had no
    // band here until TASK-173.9.21 wrote that level's 長文 store.)
    expect(
      checkEntry({
        entry: authored({ level: "N2" }),
        fillers: new Map(),
        index: INDEX,
        level: "N2",
        rejections: new Set(),
        spent: new Set(),
        windows: new Map(),
      })
    ).toContain("authored-band-unknown");
  });

  it("refuses the masked-slot signature on an authored row", () => {
    expect(checkWritten(authored({ validatedBy: undefined }))).toContain(
      "validatedBy-not-authored-signer"
    );
    expect(
      checkWritten(
        authored({ validatedBy: "deterministic:gen-reading-choubun" })
      )
    ).toContain("validatedBy-not-authored-signer");
  });

  it("refuses a row that lost its construction tag", () => {
    // Untagged falls to the masked-slot arm and fails there, so a row can never
    // switch itself onto the branch with fewer screens by dropping the tag.
    expect(checkWritten(authored({ construction: undefined }))).toContain(
      "construction-not-masked-slot"
    );
  });

  it("refuses an authored row that claims a source window or a slot", () => {
    expect(
      checkWritten(authored({ sourceIds: ["t-1"], sourceUrl: "x" }))
    ).toContain("authored-row-carries-sourceIds");
    expect(
      checkWritten(authored({ passage: W_PASSAGE.replace(W_EVIDENCE, BLANK) }))
    ).toContain("authored-row-carries-blank");
    expect(checkWritten(authored({ stem: `${W_STEM}＿＿` }))).toContain(
      "authored-row-carries-blank"
    );
  });

  it("refuses a passage outside the authored band on either side", () => {
    expect(checkWritten(authored({ passage: "みず。" }))).toContain(
      "passage-too-short"
    );
    expect(
      checkWritten(
        authored({ passage: `あ\n${"あ".repeat(CHOUBUN_MAX_PASSAGE_LENGTH)}` })
      )
    ).toContain("passage-too-long");
  });

  it("refuses a single-paragraph passage", () => {
    // 長文 means a document. One `<p>` at 500 runes is the 中文 store wearing a
    // 長文 heading, which is doc-27 §4's genre failure.
    expect(checkWritten(authored({ passage: W_LINE.repeat(9) }))).toContain(
      "passage-single-paragraph"
    );
  });

  it("refuses an option set the server cannot print", () => {
    expect(
      checkWritten(authored({ options: ["a。", "b。", "c。"] }))
    ).toContain("options-count-not-4");
    expect(
      checkWritten(authored({ options: ["a。", "b。", "b。", "c。"] }))
    ).toContain("options-not-distinct");
    expect(
      checkWritten(authored({ options: ["", "b。", "c。", "d。"] }))
    ).toContain("option-empty");
    expect(checkWritten(authored({ answerIndex: 9 }))).toContain(
      "answer-index-out-of-range"
    );
  });

  it("refuses a stem whose ねらい the table does not know", () => {
    expect(
      checkWritten(authored({ stem: "この文章について書きなさい。" }))
    ).toContain("stem-intent-unclassified");
  });

  it("reads a hedged なぜ stem as 理由, not as the 考え substring inside it", () => {
    /*
     * The store's spread is counted through this table, and 理由 is one of the
     * ねらい AC#7 requires it to reach. A 理由 stem here hedges itself as
     * 「〜と考えられているのはなぜか」, where 考え is the passive ("it is thought
     * that") rather than 筆者の考え, so the table's first match decides which of
     * the two the row is credited with. Pinned because a reordering that puts the
     * looser 考え marker back first silently drops 理由 from the store without
     * failing any screen.
     */
    expect(
      comprehensionIntentFor(
        "歩道に木を植えると、夜の町も少し涼しくなると考えられているのはなぜか。"
      )
    ).toBe("reason");
    // The genuine 主張 stem keeps its ねらい: no なぜ in it, so nothing competes.
    expect(
      comprehensionIntentFor(
        "この文章の筆者の考えとして、最も適切なものはどれか。"
      )
    ).toBe("opinion");
  });

  it("refuses an evidence span that is not the deciding sentence it prints", () => {
    expect(checkWritten(authored({ evidence: undefined }))).toContain(
      "evidence-missing"
    );
    expect(
      checkWritten(authored({ evidence: "これは文中にない文です。" }))
    ).toContain("evidence-not-in-passage");
    expect(
      checkWritten(
        authored({ evidence: W_LINE.slice(0, AUTHORED_MIN_EVIDENCE_RUNES - 1) })
      )
    ).toContain("evidence-too-short");
    expect(
      checkWritten(
        authored({
          evidence: W_LINE,
          passage: `${W_LINE}\n${W_EVIDENCE}だから日が落ちてからも冷めにくい。`,
        })
      )
    ).toContain("evidence-covers-whole-passage");
    expect(AUTHORED_MAX_EVIDENCE_RATIO).toBeLessThan(1);
  });

  it("refuses a row the judge recorded as ambiguous", () => {
    expect(
      checkEntry({
        entry: authored(),
        fillers: new Map(),
        index: INDEX,
        level: "N3",
        rejections: new Set(["w-1"]),
        spent: new Set(),
        windows: new Map(),
      })
    ).toContain("row-judge-rejected");
  });

  it("keeps the shared stamp and structure screens on this branch", () => {
    const issues = checkWritten(
      authored({ block: "naiyou-rikai-chuubun", provenance: "licensed" })
    );
    expect(issues).toContain("block-not-choubun");
    expect(issues).toContain("provenance-not-composed");
    expect(checkWritten(authored({ validated: false }))).toContain(
      "not-validated"
    );
    expect(
      checkWritten(
        authored({ answerIndex: 9, options: ["a。", "b。", "c。", "d。"] })
      ).some((issue) => issue.startsWith("structural:"))
    ).toBeTrue();
  });
});

describe("checkReadingFile: the authored store invariants", () => {
  /** A store dir with ONLY the shipped vocab files: no `hakusho.jsonl` at all, so
   * a file walk that still tried to read the 白書 would throw rather than pass. */
  const writtenStore = (rows: readonly ChoubunReadingEntry[]): string => {
    const { storeDir } = vocabFixtureDir({
      prefix: "choubun-written-",
      vocab: VOCAB,
    });
    const storePath = join(storeDir, "n3-choubun.json");
    writeFileSync(storePath, JSON.stringify(rows), "utf8");
    return storePath;
  };

  const reportsOf = (rows: readonly ChoubunReadingEntry[]) => {
    const storePath = writtenStore(rows);
    return checkReadingFile({
      dataDir: join(storePath, "../.."),
      level: "N3",
      storePath,
    });
  };

  /** Four rows, four ねらい, four different passages and keys: one real N3
   * 大問6's worth. */
  const spreadRows = (): ChoubunReadingEntry[] =>
    [
      "この文の内容に合っているものはどれか。",
      "筆者は、店が閉まることを聞いてどんな気持ちになったか。",
      "『それ』はどんなことを指しているか。",
      W_STEM,
    ].map((stem, index) =>
      authored({
        answerIndex: index % 4,
        evidence: W_EVIDENCE,
        id: `w-${index + 1}`,
        options: [
          `一丁目の案。${index}`,
          `二丁目の案。${index}`,
          `三丁目の案。${index}`,
          `四丁目の案。${index}`,
        ],
        passage: `${W_LINE.repeat(7)}\n${W_EVIDENCE}だから日が落ちてからも道路は冷めにくいという。\n${W_LINE.repeat(2)}${"追加。".repeat(index)}`,
        stem,
      })
    );

  it("accepts a store that needs no corpus to be read", () => {
    const reports = reportsOf(spreadRows());
    expect(reports.flatMap((report) => report.issues)).toEqual([]);
  });

  it("refuses a store that asks one ねらい four times", () => {
    const oneIntent = spreadRows().map((row) => ({
      ...row,
      stem: W_STEM,
    }));
    const fileReport = reportsOf(oneIntent).find(
      (report) => report.entryId === "(file)"
    );
    expect(fileReport?.issues).toContain(
      `intents-below-floor:1<${AUTHORED_MIN_INTENTS}`
    );
  });

  it("refuses a store too small to fill one real 大問", () => {
    const fileReport = reportsOf(spreadRows().slice(0, 3)).find(
      (report) => report.entryId === "(file)"
    );
    expect(fileReport?.issues).toContain("too-few-items:3<4");
  });

  it("refuses one store that mixes the two constructions", () => {
    // A written row and a 白書 window row in one file: each branch's screens
    // would then run on rows they were not written for. This dir carries a
    // `hakusho.jsonl`, because the window row makes the gate read the corpus.
    const { dataDir, storeDir } = vocabFixtureDir({
      prefix: "choubun-mixed-",
      vocab: VOCAB,
    });
    writeFileSync(join(storeDir, "hakusho.jsonl"), HAKUSHO_LINES, "utf8");
    const storePath = join(storeDir, "n3-choubun.json");
    writeFileSync(
      storePath,
      JSON.stringify([authored({ id: "w-1" }), base]),
      "utf8"
    );
    const reports = checkReadingFile({ dataDir, level: "N3", storePath });
    expect(reports.flatMap((report) => report.issues)).toContain(
      "mixed-constructions"
    );
  });

  it("refuses an authored passage printed twice", () => {
    const issues = reportsOf([
      authored({ id: "w-1" }),
      authored({ id: "w-8" }),
    ]).flatMap((report) => report.issues);
    expect(issues).toContain("duplicate-passage");
  });
});

/*
 * TASK-173.9.21 AC#3 has two halves at the level that converted, and each needs
 * its own witness. The authored arm needed a FILE-level proof at N1: every other
 * authored case in this file is gated at N3, and N1 is the store a real N1 paper
 * serves. The windowed arm needed the opposite proof: it stays falsifiable at N1
 * (the whole first half of this file runs at that level) and it cannot be
 * re-entered by hand, because one 白書 window row inside the authored N1 file is
 * refused by `mixed-constructions` before either arm's screens run.
 */
describe("checkReadingFile: the authored N1 store", () => {
  const N1_KEY: string = "N1";
  const N1_BAND = CHOUBUN_AUTHORED_BAND[N1_KEY] ?? { max: 0, min: 0 };

  /** The N3 fixture's own sentences over the 900-1200 rune band N1 prints: the
   * document is longer, not different, because the band is what the level
   * changes. 12 + 1 + 4 copies measures 965 runes. */
  const n1Passage = (extra: string): string =>
    `${W_LINE.repeat(12)}\n${W_EVIDENCE}だから日が落ちてからも道路は冷めにくいという。\n${W_LINE.repeat(4)}${extra}`;

  const storeDirWith = (rows: readonly ChoubunReadingEntry[]): string => {
    const { storeDir } = vocabFixtureDir({
      prefix: "choubun-n1-",
      vocab: VOCAB,
    });
    writeFileSync(join(storeDir, "n1-choubun.json"), JSON.stringify(rows));
    return storeDir;
  };

  const reportsOfN1 = (rows: readonly ChoubunReadingEntry[]) => {
    const storeDir = storeDirWith(rows);
    const storePath = join(storeDir, "n1-choubun.json");
    return checkReadingFile({
      dataDir: join(storePath, "../.."),
      level: "N1",
      storePath,
    });
  };

  /** Four rows, four ねらい, four passages and keys that differ: one real N1
   * 大問10's worth. */
  const spreadN1Rows = (): ChoubunReadingEntry[] =>
    [
      "この文の内容に合っているものはどれか。",
      "筆者は、町が暑くなったことを聞いてどんな気持ちになったか。",
      "『それ』はどんなことを指しているか。",
      W_STEM,
    ].map((stem, index) =>
      authored({
        answerIndex: index % 4,
        evidence: W_EVIDENCE,
        id: `wn1-${index + 1}`,
        level: "N1",
        options: [
          `一丁目の案。${index}`,
          `二丁目の案。${index}`,
          `三丁目の案。${index}`,
          `四丁目の案。${index}`,
        ],
        passage: n1Passage("追加。".repeat(index)),
        stem,
      })
    );

  it("screens a written N1 row against the band N1 prints", () => {
    const runes = [...n1Passage("")].length;
    expect(runes).toBeGreaterThanOrEqual(N1_BAND.min);
    expect(runes).toBeLessThanOrEqual(N1_BAND.max);
    expect(
      checkEntry({
        entry: authored({ level: "N1", passage: n1Passage("") }),
        fillers: new Map(),
        index: INDEX,
        level: "N1",
        rejections: new Set(),
        spent: new Set(),
        windows: new Map(),
      })
    ).toEqual([]);
  });

  it("accepts a written N1 store that needs no corpus to be read", () => {
    expect(
      reportsOfN1(spreadN1Rows()).flatMap((report) => report.issues)
    ).toEqual([]);
  });

  it("refuses one windowed row inside the converted N1 store", () => {
    // The store this task froze prints no `＿＿` and cites no paragraph, so a
    // hand-edit that pastes a 白書 window back in has to be stopped at the file:
    // the two branches prove different things, and a mixed file lets a row pick
    // the easier one. This dir carries `hakusho.jsonl` because the windowed row
    // makes the whole-file walk read the corpus.
    const storeDir = storeDirWith([
      spreadN1Rows()[0] as ChoubunReadingEntry,
      base,
    ]);
    writeFileSync(join(storeDir, "hakusho.jsonl"), HAKUSHO_LINES, "utf8");
    const storePath = join(storeDir, "n1-choubun.json");
    const reports = checkReadingFile({
      dataDir: join(storePath, "../.."),
      level: "N1",
      storePath,
    });
    expect(reports.flatMap((report) => report.issues)).toContain(
      "mixed-constructions"
    );
  });
});
